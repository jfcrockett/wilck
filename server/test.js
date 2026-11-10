// node test.js : the one check that fails if the alert rules break.
import assert from 'node:assert';
delete process.env.VAPID_PRIVATE;
const {events} = await import('./index.js');
const now = Date.parse('2026-11-10T12:00:00-08:00'), fc = [{time: '2026-11-10T13:00:00-08:00', waitTime: 60}];
const ride = (status, wait) => ({id: 'r', name: 'Space Mountain', entityType: 'ATTRACTION', status, queue: {STANDBY: {waitTime: wait}}, forecast: fc});
const d = {sel: new Set(['r', 's']), done: new Set(), ll: {r: {start: now + 5 * 6e4, end: now + 65 * 6e4}}, llAt: now - 3 * 36e5, prev: {}, fired: new Set()};
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
console.log('ok');
