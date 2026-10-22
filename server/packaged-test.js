'use strict';
// Store (MSIX) mode: the scene file must be saved to Documents, and nothing may be written into OBS's own folder.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-pkg-')), docs = path.join(T, 'docs'), appdata = path.join(T, 'appdata'), PORT = 8497;
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { ICM_PORT: String(PORT), ICM_DATA: path.join(T, 'data'), APPDATA: appdata, ICM_PACKAGED: '1', ICM_DOCS: docs, ICM_NO_EXPLORER: '1' }), stdio: 'ignore' });
const post = (p) => fetch('http://127.0.0.1:' + PORT + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());
(async () => {
  let up = false; for (let i = 0; i < 40 && !up; i++) { try { up = (await fetch('http://127.0.0.1:' + PORT + '/api/health')).ok; } catch (e) { await new Promise((r) => setTimeout(r, 250)); } }
  assert(up, 'server did not start');
  const r = await post('/api/obs/install'); assert(r.ok && r.manual, JSON.stringify(r)); assert.equal(r.file, path.join(docs, 'ItMeCasey.json'));
  assert(JSON.parse(fs.readFileSync(r.file, 'utf8')).name, 'collection saved'); assert(!fs.existsSync(path.join(appdata, 'obs-studio')), 'OBS folder untouched');
  console.log('packaged mode test passed');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { child.kill(); });
