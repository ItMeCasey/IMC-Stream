'use strict';
/**
 * Channel point reward hooks: when a reward is redeemed, run a list of actions
 * (show an alert, post in chat, run a chat command, call a webhook, drive OBS, adjust currency / counters, mark fulfilled).
 */
const TYPES = ['alert', 'chat', 'command', 'webhook', 'obs-source', 'obs-scene', 'points', 'counter', 'status', 'countdown', 'tts', 'ad', 'clip', 'alerts', 'media', 'obs-stream', 'obs-record', 'emote7tv'];
const ANN = ['primary', 'blue', 'green', 'orange', 'purple'];

module.exports = function createHooks(ctx) {
  const state = ctx.state, log = ctx.log || (() => {});
  const runs = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const raw = (v, n) => String(v == null ? '' : v).slice(0, n);
  const num = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  const cfg = () => state.obsCfg;

  const matches = (h, reward) => {
    reward = reward || {}; const m = h.match || {};
    if (m.rewardId) return reward.id === m.rewardId;
    if (m.title) return String(reward.title || '').toLowerCase().includes(m.title.toLowerCase());
    return true;   // no filter = every reward
  };

  async function doAction(a, rd) {
    const ex = (t) => ctx.bot.expandFor(t, rd.user, rd.vars, rd.args);
    switch (a.type) {
      case 'alert': {
        if (!a.key) throw new Error('Pick an alert key');
        const ok = ctx.fireCustom(a.key, { name: rd.user.name, message: rd.vars.input || rd.vars.reward, amount: rd.vars.cost }, Number(rd.vars.cost) || 0);
        if (!ok) throw new Error('No enabled Custom alert with the key "' + a.key + '" (create one in Alerts on the dashboard)');
        return 'alert "' + a.key + '" shown';
      }
      case 'chat': { const t = await ex(a.text); if (!t) throw new Error('Message is empty'); ctx.bot.say(t, undefined, a.announce); return t; }
      case 'command': {
        const t = await ex(a.text); if (!t) throw new Error('Command is empty');
        await ctx.bot.execute(t, rd.user, a.asBroadcaster ? 4 : 0); return 'ran ' + t;
      }
      case 'webhook': {
        if (!/^https?:\/\//i.test(a.url || '')) throw new Error('Webhook needs an http(s) address');
        const body = a.body ? await ex(a.body) : JSON.stringify({ event: 'redemption', user: rd.user.name, input: rd.vars.input, reward: rd.vars.reward, cost: rd.vars.cost });
        const ac = new AbortController(), t = setTimeout(() => ac.abort(), 5000);
        try {
          const r = await (ctx.fetch || fetch)(a.url, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': /^\s*[{[]/.test(body) ? 'application/json' : 'text/plain' }, body });
          if (!r.ok) throw new Error('Webhook answered HTTP ' + r.status); return 'webhook HTTP ' + r.status;
        } finally { clearTimeout(t); }
      }
      case 'obs-source': {
        if (!a.source) throw new Error('Pick the OBS source to show');
        const r = await ctx.obs.showSource({ scene: a.scene, source: a.source, seconds: num(a.seconds, 5, 0, 3600) });
        return 'showed ' + a.source + ' in ' + r.scene + (a.seconds > 0 ? ' for ' + a.seconds + 's' : '');
      }
      case 'obs-scene': { if (!a.scene) throw new Error('Pick a scene'); await ctx.obs.setScene(a.scene); return 'switched to ' + a.scene; }
      case 'points': {
        const n = Math.floor(Number(a.amount)); if (!n) throw new Error('Amount cannot be 0');
        await ctx.bot.api('points/adjust', { id: rd.user.id || undefined, name: rd.user.name, amount: Math.abs(n), mode: n < 0 ? 'remove' : 'add' });
        return (n > 0 ? 'gave ' : 'took ') + Math.abs(n);
      }
      case 'counter': {
        if (!a.name) throw new Error('Counter needs a name'); const r = await ctx.bot.api('counter/add', { name: a.name, delta: Number(a.delta) || 1 });
        return a.name + ' is now ' + r.value;
      }
      case 'tts': { const t = await ex(a.text); if (!t) throw new Error('Message is empty'); const r = await ctx.tts.say(t, { voice: a.voice || undefined, by: rd.user.name }); return 'said "' + r.text + '"'; }
      case 'countdown': {
        const op = ['add', 'start', 'pause', 'resume', 'reset', 'show', 'hide'].includes(a.op) ? a.op : 'add', sec = Number(a.seconds) || 0;
        if ((op === 'add' || op === 'start') && !sec) throw new Error('Seconds cannot be 0');
        ctx.countdown[op](op === 'add' || op === 'start' ? { seconds: sec, why: 'reward' } : {}); return 'timer ' + op + (sec ? ' ' + sec + 's' : '');
      }
      case 'status': {
        if (!rd.redemptionId) throw new Error('Only works on real redemptions (not tests)');
        const me = ctx.me(), r = await ctx.helix('PATCH', '/channel_points/custom_rewards/redemptions?id=' + encodeURIComponent(rd.redemptionId) + '&broadcaster_id=' + me.id + '&reward_id=' + encodeURIComponent(rd.vars.rewardid), { status: a.status === 'CANCELED' ? 'CANCELED' : 'FULFILLED' });
        if (!r.ok) throw new Error(((r.json && r.json.message) || 'HTTP ' + r.status) + ' (Twitch only lets an app update redemptions of rewards that app created: use "Create reward" on this page)');
        return a.status === 'CANCELED' ? 'cancelled + refunded' : 'marked fulfilled';
      }
      case 'emote7tv': {   // a viewer pasted a 7TV emote link: add it to the channel's 7TV set for a while, say so in chat, and fulfil the redemption (or refund it when the emote could not be added)
        if (!ctx.seventv) throw new Error('7TV emote rewards are not available');
        const setStatus = async (status) => {
          if (!rd.redemptionId) return; const me = ctx.me();
          const r = await ctx.helix('PATCH', '/channel_points/custom_rewards/redemptions?id=' + encodeURIComponent(rd.redemptionId) + '&broadcaster_id=' + me.id + '&reward_id=' + encodeURIComponent(rd.vars.rewardid), { status });
          if (!r.ok) throw new Error((r.json && r.json.message) || 'HTTP ' + r.status);
        };
        let res;
        try { res = await ctx.seventv.add({ url: rd.vars.input, by: rd.user.name }); } catch (e) {
          if (a.say !== false) ctx.bot.say('@' + rd.user.name + ' that emote could not be added: ' + e.message + (rd.redemptionId ? ' (your points are refunded)' : ''));
          if (rd.redemptionId) await setStatus('CANCELED').catch((x) => log('could not refund the redemption:', x.message));
          throw e;
        }
        let note = ''; await setStatus('FULFILLED').catch((x) => { note = ' (could not mark the redemption fulfilled: ' + x.message + ')'; });
        if (a.say !== false) ctx.bot.say('@' + rd.user.name + ' added the emote ' + res.name + ' to the channel for ' + res.days + ' days!');
        return 'added ' + res.name + ' for ' + res.days + ' days' + note;
      }
      case 'obs-stream': await ctx.obs.stream(a.op); return 'stream ' + a.op;
      case 'obs-record': await ctx.obs.record(a.op); return 'recording ' + a.op;
      case 'ad': {
        if (a.op === 'snooze') { const r = await ctx.snoozeAd(); return 'ad snoozed (' + r.snoozes + ' left)'; }
        const r = await ctx.runAd(Number(a.length) || 30); return 'ad running for ' + r.length + 's';
      }
      case 'clip': { const r = await ctx.createClip(); if (a.say) ctx.bot.say(r.url); return 'clip ' + r.url; }
      case 'alerts': ctx.alertControl(a.op); return 'alerts: ' + a.op;
      case 'media': await ctx.mediaControl(a.op); return 'music: ' + a.op;
      default: throw new Error('Unknown action ' + a.type);
    }
  }

  async function runHook(h, rd) {
    const results = [];
    for (const a of h.actions) {
      if (a.delay > 0) await sleep(a.delay * 1000);
      try { results.push({ type: a.type, ok: true, msg: await doAction(a, rd) }); } catch (e) { results.push({ type: a.type, ok: false, msg: e.message }); log('hook "' + h.name + '" ' + a.type + ' failed:', e.message); }
    }
    runs.unshift({ ts: Date.now(), hook: h.name, user: rd.user.name, reward: rd.vars.reward, test: !!rd.test, results }); runs.length = Math.min(runs.length, 30);
    return results;
  }

  /** a real EventSub channel_points_custom_reward_redemption.add event */
  function onRedemption(e) {
    const reward = e.reward || {}, input = e.user_input || '';
    const rd = { user: { id: e.user_id, login: e.user_login, name: e.user_name }, args: input.split(/\s+/).filter(Boolean), redemptionId: e.id,
      vars: { input, reward: reward.title || '', cost: reward.cost || 0, rewardid: reward.id || '' } };
    const hit = state.rewardHooks.filter((h) => h.enabled && matches(h, reward));
    return Promise.all(hit.map((h) => runHook(h, rd).catch((err) => log('hook error', err.message))));
  }

  function clean(b) {
    const name = str(b.name, 40) || 'Reward hook';
    const acts = (Array.isArray(b.actions) ? b.actions : []).slice(0, 12).filter((a) => a && TYPES.includes(a.type)).map((a) => {
      const o = { type: a.type, delay: num(a.delay, 0, 0, 600) };
      if (a.type === 'alert') o.key = String(a.key || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
      if (a.type === 'chat') { o.text = raw(a.text, 450); o.announce = ANN.includes(a.announce) ? a.announce : ''; }
      if (a.type === 'command') { o.text = raw(a.text, 300); o.asBroadcaster = !!a.asBroadcaster; }
      if (a.type === 'webhook') { o.url = str(a.url, 400); o.body = raw(a.body, 1000); }
      if (a.type === 'obs-source') { o.scene = str(a.scene, 100); o.source = str(a.source, 100); o.seconds = num(a.seconds, 5, 0, 3600); }
      if (a.type === 'obs-scene') o.scene = str(a.scene, 100);
      if (a.type === 'points') o.amount = Math.floor(num(a.amount, 100, -1e7, 1e7));
      if (a.type === 'counter') { o.name = String(a.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30); o.delta = num(a.delta, 1, -1e6, 1e6); }
      if (a.type === 'tts') { o.text = raw(a.text, 300); o.voice = str(a.voice, 100); }
      if (a.type === 'countdown') { o.op = ['add', 'start', 'pause', 'resume', 'reset', 'show', 'hide'].includes(a.op) ? a.op : 'add'; o.seconds = num(a.seconds, 60, -86400, 86400); }
      if (a.type === 'ad') { o.op = a.op === 'snooze' ? 'snooze' : 'run'; o.length = [30, 60, 90, 120, 150, 180].includes(Number(a.length)) ? Number(a.length) : 30; }
      if (a.type === 'obs-stream' || a.type === 'obs-record') o.op = ['start', 'stop', 'toggle'].includes(a.op) ? a.op : 'toggle';
      if (a.type === 'clip') o.say = !!a.say;
      if (a.type === 'emote7tv') o.say = a.say !== false;
      if (a.type === 'alerts') o.op = ['pause', 'resume', 'mute', 'unmute', 'skip', 'clear'].includes(a.op) ? a.op : 'skip';
      if (a.type === 'media') o.op = ['toggle', 'play', 'pause', 'next', 'previous'].includes(a.op) ? a.op : 'toggle';
      if (a.type === 'status') o.status = a.status === 'CANCELED' ? 'CANCELED' : 'FULFILLED';
      return o;
    });
    if (!acts.length) throw new Error('Add at least one action');
    return { name, enabled: b.enabled !== false, match: { rewardId: str(b.match && b.match.rewardId, 60), title: str(b.match && b.match.title, 60), rewardName: str(b.match && b.match.rewardName, 60) }, actions: acts };
  }

  let rewardCache = { t: 0, data: null };
  async function rewards(force) {
    if (!force && rewardCache.data && Date.now() - rewardCache.t < 15000) return rewardCache.data;
    const me = ctx.me(); if (!me) throw new Error('Not connected to Twitch');
    const [r, mine] = await Promise.all([ctx.helix('GET', '/channel_points/custom_rewards?broadcaster_id=' + me.id), ctx.helix('GET', '/channel_points/custom_rewards?broadcaster_id=' + me.id + '&only_manageable_rewards=true')]);
    if (!r.ok) throw new Error((r.json && r.json.message) || 'Could not list rewards (HTTP ' + r.status + ')');
    const own = new Set(mine.ok ? (mine.json.data || []).map((x) => x.id) : []);   // Twitch only lets an app change rewards that app created
    rewardCache = { t: Date.now(), data: (r.json.data || []).map((x) => ({ id: x.id, title: x.title, cost: x.cost, enabled: x.is_enabled, paused: !!x.is_paused, input: x.is_user_input_required, mine: own.has(x.id) })) };
    return rewardCache.data;
  }

  const view = () => ({
    hooks: state.rewardHooks, runs, types: TYPES,
    obs: { host: cfg().host, port: cfg().port, hasPassword: !!cfg().password },
    alertKeys: [...new Set(state.alertRules.filter((r) => r.event === 'custom' && r.key).map((r) => r.key))],
    commands: ctx.bot.view().commands.map((c) => c.name),
  });

  async function api(action, b) {
    switch (action) {
      case 'save': {
        const h = clean(b); let t = b.id && state.rewardHooks.find((x) => x.id === b.id);
        if (!t) { t = { id: 'h-' + Math.random().toString(36).slice(2, 7) }; state.rewardHooks.push(t); }
        Object.assign(t, h); ctx.persist(); return t;
      }
      case 'delete': state.rewardHooks = state.rewardHooks.filter((x) => x.id !== b.id); ctx.persist(); return { ok: true };
      case 'test': {   // really runs the actions, with a sample viewer
        const h = state.rewardHooks.find((x) => x.id === b.id); if (!h) throw new Error('No such hook');
        const input = str(b.input, 200), reward = (rewardCache.data || []).find((x) => x.id === h.match.rewardId);
        const rd = { test: true, user: { id: '', login: 'testviewer', name: str(b.user, 30) || 'TestViewer' }, args: input.split(/\s+/).filter(Boolean), redemptionId: '',
          vars: { input, reward: (reward && reward.title) || h.match.title || h.match.rewardName || 'Test reward', cost: (reward && reward.cost) || 100, rewardid: h.match.rewardId } };
        return { results: await runHook(h, rd) };
      }
      case 'obs/save': {
        const c = cfg(); c.host = str(b.host, 100) || '127.0.0.1'; c.port = Math.floor(num(b.port, 4455, 1, 65535));
        if (b.password !== undefined && b.password !== null && b.password !== '__keep__') c.password = String(b.password).slice(0, 200);
        ctx.persist(); return { host: c.host, port: c.port, hasPassword: !!c.password };
      }
      case 'obs/test': return ctx.obs.test();
      case 'obs/scenes': return ctx.obs.scenes();
      case 'obs/status': return ctx.obs.status();
      case 'obs/stream': return ctx.obs.stream(['start', 'stop', 'toggle'].includes(b.op) ? b.op : 'toggle');
      case 'obs/record': return ctx.obs.record(['start', 'stop', 'toggle'].includes(b.op) ? b.op : 'toggle');
      case 'obs/sources': return ctx.obs.sources(str(b.scene, 100));
      case 'rewards': return rewards(true);
      case 'reward/update': {   // enable/disable (is_enabled), pause, rename, change cost
        const me = ctx.me(); if (!me) throw new Error('Not connected to Twitch'); if (!b.id) throw new Error('Which reward?');
        const body = {}; if (b.enabled !== undefined) body.is_enabled = !!b.enabled; if (b.paused !== undefined) body.is_paused = !!b.paused;
        if (b.title !== undefined) { body.title = str(b.title, 45); if (!body.title) throw new Error('Reward needs a title'); } if (b.cost !== undefined) body.cost = Math.floor(num(b.cost, 100, 1, 1e9));
        const r = await ctx.helix('PATCH', '/channel_points/custom_rewards?broadcaster_id=' + me.id + '&id=' + encodeURIComponent(b.id), body);
        if (!r.ok) throw new Error(((r.json && r.json.message) || 'HTTP ' + r.status) + (r.status === 403 ? ' (Twitch only lets this app change rewards it created)' : ''));
        rewardCache.t = 0; return { ok: true };
      }
      case 'reward/copy': {   // a reward made on twitch.tv can't be edited by an app: make an app-owned copy, then switch the original off on Twitch
        const me = ctx.me(); if (!me) throw new Error('Not connected to Twitch'); const src = (await rewards(false)).find((x) => x.id === b.id); if (!src) throw new Error('Reward not found');
        const r = await ctx.helix('POST', '/channel_points/custom_rewards?broadcaster_id=' + me.id, { title: str(src.title + ' (app)', 45), cost: src.cost, is_user_input_required: !!src.input, is_enabled: true });
        if (!r.ok) throw new Error('Copy reward: ' + ((r.json && r.json.message) || 'HTTP ' + r.status)); rewardCache.t = 0; return r.json.data[0];
      }
      case 'reward/delete': {
        const me = ctx.me(); if (!me) throw new Error('Not connected to Twitch'); if (!b.id) throw new Error('Which reward?');
        const r = await ctx.helix('DELETE', '/channel_points/custom_rewards?broadcaster_id=' + me.id + '&id=' + encodeURIComponent(b.id));
        if (!r.ok) throw new Error(((r.json && r.json.message) || 'HTTP ' + r.status) + (r.status === 403 ? ' (Twitch only lets this app delete rewards it created)' : ''));
        rewardCache.t = 0; return { ok: true };
      }
      case 'reward/create': {
        const me = ctx.me(); if (!me) throw new Error('Not connected to Twitch');
        const title = str(b.title, 45); if (!title) throw new Error('Reward needs a title'); const cost = Math.floor(num(b.cost, 100, 1, 1e9));
        const body = { title, cost, prompt: str(b.prompt, 200), is_user_input_required: !!b.input, is_enabled: true };
        if (num(b.cooldown, 0, 0, 604800) > 0) { body.is_global_cooldown_enabled = true; body.global_cooldown_seconds = Math.floor(num(b.cooldown, 0, 0, 604800)); }
        const r = await ctx.helix('POST', '/channel_points/custom_rewards?broadcaster_id=' + me.id, body);
        if (!r.ok) throw new Error('Create reward: ' + ((r.json && r.json.message) || 'HTTP ' + r.status));
        rewardCache.t = 0; return r.json.data[0];
      }
      default: throw new Error('unknown action');
    }
  }
  /** run a list of actions as the broadcaster (the control board's buttons) */
  function runActions(name, actions) {
    const me = ctx.me(), login = (me && me.login) || 'broadcaster';
    return runHook({ name, actions }, { user: { id: (me && me.id) || '', login, name: login }, args: [], vars: { input: '', reward: name, cost: 0, rewardid: '' }, test: true });
  }
  return { onRedemption, runHook, runActions, view, api, rewards, matches, clean };
};
