'use strict';
/**
 * Word Rush: a full-screen pixel word game (overlays/words.html). Each round the overlay shows a rack of letters and a board of hidden words
 * that can be made from them. Chat types words (just the word, no command); the first person to type a word on the board gets it and its points.
 * The match goes on as long as chat keeps beating the rounds (finding enough of the board) or until a mod stops it; it ends when chat fails a round.
 * The share of the board needed to beat a round starts at the "beat" setting and goes up 5% every round, until it is 100% (every word).
 * All-time points and the best round each chatter scored in are kept (ctx.stats), together with the record: the most rounds chat ever beat in one game.
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

// REVIEW_MS/FINAL_MS: how long the round results and the final scoreboard stay up; the rest are limits on rack size, board size and the letters fake tiles are drawn from
const REVIEW_MS = 11000, FINAL_MS = 15000, MAX_REAL = 9, MAX_ANSWERS = 40, MIN_ANSWERS = 12, FAKE_POOL = 'eatoinsrhldcumpgybf';
// the word list is read from disk once, on first use
let LIST = null;
const loadList = () => LIST || (LIST = fs.readFileSync(path.join(__dirname, 'words-list.txt'), 'utf8').split('\n').filter(Boolean));
// bit mask of the letters in a word (bit 0 = a): lets a word be rejected with one AND instead of counting letters
const maskOf = (w) => { let m = 0; for (let i = 0; i < w.length; i++) m |= 1 << (w.charCodeAt(i) - 97); return m; };
// cache of the index per list, so it is built only once
const INDEX = new WeakMap();
/** the word list with a letter mask for every word (a quick "uses only these letters" test) and the words grouped by length */
function indexOf(list) {
  let ix = INDEX.get(list); if (ix) return ix;
  ix = { masks: list.map(maskOf), byLen: new Map() }; list.forEach((w) => { if (!ix.byLen.has(w.length)) ix.byLen.set(w.length, []); ix.byLen.get(w.length).push(w); }); INDEX.set(list, ix); return ix;
}

module.exports = function createWords(ctx) {
  // rng, clock and timers can be swapped out (the tests do this)
  const rng = ctx.rng || Math.random, now = ctx.now || Date.now, setT = ctx.setTimeout || setTimeout, clearT = ctx.clearTimeout || clearTimeout;
  // how long the intro lasts (the page can set it, default 6s)
  const introMs = () => (typeof ctx.introMs === 'function' ? ctx.introMs() : 6000);
  // the words in play: a list given by the tests, or the file
  const dict = () => ctx.words || loadList();
  // settings with defaults filled in for anything missing
  const cfg = () => Object.assign({ rounds: 0, seconds: 90, letters: 5, perLetter: 2, pangram: 25, mvp: 25, beat: 50 }, (ctx.cfg && ctx.cfg()) || {});
  // game = the running match (null when idle); timers = pending timeouts so stop() can cancel them all
  let game = null, timers = [];

  // schedule a step; unref so a pending timer never keeps the process alive
  const later = (fn, ms) => { const t = setT(fn, ms); if (t && t.unref) t.unref(); timers.push(t); return t; };
  // cancel every pending step
  const clearAll = () => { timers.forEach((t) => clearT(t)); timers = []; };
  // Fisher-Yates shuffle of a copy
  const shuffled = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /** what a round looks like: letters grow by one each round, unknown letters from round 2, fake tiles from round 3 */
  function plan(round, start) {
    const real = Math.min(MAX_REAL, start + round - 1);
    return { real, unknown: round >= 2 ? Math.min(3, Math.floor(round / 2), real - 2) : 0, fake: round >= 3 ? Math.min(3, Math.floor((round - 1) / 2)) : 0 };
  }
  /** the shortest word that counts: keeps the board readable when the rack is big */
  /** the share of the board (in percent) chat has to find to beat this round: it starts at the setting and rises 5% a round, up to 100% */
  const needPct = (round) => Math.min(100, cfg().beat + 5 * (Math.max(1, round) - 1));
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

  // points per letter, plus a bonus for using every letter (a pangram)
  const pointsFor = (word, n) => { const C = cfg(); return word.length * C.perLetter + (word.length === n ? C.pangram : 0); };
  // the best n entries by one score key (ties by name), trimmed to what the overlay needs
  const top = (m, n, key) => [...m.values()].filter((x) => x[key] > 0).sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, n).map((x) => ({ name: x.name, pts: x[key], round: x.round, words: x.words }));

  /** what the overlay is allowed to see: lengths and found words only, and "?" for letters that are not revealed yet; never the hidden words or which tiles are fake */
  function state() {
    if (!game) return { phase: 'idle' };
    const g = game, r = g.cur, s = { phase: g.phase, round: g.round, rounds: g.rounds, reached: g.reached, beat: needPct(g.round || 1), endsAt: g.endsAt, startedAt: g.startedAt, by: g.by };
    if (r) {
      const live = g.phase === 'round';
      s.letters = r.tiles.map((t) => (t.hidden && live ? '?' : t.ch)).join(''); s.N = r.base.length; s.hint = r.hint; s.found = r.found; s.total = r.words.length; s.need = Math.max(1, Math.ceil(r.words.length * needPct(g.round) / 100)); s.reveal = !live; s.minLen = r.minLen;
      s.fake = live ? [] : r.tiles.map((t, i) => (t.fake ? i : -1)).filter((i) => i >= 0);   // which tiles were fake, shown once the round is over
      s.mods = { fake: r.plan.fake, unknown: r.plan.unknown, hidden: live ? r.tiles.filter((t) => t.hidden).length : 0 };
      s.words = r.words.map((w) => { const f = r.got.get(w); return { len: w.length, w: f || !live ? w : null, by: f ? f.name : null, pangram: w.length === r.base.length, got: !!f, first: r.hint && !f ? w[0] : null }; });
      s.recent = r.feed.slice(-6);
    }
    s.round_scores = top(g.scores, 10, 'round'); s.scores = top(g.scores, 10, 'pts');
    if (g.results) s.results = g.results;
    if (g.champion) s.champion = g.champion;
    if (ctx.stats) { const st = ctx.stats.get(); s.record = st.record; if (g.phase === 'final') { s.alltime = st.top.slice(0, 5); s.newRecord = !!g.newRecord; } }
    return s;
  }
  // send the current state (and an optional event) to the overlay
  const push = (ev) => ctx.broadcast('words', Object.assign({ type: 'state', s: state() }, ev ? { ev } : {}));

  // begin a match: rounds = 0 means play until chat fails a round; silent skips the chat announcements
  function start(opts) {
    if (game) return { error: 'Word Rush is already running.' };
    const C = cfg(), asked = opts && opts.rounds !== undefined && opts.rounds !== null ? Number(opts.rounds) : Number(C.rounds), rounds = Math.max(0, Math.min(99, Math.floor(asked) || 0)), startLetters = Math.max(4, Math.min(7, Math.floor(Number(C.letters) || 5)));
    game = { phase: 'intro', round: 0, rounds, startLetters, scores: new Map(), used: new Set(), by: String((opts && opts.by) || ''), endsAt: now() + introMs(), startedAt: now(), cur: null, results: null, champion: null, reached: 0, silent: !!(opts && opts.silent) };
    if (!game.silent) ctx.say('🔤 WORD RUSH! ' + (rounds ? rounds + ' round' + (rounds === 1 ? '' : 's') + '. ' : 'How many rounds can chat beat? ') + 'Make words from the letters on screen and just type them in chat. Find ' + C.beat + '% of the words to beat round 1, and 5% more every round after that. Every round adds a letter, and later on some letters are fake or unknown! Points are paid out after every round.');
    push(); later(nextRound, introMs());
    return { ok: true, rounds };
  }

  // set up and start a round: pick the base word, add fake tiles, hide some letters, work out the time, and schedule the hint, the reveals and the end
  function nextRound() {
    const g = game; if (!g) return; const C = cfg();
    g.round++; const pl = plan(g.round, g.startLetters), pick = pickRound(pl.real, g.used); if (!pick) { stop(); return; }
    g.used.add(pick.base); g.results = null;
    for (const p of g.scores.values()) { p.round = 0; p.words = 0; }
    // fake tiles use letters that are not already in the rack when possible, so they do not look like copies
    const have = new Set(pick.base.split('')), fresh = FAKE_POOL.split('').filter((c) => !have.has(c)), extra = shuffled(fresh.length >= pl.fake ? fresh : FAKE_POOL.split('')).slice(0, pl.fake);
    const tiles = shuffled([...pick.base.split('').map((ch) => ({ ch, fake: false, hidden: false })), ...extra.map((ch) => ({ ch, fake: true, hidden: false }))]);
    // only real tiles can be hidden (a hidden fake would give the trick away)
    const hide = shuffled(tiles.map((t, i) => (t.fake ? -1 : i)).filter((i) => i >= 0)).slice(0, pl.unknown); hide.forEach((i) => { tiles[i].hidden = true; });
    const secs = Math.max(30, C.seconds + (pl.real - g.startLetters) * 10 - Math.max(0, g.round - (MAX_REAL - g.startLetters + 1)) * 4);   // bigger racks get more time; once the rack is full the rounds get shorter
    g.cur = { base: pick.base, plan: pl, minLen: pick.minLen, tiles, words: pick.answers.slice().sort((a, b) => a.length - b.length || (a < b ? -1 : 1)), got: new Map(), feed: [], found: 0, hint: false, guesses: 0 };
    g.phase = 'round'; g.startedAt = now(); g.endsAt = now() + secs * 1000;
    push({ kind: 'round', round: g.round });
    // halfway through the round the hint shows the first letter of each unfound word
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
    const paid = board.map((p, i) => { const bonus = i === 0 && !stopping && board.length > 1 && C.mvp > 0 ? C.mvp : 0; ctx.award(p.id, p.name, p.round + bonus, 'words'); if (ctx.stats) ctx.stats.player(p.id, p.name, { pts: p.round + bonus, words: p.words, round: g.round }); return { name: p.name, pts: p.round, bonus, words: p.words }; });
    g.phase = 'review'; g.endsAt = now() + REVIEW_MS; g.startedAt = now();
    const need = Math.max(1, Math.ceil(r.words.length * needPct(g.round) / 100)), beaten = r.found >= need; if (beaten) g.reached = g.round;
    g.results = { found: r.found, total: r.words.length, paid, missed: r.words.filter((w) => !r.got.has(w)).length, need, beaten };
    if (!g.silent) {
      const cur = ctx.currency ? ctx.currency() : 'points';
      ctx.say('🔤 Round ' + g.round + (beaten ? ' beaten! ' : ' failed (needed ' + need + '). ') + r.found + '/' + r.words.length + ' words. ' + (paid.length ? 'Top: ' + paid.slice(0, 3).map((p) => p.name + ' +' + (p.pts + p.bonus)).join(', ') + ' (paid out in ' + cur + ')' : 'Nobody found a word.'));
    }
    push({ kind: 'review' });
    if (stopping) return;
    later(() => (!beaten || (g.rounds && g.round >= g.rounds) ? final() : nextRound()), REVIEW_MS);   // chat failed the round, or a fixed match is done: game over; otherwise on to the next round
  }

  // game over: rank the whole match, record a new best if chat beat more rounds than ever before, show the scoreboard, then stop
  function final() {
    const g = game; if (!g) return;
    const rank = top(g.scores, 10, 'pts'); g.phase = 'final'; g.endsAt = now() + FINAL_MS; g.startedAt = now(); g.champion = rank[0] || null; g.newRecord = !!(ctx.stats && g.reached > 0 && ctx.stats.record(g.reached, g.champion ? g.champion.name : ''));
    if (!g.silent) ctx.say('🔤 Word Rush is over! ' + (g.newRecord ? 'NEW RECORD! ' : '') + 'Chat beat ' + g.reached + ' round' + (g.reached === 1 ? '' : 's') + '. ' + (rank.length ? 'Champion: ' + rank[0].name + ' with ' + rank[0].pts + ' points' + (rank[1] ? ', then ' + rank.slice(1, 3).map((p) => p.name + ' (' + p.pts + ')').join(', ') : '') + '. Thanks for playing!' : 'Nobody scored. Thanks for watching!'));
    push({ kind: 'final' }); later(() => stop(), FINAL_MS);
  }

  /** end the current round now (mods): the words found so far still pay out */
  function skip() { if (!game || game.phase !== 'round') return { error: 'There is no round running.' }; endRound(); return { ok: true }; }
  // end the game now, clear the overlay and cancel every pending step
  function stop() {
    if (!game) return { error: 'Word Rush is not running.' };
    if (game.phase === 'round') endRound(true);   // what was earned this round is still paid
    clearAll(); game = null; ctx.broadcast('words', { type: 'state', s: { phase: 'idle' } }); return { ok: true };
  }
  return { start, stop, skip, guess, state, active: () => !!game, answersFor, pointsFor, plan, minLenFor, needPct };
};
