'use strict';
/**
 * Spin the wheel: the streamer or a mod gives a list of options, the server picks one at random and the pixel wheel on the game overlay (overlays/arena.html)
 * plays the spin and lands exactly on it. The winner is decided here, never by the overlay. Each option can carry a percentage (the slices are drawn that size);
 * without percentages every option is equally likely, and entering an option twice doubles its chance.
 */
const crypto = require('node:crypto');

module.exports = function createWheel(ctx) {
  // pick/rand use crypto for fair results; both (and the timers) can be swapped out by the tests
  const pick = ctx.pick || ((n) => crypto.randomInt(n)), rand = ctx.rand || (() => crypto.randomInt(1e6) / 1e6), setT = ctx.setTimeout || setTimeout, clearT = ctx.clearTimeout || clearTimeout;
  // how long the overlay spins, how long it then shows the result, and the most options allowed
  const SPIN_MS = 7000, HOLD_MS = 5200, MAX = 16;
  let running = null;   // { timer }

  /** text of one entry: a plain string, or { text } from the page */
  const textOf = (x) => String(x && typeof x === 'object' ? x.text : x == null ? '' : x).trim().replace(/ +/g, ' ').slice(0, 40);
  /** a list typed in chat ("a, b | c") or an array from the page, cleaned up: at most 16 options of 40 characters. pct (optional) is one number per entry, kept lined up while empty entries are dropped */
  function entries(v, pct) {
    const raw = Array.isArray(v) ? v : String(v || '').split(/[,|]/), out = [];
    raw.forEach((x, i) => { const text = textOf(x), w = Number(Array.isArray(pct) ? pct[i] : x && typeof x === 'object' ? x.pct : NaN); if (text) out.push({ text, w: Number.isFinite(w) && w >= 0 ? w : NaN }); });
    return out.slice(0, MAX);
  }
  // just the cleaned-up option texts
  const clean = (v) => entries(v).map((e) => e.text);
  /** the percentages as fractions that add up to 1: entries without one share what is left of 100%; with none given everything is equal. An option at 0% is left off the wheel */
  function shares(list) {
    const given = list.filter((e) => !Number.isNaN(e.w)), left = Math.max(0, 100 - given.reduce((a, e) => a + e.w, 0)), blank = list.length - given.length;
    const w = list.map((e) => (Number.isNaN(e.w) ? (blank ? left / blank : 0) : e.w)), tot = w.reduce((a, b) => a + b, 0);
    return tot > 0 ? w.map((x) => x / tot) : list.map(() => 1 / list.length);
  }

  /** opts: { title, options, pct, silent } */
  function spin(opts) {
    if (running) return { error: 'The wheel is already spinning.' };
    const all = entries(opts && opts.options, opts && opts.pct), f = shares(all), list = all.filter((_, i) => f[i] > 0), fr = f.filter((x) => x > 0);
    if (list.length < 2) return { error: 'The wheel needs at least 2 options.' };
    const options = list.map((e) => e.text), pcts = fr.map((x) => Math.round(x * 1e4) / 1e4);
    // weighted pick: walk along the slices until the random point falls inside one
    let u = rand() * fr.reduce((a, b) => a + b, 0), index = 0; while (index < fr.length - 1 && u >= fr[index]) { u -= fr[index]; index++; }
    // jitter only moves where inside the slice the pointer stops; turns is how many full rotations the overlay shows
    const title = String((opts && opts.title) || '').trim().slice(0, 40), jitter = (rand() - 0.5) * 0.7, turns = 5 + pick(3);
    ctx.broadcast('arena', { type: 'wheel:spin', title, options, pcts, index, jitter, turns, spinMs: SPIN_MS, holdMs: HOLD_MS });
    const slot = { timer: null }; running = slot;
    slot.timer = setT(() => {
      if (!(opts && opts.silent)) ctx.say('🎡 ' + (title ? title + ': ' : '') + options[index] + '!');
    }, SPIN_MS + 400);
    // the overlay keeps showing the result for a few seconds after the spin: a new spin has to wait for that
    const free = setT(() => { if (running === slot) running = null; }, SPIN_MS + HOLD_MS + 600); if (free && free.unref) free.unref();
    return { ok: true, winner: options[index], index, options, pcts };
  }
  // stop a running spin: the overlay is told to clear and the wheel is free again
  function cancel() { if (!running) return { error: 'The wheel is not spinning.' }; clearT(running.timer); running = null; ctx.broadcast('arena', { type: 'stop' }); return { ok: true }; }
  return { spin, cancel, clean, entries, shares, active: () => !!running, MAX };
};
