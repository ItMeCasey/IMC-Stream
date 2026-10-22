// Auto scene switching + control board buttons. Run: node scenes-test.js
const assert = require('node:assert');
const createScenes = require('./scenes.js'), createHooks = require('./hooks.js');

(async () => {
  const state = { autoScenes: { enabled: false, raidSeconds: 30, map: { online: '', offline: '', raid: '', raidEnd: '', adStart: '', adEnd: '', hypeStart: '', hypeEnd: '', brb: '', back: '' } }, board: [], rewardHooks: [], obsCfg: {}, alertRules: [] };
  let cur = 'Gameplay'; const calls = [], fail = { on: false };
  const obs = { current: async () => cur, setScene: async (n) => { if (fail.on) throw new Error('OBS is not running'); cur = n; calls.push(n); } };
  const did = []; const bot = { say: (t) => did.push('say:' + t), expandFor: async (t) => t, execute: async () => {}, api: async () => ({}), view: () => ({ commands: [] }) };
  const hooks = createHooks({ state, persist: () => {}, log: () => {}, bot, obs, me: () => ({ id: '1', login: 'itmecasey' }),
    runAd: async (l) => { did.push('ad' + l); return { length: l }; }, snoozeAd: async () => { did.push('snooze'); return { snoozes: 2 }; }, createClip: async () => { did.push('clip'); return { url: 'https://clips.twitch.tv/x' }; },
    alertControl: (a) => did.push('alerts:' + a), mediaControl: async (a) => did.push('media:' + a), countdown: {}, tts: {} });
  const sc = createScenes({ state, persist: () => {}, log: () => {}, obs, hooks });

  // off by default: nothing happens
  state.autoScenes.map.online = 'Starting Soon'; assert.strictEqual(await sc.fire('online'), false); assert.strictEqual(cur, 'Gameplay');
  await sc.api('save', { enabled: true, raidSeconds: 30, map: { online: 'Starting Soon', offline: 'Ending', raid: 'Full Cam', adStart: 'Be Right Back', hypeStart: 'Just Chatting', brb: 'Be Right Back', back: 'Gameplay' } });
  assert.strictEqual(await sc.fire('online'), true); assert.strictEqual(cur, 'Starting Soon');
  assert.strictEqual(await sc.fire('offline'), true); assert.strictEqual(cur, 'Ending');
  assert.strictEqual(await sc.fire('adEnd'), false, 'an ad end with nothing to undo does nothing');

  // ad: go to BRB, then come back to where we were
  cur = 'Gameplay'; calls.length = 0;
  await sc.fire('adStart'); assert.strictEqual(cur, 'Be Right Back'); await sc.fire('adEnd'); assert.strictEqual(cur, 'Gameplay', 'back to the scene before the ad');
  // raid: temporary scene, manual "go back" works, a second trigger while temporary keeps the ORIGINAL scene to return to
  await sc.fire('raid'); assert.strictEqual(cur, 'Full Cam'); await sc.fire('hypeStart'); assert.strictEqual(cur, 'Just Chatting');
  await sc.fire('hypeEnd'); assert.strictEqual(cur, 'Gameplay', 'returns to the original scene, not the raid scene');
  await sc.fire('raid'); assert.strictEqual((await sc.api('back', {})).ok, true); assert.strictEqual(cur, 'Gameplay', 'manual back');
  await sc.api('save', { enabled: true, raidSeconds: 1, map: { raidEnd: 'Just Chatting' } }); await sc.fire('raid'); assert.strictEqual(cur, 'Full Cam');
  await new Promise((r) => setTimeout(r, 1300)); assert.strictEqual(cur, 'Just Chatting', 'raid timer moves to the raid-end scene');
  await sc.api('save', { enabled: true, raidSeconds: 1, map: { raidEnd: '' } }); cur = 'Gameplay'; await sc.fire('raid'); await new Promise((r) => setTimeout(r, 1300)); assert.strictEqual(cur, 'Gameplay', 'raid timer goes back to where we were');
  // chat commands
  await sc.fire('brb'); assert.strictEqual(cur, 'Be Right Back'); await sc.fire('back'); assert.strictEqual(cur, 'Gameplay');
  // a trigger with no scene chosen does nothing
  state.autoScenes.map.brb = ''; assert.strictEqual(await sc.fire('brb'), false);
  // OBS down: reported in the log, never throws
  fail.on = true; assert.strictEqual(await sc.fire('online'), false); assert.ok(sc.view().log[0].ok === false && /not running/.test(sc.view().log[0].text)); fail.on = false;
  // test button works even when auto switching is off, and leaves the switch off
  await sc.api('save', { enabled: false, map: {} }); const t = await sc.api('test', { trigger: 'online' }); assert.strictEqual(cur, 'Starting Soon'); assert.strictEqual(sc.view().enabled, false); assert.ok(t.ok);

  // board buttons
  const b = await sc.api('button/save', { label: 'Hello chat', color: 'orange', actions: [{ type: 'chat', text: 'Hello {name}!' }] });
  assert.ok(b.id && state.board.length === 1);
  const pr = await sc.api('press', { id: b.id }); assert.ok(pr.ok && did.includes('say:Hello {name}!'));
  await sc.api('button/save', { label: 'Scene', actions: [{ type: 'obs-scene', scene: 'Full Cam' }] }); await sc.api('press', { id: state.board[1].id }); assert.strictEqual(cur, 'Full Cam');
  await sc.api('button/move', { id: state.board[1].id, dir: -1 }); assert.strictEqual(state.board[0].label, 'Scene');
  for (const [type, extra, expect] of [['ad', { op: 'run', length: 60 }, 'ad60'], ['ad', { op: 'snooze' }, 'snooze'], ['clip', {}, 'clip'], ['alerts', { op: 'pause' }, 'alerts:pause'], ['media', { op: 'next' }, 'media:next']]) {
    const r = await sc.api('run', { actions: [Object.assign({ type }, extra)] }); assert.ok(r.ok && did.includes(expect), type + ' ran');
  }
  await assert.rejects(sc.api('run', { actions: [{ type: 'alerts', op: 'skip' }, { type: 'obs-scene', scene: '' }] }), /Pick a scene/, 'a failing action is reported');
  await assert.rejects(sc.api('button/save', { label: 'Empty', actions: [] }), /at least one action/);
  await sc.api('button/delete', { id: b.id }); assert.strictEqual(state.board.length, 1);
  console.log('scenes test passed');
})().catch((e) => { console.error('FAILED:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });
