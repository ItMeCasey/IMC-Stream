// Tests channel point reward hooks with the real bot + hooks engine and fakes for Twitch / OBS. Run: node hooks-test.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert');
const createBot = require('./bot.js'), createHooks = require('./hooks.js');

const sevenAdds = [], ttsSaid = [], cdOps = [], sent = [], obsCalls = [], helixCalls = [], fetchCalls = [], customFires = [];
const state = { stream: { live: true, startedAt: new Date().toISOString(), game: 'Tetris', title: 'T', viewers: 5 }, totals: { followers: 10, subs: 1 }, recent: { followers: [], subscribers: [] },
  rewardHooks: [], alertRules: [{ event: 'custom', key: 'confetti' }, { event: 'custom', key: 'confetti' }, { event: 'follow' }], obsCfg: { host: '127.0.0.1', port: 4455, password: '' } };
let persisted = 0;
const bot = createBot({
  DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'icm-hooks-')), log: () => {}, get state() { return state; }, gapMs: 0, maxPer30s: 1e9, rng: () => 0,
  me: () => ({ id: '1', login: 'itmecasey' }), send: async (text, replyTo, announce) => { sent.push({ text, replyTo, announce }); },
  mod: async () => {}, resolveUser: async (l) => 'id-' + l, helix: async () => ({ ok: true, json: {} }), clientId: () => 'c', ID_URL: () => 'x', HELIX: () => 'y',
  searchCategories: async () => [], setChannel: async () => {}, runAd: async () => {}, snoozeAd: async () => ({}),
});
const obs = {
  showSource: async (o) => { obsCalls.push(['show', o]); if (o.source === 'Missing') throw new Error('No scene items were found'); return { scene: o.scene || 'Current' }; },
  setScene: async (n) => { obsCalls.push(['scene', n]); },
  test: async () => ({}), scenes: async () => [], sources: async () => [],
};
const hooks = createHooks({
  state, persist: () => { persisted++; }, log: () => {}, bot, obs, me: () => ({ id: '1', login: 'itmecasey' }),
  helix: async (m, p, b) => { helixCalls.push([m, p, b]); if (p.startsWith('/channel_points/custom_rewards?')) { return m === 'GET' ? { ok: true, json: { data: [{ id: 'r1', title: 'Hydrate!', cost: 200, is_enabled: true, is_user_input_required: false }] } } : { ok: true, json: { data: [{ id: 'new1', title: b.title }] } }; } return p.includes('fail') ? { ok: false, status: 403, json: { message: 'The broadcaster is not the owner of this reward' } } : { ok: true, json: {} }; },
  fireCustom: (key, vars, n) => { customFires.push([key, vars, n]); return key === 'confetti'; },
  tts: { say: async (text, o) => { ttsSaid.push([text, o.voice, o.by]); return { text }; } },
  countdown: new Proxy({}, { get: (_, op) => (b) => { cdOps.push([op, b]); } }),
  seventv: { add: async ({ url, by }) => { sevenAdds.push([url, by]); if (/bad/.test(url)) throw new Error('that emote does not exist on 7TV'); return { name: 'KEKW', days: 30 }; } },
  fetch: async (url, o) => { fetchCalls.push([url, o]); return { ok: !/bad/.test(url), status: /bad/.test(url) ? 500 : 200 }; },
});

const redemption = (over = {}) => Object.assign({ id: 'red1', user_id: 'u9', user_login: 'sam', user_name: 'Sam', user_input: 'blue shirt', reward: { id: 'r1', title: 'Hydrate!', cost: 200 } }, over);

(async () => {
  // ---- saving + validation
  const h1 = await hooks.api('save', { name: 'Hydrate combo', match: { rewardId: 'r1' }, actions: [
    { type: 'alert', key: 'Confetti' },
    { type: 'chat', text: '{name} redeemed {reward} ({cost})! They said: {input} / first word: {1}', announce: 'green' },
    { type: 'command', text: '!addquote {input}', asBroadcaster: true },
    { type: 'webhook', url: 'https://example.test/hook', body: '' },
    { type: 'obs-source', scene: '', source: 'Water', seconds: 8 },
    { type: 'obs-scene', scene: 'Chill' },
    { type: 'points', amount: 250 },
    { type: 'counter', name: 'Glugs', delta: 1 },
    { type: 'status', status: 'FULFILLED' },
    { type: 'bogus' }] });
  assert.strictEqual(h1.actions.length, 9, 'unknown action types are dropped');
  assert.strictEqual(h1.actions[0].key, 'confetti', 'alert keys are normalised');
  await assert.rejects(hooks.api('save', { name: 'empty', actions: [] }), /at least one action/);
  assert.deepStrictEqual(hooks.view().alertKeys, ['confetti'], 'custom alert keys offered to the UI');

  // ---- matching
  assert.ok(hooks.matches({ match: { rewardId: 'r1' } }, { id: 'r1', title: 'x' }) && !hooks.matches({ match: { rewardId: 'r1' } }, { id: 'r2', title: 'Hydrate!' }));
  assert.ok(hooks.matches({ match: { title: 'hydr' } }, { id: 'z', title: 'Hydrate!' }) && !hooks.matches({ match: { title: 'hydr' } }, { id: 'z', title: 'Sing' }));
  assert.ok(hooks.matches({ match: {} }, { id: 'z', title: 'anything' }), 'no filter = every reward');

  // ---- a real redemption runs every action in order
  await hooks.onRedemption(redemption()); await bot._flush();
  assert.deepStrictEqual(customFires.pop(), ['confetti', { name: 'Sam', message: 'blue shirt', amount: 200 }, 200]);
  assert.deepStrictEqual(sent.shift(), { text: 'Sam redeemed Hydrate! (200)! They said: blue shirt / first word: blue', replyTo: undefined, announce: 'green' });
  assert.deepStrictEqual(sent.map((m) => m.text), ['Added quote #1.'], '!addquote ran as the broadcaster with the viewer\'s text');
  assert.strictEqual(bot.db().quotes[0].text, 'blue shirt');
  assert.deepStrictEqual(JSON.parse(fetchCalls[0][1].body), { event: 'redemption', user: 'Sam', input: 'blue shirt', reward: 'Hydrate!', cost: 200 });
  assert.deepStrictEqual(obsCalls, [['show', { scene: '', source: 'Water', seconds: 8 }], ['scene', 'Chill']]);
  assert.strictEqual(bot.db().points['u9'].pts, 250); assert.strictEqual(bot.db().counters.glugs, 1);
  assert.deepStrictEqual(helixCalls.pop().slice(0, 2), ['PATCH', '/channel_points/custom_rewards/redemptions?id=red1&broadcaster_id=1&reward_id=r1']);
  const run = hooks.view().runs[0]; assert.ok(run.results.every((r) => r.ok), JSON.stringify(run.results));
  sent.length = 0;

  // ---- reward makes the voice speak what the viewer typed
  const ht = await hooks.api('save', { name: 'Speak', match: { title: 'tts' }, actions: [{ type: 'tts', text: '{name} says {input}', voice: 'Microsoft Zira Desktop' }] });
  await hooks.onRedemption(redemption({ reward: { id: 'x', title: 'TTS message', cost: 10 }, user_input: 'good luck' }));
  assert.deepStrictEqual(ttsSaid.splice(0), [['Sam says good luck', 'Microsoft Zira Desktop', 'Sam']]);
  await hooks.api('delete', { id: ht.id });

  // ---- reward adds time to the subathon timer
  const hc = await hooks.api('save', { name: 'Add time', match: { title: 'add time' }, actions: [{ type: 'countdown', op: 'add', seconds: 120 }, { type: 'countdown', op: 'pause' }, { type: 'countdown', op: 'bogus', seconds: 5 }] });
  assert.deepStrictEqual(hc.actions.map((a) => a.op), ['add', 'pause', 'add'], 'unknown timer operations fall back to add');
  await hooks.onRedemption(redemption({ reward: { id: 'x', title: 'Add time to the timer', cost: 50 } }));
  assert.deepStrictEqual(cdOps.splice(0).map((c) => c[0] + ':' + (c[1].seconds || '')), ['add:120', 'pause:', 'add:5']);
  await hooks.api('delete', { id: hc.id });

  // ---- other rewards are ignored; disabled hooks don't run
  await hooks.onRedemption(redemption({ reward: { id: 'r2', title: 'Sing', cost: 5 } })); await bot._flush(); assert.strictEqual(sent.length, 0);
  state.rewardHooks[0].enabled = false; await hooks.onRedemption(redemption()); await bot._flush(); assert.strictEqual(sent.length, 0); state.rewardHooks[0].enabled = true;

  // ---- a failing action is reported but does not stop the next ones
  obsCalls.length = 0; fetchCalls.length = 0;
  const h2 = await hooks.api('save', { name: 'Resilient', match: { title: 'Sing' }, actions: [
    { type: 'obs-source', source: 'Missing', seconds: 3 }, { type: 'webhook', url: 'https://bad.test/x' }, { type: 'webhook', url: 'ftp://nope' }, { type: 'alert', key: 'nokey' },
    { type: 'status', status: 'CANCELED' }, { type: 'chat', text: 'still here, {name}' }] });
  helixCalls.length = 0;
  await hooks.onRedemption(redemption({ reward: { id: 'r2', title: 'Sing a song', cost: 5 } })); await bot._flush();
  const res = hooks.view().runs[0].results;
  assert.deepStrictEqual(res.map((r) => r.ok), [false, false, false, false, true, true], JSON.stringify(res));
  assert.match(res[0].msg, /No scene items/); assert.match(res[1].msg, /HTTP 500/); assert.match(res[2].msg, /http\(s\)/); assert.match(res[3].msg, /No enabled Custom alert/);
  assert.strictEqual(helixCalls[0][2].status, 'CANCELED'); assert.strictEqual(sent.pop().text, 'still here, Sam');

  // ---- the 7TV emote reward: a good link is added and the redemption fulfilled; a bad one is refunded and the viewer is told why
  const h7 = await hooks.api('save', { name: '7TV emote', match: { rewardId: 'r7' }, actions: [{ type: 'emote7tv' }] }); assert.strictEqual(h7.actions[0].say, true);
  helixCalls.length = 0; sent.length = 0;
  await hooks.onRedemption(redemption({ id: 'red7', user_input: 'https://7tv.app/emotes/01M4TQBBJRVAC5ETDM0CV4FBN7', reward: { id: 'r7', title: 'Add an emote', cost: 5000 } })); await bot._flush();
  assert.deepStrictEqual(sevenAdds.pop(), ['https://7tv.app/emotes/01M4TQBBJRVAC5ETDM0CV4FBN7', 'Sam']); assert.strictEqual(helixCalls[0][2].status, 'FULFILLED'); assert.match(helixCalls[0][1], /id=red7.*reward_id=r7/); assert.match(sent.pop().text, /@Sam added the emote KEKW to the channel for 30 days/);
  await hooks.onRedemption(redemption({ id: 'red8', user_input: 'https://bad.example', reward: { id: 'r7', title: 'Add an emote', cost: 5000 } })); await bot._flush();
  assert.strictEqual(helixCalls[1][2].status, 'CANCELED'); assert.match(sent.pop().text, /that emote could not be added: that emote does not exist on 7TV \(your points are refunded\)/); assert.strictEqual(hooks.view().runs[0].results[0].ok, false);
  await hooks.api('delete', { id: h7.id });

  // ---- status action explains Twitch's app-ownership rule
  await hooks.api('save', { id: h2.id, name: 'Resilient', match: { title: 'Sing' }, actions: [{ type: 'status', status: 'FULFILLED' }] });
  const failHelix = hooks.api; // reuse: force a failure through a reward id that makes the fake Helix answer 403
  await hooks.onRedemption(redemption({ id: 'fail1', reward: { id: 'r2', title: 'Sing', cost: 5 } }));
  // (the fake only fails when the path contains "fail"; the redemption id is in the path)
  assert.match(hooks.view().runs[0].results[0].msg, /not the owner of this reward.*created/);

  // ---- delayed actions + test button with a sample viewer
  const h3 = await hooks.api('save', { name: 'Timed', match: { title: 'zzz' }, actions: [{ type: 'chat', text: 'first' }, { type: 'chat', text: 'second {name} {input}', delay: 0.2 }] });
  const t0 = Date.now(); const out = await hooks.api('test', { id: h3.id, input: 'hello there', user: 'Tester' }); await bot._flush();
  assert.ok(Date.now() - t0 >= 190, 'delay respected'); assert.deepStrictEqual(sent.splice(-2).map((m) => m.text), ['first', 'second Tester hello there']);
  assert.strictEqual(hooks.view().runs[0].test, true); assert.ok(out.results.every((r) => r.ok));
  await hooks.api('save', { id: h3.id, name: 'Timed', match: {}, actions: [{ type: 'status', status: 'FULFILLED' }] });
  assert.match((await hooks.api('test', { id: h3.id })).results[0].msg, /real redemptions/, 'status action refuses test runs');

  // ---- rewards list + create, OBS settings
  assert.deepStrictEqual(await hooks.api('rewards'), [{ id: 'r1', title: 'Hydrate!', cost: 200, enabled: true, paused: false, input: false, mine: true }]);
  const created = await hooks.api('reward/create', { title: 'Pick my snack', cost: 500, prompt: 'what snack?', input: true, cooldown: 60 });
  assert.strictEqual(created.title, 'Pick my snack');
  assert.deepStrictEqual(helixCalls.find((c) => c[0] === 'POST' && c[1].startsWith('/channel_points/custom_rewards?'))[2],
    { title: 'Pick my snack', cost: 500, prompt: 'what snack?', is_user_input_required: true, is_enabled: true, is_global_cooldown_enabled: true, global_cooldown_seconds: 60 });
  await assert.rejects(hooks.api('reward/create', { title: '', cost: 1 }), /needs a title/);
  assert.deepStrictEqual(await hooks.api('obs/save', { host: '', port: 99999, password: 'pw' }), { host: '127.0.0.1', port: 65535, hasPassword: true });
  assert.strictEqual(state.obsCfg.password, 'pw'); await hooks.api('obs/save', { host: '10.0.0.5', port: 4456, password: '__keep__' }); assert.strictEqual(state.obsCfg.password, 'pw');
  assert.ok(!JSON.stringify(hooks.view().obs).includes('pw'), 'the OBS password is never sent back to the page');
  await hooks.api('delete', { id: h3.id }); assert.ok(!state.rewardHooks.some((h) => h.id === h3.id)); assert.ok(persisted > 0);
  console.log('hooks test passed (' + hooks.view().runs.length + ' recorded runs)');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });
