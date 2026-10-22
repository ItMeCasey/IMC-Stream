// Tests who may connect (password / LAN / Host checks) and settings backup + restore with the real zip tool. Run: node access-backup-test.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert');
const createAccess = require('./access.js'), createBackup = require('./backup.js');

// ---------------- access
const state = { access: { lan: false, salt: '', hash: '' } }; let saved = 0;
const acc = createAccess({ state, persist: () => { saved++; }, port: () => 8420 });
const mkRes = () => { const r = { code: 0, headers: {}, body: '', writeHead(c, h) { r.code = c; Object.assign(r.headers, h); }, end(b) { r.body = b || ''; r.ended = true; } }; return r; };
const mkReq = (ip, host, cookie) => ({ socket: { remoteAddress: ip }, headers: { host: host || 'localhost:8420', cookie } });
const ask = (req, p) => { const res = mkRes(); const handled = acc.gate(req, res, p); return { handled, res }; };

// this PC is always allowed, with no password
for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.strictEqual(ask(mkReq(ip), '/api/status').handled, false, ip + ' is this PC');
assert.strictEqual(acc.hostAllowed('poll.localhost:8420'), true, 'overlay sub-hosts are this PC'); assert.strictEqual(acc.hostAllowed('poll.localhost.evil.com'), false);
// web pages that rebind a hostname to 127.0.0.1 are refused
for (const host of ['evil.example.com:8420', 'attacker.test', '192.168.1.5:8420']) { const r = ask(mkReq('127.0.0.1', host), '/api/status'); assert.ok(r.handled && r.res.code === 403, 'bad Host refused: ' + host); }
// other devices: refused while remote access is off
let r = ask(mkReq('192.168.1.50', '192.168.1.5:8420'), '/'); assert.ok(r.handled && r.res.code === 403, 'LAN off = nothing gets in');
// turn it on: needs a password first
assert.throws(() => acc.setSettings({ lan: true }), /Set a password first/); assert.throws(() => acc.setSettings({ password: 'short' }), /at least 8/);
let v = acc.setSettings({ password: 'correct horse battery' }); assert.deepStrictEqual([v.hasPassword, v.lan], [true, false]); assert.ok(!JSON.stringify(state).includes('correct horse'), 'the password itself is never stored');
v = acc.setSettings({ lan: true }); assert.strictEqual(v.lan, true); assert.strictEqual(acc.bindHost(), '0.0.0.0'); assert.ok(saved >= 2);
const lanHost = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
if (lanHost) assert.strictEqual(acc.hostAllowed(lanHost.address + ':8420'), true, 'this PC\'s own network address is accepted once LAN access is on');
assert.strictEqual(acc.hostAllowed('evil.example.com'), false);
// not logged in: the page asks for the password, the API says 401
const ipx = '192.168.1.50', hostx = lanHost ? lanHost.address + ':8420' : 'localhost:8420';
r = ask(mkReq(ipx, hostx), '/'); assert.ok(r.handled && r.res.code === 200 && /type=password/.test(r.res.body), 'login page');
r = ask(mkReq(ipx, hostx), '/api/status'); assert.ok(r.handled && r.res.code === 401);
r = ask(mkReq(ipx, hostx), '/events'); assert.ok(r.handled && r.res.code === 401);
assert.strictEqual(ask(mkReq(ipx, hostx), '/api/login').handled, false, 'the login call itself is allowed through');
// wrong password, then right password
let res = mkRes(); acc.login(mkReq(ipx, hostx), res, { password: 'nope' }); assert.strictEqual(res.code, 401);
res = mkRes(); acc.login(mkReq(ipx, hostx), res, { password: 'correct horse battery' }); assert.strictEqual(res.code, 200);
const cookie = /icm_session=([a-f0-9]{64})/.exec(res.headers['Set-Cookie']); assert.ok(cookie && /HttpOnly/.test(res.headers['Set-Cookie']) && /SameSite=Strict/.test(res.headers['Set-Cookie']));
assert.strictEqual(ask(mkReq(ipx, hostx, 'icm_session=' + cookie[1]), '/api/status').handled, false, 'logged-in device is let in');
assert.strictEqual(ask(mkReq(ipx, hostx, 'icm_session=' + 'a'.repeat(64)), '/api/status').res.code, 401, 'a made-up cookie is useless');
// brute force is throttled
for (let i = 0; i < 6; i++) { res = mkRes(); acc.login(mkReq('10.9.9.9', hostx), res, { password: 'x' + i }); }
assert.strictEqual(res.code, 429, 'after 5 wrong tries: wait'); res = mkRes(); acc.login(mkReq('10.9.9.9', hostx), res, { password: 'correct horse battery' }); assert.strictEqual(res.code, 429, 'even the right password has to wait');
// changing the password logs everyone out; clearing it switches remote access off
acc.setSettings({ password: 'a brand new password' }); assert.strictEqual(ask(mkReq(ipx, hostx, 'icm_session=' + cookie[1]), '/api/status').res.code, 401, 'old sessions end');
acc.setSettings({ clearPassword: true }); assert.deepStrictEqual([acc.view().lan, acc.view().hasPassword, acc.bindHost()], [false, false, '127.0.0.1']);

// ---------------- backup + restore (real tar.exe)
(async () => {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-bk-'));
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(DATA, f)), { recursive: true }); fs.writeFileSync(path.join(DATA, f), t); };
  w('state.json', '{"hello":"world"}'); w('bot.json', '{"commands":["lurk"]}'); w('tokens.json', '{"access_token":"SECRET"}'); w('custom/sounds/boom.wav', 'RIFFxxxx'); w('tts/cache.wav', 'x'); w('events.jsonl', 'log'); w('emotes.json', '{}');
  const bk = createBackup({ DATA, log: () => {} });
  const b1 = bk.create({}); assert.ok(b1.size > 0 && b1.file.endsWith('.zip'));
  assert.deepStrictEqual(b1.files.sort(), ['bot.json', 'custom', 'state.json'], 'settings, bot data and uploads: no logins, caches or logs');
  const b2 = bk.create({ includeLogins: true, out: path.join(DATA, 'with-logins.zip') }); assert.ok(b2.files.includes('tokens.json'));
  // wipe and restore
  w('state.json', '{"hello":"CHANGED"}'); fs.rmSync(path.join(DATA, 'custom'), { recursive: true }); fs.unlinkSync(path.join(DATA, 'bot.json'));
  const out = bk.restore(b2.file); assert.deepStrictEqual([out.ok, out.restart], [true, true]);
  assert.strictEqual(fs.readFileSync(path.join(DATA, 'state.json'), 'utf8'), '{"hello":"world"}'); assert.strictEqual(fs.readFileSync(path.join(DATA, 'bot.json'), 'utf8'), '{"commands":["lurk"]}');
  assert.strictEqual(fs.readFileSync(path.join(DATA, 'custom/sounds/boom.wav'), 'utf8'), 'RIFFxxxx', 'uploads come back');
  assert.ok(bk.list().some((f) => f.name.startsWith('before-restore-')), 'a safety copy of the old settings is kept before restoring');
  assert.ok(fs.existsSync(path.join(DATA, 'tts/cache.wav')), 'caches are left alone');
  // refuses things that are not our backups
  const evil = path.join(DATA, 'evil.zip'); fs.mkdirSync(path.join(DATA, 'x')); fs.writeFileSync(path.join(DATA, 'x', 'notes.txt'), 'hi');
  require('node:child_process').spawnSync(process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar', ['-a', '-c', '-f', evil, 'x'], { cwd: DATA });
  assert.throws(() => bk.restore(evil), /does not look like an ItMeCasey backup/);
  fs.writeFileSync(path.join(DATA, 'junk.zip'), 'not a zip'); assert.throws(() => bk.restore(path.join(DATA, 'junk.zip')), /zip tool failed/);
  // daily automatic backup keeps the newest 7
  bk.auto(); assert.ok(bk.list().some((f) => f.name.startsWith('auto-' + new Date().toISOString().slice(0, 10)))); const n = bk.list().length; bk.auto(); assert.strictEqual(bk.list().length, n, 'only one automatic backup per day');
  for (let i = 1; i <= 9; i++) fs.writeFileSync(path.join(bk.dir, 'auto-2020-01-0' + i + '.zip'), 'x'); bk.auto();
  assert.strictEqual(bk.list().filter((f) => f.name.startsWith('auto-')).length, 7, 'old automatic backups are pruned');
  console.log('access + backup test passed');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });
