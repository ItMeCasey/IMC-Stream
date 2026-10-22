'use strict';
const assert = require('assert'), createWords = require('./words');
// a tiny word list: LISTEN has many words, the rest are padding so a board of the right size exists
const WORDS = ['listen', 'silent', 'tinsel', 'enlist', 'inlets', 'lint', 'line', 'lens', 'lent', 'list', 'silt', 'site', 'sine', 'nest', 'net', 'ten', 'tin', 'sit', 'sin', 'set', 'let', 'lie', 'ens', 'ins', 'its', 'nit', 'tie', 'lit', 'els', 'tile', 'tils', 'stile', 'islet', 'inlet', 'least'];
const said = [], events = [], paid = [], timers = []; let t = 1e6;
const W = createWords({ words: WORDS, rng: () => 0.01, now: () => t, say: (m) => said.push(m), broadcast: (e, d) => events.push(d), award: (id, name, n, why) => paid.push({ id, name, n, why }), currency: () => 'points', cfg: () => ({ rounds: 2, seconds: 60, letters: 6, perLetter: 2, pangram: 25, mvp: 25 }),
  setTimeout: (f, ms) => { const x = { f, ms }; timers.push(x); return x; }, clearTimeout: (x) => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); } });
const fire = () => { const x = timers.sort((a, b) => a.ms - b.ms).shift(); t += x.ms; x.f(); };   // run the next timer
const last = () => events[events.length - 1].s;

assert(W.stop().error, 'nothing to stop'); assert.equal(W.guess({ id: 1, name: 'A' }, 'tin'), false, 'no game, no guesses');
assert(W.answersFor('listen').includes('tin') && W.answersFor('listen').includes('listen') && !W.answersFor('listen').includes('least'), 'only words from the letters count');
assert.equal(W.start({ by: 'Mod' }).ok, true); assert(W.start({}).error, 'only one game at a time'); assert.equal(last().phase, 'intro'); assert(said[0].includes('WORD RUSH'));
fire();   // intro over: round 1 starts
let s = last(); assert.equal(s.phase, 'round'); assert.equal(s.round, 1); assert.equal(s.N, 6); assert.equal([...s.letters].sort().join(''), [...'listen'].sort().join(''));
assert(s.words.every((w) => w.w === null), 'hidden words are never sent'); assert(!JSON.stringify(s).includes('"tin"'), 'and not leaked anywhere in the state');
assert.equal(W.guess({ id: 1, name: 'Ann' }, 'xyz'), false); assert.equal(W.guess({ id: 1, name: 'Ann' }, 'hello world'), false);
assert.equal(W.guess({ id: 1, name: 'Ann' }, 'Tin'), true, 'case does not matter'); s = last(); assert.equal(s.found, 1); assert(s.words.some((w) => w.w === 'tin' && w.by === 'Ann'));
const before = events.length; assert.equal(W.guess({ id: 2, name: 'Bob' }, 'tin'), true); assert.equal(events.length, before, 'the second finder gets nothing');
assert.equal(W.guess({ id: 2, name: 'Bob' }, 'listen'), true); assert.equal(W.pointsFor('listen', 6), 12 + 25, 'a word with every letter earns the bonus'); assert.equal(W.pointsFor('tin', 6), 6);
assert(last().recent.some((r) => r.pangram));
assert.equal(W.guess({ id: 1, name: 'Ann' }, 'lens'), true);
// the hint comes halfway through
fire(); assert.equal(last().hint, true); assert(last().words.some((w) => w.first));
// the round ends: scores are paid out, the board is shown
fire(); s = last(); assert.equal(s.phase, 'review'); assert(s.words.every((w) => w.w), 'the board is revealed'); assert.equal(s.results.paid[0].name, 'Bob');
assert.deepEqual(paid.map((p) => [p.name, p.n]), [['Bob', 37 + 25], ['Ann', 6 + 8]], 'round points plus the top scorer bonus'); assert(paid.every((p) => p.why === 'words'));
assert(said.some((m) => m.includes('Round 1 over')));
fire();   // next round
s = last(); assert.equal(s.round, 2); assert.equal(s.scores.find((p) => p.name === 'Bob').pts, 37, 'the match score carries over'); assert(s.round_scores.length === 0, 'but the round score starts again');
W.guess({ id: 1, name: 'Ann' }, 'tin'); W.guess({ id: 3, name: 'Cy' }, 'line');
assert(W.skip().ok); assert.equal(last().phase, 'review'); assert.equal(paid.length, 4, 'ending a round early still pays');
fire(); s = last(); assert.equal(s.phase, 'final'); assert.equal(s.champion.name, 'Bob'); assert(said.some((m) => m.includes('Champion: Bob')));
fire(); assert.equal(last().phase, 'idle'); assert(!W.active());
// stopping mid-round pays what was earned, nobody is stuck, and a new game can start
W.start({ rounds: 1 }); fire(); W.guess({ id: 9, name: 'Dee' }, 'sit'); const n0 = paid.length; assert(W.stop().ok); assert.equal(paid.length, n0 + 1); assert.equal(paid[n0].n, 6); assert.equal(last().phase, 'idle'); assert(!W.active() && timers.length === 0, 'no timers are left behind');
// nobody playing for two rounds ends the game
W.start({ rounds: 5 });
while (W.active() && timers.length) fire(); assert(!W.active(), 'an empty game stops by itself'); assert(said.some((m) => m.includes('Nobody is playing')));
// the real word list: boards are a sensible size and every word is really buildable
const real = createWords({ broadcast() {}, say() {}, award() {}, setTimeout: () => ({}), clearTimeout() {} });
for (const n of [6, 7]) {
  let board = null, later = null; const r = createWords({ cfg: () => ({ letters: n }), broadcast: (e, d) => { if (d.s && d.s.letters) board = d.s; }, say() {}, award() {}, setTimeout: (f, ms) => { if (ms === 6000) later = f; return {}; }, clearTimeout() {} });
  r.start({}); later(); assert.equal(board.N, n); assert(board.total >= 12 && board.total <= (n === 6 ? 34 : 44), n + ' letters: ' + board.total + ' words'); r.stop();
}
assert(real.answersFor('garden').includes('danger') && real.answersFor('garden').includes('red') && !real.answersFor('garden').includes('gardens'));
console.log('words test passed');
