'use strict';
const assert = require('assert'), createWheel = require('./wheel');
const events = [], said = [], timers = []; let n = 0;
const W = createWheel({ broadcast: (e, d) => events.push(d), say: (t) => said.push(t), pick: (k) => (n++ * 7 + 3) % k, rand: () => 0.5, setTimeout: (f, ms) => { timers.push({ f, ms }); return { unref() {} }; }, clearTimeout: () => {} });
assert.deepEqual(W.clean('pizza, tacos | sushi ,, '), ['pizza', 'tacos', 'sushi']); assert.equal(W.clean(Array.from({ length: 30 }, (_, i) => 'o' + i)).length, 16); assert.equal(W.clean(['x'.repeat(60)])[0].length, 40);
assert(W.spin({ options: ['only one'] }).error, 'needs 2 options'); assert(W.spin({ options: '' }).error);
const r = W.spin({ title: 'Dinner', options: ['pizza', 'tacos', 'sushi'] }); assert(r.ok && r.options[r.index] === r.winner);
const e = events[0]; assert.equal(e.type, 'wheel:spin'); assert.deepEqual(e.options, ['pizza', 'tacos', 'sushi']); assert.equal(e.index, r.index); assert(e.turns >= 5 && e.turns <= 7); assert(Math.abs(e.jitter) <= 0.35);
assert(W.spin({ options: ['a', 'b'] }).error, 'busy while spinning'); assert(W.active());
timers.find((t) => t.ms < 8000).f(); assert.equal(said.length, 1); assert(said[0].includes('Dinner') && said[0].includes(r.winner), said[0]);
timers.filter((t) => t.ms > 12000).forEach((t) => t.f()); assert(!W.active()); assert(W.spin({ options: ['a', 'b'], silent: true }).ok);
timers.slice(-2)[0].f(); assert.equal(said.length, 1, 'a silent spin says nothing');
assert(W.cancel().ok && events[events.length - 1].type === 'stop' && !W.active()); assert(W.cancel().error);
// fairness: every option comes up (the real picker is crypto.randomInt)
const real = createWheel({ broadcast: (ev, d) => events.push(d), say() {}, setTimeout: () => ({ unref() {} }), clearTimeout() {} }), seen = new Set();
for (let i = 0; i < 400; i++) { const x = real.spin({ options: ['a', 'b', 'c', 'd'], silent: true }); seen.add(x.winner); real.cancel(); }
assert.equal(seen.size, 4, 'all four options win sometimes');
// percentages: slices sized by them, the rest shared out, zero percent left off, and the odds are honoured
const sh = (l, p) => W.shares(W.entries(l, p)).map((x) => Math.round(x * 1000) / 1000);
assert.deepEqual(sh(['a', 'b', 'c', 'd']), [0.25, 0.25, 0.25, 0.25]); assert.deepEqual(sh(['a', 'b', 'c'], [50, NaN, NaN]), [0.5, 0.25, 0.25]); assert.deepEqual(sh(['a', 'b'], [30, 30]), [0.5, 0.5], 'always adds up to 100%');
assert.deepEqual(sh(['a', 'b', 'c'], [0, 0, 0]), [0.333, 0.333, 0.333]);
const wr = createWheel({ broadcast: (ev, d) => events.push(d), say() {}, setTimeout: () => ({ unref() {} }), clearTimeout() {} }), cnt = { a: 0, b: 0, c: 0 };
for (let i = 0; i < 3000; i++) { const x = wr.spin({ options: ['a', 'b', 'c'], pct: [70, 30, 0], silent: true }); cnt[x.winner]++; wr.cancel(); }
assert.equal(cnt.c, 0, '0% never wins'); assert(cnt.a > 1900 && cnt.a < 2300, 'a wins about 70% of the time: ' + cnt.a);
const ev = events.filter((x) => x.type === 'wheel:spin').pop(); assert.deepEqual(ev.options, ['a', 'b']); assert(Math.abs(ev.pcts[0] - 0.7) < 1e-9); assert(wr.spin({ options: ['a', 'b'], pct: [100, 0] }).error, 'one option left is not a wheel');
console.log('wheel test passed');
