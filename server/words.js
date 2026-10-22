'use strict';
/**
 * Word Rush: a full-screen pixel word game (overlays/words.html). Each round the overlay shows a rack of letters and a board of hidden words
 * that can be made from them. Chat types words (just the word, no command); the first person to type a word on the board gets it and its points.
 * Every round adds one letter (up to 9). From round 2 some letters are UNKNOWN (shown as "?" until they are revealed during the round) and from
 * round 3 some tiles are FAKE (they look like any other letter, but no word on the board uses them), so the rack gets harder as the match goes on.
 * After every round the points earned are paid out in the chat currency (plus a bonus for the top scorer), the board is revealed and a scoreboard
 * shows; a match is several rounds and keeps one running score. Only mods and the streamer can start it (the command level lives in bot.js).
 * The server decides everything (which words count, who was first, which letters are fake); the overlay only draws what it is told, and the hidden
 * letters and words are never sent before they are meant to be seen.
 * Word list: server/words-list.txt, 3 to 9 letter words from the ENABLE list, which is in the public domain.
 */
const fs = require('node:fs');
const path = require('node:path');

const REVIEW_MS = 11000, FINAL_MS = 15000, MAX_REAL = 9, MAX_ANSWERS = 40, MIN_ANSWERS = 12, FAKE_POOL = 'eatoinsrhldcumpgybf';
let LIST = null;
const loadList = () => LIST || (LIST = fs.readFileSync(path.join(__dirname, 'words-list.txt'), 'utf8').split('\n').filter(Boolean));
const maskOf = (w) => { let m = 0; for (let i = 0; i < w.length; i++) m |= 1 << (w.charCodeAt(i) - 97); return m; };
const INDEX = new WeakMap();
/** the word list with a letter mask for every word (a quick "uses only these letters" test) and the words grouped by length */
function indexOf(list) {
  let ix = INDEX.get(list); if (ix) return ix;
  ix = { masks: list.map(maskOf), byLen: new Map() }; list.forEach((w) => { if (!ix.byLen.has(w.length)) ix.byLen.set(w.length, []); ix.byLen.get(w.length).push(w); }); INDEX.set(list, ix); return ix;
}

module.exports = function createWords(ctx) {
  const rng = ctx.rng || Math.random, now = ctx.now || Date.now, setT = ctx.setTimeout || setTimeout, clearT = ctx.clearTimeout || clearTimeout;
  const introMs = () => (typeof ctx.introMs === 'function' ? ctx.introMs() : 6000);
  const dict = () => ctx.words || loadList();
  const cfg = () => Object.assign({ rounds: 5, seconds: 90, letters: 5, perLetter: 2, pangram: 25, mvp: 25 }, (ctx.cfg && ctx.cfg()) || {});
  let game = null, timers = [];

  const later = (fn, ms) => { const t = setT(fn, ms); if (t && t.unref) t.unref(); timers.push(t); return t; };
  const clearAll = () => { timers.forEach((t) => clearT(t)); timers = []; };
  const shuffled = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /** what a round looks like: letters grow by one each round, unknown letters from round 2, fake tiles from round 3 */
  function plan(round, start) {
    const real = Math.min(MAX_REAL, start + round - 1);
    return { real, unknown: round >= 2 ? Math.min(3, Math.floor(round / 2), real - 2) : 0, fake: round >= 3 ? Math.min(3, Math.floor((round - 1) / 2)) : 0 };
  }
  /** the shortest word that counts: keeps the board readable when the rack is big */
  const minLenFor = (n) => Math.max(3, n - 4);

  /** every word in the list that can be made from these letters (each letter used at most as often as it appears), minLen letters or more */
  function answersFor(letters, minLen) {
    const list = dict(), ix = indexOf(list), bm = maskOf(letters), base = {}, out = [], lo = minLen || 3;
    for (const ch of letters) base[ch] = (base[ch] || 0) + 1;
    for (let i = 0; i < list.length; i++) {
      const w = list[i]; if (w.length > letters.length || w.length < lo || (ix.masks[i] & ~bm)) continue;
      const left = Object.assign({}, base); let ok = true;
      for (let k = 0; k < w.length; k++) { const ch = w[k]; if (!left[ch]) { ok = false; break; } left[ch]--; }
      if (ok) out.push(w);
    }
    return out;
  }
  /** a random N letter word whose board is a good size: enough words to be fun, few enough to fit on screen */
  function pickRound(n, used) {
    const pool = (indexOf(dict()).byLen.get(n) || []).filter((w) => !used.has(w)), minLen = minLenFor(n); let best = null;
    for (let i = 0; i < 150 && pool.length; i++) {
      const base = pool[Math.floor(rng() * pool.length)], ans = answersFor(base, minLen);
      if (ans.length >= MIN_ANSWERS && ans.length <= MAX_ANSWERS) return { base, answers: ans, minLen };
      if (!best || Math.abs(ans.length - 24) < Math.abs(best.answers.length - 24)) best = { base, answers: ans.slice(0, MAX_ANSWERS), minLen };
    }
    return best;
  }

  const pointsFor = (word, n) => { const C = cfg(); return word.length * C.perLetter + (word.length === n ? C.pangram : 0); };
  const top = (m, n, key) => [...m.values()].filter((x) => x[key] > 0).sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, n).map((x) => ({ name: x.name, pts: x[key], round: x.round, words: x.words }));

  /** what the overlay is allowed to see: lengths and found words only, and "?" for letters that are not revealed yet; never the hidden words or which tiles are fake */
  function state() {
    if (!game) return { phase: 'idle' };
    const g = game, r = g.cur, s = { phase: g.phase, round: g.round, rounds: g.rounds, endsAt: g.endsAt, startedAt: g.startedAt, by: g.by };
    if (r) {
      const live = g.phase === 'round';
      s.letters = r.tiles.map((t) => (t.hidden && live ? '?' : t.ch)).join(''); s.N = r.base.length; s.hint = r.hint; s.found = r.found; s.total = r.words.length; s.reveal = !live; s.minLen = r.minLen;
      s.fake = live ? [] : r.tiles.map((t, i) => (t.fake ? i : -1)).filter((i) => i >= 0);   // which tiles were fake, shown once the round is over
      s.mods = { fake: r.plan.fake, unknown: r.plan.unknown, hidden: live ? r.tiles.filter((t) => t.hidden).length : 0 };
      s.words = r.words.map((w) => { const f = r.got.get(w); return { len: w.length, w: f || !live ? w : null, by: f ? f.name : null, pangram: w.length === r.base.length, got: !!f, first: r.hint && !f ? w[0] : null }; });
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
    const C = cfg(), rounds = Math.max(1, Math.min(10, Math.floor(Number(opts && opts.rounds) || C.rounds))), startLetters = Math.max(4, Math.min(7, Math.floor(Number(C.letters) || 5)));
    game = { phase: 'intro', round: 0, rounds, startLetters, scores: new Map(), used: new Set(), by: String((opts && opts.by) || ''), endsAt: now() + introMs(), startedAt: now(), cur: null, results: null, champion: null, quiet: 0, silent: !!(opts && opts.silent) };
    if (!game.silent) ctx.say('🔤 WORD RUSH! ' + rounds + ' round' + (rounds === 1 ? '' : 's') + '. Make words from the letters on screen and just type them in chat. Every round adds a letter, and later on some letters are fake or unknown! Points are paid out after every round.');
    push(); later(nextRound, introMs());
    return { ok: true, rounds };
  }

  function nextRound() {
    const g = game; if (!g) return; const C = cfg();
    g.round++; const pl = plan(g.round, g.startLetters), pick = pickRound(pl.real, g.used); if (!pick) { stop(); return; }
    g.used.add(pick.base); g.results = null;
    for (const p of g.scores.values()) { p.round = 0; p.words = 0; }
    const have = new Set(pick.base.split('')), fresh = FAKE_POOL.split('').filter((c) => !have.has(c)), extra = shuffled(fresh.length >= pl.fake ? fresh : FAKE_POOL.split('')).slice(0, pl.fake);
    const tiles = shuffled([...pick.base.split('').map((ch) => ({ ch, fake: false, hidden: false })), ...extra.map((ch) => ({ ch, fake: true, hidden: false }))]);
    const hide = shuffled(tiles.map((t, i) => (t.fake ? -1 : i)).filter((i) => i >= 0)).slice(0, pl.unknown); hide.forEach((i) => { tiles[i].hidden = true; });
    const secs = C.seconds + (pl.real - g.startLetters) * 10;
    g.cur = { base: pick.base, plan: pl, minLen: pick.minLen, tiles, words: pick.answers.slice().sort((a, b) => a.length - b.length || (a < b ? -1 : 1)), got: new Map(), feed: [], found: 0, hint: false, guesses: 0 };
    g.phase = 'round'; g.startedAt = now(); g.endsAt = now() + secs * 1000;
    push({ kind: 'round', round: g.round });
    later(() => { if (game === g && g.phase === 'round') { g.cur.hint = true; push({ kind: 'hint' }); } }, Math.floor(secs * 500));
    hide.forEach((ti, k) => later(() => { if (game === g && g.phase === 'round') { g.cur.tiles[ti].hidden = false; push({ kind: 'reveal', tile: ti }); } }, Math.floor(secs * 1000 * (0.3 + 0.2 * k))));   // unknown letters turn up one by one
    later(() => endRound(), secs * 1000);
  }

  /** a chat message: returns true when it was a word of the current board (so the bot does not treat it as anything else) */
  function guess(u, text) {
    const g = game; if (!g || g.phase !== 'round') return false;
    const w = String(text || '').trim().toLowerCase(); if (!/^[a-z]{3,9}$/.test(w)) return false;
    const r = g.cur; if (!r.words.includes(w)) return false;
    r.guesses++;
    if (r.got.has(w)) return true;   // somebody was faster
    const n = r.base.length, id = String(u.id || u.name), name = String(u.name || u.login || 'Someone'), pts = pointsFor(w, n);
    r.got.set(w, { id, name, pts });
    let p = g.scores.get(id); if (!p) { p = { id, name, pts: 0, round: 0, words: 0 }; g.scores.set(id, p); }
    p.name = name; p.pts += pts; p.round += pts; p.words++; r.found++;
    r.feed.push({ name, word: w, pts, pangram: w.length === n });
    push({ kind: 'found', name, word: w, pts, pangram: w.length === n });
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
  return { start, stop, skip, guess, state, active: () => !!game, answersFor, pointsFor, plan, minLenFor };
};
