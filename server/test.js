// node test.js : the one check that fails if the alert rules break.
import assert from 'node:assert';
delete process.env.VAPID_PRIVATE;
const {events} = await import('./index.js');
const now = Date.parse('2026-11-10T12:00:00-08:00'), fc = [{time: '2026-11-10T13:00:00-08:00', waitTime: 60}];
const ride = (status, wait) => ({id: 'r', name: 'Space Mountain', entityType: 'ATTRACTION', status, queue: {STANDBY: {waitTime: wait}}, forecast: fc});
const d = {sel: new Set(['r', 's']), done: new Set(), ll: {r: {start: now + 5 * 6e4, end: now + 65 * 6e4}}, llAt: now - 3 * 36e5,
  showAt: {s: Date.parse('2026-11-10T12:20:00-08:00')}, focus: new Set(['r']), prev: {}, fired: new Set()};
const show = {id: 's', name: 'Fantasmic!', entityType: 'SHOW', showtimes: [{type: 'Performance Time', startTime: '2026-11-10T12:20:00-08:00'}]};
const run = r => events(d, new Map([['r', r], ['s', show]]), now);
let e = run(ride('DOWN', null));
assert(e.some(x => x.includes('Fantasmic')) && e.some(x => x.includes('opens at')) && e.some(x => x.includes('book your next')), 'first pass: show, LL soon, next booking');
e = run(ride('OPERATING', 50));
assert.deepEqual(e, ['Space Mountain is back up · 50 min'], 'back up, and nothing repeats');
e = run(ride('OPERATING', 30));
assert(e.length === 1 && e[0].includes('dropped to 30 min (usually 60)'), 'great wait');
assert.deepEqual(run(ride('OPERATING', 30)), [], 'quiet when nothing changes');
d.done.add('r');
assert.deepEqual(run(ride('DOWN', null)), [], 'done rides stay quiet');
d.done.delete('r'); d.focus.clear(); run(ride('OPERATING', 60));
assert.deepEqual(run(ride('DOWN', null)), [], 'down is quiet when the ride is not next up or nearby');
run(ride('OPERATING', 60));
assert.deepEqual(run(ride('OPERATING', 30)), [], 'great wait only once a day per ride');
d.done.add('r');
// A planned show time wins over the next performance.
const show2 = {...show, showtimes: [{type: 'Performance Time', startTime: '2026-11-10T12:10:00-08:00'}, {type: 'Performance Time', startTime: '2026-11-10T13:00:00-08:00'}]};
const d2 = {sel: new Set(['s']), done: new Set(), ll: {}, llAt: 0, showAt: {s: Date.parse('2026-11-10T13:00:00-08:00')}, prev: {}, fired: new Set()};
assert.deepEqual(events({...d2, showAt: {}, fired: new Set()}, new Map([['s', show2]]), now), [], 'shows without a planned time stay quiet');
const turtle = {id: 't', name: 'Turtle Talk with Crush', entityType: 'ATTRACTION', status: 'OPERATING', queue: {}};
const d3 = {sel: new Set(['t']), done: new Set(), ll: {}, llAt: 0, showAt: {t: now + 20 * 6e4}, focus: new Set(), prev: {}, fired: new Set()};
assert(events(d3, new Map([['t', turtle]]), now)[0].startsWith('🕐 Turtle Talk'), 'a ride at a set time alerts like a show');
assert.deepEqual(events(d2, new Map([['s', show2]]), now), [], 'no alert for the 12:10 you did not plan');
assert(events(d2, new Map([['s', show2]]), now + 35 * 6e4)[0].includes('1:00 PM'), 'alert for the planned 1:00');
console.log('ok');
