'use strict';
/**
 * Horse race for the pixel overlay (overlays/arena.html). A Twitch prediction takes the bets (channel points), the server picks the
 * winner, the overlay plays the race, then the prediction is resolved so Twitch pays out. Nobody's reaction time or ping matters.
 *   start()  -> creates the prediction (one outcome per horse) and opens the gate
 *   run()    -> locks bets, picks the winner (random, or the streamer's choice), plays the race, resolves the prediction
 */
module.exports = function createRace(ctx) {
  const rng = ctx.rng || Math.random, setT = ctx.setTimeout || setTimeout, clearT = ctx.clearTimeout || clearTimeout, now = ctx.now || (() => Date.now());
  const cfg = () => ctx.cfg(), emit = (type, d) => ctx.broadcast('arena', Object.assign({ type }, d || {}));
  const NAMES = ['Thunder Biscuit', 'Neon Gallop', 'Sir Hoofs-a-Lot', 'Disco Stu', 'Mane Event', 'Turbo Pony', 'Glue Factory', 'Hay Fever', 'Saddle Sore', 'Photo Finish', 'Ctrl Alt Defeat', 'Retro Rocket', 'Lucky Clover', 'Dark Horse', 'Rusty Spur', 'Pixel Pegasus'];
  let r = null;   // { phase: 'betting' | 'racing', horses: [{name, outcomeId}], predId, ends, timer }

  const pickNames = (want, n) => {
    const pool = (want && want.length ? want : (cfg().names && cfg().names.length >= 2 ? cfg().names : NAMES)).map((x) => String(x).trim().slice(0, 25)).filter(Boolean);
    const uniq = [...new Set(pool)]; if (uniq.length < 2) throw new Error('A race needs at least 2 horses');
    const a = uniq.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, Math.max(2, Math.min(10, n || cfg().count, a.length)));
  };

  async function start(opts) {
    opts = opts || {};
    if (r) return { error: 'A race is already running.' };
    const C = cfg(), horses = pickNames(opts.names, opts.count).map((name) => ({ name })), secs = Math.max(30, Math.min(1800, Math.floor(Number(opts.seconds) || C.seconds)));
    r = { phase: 'opening', horses, ends: now() + secs * 1000 };   // claimed now so a second !race can't slip in while Twitch answers
    let pred; try { pred = await ctx.predict.create(C.title, horses.map((h) => h.name), secs); } catch (e) { r = null; return { error: e.message }; }
    const outs = (pred && pred.outcomes) || []; horses.forEach((h, i) => { h.outcomeId = outs[i] && outs[i].id; });
    r.predId = pred && pred.id; r.phase = 'betting'; r.ends = now() + secs * 1000;
    emit('race:open', { horses: horses.map((h) => h.name), seconds: secs });
    ctx.say('🏇 THE RACE IS ON! Bet your channel points on a horse (the Predictions box): ' + horses.map((h) => h.name).join(', ') + '. Betting closes in ' + (secs >= 60 ? Math.round(secs / 60) + ' min' : secs + 's') + '!');
    const mine = r; r.timer = setT(() => { if (r === mine) run(); }, secs * 1000);
    return { ok: true, horses: horses.map((h) => h.name), seconds: secs };
  }

  /** winner: optional horse name or 1-based number the streamer picked; otherwise a fair random pick */
  async function run(winner) {
    if (!r || r.phase !== 'betting') return { error: 'No race is open for bets.' };
    const g = r; if (g.timer) clearT(g.timer); g.phase = 'racing';
    let wi = -1; if (winner != null && winner !== '') { const n = Number(winner); wi = Number.isInteger(n) && n >= 1 && n <= g.horses.length ? n - 1 : g.horses.findIndex((h) => h.name.toLowerCase() === String(winner).toLowerCase()); if (wi < 0) { g.phase = 'betting'; return { error: 'No such horse.' }; } }
    if (wi < 0) wi = Math.floor(rng() * g.horses.length);
    try { await ctx.predict.lock(g.predId); } catch (e) { /* already locked when the window ran out */ }
    // finishing times: the winner crosses first, the others trail by distinct gaps (the overlay does the wobble in between)
    const base = 11, gaps = g.horses.map((_, i) => (i === wi ? 0 : 0.35 + rng() * 2.2)), order = gaps.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
    for (let k = 1; k < order.length; k++) if (order[k].x - order[k - 1].x < 0.18) order[k].x = order[k - 1].x + 0.18;
    const times = []; for (const o of order) times[o.i] = Math.round((base + o.x) * 100) / 100;
    const seeds = g.horses.map(() => Math.floor(rng() * 1e9)), ms = Math.round(base * 1000) + 6500;
    emit('race:go', { horses: g.horses.map((h) => h.name), times, seeds, winner: wi, ms });
    ctx.say('🏁 And they\'re off!');
    g.timer = setT(async () => {
      const w = g.horses[wi]; let note = '';
      try { if (w.outcomeId) await ctx.predict.resolve(g.predId, w.outcomeId); else note = ' (could not pay out: no outcome id)'; } catch (e) { note = ' (payout failed: ' + e.message + ')'; }
      if (r === g) r = null;
      ctx.say('🏆 ' + w.name + ' wins the race! Predictors who backed ' + w.name + ' share the pot.' + note);
    }, ms);
    return { ok: true, winner: g.horses[wi].name };
  }

  async function cancel() {
    if (!r) return { error: 'No race running.' }; const g = r; r = null; if (g.timer) clearT(g.timer);
    try { if (g.predId) await ctx.predict.cancel(g.predId); } catch (e) { /* ignore */ }
    emit('stop'); ctx.say('The race was cancelled and bets are refunded.'); return { ok: true };
  }

  return { start, run, cancel, active: () => !!r, view: () => (r ? { phase: r.phase, horses: r.horses.map((h) => h.name), secondsLeft: Math.max(0, Math.round((r.ends - now()) / 1000)) } : { phase: '' }) };
};
