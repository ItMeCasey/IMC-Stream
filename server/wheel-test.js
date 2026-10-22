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
console.log('wheel test passed');
