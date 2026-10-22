// Tests the countdown / subathon timer. Run: node countdown-test.js
const assert = require('node:assert');
const createCountdown = require('./countdown.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fresh = () => ({ countdown: { mode: 'idle', endsAt: 0, remainingMs: 300000, durationMs: 300000, visible: true, label: 'WE GO LIVE IN', doneMessage: "LET'S GO!", doneScene: '', doneChat: '', lastAdd: null,
  subathon: { on: false, perSub: 300, perGiftSub: 300, perBits100: 60, perFollow: 30, perRaidViewer: 1, maxMinutes: 720 } } });

(async () => {
  // ---------- fake clock: state machine
  let T = 1_000_000; const events = [], said = [], scenes = [];
  const state = fresh();
  const cd = createCountdown({ state, now: () => T, persist: () => {}, broadcast: (e, d) => events.push([e, d]), bot: { say: (t) => said.push(t) }, obs: { setScene: async (n) => { scenes.push(n); } } });
  assert.strictEqual(cd.view().mode, 'idle'); assert.strictEqual(cd.view().remainingMs, 300000);
  let v = cd.start({ minutes: 5 }); assert.deepStrictEqual([v.mode, v.remainingMs, v.durationMs], ['running', 300000, 300000]);
  T += 60000; assert.strictEqual(cd.view().remainingMs, 240000);
  v = cd.pause(); assert.deepStrictEqual([v.mode, v.remainingMs], ['paused', 240000]); T += 99999; assert.strictEqual(cd.view().remainingMs, 240000, 'paused time does not move');
  v = cd.resume(); assert.strictEqual(v.mode, 'running'); T += 40000; assert.strictEqual(cd.view().remainingMs, 200000);
  v = cd.add({ seconds: 120, why: 'you' }); assert.strictEqual(v.remainingMs, 320000); assert.deepStrictEqual([v.lastAdd.seconds, v.lastAdd.why], [120, 'you']);
  v = cd.add({ minutes: -1 }); assert.strictEqual(v.remainingMs, 260000);
  cd.pause(); v = cd.set({ seconds: 90 }); assert.deepStrictEqual([v.mode, v.remainingMs], ['paused', 90000]);
  v = cd.reset(); assert.deepStrictEqual([v.mode, v.remainingMs], ['idle', v.durationMs]); assert.ok(v.durationMs >= 300000);
  v = cd.hide(); assert.strictEqual(v.visible, false); v = cd.visible({ on: true }); assert.strictEqual(v.visible, true);
  assert.ok(events.filter(([e]) => e === 'countdown').length >= 8, 'every change is broadcast to the overlay');
  v = cd.start({ seconds: 99999999 }); assert.strictEqual(v.durationMs, 48 * 3600 * 1000, 'capped at 48 hours'); cd.start({ minutes: 5 }); cd.reset();

  // ---------- chat commands
  assert.match(cd.command([]), /^Timer ready: 05:00|^Timer ready: \d+:\d\d$/);
  assert.strictEqual(cd.command(['10']), 'Timer started: 10:00.');
  T += 30000; assert.strictEqual(cd.command([]), 'Timer running: 9:30 left.');
  assert.strictEqual(cd.command(['+5']), 'Timer extended by 5:00: 14:30 left.');
  assert.strictEqual(cd.command(['-30s']), 'Timer cut by 0:30: 14:00 left.');
  assert.strictEqual(cd.command(['pause']), 'Timer paused at 14:00.'); assert.strictEqual(cd.command(['resume']), 'Timer resumed.');
  assert.strictEqual(cd.command(['hide']), 'Timer hidden.'); assert.strictEqual(cd.command(['show']), 'Timer shown.');
  assert.match(cd.command(['nonsense']), /^Usage: !countdown/); assert.match(cd.command(['reset']), /^Timer reset to /);
  assert.strictEqual(cd.command(['1.5h']), 'Timer started: 1:30:00.');
  cd.reset();

  // ---------- subathon
  cd.settings({ subathon: { on: true, perSub: 300, perGiftSub: 200, perBits100: 60, perFollow: 30, perRaidViewer: 2, maxMinutes: 100 } });
  cd.start({ seconds: 600 }); cd.pause(); cd.onEvent('sub', { name: 'Ann' }); assert.strictEqual(cd.view().remainingMs, 600000, 'only a RUNNING timer grows');
  cd.resume(); const t0 = cd.view().remainingMs;
  cd.onEvent('sub', { name: 'Ann' }); assert.strictEqual(cd.view().remainingMs - t0, 300000); assert.match(cd.view().lastAdd.why, /sub from Ann/);
  cd.onEvent('giftsub', { name: 'Bo', total: 3 }); cd.onEvent('bits', { name: 'Cy', amount: 250 }); cd.onEvent('follow', { name: 'Di' }); cd.onEvent('raid', { name: 'Ed', viewers: 10 }); cd.onEvent('tip', {});
  assert.strictEqual(cd.view().remainingMs - t0, 300000 + 600000 + 120000 + 30000 + 20000, 'gift x3, bits per 100, follow, raid per viewer; other events ignored');
  cd.onEvent('sub', { name: 'Fay' }); cd.onEvent('sub', { name: 'Gus' }); cd.onEvent('giftsub', { name: 'Hal', total: 50 });
  assert.strictEqual(cd.view().remainingMs, 100 * 60000, 'the cap holds');
  cd.settings({ subathon: { on: false } }); const before = cd.view().remainingMs; cd.onEvent('sub', { name: 'Ivy' }); assert.strictEqual(cd.view().remainingMs, before, 'subathon off = no extra time');
  const L = cd.labels(); assert.deepStrictEqual([L.countdown_remaining.value, L.countdown_status.value], ['1:40:00', 'RUNNING']);
  cd.settings({ label: '  BE BACK  IN  ', doneMessage: 'DONE', doneScene: 'Gameplay', doneChat: 'We are live!' }); assert.deepStrictEqual([state.countdown.label, state.countdown.doneMessage, state.countdown.doneScene], ['BE BACK IN', 'DONE', 'Gameplay']);

  // ---------- restoring a saved state after a restart
  const old = fresh(); old.countdown.mode = 'running'; old.countdown.endsAt = Date.now() - 5000;
  createCountdown({ state: old, persist: () => {}, broadcast: () => {} }); assert.strictEqual(old.countdown.mode, 'done', 'a timer that ran out while the server was off is done');
  const live = fresh(); live.countdown.mode = 'running'; live.countdown.endsAt = Date.now() + 700; const lc = [];
  createCountdown({ state: live, persist: () => {}, broadcast: () => {}, obs: { setScene: async (n) => lc.push(n) } }); live.countdown.doneScene = 'After';
  await sleep(1000); assert.deepStrictEqual([live.countdown.mode, lc], ['done', ['After']], 'a running timer picked up after restart still finishes');

  // ---------- reaching zero: overlay state, chat message, OBS scene; adding time afterwards revives it
  const s2 = fresh(); s2.countdown.doneScene = 'Gameplay'; s2.countdown.doneChat = 'We are live!'; const sc2 = [], say2 = [];
  const c2 = createCountdown({ state: s2, persist: () => {}, broadcast: () => {}, bot: { say: (t) => say2.push(t) }, obs: { setScene: async (n) => sc2.push(n) } });
  c2.start({ seconds: 1 }); await sleep(1300);
  assert.deepStrictEqual([s2.countdown.mode, s2.countdown.remainingMs, sc2, say2], ['done', 0, ['Gameplay'], ['We are live!']]);
  const v2 = c2.add({ seconds: 60 }); assert.deepStrictEqual([v2.mode, v2.remainingMs], ['paused', 60000]);
  c2.resume(); c2.add({ seconds: 1 }); c2.set({ seconds: 1 }); await sleep(1300); assert.strictEqual(sc2.length, 2, 'finishes again after more time was added');
  // ---------- the subathon is its own timer: own state, own broadcast event, own chat wording, rules line
  { let T3 = 5_000_000; const ev3 = [];
    const st3 = { countdown: fresh().countdown, subathon: { mode: 'idle', endsAt: 0, remainingMs: 43200000, durationMs: 43200000, visible: true, label: 'SUBATHON', doneMessage: 'DONE', doneScene: '', doneChat: '', lastAdd: null, subathon: { on: true, perSub: 600, perGiftSub: 600, perBits100: 300, perFollow: 60, perRaidViewer: 30, maxMinutes: 0 } } };
    const sub = createCountdown({ state: st3, key: 'subathon', evt: 'subathon', noun: 'Subathon', labelPrefix: 'subathon', cmd: '!subathon', now: () => T3, persist: () => {}, broadcast: (e, d) => ev3.push(e) });
    assert.strictEqual(sub.rules(), 'Subathon time: Sub/resub +10m | Gifted sub +10m each | 100 bits +5m | Follow +1m | Raid +30s per viewer.');
    assert.strictEqual(sub.command(['rules']), sub.rules()); assert.strictEqual(sub.command([]), 'Subathon ready: 12:00:00');
    sub.onEvent('sub', { name: 'Ann' }); assert.strictEqual(sub.view().remainingMs, 43200000, 'does nothing until it is running');
    sub.start({ seconds: 3600 }); sub.onEvent('sub', { name: 'Ann' }); T3 += 0; assert.strictEqual(sub.view().remainingMs, 3600000 + 600000);
    sub.onEvent('giftsub', { name: 'Bo', total: 3 }); sub.onEvent('bits', { name: 'Cy', amount: 250 }); sub.onEvent('follow', {}); sub.onEvent('raid', { viewers: 10 });
    assert.strictEqual(sub.view().remainingMs, 3600000 + 600000 + 1800000 + 600000 + 60000 + 300000, 'gift x3, 250 bits = 2 x 100, follow, raid x10');
    assert.strictEqual(sub.view().lastAdd.why, 'raid'); assert.ok(sub.command(['+10']).startsWith('Subathon extended by'));
    assert.ok(ev3.every((e) => e === 'subathon'), 'broadcasts on its own channel'); assert.ok(!('countdown_remaining' in sub.labels()) && 'subathon_remaining' in sub.labels());
    assert.strictEqual(st3.countdown.mode, 'idle', 'the start-screen countdown is untouched');
    st3.subathon.subathon.maxMinutes = 100; sub.settings({ subathon: { on: true, perSub: 600, perGiftSub: 600, perBits100: 300, perFollow: 60, perRaidViewer: 30, maxMinutes: 100 } }); sub.onEvent('sub', {}); assert.ok(sub.view().remainingMs <= 6000000, 'the cap holds');
    sub.settings({ subathon: { on: false } }); assert.match(sub.rules(), /not added automatically/); }
  console.log('countdown test passed');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });
