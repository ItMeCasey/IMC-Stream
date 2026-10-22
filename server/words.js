'use strict';
/**
 * Word Rush: a full-screen pixel word game (overlays/words.html). Each round the overlay shows a rack of letters and a board of hidden words
 * that can be made from them. Chat types words (just the word, no command); the first person to type a word on the board gets it and its points.
 * After every round the points earned are paid out in the chat currency (plus a bonus for the top scorer), the board is revealed and a scoreboard
 * shows; a match is several rounds and keeps one running score. Only mods and the streamer can start it (the command level lives in bot.js).
 * The server decides everything (which words count, who was first); the overlay only draws what it is told.
 * Word list: server/words-list.txt, 3 to 7 letter words from the ENABLE list, which is in the public domain.
 */
const fs = require('node:fs');
const path = require('node:path');

const REVIEW_MS = 11000, FINAL_MS = 15000, MAX_ANSWERS = { 6: 34, 7: 44 }, MIN_ANSWERS = 12;
let LIST = null;
const loadList = () => LIST || (LIST = fs.readFileSync(path.join(__dirname, 'words-list.txt'), 'utf8').split('\n').filter(Boolean));

module.exports = function createWords(ctx) {
  const rng = ctx.rng || Math.random, now = ctx.now || Date.now, setT = ctx.setTimeout || setTimeout, clearT = ctx.clearTimeout || clearTimeout;
  const introMs = () => (typeof ctx.introMs === 'function' ? ctx.introMs() : 6000);
  const dict = () => ctx.words || loadList();
  const cfg = () => Object.assign({ rounds: 5, seconds: 90, letters: 6, perLetter: 2, pangram: 25, mvp: 25 }, (ctx.cfg && ctx.cfg()) || {});
  let game = null, timers = [];

  const later = (fn, ms) => { const t = setT(fn, ms); if (t && t.unref) t.unref(); timers.push(t); return t; };
  const clearAll = () => { timers.forEach((t) => clearT(t)); timers = []; };
  const shuffle = (s) => { const a = s.split(''); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.join(''); };

  /** every word in the list that can be made from these letters, 3 letters or more, each letter used at most as often as it appears */
  function answersFor(letters) {
    const base = {}; for (const ch of letters) base[ch] = (base[ch] || 0) + 1;
    const out = [];
    for (const w of dict()) {
      if (w.length > letters.length || w.length < 3) continue;
      const left = Object.assign({}, base); let ok = true;
      for (const ch of w) { if (!left[ch]) { ok = false; break; } left[ch]--; }
      if (ok) out.push(w);
    }
    return out;
  }
  /** a random N letter word whose board is a good size: enough words to be fun, few enough to fit on screen */
  function pickRound(n, used) {
    const pool = dict().filter((w) => w.length === n && !used.has(w)), max = MAX_ANSWERS[n] || 34; let best = null;
    for (let i = 0; i < 40 && pool.length; i++) {
      const base = pool[Math.floor(rng() * pool.length)], ans = answersFor(base);
      if (ans.length >= MIN_ANSWERS && ans.length <= max) return { base, answers: ans };
      if (!best || Math.abs(ans.length - 24) < Math.abs(best.answers.length - 24)) best = { base, answers: ans.slice(0, max) };
    }
    return best;
  }

  const pointsFor = (word, N) => { const C = cfg(); return word.length * C.perLetter + (word.length === N ? C.pangram : 0); };
  const top = (m, n, key) => [...m.values()].filter((x) => x[key] > 0).sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, n).map((x) => ({ name: x.name, pts: x[key], round: x.round, words: x.words }));

  /** what the overlay is allowed to see: lengths and found words only, never the hidden ones */
  function state() {
    if (!game) return { phase: 'idle' };
    const g = game, r = g.cur, s = { phase: g.phase, round: g.round, rounds: g.rounds, endsAt: g.endsAt, startedAt: g.startedAt, by: g.by };
    if (r) {
      s.letters = r.rack; s.N = r.base.length; s.hint = r.hint; s.found = r.found; s.total = r.words.length; s.reveal = g.phase !== 'round';
      s.words = r.words.map((w) => { const f = r.got.get(w); return { len: w.length, w: f || g.phase !== 'round' ? w : null, by: f ? f.name : null, pangram: w.length === r.base.length, got: !!f, first: r.hint && !f ? w[0] : null }; });
      s.recent = r.feed.slice(-6);
    }
    s.round_scores = top(g.scores, 10, 'round'); s.scores = top(g.scores, 10, 'pts');
    if (g.results) s.results = g.results;
    if (g.champion) s.champion = g.champion;
    return s;
  }
  const push = (ev) => ctx.broadcast('words', Object.assign({ type: 'state', s: state() }, ev ? { ev } : {}));

  function start(opts) {
    if (game) return { error: 'Word Rush is already running.' };
    const C = cfg(), rounds = Math.max(1, Math.min(10, Math.floor(Number(opts && opts.rounds) || C.rounds))), n = C.letters === 7 ? 7 : 6;
    game = { phase: 'intro', round: 0, rounds, n, scores: new Map(), used: new Set(), by: String((opts && opts.by) || ''), endsAt: now() + introMs(), startedAt: now(), cur: null, results: null, champion: null, quiet: 0, silent: !!(opts && opts.silent) };
    if (!game.silent) ctx.say('🔤 WORD RUSH! ' + rounds + ' round' + (rounds === 1 ? '' : 's') + '. Make words from the letters on screen and just type them in chat. Points are paid out after every round!');
    push(); later(nextRound, introMs());
    return { ok: true, rounds };
  }

  function nextRound() {
    const g = game; if (!g) return; const C = cfg();
    const pick = pickRound(g.n, g.used); if (!pick) { stop(); return; }
    g.used.add(pick.base); g.round++; g.results = null;
    for (const p of g.scores.values()) { p.round = 0; p.words = 0; }
    g.cur = { base: pick.base, rack: shuffle(pick.base), words: pick.answers.slice().sort((a, b) => a.length - b.length || (a < b ? -1 : 1)), got: new Map(), feed: [], found: 0, hint: false, guesses: 0 };
    g.phase = 'round'; g.startedAt = now(); g.endsAt = now() + C.seconds * 1000;
    push({ kind: 'round', round: g.round });
    later(() => { if (game === g && g.phase === 'round') { g.cur.hint = true; push({ kind: 'hint' }); } }, Math.floor(C.seconds * 500));
    later(() => endRound(), C.seconds * 1000);
  }

  /** a chat message: returns true when it was a word of the current board (so the bot does not treat it as anything else) */
  function guess(u, text) {
    const g = game; if (!g || g.phase !== 'round') return false;
    const w = String(text || '').trim().toLowerCase(); if (!/^[a-z]{3,7}$/.test(w)) return false;
    const r = g.cur; if (!r.words.includes(w)) return false;
    r.guesses++;
    if (r.got.has(w)) return true;   // somebody was faster
    const id = String(u.id || u.name), name = String(u.name || u.login || 'Someone'), pts = pointsFor(w, g.n);
    r.got.set(w, { id, name, pts });
    let p = g.scores.get(id); if (!p) { p = { id, name, pts: 0, round: 0, words: 0 }; g.scores.set(id, p); }
    p.name = name; p.pts += pts; p.round += pts; p.words++; r.found++;
    r.feed.push({ name, word: w, pts, pangram: w.length === g.n });
    push({ kind: 'found', name, word: w, pts, pangram: w.length === g.n });
    if (r.found >= r.words.length) { later(() => endRound(), 1800); }   // the whole board is done: wrap up
    return true;
  }

  /** pay out what everyone earned this round (plus the top scorer's bonus), show the results, then the next round or the final scoreboard */
  function endRound(stopping) {
    const g = game; if (!g || g.phase !== 'round') return;
    clearAll(); const C = cfg(), r = g.cur, board = [...g.scores.values()].filter((p) => p.round > 0).sort((a, b) => b.round - a.round || a.name.localeCompare(b.name));
    const paid = board.map((p, i) => { const bonus = i === 0 && !stopping && board.length > 1 && C.mvp > 0 ? C.mvp : 0; ctx.award(p.id, p.name, p.round + bonus, 'words'); return { name: p.name, pts: p.round, bonus, words: p.words }; });
    g.phase = 'review'; g.endsAt = now() + REVIEW_MS; g.startedAt = now();
    g.results = { found: r.found, total: r.words.length, paid, missed: r.words.filter((w) => !r.got.has(w)).length };
    r.guesses ? (g.quiet = 0) : g.quiet++;
    if (!g.silent) {
      const cur = ctx.currency ? ctx.currency() : 'points';
      ctx.say('🔤 Round ' + g.round + ' over! ' + r.found + '/' + r.words.length + ' words. ' + (paid.length ? 'Top: ' + paid.slice(0, 3).map((p) => p.name + ' +' + (p.pts + p.bonus)).join(', ') + ' (paid out in ' + cur + ')' : 'Nobody found a word.'));
    }
    push({ kind: 'review' });
    if (stopping) return;
    if (g.quiet >= 2) { later(() => { if (!g.silent) ctx.say('🔤 Nobody is playing, so Word Rush is stopping.'); stop(); }, REVIEW_MS); return; }
    later(() => (g.round >= g.rounds ? final() : nextRound()), REVIEW_MS);
  }

  function final() {
    const g = game; if (!g) return;
    const rank = top(g.scores, 10, 'pts'); g.phase = 'final'; g.endsAt = now() + FINAL_MS; g.startedAt = now(); g.champion = rank[0] || null;
    if (!g.silent) ctx.say('🔤 Word Rush is over! ' + (rank.length ? 'Champion: ' + rank[0].name + ' with ' + rank[0].pts + ' points' + (rank[1] ? ', then ' + rank.slice(1, 3).map((p) => p.name + ' (' + p.pts + ')').join(', ') : '') + '. Thanks for playing!' : 'Nobody scored. Thanks for watching!'));
    push({ kind: 'final' }); later(() => stop(), FINAL_MS);
  }

  /** end the current round now (mods): the words found so far still pay out */
  function skip() { if (!game || game.phase !== 'round') return { error: 'There is no round running.' }; endRound(); return { ok: true }; }
  function stop() {
    if (!game) return { error: 'Word Rush is not running.' };
    if (game.phase === 'round') endRound(true);   // what was earned this round is still paid
    clearAll(); game = null; ctx.broadcast('words', { type: 'state', s: { phase: 'idle' } }); return { ok: true };
  }
  return { start, stop, skip, guess, state, active: () => !!game, answersFor, pointsFor };
};
