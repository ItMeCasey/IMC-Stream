'use strict';
// Installing an update: only the right release files, only github links, only a checked installer is started. Run: node updater-test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), createUpdater = require('./updater.js');

const exeBytes = Buffer.alloc(300000, 7), hash = crypto.createHash('sha256').update(exeBytes).digest('hex'), NAME = 'IMC-Stream Setup 2026.10.17.exe';
const rel = { assets: [
  { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/ItMeCasey/IMC-Stream/releases/download/v2026.10.17/SHA256SUMS.txt', size: 100 },
  { name: NAME, browser_download_url: 'https://github.com/ItMeCasey/IMC-Stream/releases/download/v2026.10.17/IMC-Stream.Setup.2026.10.17.exe', size: exeBytes.length },
  { name: 'evil.exe', browser_download_url: 'https://evil.example.com/evil.exe', size: 1 }] };
const A = createUpdater.pickAssets(rel); assert.equal(A.name, NAME); assert.ok(A.sumsUrl.endsWith('SHA256SUMS.txt')); assert.equal(A.size, exeBytes.length);
assert.deepEqual(createUpdater.pickAssets({ assets: [{ name: 'x.exe', browser_download_url: 'http://github.com/x.exe' }] }), { name: '', url: '', size: 0, sumsUrl: '' }, 'plain http is refused');
assert.equal(createUpdater.expectedHash(hash + '  ' + NAME + '\r\n', NAME), hash); assert.equal(createUpdater.expectedHash(hash + '  other.exe', NAME), '');
assert.ok(createUpdater.hostOk('https://objects.githubusercontent.com/a') && !createUpdater.hostOk('https://githubusercontent.com.evil.io/a') && !createUpdater.hostOk('https://notgithub.com/a'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-upd-')); let sums = hash + '  ' + NAME + '\n', body = exeBytes, started = [];
const mkFetch = () => async (url) => {
  const isSums = url.endsWith('SHA256SUMS.txt'), buf = isSums ? Buffer.from(sums) : body;
  return { ok: true, status: 200, url, headers: { get: () => String(buf.length) }, text: async () => buf.toString(), body: (async function* () { for (let i = 0; i < buf.length; i += 65536) yield buf.subarray(i, i + 65536); })() };
};
const mk = () => createUpdater({ dir: path.join(tmp, 'u'), fetch: mkFetch(), spawn: (f, args, o) => { started.push({ f, args, o }); return { unref() {} }; } });

(async () => {
  let U = mk(); const info = { latest: '2026.10.17', asset: A };
  const r = await U.install(info); assert.ok(r.ok && fs.existsSync(r.file) && !fs.existsSync(r.file + '.part'));
  assert.deepEqual(started[0].args, ['/S', '--force-run']); assert.equal(started[0].o.detached, true); assert.equal(U.status().state, 'starting');

  started = []; body = Buffer.alloc(300000, 9); U = mk();
  await assert.rejects(U.install(info), /checksum/); assert.equal(started.length, 0, 'a changed installer is never started'); assert.equal(U.status().state, 'error');
  assert.ok(!fs.readdirSync(path.join(tmp, 'u')).some((f) => f.endsWith('.part')), 'half files are cleaned up'); body = exeBytes;

  sums = 'nothing useful\n'; U = mk(); await assert.rejects(U.install(info), /does not list/); assert.equal(started.length, 0); sums = hash + '  ' + NAME + '\n';
  await assert.rejects(U.install({ latest: 'x', asset: { name: '', url: '', sumsUrl: '' } }), /no installer/);
  await assert.rejects(U.install({ latest: 'x', asset: { name: NAME, url: A.url, sumsUrl: '' } }), /SHA256SUMS/);
  await assert.rejects(U.install({ latest: 'x', asset: { name: '..\\x.exe', url: A.url, sumsUrl: A.sumsUrl } }), /installer name/);
  await assert.rejects(U.install({ latest: 'x', asset: { name: NAME, url: 'https://evil.example.com/a.exe', sumsUrl: A.sumsUrl } }), /Refusing/);
  fs.rmSync(tmp, { recursive: true, force: true }); console.log('updater-test: ok');
})().catch((e) => { console.error(e); process.exit(1); });
