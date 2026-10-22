'use strict';
const assert = require('assert'); const createRace = require('./race');
let ev = [], said = [], calls = [], timers = [], r = 0.3; const rng = () => (r = (r * 9301 + 49297.1) % 1, r);
const R = createRace({ rng, now: () => 1e6, cfg: () => ({ count: 4, seconds: 60, title: 'Who wins?', names: [] }), broadcast: (e, d) => ev.push(d), say: (t) => said.push(t),
  setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {},
  predict: { create: async (t, n, s) => { calls.push(['create', n.length, s]); return { id: 'P1', outcomes: n.map((x, i) => ({ id: 'o' + i, title: x })) }; }, lock: async (id) => calls.push(['lock', id]), resolve: async (id, o) => calls.push(['resolve', id, o]), cancel: async (id) => calls.push(['cancel', id]) } });
(async () => {
  const s = await R.start({}); assert(s.ok && s.horses.length === 4 && R.active()); assert((await R.start({})).error);
  assert.equal(ev[0].type, 'race:open'); assert((await R.run('Nope')).error);
  const res = await R.run(2); assert.equal(res.winner, s.horses[1]);
  const go = ev.find((e) => e.type === 'race:go'); assert.equal(go.winner, 1); const w = go.times[1]; assert(go.times.every((t, i) => i === 1 || t > w + 0.1));
  await timers.pop().f(); assert.deepEqual(calls.find((c) => c[0] === 'resolve'), ['resolve', 'P1', 'o1']); assert(said.pop().includes(s.horses[1])); assert(!R.active());
  await R.start({ names: ['A', 'B'], count: 5 }); await R.cancel(); assert(calls.some((c) => c[0] === 'cancel')); assert(!R.active());
  assert.equal((await createRace({ rng, cfg: () => ({ count: 4, seconds: 60, names: [] }), broadcast() {}, say() {}, predict: { create: async () => { throw new Error('boom'); } } }).start({})).error, 'boom');
  console.log('race ok');
})().catch((e) => { console.error(e); process.exit(1); });
