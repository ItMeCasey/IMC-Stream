// Tests text-to-speech with the REAL Windows speech engine (skips the engine part elsewhere). Run: node tts-test.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert');
const createTts = require('./tts.js');

const state = { ttsCfg: { blockSeeded: 1, on: true, voice: '', rate: 0, pitch: 0, volume: 80, maxChars: 60, blockWords: ['badword', '/free\\s+v-?bucks/'], command: { on: false, level: 'subscriber', cost: 0, userCd: 60 } } };
const broadcasts = [];
const t = createTts({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'icm-tts-')), state, persist: () => {}, broadcast: (e, d) => broadcasts.push([e, d]), log: () => {}, blockWords: () => ['shared-filter-word'] });

(async () => {
  // ---- cleaning + blocking (no engine needed)
  assert.strictEqual(t.clean('Hello   world!!!!!! https://evil.test/x 😀 www.spam.com'), 'Hello world!!! link link', 'links, emoji, long repeats and spacing are tidied');
  assert.strictEqual(t.clean('a'.repeat(5) + ' ' + 'word '.repeat(30)).length <= 60, true, 'long messages are cut to maxChars');
  assert.throws(() => t.clean('you BadWord you'), /blocked/); assert.throws(() => t.clean('get free v-bucks'), /blocked/); assert.throws(() => t.clean('shared-filter-word'), /blocked/, 'the chat bot\'s banned words apply too');
  assert.throws(() => t.clean('   !!! ??? '), /Nothing to say/); assert.throws(() => t.clean(''), /Nothing to say/);

  // ---- settings
  const v = t.settings({ rate: 99, pitch: -9, volume: 150, maxChars: 5, addBlock: 'zzone\n\nzztwo \nZZONE', command: { on: true, level: 'bogus', cost: 25, userCd: 10 } });
  assert.deepStrictEqual([v.cfg.rate, v.cfg.pitch, v.cfg.volume, v.cfg.maxChars, v.cfg.blockCount, v.cfg.command], [10, -2, 100, 20, 4, { on: true, level: 'subscriber', cost: 25, userCd: 10 }]);
  assert.ok(!('blockWords' in v.cfg) && !JSON.stringify(t.view()).includes('zzone') && !JSON.stringify(t.view()).includes('badword'), 'the list itself is never sent to the app');
  t.settings({ blockWords: ['hack'], rate: 0, pitch: 0, volume: 80, maxChars: 200, command: { on: false, level: 'subscriber', cost: 0, userCd: 60 } });
  t.settings({ on: false }); await assert.rejects(t.speak('hello'), /turned off/); t.settings({ on: true });

  if (process.platform !== 'win32') { console.log('tts test passed (clean/settings only: not Windows)'); return; }

  // ---- the real engine
  const vs = await t.voices(true);
  assert.ok(vs.length > 0 && vs[0].name && vs[0].culture, 'at least one Windows voice is installed: ' + JSON.stringify(vs));
  const names = vs.map((x) => x.name);
  const a = await t.speak('Thanks for the follow, RetroRider!');
  assert.match(a.url, /^\/tts\/[a-f0-9]{40}\.wav$/); assert.strictEqual(a.volume, 80);
  const file = t.clip(a.url.slice(5)); assert.ok(file, 'clip is served from the tts folder');
  const buf = fs.readFileSync(file);
  assert.strictEqual(buf.slice(0, 4).toString(), 'RIFF'); assert.strictEqual(buf.slice(8, 12).toString(), 'WAVE');
  assert.ok(buf.length > 8000, 'audible length: ' + buf.length + ' bytes');
  const before = fs.statSync(file).mtimeMs; const b2 = await t.speak('Thanks for the follow, RetroRider!'); assert.strictEqual(b2.url, a.url); assert.strictEqual(fs.statSync(file).mtimeMs, before, 'identical text is served from the cache');
  const fast = await t.speak('Thanks for the follow, RetroRider!', { rate: 6 }); assert.notStrictEqual(fast.url, a.url);
  assert.ok(fs.readFileSync(t.clip(fast.url.slice(5))).length < buf.length, 'a faster rate makes a shorter clip');
  const hi = await t.speak('Pitch test', { pitch: 2 }); assert.ok(fs.readFileSync(t.clip(hi.url.slice(5))).length > 8000, 'pitch (SSML) works');
  const other = names.length > 1 ? names[1] : names[0]; const o2 = await t.speak('A different voice', { voice: other }); assert.ok(fs.statSync(t.clip(o2.url.slice(5))).size > 8000, 'voice "' + other + '" speaks');
  const says = await t.say('Spoken through the overlay', { by: 'Tester', volume: 50 });
  assert.deepStrictEqual([says.volume, says.by, broadcasts.at(-1)[0], broadcasts.at(-1)[1].url === says.url], [50, 'Tester', 'tts', true], 'say() broadcasts the clip to the overlay');
  t.ctl('skip'); assert.deepStrictEqual(broadcasts.at(-1), ['ttsctl', { action: 'skip' }]);
  assert.strictEqual(t.clip('../../etc/passwd'), null); assert.strictEqual(t.clip('x'.repeat(40) + '.wav'), null, 'only real clip names are served');
  // ---- Kokoro (realistic voices), when installed in server/kokoro
  if (t.kokoroInstalled()) {
    const all = await t.voices(true), kv = all.filter((v) => v.engine === 'kokoro');
    assert.ok(kv.length >= 20 && kv.some((v) => v.name === 'af_heart') && kv.some((v) => v.name === 'am_adam') && all.some((v) => v.engine === 'windows'), 'Kokoro voices are listed next to the Windows ones');
    assert.strictEqual(t.engineFor({ voice: 'af_heart' }), 'kokoro'); assert.strictEqual(t.engineFor({ voice: 'Microsoft Zira Desktop' }), 'windows'); assert.strictEqual(t.engineFor({}), 'windows');
    const k0 = Date.now(), kv1 = await t.speak('Thanks for the follow, RetroRider! Welcome to the stream.', { voice: 'af_heart' }), took = Date.now() - k0;
    const kb = fs.readFileSync(t.clip(kv1.url.slice(5))); assert.strictEqual(kb.slice(0, 4).toString(), 'RIFF'); assert.strictEqual(kb.readUInt32LE(24), 24000, 'Kokoro makes 24 kHz audio');
    const secs = (kb.length - 44) / (24000 * 2); assert.ok(secs > 2.5 && secs < 12, 'a sensible clip length: ' + secs.toFixed(1) + 's');
    const k1 = Date.now(), kv2 = await t.speak('Another short line for the timing check.', { voice: 'am_adam' }); const warm = Date.now() - k1;
    const again = await t.speak('Another short line for the timing check.', { voice: 'am_adam' }); assert.strictEqual(again.url, kv2.url, 'cached');
    const slowClip = await t.speak('Another short line for the timing check.', { voice: 'am_adam', rate: -6 }); assert.ok(fs.statSync(t.clip(slowClip.url.slice(5))).size > fs.statSync(t.clip(kv2.url.slice(5))).size, 'a slower rate makes a longer clip');
    assert.notStrictEqual(kv1.url, (await t.speak('Thanks for the follow, RetroRider! Welcome to the stream.', { voice: 'bf_emma' })).url, 'different voices make different clips');
    console.log('   kokoro: first clip ' + (took / 1000).toFixed(1) + 's (includes model load), next clip ' + (warm / 1000).toFixed(1) + 's');
    // a missing Kokoro install must not silence alerts: a Kokoro voice name falls back to a Windows voice
    const noK = createTts({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'icm-tts2-')), state, persist: () => {}, broadcast: () => {}, log: () => {}, kokoroDir: path.join(os.tmpdir(), 'no-kokoro-here') });
    assert.strictEqual(noK.kokoroInstalled(), false); assert.strictEqual(noK.engineFor({ voice: 'af_heart' }), 'windows');
    const fb = await noK.speak('Falling back to a Windows voice', { voice: 'af_heart' }); assert.ok(fs.statSync(noK.clip(fb.url.slice(5))).size > 8000, 'still speaks');
    t.stopKokoro();
  } else console.log('   (Kokoro is not installed: skipped its tests)');
  const par = await Promise.all([t.speak('one two'), t.speak('three four'), t.speak('five six')]); assert.strictEqual(new Set(par.map((p) => p.url)).size, 3, 'queued clips are all made');
  // the starter list: fills itself once, blocks hate phrases and spaced/leet spellings, leaves normal chat alone
  { const st2 = { ttsCfg: { on: true, voice: '', rate: 0, pitch: 0, volume: 80, maxChars: 200, blockWords: [], command: { on: false, level: 'subscriber', cost: 0, userCd: 60 } } };
    const t2 = createTts({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'icm-tts2-')), state: st2, persist: () => {}, broadcast: () => {}, log: () => {} });
    await new Promise((r) => setTimeout(r, 50));   // the list fills itself right after start-up
    assert.ok(t2.view().cfg.blockCount > 150 && st2.ttsCfg.blockSeeded === 1, 'starter list loaded: ' + t2.view().cfg.blockCount);
    for (const bad of ['heil hitler', 'H E I L   H I T L E R', 'k.y.s', 'go kill yourself', 'white power']) assert.throws(() => t2.clean(bad), /blocked/, bad);
    for (const ok of ['hello chat, thanks for the follow', 'Niger is a country', 'what a nice raccoon', 'hard rock cafe', 'kill all the enemies']) assert.doesNotThrow(() => t2.clean(ok), ok);
    const n = t2.view().cfg.blockCount; t2.settings({ rate: 1 }); assert.strictEqual(t2.view().cfg.blockCount, n, 'seeded only once'); }
  console.log('tts test passed (' + vs.length + ' voice(s): ' + names.join(', ') + ')');
})().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });
