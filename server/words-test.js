'use strict';
const assert = require('assert'), createWords = require('./words');
// a tiny word list: LISTEN (6 letters) and LISTENS (7) have plenty of words
const WORDS = ['listens', 'listen', 'silent', 'tinsel', 'enlist', 'inlets', 'lint', 'line', 'lens', 'lent', 'list', 'silt', 'site', 'sine', 'nest', 'net', 'ten', 'tin', 'sit', 'sin', 'set', 'let', 'lie', 'ens', 'ins', 'its', 'nit', 'tie', 'lit', 'els', 'tile', 'tils', 'stile', 'islet', 'inlet', 'least'];
const said = [], events = [], paid = [], timers = []; let t = 1e6;
const CFG = { rounds: 2, seconds: 60, letters: 6, perLetter: 2, pangram: 25, mvp: 25, beat: 1 };
const W = createWords({ words: WORDS, rng: () => 0.01, now: () => t, say: (m) => said.push(m), broadcast: (e, d) => events.push(d), award: (id, name, n, why) => paid.push({ id, name, n, why }), currency: () => 'points', cfg: () => CFG,
  setTimeout: (f, ms) => { const x = { f, ms }; timers.push(x); return x; }, clearTimeout: (x) => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); } });
const fire = () => { const x = timers.sort((a, b) => a.ms - b.ms).shift(); t += x.ms; x.f(); };   // run the next timer
const last = () => events[events.length - 1].s;

// what each round looks like: one more letter every round, unknown letters from round 2, fake tiles from round 3
assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((r) => W.plan(r, 5)), [{ real: 5, unknown: 0, fake: 0 }, { real: 6, unknown: 1, fake: 0 }, { real: 7, unknown: 1, fake: 1 }, { real: 8, unknown: 2, fake: 1 }, { real: 9, unknown: 2, fake: 2 }, { real: 9, unknown: 3, fake: 2 }, { real: 9, unknown: 3, fake: 3 }]);

assert(W.stop().error, 'nothing to stop'); assert.equal(W.guess({ id: 1, name: 'A' }, 'tin'), false, 'no game, no guesses');
assert(W.answersFor('listen').includes('tin') && W.answersFor('listen').includes('listen') && !W.answersFor('listen').includes('least'), 'only words from the letters count');
assert(!W.answersFor('listen', 5).includes('tin') && W.answersFor('listen', 5).includes('listen'), 'a minimum length can be set');
assert.equal(W.start({ by: 'Mod' }).ok, true); assert(W.start({}).error, 'only one game at a time'); assert.equal(last().phase, 'intro'); assert(said[0].includes('WORD RUSH') && said[0].includes('fake or unknown'));
fire();   // intro over: round 1 starts
let s = last(); assert.equal(s.phase, 'round'); assert.equal(s.round, 1); assert.equal(s.N, 6); assert.equal([...s.letters].sort().join(''), [...'listen'].sort().join('')); assert.deepEqual(s.mods, { fake: 0, unknown: 0, hidden: 0 });
assert(s.words.every((w) => w.w === null), 'hidden words are never sent'); assert(!JSON.stringify(s).includes('"tin"'), 'and not leaked anywhere in the state');
assert.equal(W.guess({ id: 1, name: 'Ann' }, 'xyz'), false); assert.equal(W.guess({ id: 1, name: 'Ann' }, 'hello world'), false);
assert.equal(W.guess({ id: 1, name: 'Ann' }, 'Tin'), true, 'case does not matter'); s = last(); assert.equal(s.found, 1); assert(s.words.some((w) => w.w === 'tin' && w.by === 'Ann'));
const before = events.length; assert.equal(W.guess({ id: 2, name: 'Bob' }, 'tin'), true); assert.equal(events.length, before, 'the second finder gets nothing');
assert.equal(W.guess({ id: 2, name: 'Bob' }, 'listen'), true); assert.equal(W.pointsFor('listen', 6), 12 + 25, 'a word with every letter earns the bonus'); assert.equal(W.pointsFor('tin', 6), 6);
assert(last().recent.some((r) => r.pangram));
assert.equal(W.guess({ id: 1, name: 'Ann' }, 'lens'), true);
fire(); assert.equal(last().hint, true); assert(last().words.some((w) => w.first), 'the hint comes halfway through');
fire(); s = last(); assert.equal(s.phase, 'review'); assert(s.words.every((w) => w.w), 'the board is revealed'); assert.equal(s.results.paid[0].name, 'Bob');
assert.deepEqual(paid.map((p) => [p.name, p.n]), [['Bob', 37 + 25], ['Ann', 6 + 8]], 'round points plus the top scorer bonus'); assert(paid.every((p) => p.why === 'words'));
assert(said.some((m) => m.includes('Round 1 beaten')));
fire();   // round 2: one more letter, and one of them is unknown
s = last(); assert.equal(s.round, 2); assert.equal(s.N, 7); assert.equal(s.letters.length, 7); assert.equal([...s.letters].filter((c) => c === '?').length, 1, 'one letter is hidden'); assert.deepEqual(s.mods, { fake: 0, unknown: 1, hidden: 1 });
assert.equal(s.scores.find((p) => p.name === 'Bob').pts, 37, 'the match score carries over'); assert(s.round_scores.length === 0, 'but the round score starts again');
assert.equal(s.endsAt - s.startedAt, 70000, 'a longer rack gets more time');
W.guess({ id: 1, name: 'Ann' }, 'tin'); W.guess({ id: 3, name: 'Cy' }, 'line');
fire(); s = last(); assert.equal(s.letters.includes('?'), false, 'the unknown letter is revealed during the round'); assert.equal([...s.letters].sort().join(''), [...'listens'].sort().join('')); assert.equal(events[events.length - 1].ev.kind, 'reveal'); assert.equal(s.mods.hidden, 0);
assert(W.skip().ok); assert.equal(last().phase, 'review'); assert.equal(paid.length, 4, 'ending a round early still pays'); assert.deepEqual(last().fake, [], 'no fake tiles in round 2');
fire(); s = last(); assert.equal(s.phase, 'final'); assert.equal(s.champion.name, 'Bob'); assert(said.some((m) => m.includes('Champion: Bob')));
fire(); assert.equal(last().phase, 'idle'); assert(!W.active());
// stopping mid-round pays what was earned, nobody is stuck, and a new game can start
W.start({ rounds: 1 }); fire(); W.guess({ id: 9, name: 'Dee' }, 'sit'); const n0 = paid.length; assert(W.stop().ok); assert.equal(paid.length, n0 + 1); assert.equal(paid[n0].n, 6); assert.equal(last().phase, 'idle'); assert(!W.active() && timers.length === 0, 'no timers are left behind');
// a round chat fails (too few words found) ends the game; a round that is beaten goes on, with no limit on rounds when none is set
CFG.beat = 50; CFG.rounds = 0; W.start({}); assert(said[said.length - 1].includes('How many rounds can chat beat') && said[said.length - 1].includes('50%'));
fire(); W.guess({ id: 1, name: 'Ann' }, 'tin'); assert(W.skip().ok); s = last(); assert.equal(s.results.beaten, false); assert(s.results.need > 1 && s.results.found === 1); assert(said.some((m) => /Round 1 failed \(needed \d+\)/.test(m)));
fire(); s = last(); assert.equal(s.phase, 'final'); assert.equal(s.reached, 0); assert(said.some((m) => m.includes('Chat beat 0 rounds')), 'the game is over'); fire(); assert(!W.active());
// the share needed to beat a round starts at the setting and goes up 5% every round, to 100%
CFG.beat = 50; assert.deepEqual([1, 2, 3, 10, 11, 12, 20].map((r) => W.needPct(r)), [50, 55, 60, 95, 100, 100, 100]);
W.start({}); fire(); s = last(); assert.equal(s.rounds, 0, 'no round limit'); assert.equal(s.beat, 50); const w1 = W.answersFor('listen'); assert.equal(s.total, w1.length); assert.equal(s.need, Math.ceil(w1.length * 0.5));
w1.slice(0, s.need).forEach((w, i) => W.guess({ id: 1, name: 'Ann' }, w)); assert(W.skip().ok); assert.equal(last().results.beaten, true, 'half the words beat round 1');
fire(); s = last(); assert.equal(s.round, 2); assert.equal(s.beat, 55, 'round 2 needs 5% more'); const w2 = W.answersFor('listens'); assert.equal(s.need, Math.ceil(w2.length * 0.55));
w2.slice(0, Math.ceil(w2.length * 0.5)).forEach((w) => W.guess({ id: 1, name: 'Ann' }, w)); assert(W.skip().ok); assert.equal(last().results.beaten, false, 'the same half is not enough any more'); fire(); assert.equal(last().phase, 'final'); assert.equal(last().reached, 1); fire(); assert(!W.active());
CFG.rounds = 2; CFG.beat = 1;

// the real word list: every round of a long match has a sensible board, fake tiles are never used by a word, and unknown letters come out
const real = createWords({ broadcast() {}, say() {}, award() {}, setTimeout: () => ({}), clearTimeout() {} });
assert(real.answersFor('garden').includes('danger') && real.answersFor('garden').includes('red') && !real.answersFor('garden').includes('gardens'));
{
  const ev = [], tm = []; let clock = 0;
  const g = createWords({ broadcast: (e, d) => ev.push(d), say() {}, award() {}, now: () => clock, cfg: () => ({ rounds: 7, seconds: 60, letters: 5, perLetter: 2, pangram: 25, mvp: 25, beat: 1 }), introMs: () => 10, setTimeout: (f, ms) => { const x = { f, ms }; tm.push(x); return x; }, clearTimeout: (x) => { const i = tm.indexOf(x); if (i >= 0) tm.splice(i, 1); } });
  const step = () => { const x = tm.sort((a, b) => a.ms - b.ms).shift(); clock += x.ms; x.f(); }, cur = () => ev[ev.length - 1].s;
  g.start({ silent: true, rounds: 7 }); step();
  for (let r = 1; r <= 7; r++) {
    let s = cur(); const pl = g.plan(r, 5);
    assert.equal(s.phase, 'round'); assert.equal(s.round, r); assert.equal(s.N, pl.real); assert.equal(s.letters.length, pl.real + pl.fake, 'round ' + r + ': real letters plus fake tiles');
    assert.equal([...s.letters].filter((c) => c === '?').length, pl.unknown, 'round ' + r + ': unknown letters'); assert(s.total >= 12 && s.total <= 40, 'round ' + r + ' board has ' + s.total + ' words'); assert.deepEqual(s.fake, [], 'which tiles are fake is not shown during the round');
    while (cur().letters.includes('?')) step();   // the unknown letters turn up
    for (const w of real.answersFor(cur().letters, 3)) g.guess({ id: 'u', name: 'U' }, w);   // chat finds every word on the board (the share needed rises each round)
    g.skip(); s = cur(); assert.equal(s.phase, 'review'); assert.equal(s.fake.length, pl.fake, 'fake tiles are shown once the round is over'); assert.equal(s.letters.includes('?'), false);
    const good = [...s.letters].filter((c, i) => !s.fake.includes(i)).join(''); assert(s.words.every((w) => real.answersFor(good, 3).includes(w.w)), 'no word on the board uses a fake tile');
    if (r < 7) step();   // the review ends and the next round starts
  }
  g.stop();
}
// all-time stats: every scoring chatter is recorded after each round, and a game that beats more rounds than ever sets the record
{
  const st = [], rec = []; let best = 0, tm = []; const ev = []; let clock = 0;
  const g = createWords({ words: WORDS, rng: () => 0.01, now: () => clock, say() {}, broadcast: (e, d) => ev.push(d), award() {}, introMs: () => 10, cfg: () => ({ rounds: 1, seconds: 60, letters: 6, perLetter: 2, pangram: 25, mvp: 25, beat: 1 }),
    stats: { player: (id, name, x) => st.push([name, x.pts, x.words, x.round]), record: (r, by) => { rec.push([r, by]); const nr = r > best; best = Math.max(best, r); return nr; }, get: () => ({ record: { round: best, by: 'x' }, top: [{ name: 'A', pts: 5, words: 1, best: 1 }] }) },
    setTimeout: (f, ms) => { const x = { f, ms }; tm.push(x); return x; }, clearTimeout: (x) => { const i = tm.indexOf(x); if (i >= 0) tm.splice(i, 1); } });
  const step = () => { const x = tm.sort((a, b) => a.ms - b.ms).shift(); clock += x.ms; x.f(); };
  g.start({ silent: true }); step(); g.guess({ id: 1, name: 'Ann' }, 'tin'); g.guess({ id: 2, name: 'Bob' }, 'listen'); g.skip();
  assert.deepEqual(st, [['Bob', 37 + 25, 1, 1], ['Ann', 6, 1, 1]], 'each scorer is recorded with the bonus'); step();
  const f = ev[ev.length - 1].s; assert.equal(f.phase, 'final'); assert.deepEqual(rec, [[1, 'Bob']]); assert.equal(f.newRecord, true); assert.equal(f.record.round, 1); assert.equal(f.alltime.length, 1); step();
}
console.log('words test passed');
