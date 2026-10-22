'use strict';
/**
 * Automatic OBS scene switching + the control board's button list.
 *  triggers: online, offline, raid, adStart, adEnd, hypeStart, hypeEnd, brb, back
 *  online/offline/brb/back switch for good. raid/adStart/hypeStart switch temporarily and go back to the
 *  scene you were on when the raid timer / ad / hype train is over (unless an "end" scene is chosen).
 */
const TRIGGERS = {
  online:    { label: 'Stream goes live', hint: 'e.g. Starting Soon' },
  offline:   { label: 'Stream ends', hint: 'e.g. Ending' },
  raid:      { label: 'Incoming raid', hint: 'shown for the raid seconds below, then back' },
  adStart:   { label: 'Ad break starts', hint: 'e.g. Be Right Back' },
  adEnd:     { label: 'Ad break ends', hint: 'blank = go back to the previous scene' },
  hypeStart: { label: 'Hype train starts', hint: 'shown until the train ends' },
  hypeEnd:   { label: 'Hype train ends', hint: 'blank = go back to the previous scene' },
  brb:       { label: 'Chat command !brb', hint: 'mods + you only' },
  back:      { label: 'Chat command !back', hint: 'mods + you only' },
};
const TEMP = { raid: 'raidEnd', adStart: 'adEnd', hypeStart: 'hypeEnd' };

module.exports = function createScenes(ctx) {
  const state = ctx.state, log = ctx.log || (() => {});
  const S = () => state.autoScenes;
  const num = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  let prev = null, raidTimer = null, lastLog = [];
  const note = (text, ok = true) => { lastLog.unshift({ ts: Date.now(), text, ok }); lastLog.length = Math.min(lastLog.length, 15); if (!ok) log('auto scene:', text); };

  async function go(scene, why) {
    try { await ctx.obs.setScene(scene); note(why + ' -> ' + scene); return true; } catch (e) { note(why + ': ' + e.message, false); return false; }
  }
  /** a trigger happened; returns true if a scene change was attempted */
  async function fire(trigger, data = {}) {
    const s = S(); if (!s.enabled || !TRIGGERS[trigger]) return false;
    const target = s.map[trigger];
    if (TEMP[trigger]) {
      if (!target) return false;
      if (prev == null) { try { prev = await ctx.obs.current(); } catch (e) { prev = null; } }
      const ok = await go(target, TRIGGERS[trigger].label);
      if (trigger === 'raid') { clearTimeout(raidTimer); raidTimer = setTimeout(() => back('raid timer', s.map.raidEnd), num(s.raidSeconds, 30, 1, 600) * 1000); if (raidTimer.unref) raidTimer.unref(); }
      return ok;
    }
    if (trigger === 'adEnd' || trigger === 'hypeEnd') {
      const startKey = trigger === 'adEnd' ? 'adStart' : 'hypeStart';
      if (!s.map[startKey] && !target) return false;   // nothing was switched, so nothing to undo
      return back(TRIGGERS[trigger].label, target);
    }
    if (!target) return false;
    prev = null;
    return go(target, TRIGGERS[trigger].label);
  }
  async function back(why, endScene) {
    clearTimeout(raidTimer);
    const to = endScene || prev; prev = null;
    if (!to) return false;
    return go(to, why);
  }

  // ---------------------------------------------------------------- board buttons
  const clean = (b) => {
    const label = str(b.label, 24) || 'Button';
    const a = Object.assign({}, b.action || {});
    return { label, color: ['orange', 'teal', 'rust', 'olive', 'cream'].includes(b.color) ? b.color : 'teal', confirm: !!b.confirm, actions: ctx.hooks.clean({ name: label, actions: Array.isArray(b.actions) ? b.actions : [a] }).actions };
  };

  async function press(id) {
    const b = state.board.find((x) => x.id === id); if (!b) throw new Error('No such button');
    const results = await ctx.hooks.runActions(b.label, b.actions);
    const bad = results.find((r) => !r.ok); if (bad) throw new Error(bad.msg);
    return { ok: true, msg: results.map((r) => r.msg).filter(Boolean).join(', ') };
  }

  function view() {
    const s = S();
    return { enabled: !!s.enabled, map: s.map, raidSeconds: s.raidSeconds, triggers: TRIGGERS, board: state.board, log: lastLog };
  }
  async function api(action, b) {
    const s = S();
    switch (action) {
      case 'save': {
        s.enabled = !!b.enabled; s.raidSeconds = num(b.raidSeconds, 30, 1, 600);
        for (const k of [...Object.keys(TRIGGERS), 'raidEnd']) if (b.map && b.map[k] !== undefined) s.map[k] = str(b.map[k], 100);
        ctx.persist(); return view();
      }
      case 'test': { if (!TRIGGERS[b.trigger]) throw new Error('Unknown trigger'); const was = S().enabled; s.enabled = true; try { const ok = await fire(b.trigger); return { ok, log: lastLog[0] }; } finally { s.enabled = was; } }
      case 'back': { const ok = await back('manual', ''); return { ok }; }
      case 'button/save': {
        const c = clean(b); let t = b.id && state.board.find((x) => x.id === b.id);
        if (!t) { if (state.board.length >= 40) throw new Error('That is plenty of buttons (40)'); t = { id: 'b-' + Math.random().toString(36).slice(2, 7) }; state.board.push(t); }
        Object.assign(t, c); ctx.persist(); return t;
      }
      case 'button/delete': state.board = state.board.filter((x) => x.id !== b.id); ctx.persist(); return { ok: true };
      case 'button/move': {
        const i = state.board.findIndex((x) => x.id === b.id), j = i + (b.dir < 0 ? -1 : 1);
        if (i >= 0 && j >= 0 && j < state.board.length) { [state.board[i], state.board[j]] = [state.board[j], state.board[i]]; ctx.persist(); }
        return { ok: true };
      }
      case 'press': return press(b.id);
      case 'run': {   // one-off actions from the board's fixed buttons
        const acts = ctx.hooks.clean({ name: 'board', actions: b.actions }).actions;
        const results = await ctx.hooks.runActions('board', acts), bad = results.find((r) => !r.ok); if (bad) throw new Error(bad.msg);
        return { ok: true, msg: results.map((r) => r.msg).filter(Boolean).join(', ') };
      }
      default: throw new Error('unknown action');
    }
  }
  return { fire, back, view, api, press, TRIGGERS };
};
