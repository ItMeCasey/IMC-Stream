'use strict';
/**
 * Spin the wheel: the streamer or a mod gives a list of options, the server picks one at random and the pixel wheel on the game overlay (overlays/arena.html)
 * plays the spin and lands exactly on it. The winner is decided here, never by the overlay. Entering an option twice doubles its chance.
 */
const crypto = require('node:crypto');

module.exports = function createWheel(ctx) {
  const pick = ctx.pick || ((n) => crypto.randomInt(n)), rand = ctx.rand || (() => crypto.randomInt(1e6) / 1e6), setT = ctx.setTimeout || setTimeout, clearT = ctx.clearTimeout || clearTimeout;
  const SPIN_MS = 7000, HOLD_MS = 5200, MAX = 16;
  let running = null;   // { timer }

  /** a list typed in chat ("a, b | c") or an array from the page, cleaned up: at most 16 options of 40 characters */
  const clean = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,|]/)).map((x) => String(x).trim().replace(/ +/g, ' ').slice(0, 40)).filter(Boolean).slice(0, MAX);

  /** opts: { title, options, silent } */
  function spin(opts) {
    if (running) return { error: 'The wheel is already spinning.' };
    const options = clean(opts && opts.options); if (options.length < 2) return { error: 'The wheel needs at least 2 options.' };
    const title = String((opts && opts.title) || '').trim().slice(0, 40), index = pick(options.length), jitter = (rand() - 0.5) * 0.7, turns = 5 + pick(3);
    ctx.broadcast('arena', { type: 'wheel:spin', title, options, index, jitter, turns, spinMs: SPIN_MS, holdMs: HOLD_MS });
    const slot = { timer: null }; running = slot;
    slot.timer = setT(() => {
      if (!(opts && opts.silent)) ctx.say('🎡 ' + (title ? title + ': ' : '') + options[index] + '!');
    }, SPIN_MS + 400);
    // the overlay keeps showing the result for a few seconds after the spin: a new spin has to wait for that
    const free = setT(() => { if (running === slot) running = null; }, SPIN_MS + HOLD_MS + 600); if (free && free.unref) free.unref();
    return { ok: true, winner: options[index], index, options };
  }
  function cancel() { if (!running) return { error: 'The wheel is not spinning.' }; clearT(running.timer); running = null; ctx.broadcast('arena', { type: 'stop' }); return { ok: true }; }
  return { spin, cancel, clean, active: () => !!running, MAX };
};
