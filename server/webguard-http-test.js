'use strict';
// The real server, hit like a browser on another site would: cross-site and "Origin: null" requests are refused, CORS is not "*". Run: node webguard-http-test.js
const assert = require('assert'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');

const PORT = 20000 + Math.floor(Math.random() * 20000), DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-wg-'));
const req = (method, p, headers, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: Object.assign({ Host: 'localhost:' + PORT }, headers) }, (res) => {
    if (p === '/events') { resolve({ status: res.statusCode, headers: res.headers, body: '' }); return res.destroy(); }   // a stream that never ends: the headers are all we need
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject); if (body) r.write(body); r.end();
});
const json = { 'Content-Type': 'application/json' };

const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { ICM_PORT: String(PORT), ICM_DATA: DATA }), stdio: 'ignore' });
const done = (code) => { try { srv.kill(); } catch (e) { /* gone */ } setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* busy */ } process.exit(code); }, 300); };

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await req('GET', '/api/health')).status === 200) break; } catch (e) { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  assert.equal((await req('GET', '/api/health')).status, 200, 'server is up');

  // changing things from another site
  const tip = JSON.stringify({ kind: 'tip', name: 'x', amount: 1 });
  assert.equal((await req('POST', '/api/event', Object.assign({ Origin: 'null' }, json), tip)).status, 403, 'Origin: null is refused');
  assert.equal((await req('POST', '/api/event', Object.assign({ Origin: 'https://evil.example' }, json), tip)).status, 403, 'another site is refused');
  assert.equal((await req('POST', '/api/event', Object.assign({ Origin: 'http://localhost:1' }, { 'Content-Type': 'text/plain' }), tip)).status, 403, 'another local app on another port is refused');
  assert.equal((await req('POST', '/api/event', { 'Content-Type': 'text/plain', 'Sec-Fetch-Site': 'cross-site' }, tip)).status, 403, 'a browser saying cross-site is refused');
  // the app's own pages and plain programs still work
  assert.equal((await req('POST', '/api/event', Object.assign({ Origin: 'http://localhost:' + PORT }, json), tip)).status, 200, 'own page works');
  assert.equal((await req('POST', '/api/event', json, tip)).status, 200, 'a program with no Origin (OBS, Stream Deck) works');

  // reading from another site
  const evilGet = await req('GET', '/api/health', { Origin: 'https://evil.example' });
  assert.equal(evilGet.headers['access-control-allow-origin'], undefined, 'no CORS grant for another site');
  assert.equal((await req('GET', '/api/health', { Origin: 'null' })).headers['access-control-allow-origin'], undefined, 'no CORS grant for null');
  assert.equal((await req('GET', '/api/health', { Origin: 'http://ov.localhost:' + PORT })).headers['access-control-allow-origin'], 'http://ov.localhost:' + PORT, 'overlays may read');
  assert.equal((await req('GET', '/events', { Origin: 'https://evil.example' })).headers['access-control-allow-origin'], undefined, 'the live event stream is not readable by another site');
  const pre = await req('OPTIONS', '/api/event', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' });
  assert.equal(pre.headers['access-control-allow-origin'], undefined, 'preflight is not approved for another site');

  // backups carry logins: not for another site's request
  assert.equal((await req('GET', '/api/backup/download?includeLogins=1', { Origin: 'https://evil.example' })).status, 403, 'backup download from another site is refused');
  assert.equal((await req('GET', '/api/backup/download', { 'Sec-Fetch-Site': 'cross-site' })).status, 403, 'cross-site backup download is refused');
  console.log('webguard-http-test: ok'); done(0);
})().catch((e) => { console.error(e); done(1); });
