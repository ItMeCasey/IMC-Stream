'use strict';
/** Server-controlled countdown / subathon timer shown by overlays/countdown.html. */
module.exports = function createCountdown(ctx) {
  // ctx lets the same factory serve more than one timer (state key, event name, chat wording, label prefix, chat command).
  const KEY = ctx.key || 'countdown', EVT = ctx.evt || 'countdown', NOUN = ctx.noun || 'Timer', LP = ctx.labelPrefix || 'countdown', CMD = ctx.cmd || '!countdown';
  // S() is always the live state object, so the timer survives a restart through ctx.persist.
  const S = () => ctx.state[KEY];
  const now = () => (ctx.now ? ctx.now() : Date.now());
  const log = ctx.log || (() => {});
  // doneT is the single pending 'time is up' timeout; it is re-armed whenever the end time changes.
  let doneT = null;
  // round to whole seconds and keep inside [lo, hi]; junk input becomes 0 before clamping.
  const clampSec = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
  // hard ceiling of 48 hours so a typo cannot start an endless timer.
  const MAX = 48 * 3600;

  // while running the time left comes from the clock; otherwise it is the frozen value.
  const remaining = (c = S()) => (c.mode === 'running' ? Math.max(0, c.endsAt - now()) : c.remainingMs);
  // snapshot sent to the overlay; includes 'now' so the overlay can correct for clock drift.
  const view = () => { const c = S(); return { mode: c.mode, endsAt: c.endsAt, remainingMs: remaining(c), durationMs: c.durationMs, visible: c.visible, label: c.label, doneMessage: c.doneMessage,
    doneScene: c.doneScene, doneChat: c.doneChat, subathon: c.subathon, lastAdd: c.lastAdd, now: now() }; };
  // tell the overlay and save to disk after every change.
  const pub = () => { ctx.broadcast(EVT, view()); ctx.persist(true); };
  // (re)arm the finish timeout for the current end time; does nothing unless running.
  function schedule() {
    clearTimeout(doneT); const c = S(); if (c.mode !== 'running') return;
    // +30ms so we fire just after the end, never just before; unref so the timer cannot keep the process alive.
    doneT = setTimeout(finish, Math.max(0, c.endsAt - now()) + 30); if (doneT.unref) doneT.unref();
  }
  // time ran out: mark done, then run the optional chat message and OBS scene switch.
  function finish() {
    const c = S(); if (c.mode !== 'running') return;
    if (c.endsAt - now() > 100) return schedule();   // time was added meanwhile
    c.mode = 'done'; c.remainingMs = 0; pub();
    if (c.doneChat && ctx.bot) ctx.bot.say(c.doneChat);
    if (c.doneScene && ctx.obs) ctx.obs.setScene(c.doneScene).catch((e) => log('countdown: could not switch OBS scene:', e.message));
  }
  // set the time left, moving the end time if it is running.
  function setRemaining(ms) { const c = S(); ms = Math.max(0, ms); if (c.mode === 'running') { c.endsAt = now() + ms; schedule(); } else c.remainingMs = ms; }

  // start a fresh run from seconds or minutes (at least 1 second).
  function start(b) {
    const c = S(), sec = clampSec(b.seconds != null ? b.seconds : (Number(b.minutes) || 0) * 60, 1, MAX);
    c.durationMs = sec * 1000; c.endsAt = now() + c.durationMs; c.remainingMs = c.durationMs; c.mode = 'running'; c.lastAdd = null; schedule(); pub(); return view();
  }
  // add (or take away) time. 'capped' applies the subathon max, so only automatic additions are limited; a done timer comes back as paused.
  function add(seconds, why, capped) {
    const c = S(), delta = Math.round(Number(seconds) || 0) * 1000; if (!delta) return view();
    let ms = remaining(c) + delta;
    if (capped && c.subathon.maxMinutes) ms = Math.min(ms, c.subathon.maxMinutes * 60000);
    if (c.mode === 'done' && ms > 0) { c.mode = 'paused'; c.remainingMs = 0; }
    setRemaining(ms); c.durationMs = Math.max(c.durationMs, ms);
    c.lastAdd = { seconds: delta / 1000, why: why || '', at: now() }; pub(); return view();
  }
  // public controls; each returns the new view so callers can answer right away.
  const api = {
    start,
    // freeze the remaining time and cancel the finish timeout.
    pause() { const c = S(); if (c.mode === 'running') { c.remainingMs = remaining(c); c.mode = 'paused'; clearTimeout(doneT); pub(); } return view(); },
    // continue from the frozen time.
    resume() { const c = S(); if (c.mode === 'paused' && c.remainingMs > 0) { c.endsAt = now() + c.remainingMs; c.mode = 'running'; schedule(); pub(); } return view(); },
    // back to idle at the last full duration.
    reset() { const c = S(); clearTimeout(doneT); c.mode = 'idle'; c.remainingMs = c.durationMs; c.endsAt = 0; c.lastAdd = null; pub(); return view(); },
    add: (b) => add(b.seconds != null ? b.seconds : (Number(b.minutes) || 0) * 60, b.why, false),
    // jump straight to a new time without counting it as an addition.
    set(b) {
      const c = S(), sec = clampSec(b.seconds != null ? b.seconds : (Number(b.minutes) || 0) * 60, 0, MAX);
      if (c.mode === 'done' && sec > 0) c.mode = 'paused'; setRemaining(sec * 1000); c.durationMs = Math.max(c.durationMs, sec * 1000); pub(); return view();
    },
    // overlay visibility only; the timer keeps running either way.
    show() { S().visible = true; pub(); return view(); }, hide() { S().visible = false; pub(); return view(); },
    visible(b) { S().visible = !!b.on; pub(); return view(); },
    // edit label, finish actions and subathon rates; every text is trimmed to a safe length.
    settings(b) {
      const c = S(), t = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
      if (b.label !== undefined) c.label = t(b.label, 60); if (b.doneMessage !== undefined) c.doneMessage = t(b.doneMessage, 60);
      if (b.doneScene !== undefined) c.doneScene = t(b.doneScene, 100); if (b.doneChat !== undefined) c.doneChat = t(b.doneChat, 300);
      if (b.subathon) { const s = c.subathon, x = b.subathon; s.on = !!x.on; for (const k of ['perSub', 'perGiftSub', 'perBits100', 'perFollow', 'perRaidViewer']) if (k in x) s[k] = clampSec(x[k], 0, 86400); s.maxMinutes = clampSec(x.maxMinutes, 0, 48 * 60); }
      pub(); return view();
    },
    /** stream events extend a running subathon */
    onEvent(event, vars) {
      const c = S(), s = c.subathon; if (!s.on || c.mode !== 'running') return;
      let sec = 0;
      if (event === 'follow') sec = s.perFollow; else if (event === 'sub' || event === 'resub') sec = s.perSub; else if (event === 'giftsub') sec = s.perGiftSub * (Number(vars.total) || 1);
      else if (event === 'bits') sec = Math.floor((Number(vars.amount) || 0) / 100) * s.perBits100; else if (event === 'raid') sec = s.perRaidViewer * (Number(vars.viewers) || 0);
      if (sec > 0) add(sec, event + (vars.name ? ' from ' + vars.name : ''), true);
    },
    /** "!countdown 10" / "+5" / "-30s" / pause / resume / reset / hide / show: returns the chat reply */
    command(args) {
      const a = (args[0] || '').toLowerCase(), fmt = (ms) => { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
      if (!a) { const c = S(); return c.mode === 'idle' ? NOUN + ' ready: ' + fmt(c.remainingMs) : c.mode === 'done' ? NOUN + ' finished.' : NOUN + ' ' + c.mode + ': ' + fmt(remaining(c)) + ' left.'; }
      if (a === 'rules' || a === 'rule' || a === '?' || a === 'info') return api.rules();
      if (a === 'pause') { api.pause(); return NOUN + ' paused at ' + fmt(remaining()) + '.'; }
      if (a === 'resume') { api.resume(); return NOUN + ' resumed.'; }
      if (a === 'reset') { api.reset(); return NOUN + ' reset to ' + fmt(S().remainingMs) + '.'; }
      if (a === 'hide') { api.hide(); return NOUN + ' hidden.'; } if (a === 'show') { api.show(); return NOUN + ' shown.'; }
      const m = /^([+-])?(\d+(?:\.\d+)?)(s|m|h)?$/.exec(a); if (!m) return 'Usage: ' + CMD + ' | ' + CMD + ' rules | ' + CMD + ' <minutes> | +5 | -30s | pause | resume | reset | hide | show';
      const sec = Number(m[2]) * (m[3] === 's' ? 1 : m[3] === 'h' ? 3600 : 60);
      if (m[1]) { api.add({ seconds: m[1] === '-' ? -sec : sec, why: 'chat' }); return NOUN + ' ' + (m[1] === '-' ? 'cut by ' : 'extended by ') + fmt(sec * 1000) + ': ' + fmt(remaining()) + ' left.'; }
      api.start({ seconds: sec }); return NOUN + ' started: ' + fmt(sec * 1000) + '.';
    },
    view,
    /** what each action adds, as one chat line: "Sub +10m | 100 bits +5m | ..." */
    rules() {
      const s = S().subathon, f = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return (h ? h + 'h' : '') + (m ? (h ? ' ' : '') + m + 'm' : '') + (x ? (h || m ? ' ' : '') + x + 's' : '') || '0s'; };
      if (!s.on) return NOUN + ': time is not added automatically. Streamer and mods can change it.';
      const parts = [s.perSub && 'Sub/resub +' + f(s.perSub), s.perGiftSub && 'Gifted sub +' + f(s.perGiftSub) + ' each', s.perBits100 && '100 bits +' + f(s.perBits100), s.perFollow && 'Follow +' + f(s.perFollow), s.perRaidViewer && 'Raid +' + f(s.perRaidViewer) + ' per viewer'].filter(Boolean);
      return NOUN + ' time: ' + (parts.length ? parts.join(' | ') : 'nothing adds time yet') + (s.maxMinutes ? ' | max ' + f(s.maxMinutes * 60) : '') + '.';
    },
    // values for the label files / chat variables (prefixed so two timers do not clash).
    labels() {
      const c = S(), ms = remaining(c), s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
      return { [LP + '_remaining']: { value: (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s % 60).padStart(2, '0'), desc: 'Time left on the countdown / subathon timer' },
        [LP + '_status']: { value: c.mode.toUpperCase(), desc: 'IDLE, RUNNING, PAUSED or DONE' } };
    },
    // after a restart: finish a timer that ran out while we were off, or re-arm one that is still running.
    restore() { const c = S(); if (c.mode === 'running') { if (c.endsAt <= now()) { c.mode = 'done'; c.remainingMs = 0; } else schedule(); } },
  };
  api.restore();
  return api;
};
