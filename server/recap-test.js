'use strict';
// The chat recap against a fake "claude" program: nothing leaves this PC. Run: node recap-test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { EventEmitter } = require('events'), { PassThrough } = require('stream'), createRecap = require('./recap');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-recap-')), calls = [], posts = []; let mode = 'ok', clockNow = Date.UTC(2026, 9, 22, 20, 0, 0);
function fakeSpawn(cmd, args) {
  const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); let input = ''; c.kill = () => {};
  c.stdin = new PassThrough(); c.stdin.on('data', (d) => { input += d; });
  c.stdin.on('end', () => setImmediate(() => {
    calls.push({ cmd, args, input });
    if (mode === 'login') { c.stderr.end('Failed to authenticate: OAuth session expired and could not be refreshed'); return c.emit('exit', 1); }
    if (mode === 'missing') { const e = new Error('spawn ENOENT'); e.code = 'ENOENT'; return c.emit('error', e); }
    c.stdout.end(/CHAT LOG/.test(input) ? 'Chat talked about Tetris.' : 'ready'); c.emit('exit', 0);
  }));
  return c;
}
const R = createRecap({ file: path.join(tmp, 'recap.json'), dir: () => path.join(tmp, 'recaps'), spawn: fakeSpawn, now: () => clockNow, endDelayMs: 5, hideBots: ['Nightbot'], discordPost: async (t, x) => { posts.push([t, x]); } });

(async () => {
  // what is kept
  const say = (id, login, text, extra) => R.add(Object.assign({ id, uid: 'u' + login, login, name: login[0].toUpperCase() + login.slice(1), text, ts: clockNow }, extra));
  say('1', 'ann', 'first time here!'); say('2', 'bob', '!points'); say('3', 'nightbot', 'Follow us!'); say('4', 'cat', 'tetris is hard'); say('5', 'dan', 'gg', { type: 'channel_points_highlighted' }); say('6', 'eve', 'lol that was close'); say('7', 'fay', 'hello   everyone');
  assert.equal(R.view().messages, 4, 'commands, bots and special message types are left out');
  R.moderate({ type: 'delete', id: '6' }); assert.equal(R.view().messages, 3, 'deleted messages are dropped'); R.moderate({ type: 'clearUser', uid: 'ucat' }); assert.equal(R.view().messages, 2);
  await assert.rejects(R.makeRecap(), /Not enough chat/); await assert.rejects(R.catchUp(), /Not enough chat/);
  for (let i = 0; i < 8; i++) say('x' + i, 'user' + (i % 3), 'message number ' + i);

  // the tool is called with the cheapest model, no tools, no saved session
  const t = R.transcript([{ name: 'Ann', text: 'hi', t: clockNow }, { name: 'Bob', text: 'yo', t: clockNow }, { name: 'Ann', text: 'again', t: clockNow }]); assert.match(t, /Ann: hi[\s\S]*Bob: yo/);
  const item = await R.makeRecap(); assert.equal(item.text, 'Chat talked about Tetris.');
  const c = calls[0]; assert.ok(c.cmd.startsWith('claude')); assert.deepEqual(c.args.slice(0, 5), ['-p', '--model', 'haiku', '--tools', '']); assert.ok(c.args.includes('--no-session-persistence')); assert.match(c.input, /CHAT LOG:\n[\s\S]*User0: message number 0|user0: message number 0/i);
  assert.ok(fs.readdirSync(path.join(tmp, 'recaps')).some((f) => /^recap_2026-10-2\d_\d{4}\.md$/.test(f)), 'saved as a file'); assert.equal(R.view().last.length, 1);
  assert.equal(posts.length, 0, 'not posted to Discord unless switched on');
  R.configure({ discord: true }); await R.makeRecap(); assert.deepEqual(posts[0], ['Stream recap', 'Chat talked about Tetris.']);

  // privacy: names can be replaced
  R.configure({ names: false }); await R.makeRecap(); const last = calls[calls.length - 1].input; assert.ok(/Viewer1: /.test(last) && !/Ann|User0/i.test(last.split('CHAT LOG:')[1]), 'no real names are sent'); R.configure({ names: true });
  // the model name is validated
  R.configure({ model: 'bad name; rm' }); assert.equal(R.view().model, 'haiku'); R.configure({ model: 'claude-haiku-5-5' }); assert.equal(R.view().model, 'claude-haiku-5-5'); R.configure({ model: 'haiku' });

  // !recap: one call per 5 minutes
  const n = calls.length; const a = await R.catchUp(); const b = await R.catchUp(); assert.equal(a, b); assert.equal(calls.length, n + 1, 'the answer is reused'); clockNow += 6 * 60000; for (let i = 0; i < 4; i++) say('y' + i, 'zed', 'new talk ' + i); await R.catchUp(); assert.equal(calls.length, n + 2);

  // errors the streamer can act on
  mode = 'login'; await assert.rejects(R.check(), /not logged in on this PC/); mode = 'missing'; await assert.rejects(R.check(), /not installed/); mode = 'ok'; assert.equal((await R.check()).ok, true);

  // automatic recap after the stream ends
  const before = posts.length; R.onStreamEnd(); await new Promise((r) => setTimeout(r, 60)); assert.equal(posts.length, before, 'off by default'); R.configure({ auto: true }); R.onStreamEnd(); await new Promise((r) => setTimeout(r, 80)); assert.equal(posts.length, before + 1);
  R.newStream(); assert.equal(R.view().messages, 0);
  // settings survive a restart
  const R2 = createRecap({ file: path.join(tmp, 'recap.json'), dir: () => tmp, spawn: fakeSpawn }); assert.equal(R2.view().auto, true); assert.ok(R2.view().last.length >= 2);
  console.log('recap test passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
