// Wilck push server: checks Disneyland wait times every minute and sends Web Push to phones that signed up.
// The app posts its picks, done rides and Lightning Lane bookings to /sync; nothing else is stored.
// ponytail: state lives in memory. A restart forgets every phone until its app is next opened (it re-syncs
// on every refresh). Add a Railway volume + JSON file if restarts start losing alerts.
import http from 'node:http';
import webpush from 'web-push';

const LIVE = 'https://api.themeparks.wiki/v1/entity/bfc89fd6-314d-44b4-b89e-df1a89cf991e/live';
const ORIGIN = 'https://jfcrockett.github.io';
// Only real push services: stops this server being pointed at arbitrary URLs.
const PUSH_HOST = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
const TZ = 'America/Los_Angeles', MIN = 6e4, HOUR = 36e5, LL_GAP = 2 * HOUR, MAX_DEVICES = 50, MAX_PER_TICK = 3;
const parkDay = () => new Date().toLocaleDateString('en-CA', {timeZone: TZ});
const clock = t => new Date(t).toLocaleTimeString('en-US', {timeZone: TZ, hour: 'numeric', minute: '2-digit'});
const mins = ms => Math.max(0, Math.round(ms / MIN));

const devices = new Map();   // endpoint -> {sub, sel, done, ll, llAt, showAt, focus, date, seen, prev, fired}
// sel = picks in today's park only. focus = the next few rides in the plan + rides a short walk away (ids only, no location).

function send(d, body) {
  return webpush.sendNotification(d.sub, JSON.stringify({title: 'Wilck', body}), {TTL: 600, urgency: 'high'}).catch(e => {
    if (e.statusCode === 404 || e.statusCode === 410) devices.delete(d.sub.endpoint);   // phone unsubscribed
    else console.error('push failed', e.statusCode || e.message);
  });
}

// Pure: what should this phone hear about right now? Mutates d.prev / d.fired so nothing repeats.
export function events(d, byId, now) {
  const out = [], once = (key, text) => { if (!d.fired.has(key)) { d.fired.add(key); out.push(text); } };
  for (const id of d.sel) {
    const a = byId.get(id);
    if (!a) continue;
    if (a.entityType === 'SHOW') {
      // Only shows you've picked a time for.
      const t = d.showAt?.[id];
      if (t > now && t - now <= 30 * MIN) once('show' + id + t, `🎭 ${a.name} starts at ${clock(t)} (in ${mins(t - now)} min)`);
      continue;
    }
    if (d.done.has(id)) continue;
    const wait = a.status === 'OPERATING' ? (a.queue?.STANDBY?.waitTime ?? null) : null;
    const fc = (a.forecast || []).filter(f => f.waitTime > 0 && Date.parse(f.time) >= now - HOUR).map(f => f.waitTime);
    const typical = fc.length ? Math.round(fc.reduce((s, w) => s + w, 0) / fc.length) : 0;
    const great = wait > 10 && typical >= 20 && wait / typical <= .7;
    const p = d.prev[id];
    d.prev[id] = {s: a.status, g: great};
    if (!p) continue;
    const focus = d.focus?.has(id);   // up/down only matters for a ride you're about to do or standing near
    if (focus && p.s === 'DOWN' && a.status === 'OPERATING') out.push(`${a.name} is back up` + (wait != null ? ` · ${wait} min` : ''));
    else if (focus && p.s === 'OPERATING' && a.status === 'DOWN') out.push(`${a.name} just went down`);
    else if (great && !p.g) once('great' + id, `${a.name} dropped to ${wait} min (usually ${typical})`);   // once a day per ride
  }
  const name = id => byId.get(id)?.name || 'Your ride', windows = Object.entries(d.ll);
  for (const [id, w] of windows) {
    if (now >= w.start && now < w.end) once('open' + id + w.start, `⚡ ${name(id)}: Lightning Lane window is open until ${clock(w.end)}`);
    else if (now < w.start && w.start - now <= 10 * MIN) once('soon' + id + w.start, `⚡ ${name(id)}: Lightning Lane opens at ${clock(w.start)}`);
    if (now < w.end && w.end - now <= 15 * MIN) once('end' + id + w.start, `⚡ ${name(id)}: Lightning Lane ends in ${mins(w.end - now)} min`);
  }
  if (d.llAt && windows.length && now >= Math.min(d.llAt + LL_GAP, ...windows.map(([, w]) => w.start)))
    once('next' + d.llAt, '⚡ You can book your next Lightning Lane now');
  return out;
}

async function tick() {
  const now = Date.now(), today = parkDay();
  for (const [k, d] of devices) if (now - d.seen > 18 * HOUR) devices.delete(k);   // trip is over
  const active = [...devices.values()].filter(d => d.date === today);
  if (!active.length) return;
  const byId = new Map((await (await fetch(LIVE)).json()).liveData.map(a => [a.id, a]));
  for (const d of active) for (const text of events(d, byId, now).slice(0, MAX_PER_TICK)) await send(d, text);
}

const isIds = v => Array.isArray(v) && v.length <= 300 && v.every(x => typeof x === 'string' && x.length <= 40);
function sync(b) {
  const ep = b?.sub?.endpoint;
  if (typeof ep !== 'string' || !PUSH_HOST.test(new URL(ep).hostname) || !b.sub.keys?.p256dh || !b.sub.keys?.auth) return 400;
  if (!isIds(b.sel) || !isIds(b.done) || (b.focus != null && !isIds(b.focus)) || typeof b.ll !== 'object' || !b.ll || typeof b.date !== 'string') return 400;
  const old = devices.get(ep);
  if (!old && devices.size >= MAX_DEVICES) return 429;
  const ll = {};
  for (const [id, w] of Object.entries(b.ll).slice(0, 20)) if (Number.isFinite(w?.start) && Number.isFinite(w?.end)) ll[id] = {start: w.start, end: w.end};
  const showAt = {};
  for (const [id, t] of Object.entries(b.showAt && typeof b.showAt === 'object' ? b.showAt : {}).slice(0, 40)) if (id.length <= 40 && Number.isFinite(t)) showAt[id] = t;
  const keep = old && old.date === b.date;   // same park day: remember what was already announced
  const d = {sub: {endpoint: ep, keys: {p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth}}, sel: new Set(b.sel), done: new Set(b.done), ll,
    llAt: Number(b.llAt) || 0, showAt, focus: new Set(b.focus || []), date: b.date, seen: Date.now(), prev: keep ? old.prev : {}, fired: keep ? old.fired : new Set()};
  devices.set(ep, d);
  if (b.test) send(d, 'Notifications are on. You’ll hear about your rides and Lightning Lanes here.');
  return 204;
}

if (process.env.VAPID_PRIVATE) {   // not set under test.js
  webpush.setVapidDetails('https://jfcrockett.github.io/wilck/', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
  http.createServer((req, res) => {
    const head = {'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST'};
    if (req.method === 'OPTIONS') return res.writeHead(204, head).end();
    if (req.method === 'POST' && req.url === '/sync') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 20000) req.destroy(); });
      req.on('end', () => { let code = 400; try { code = sync(JSON.parse(body)); } catch {} res.writeHead(code, head).end(); });
      return;
    }
    res.writeHead(200, head).end(`wilck-push ok, ${devices.size} phone(s)`);
  }).listen(process.env.PORT || 3000);
  setInterval(() => tick().catch(e => console.error('tick failed', e.message)), 60000);
}
