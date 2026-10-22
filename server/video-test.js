// Video alerts + overlay data endpoints against a real server process. Run: node video-test.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert'), { spawn } = require('node:child_process');
const PORT = 9930, data = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-video-')), B = 'http://127.0.0.1:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const proc = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { ICM_DATA: data, ICM_PORT: PORT, ICM_CLIENT_ID: 'x' }), stdio: 'ignore' });

(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(B + '/api/health'); break; } catch (e) { await sleep(250); } }
  // upload: wrong type refused, right type lands in the data folder (not the install folder)
  const clip = Buffer.alloc(2048, 7);
  let r = await fetch(B + '/api/alerts/upload?kind=video&name=boom.avi', { method: 'POST', body: clip }).then((x) => x.json()); assert.ok(/Allowed video files/.test(r.error), 'avi refused');
  r = await fetch(B + '/api/alerts/upload?kind=video&name=boom.mp4', { method: 'POST', body: clip }).then((x) => x.json()); assert.strictEqual(r.path, 'custom/boom.mp4');
  assert.ok(fs.existsSync(path.join(data, 'custom', 'video', 'boom.mp4')));
  const list = await fetch(B + '/api/alerts').then((x) => x.json()); assert.deepStrictEqual(list.assets.videos, ['custom/boom.mp4']);
  const vr = await fetch(B + '/video/custom/boom.mp4'); assert.strictEqual(vr.headers.get('content-type'), 'video/mp4'); assert.strictEqual((await vr.arrayBuffer()).byteLength, 2048);
  assert.strictEqual((await fetch(B + '/video/custom/..%2f..%2fstate.json')).status, 404, 'no escaping the folder');
  // a rule with a video: the alert that reaches the overlay carries it
  const rule = list.rules.find((x) => x.event === 'follow');
  const saved = await post('/api/alerts/save', Object.assign({}, rule, { video: 'custom/boom.mp4' })); assert.strictEqual(saved.video, 'custom/boom.mp4');
  const bad = await post('/api/alerts/save', Object.assign({}, rule, { video: '../../x.mp4' })); assert.strictEqual(bad.video, '', 'unknown video names are dropped');
  await post('/api/alerts/save', Object.assign({}, rule, { video: 'custom/boom.mp4' }));
  const got = new Promise((res) => { fetch(B + '/events').then(async (resp) => { let buf = ''; for await (const c of resp.body) { buf += Buffer.from(c).toString(); const m = /^data: (\{.*"video".*)$/m.exec(buf); if (m) return res(JSON.parse(m[1])); } }); });
  await sleep(300); await post('/api/alerts/test', { id: rule.id });
  const a = await Promise.race([got, sleep(4000).then(() => null)]); assert.ok(a && a.video === '/video/custom/boom.mp4', 'alert carries the video: ' + JSON.stringify(a));
  // overlay data
  const stats = await fetch(B + '/api/stats').then((x) => x.json()); assert.deepStrictEqual(Object.keys(stats).sort(), ['followers', 'game', 'live', 'now', 'sessionFollowers', 'sessionSubs', 'startedAt', 'subs', 'title', 'viewers']);
  const hype = await fetch(B + '/api/hype').then((x) => x.json()); assert.strictEqual(hype.active, false);
  for (const f of ['hypetrain', 'events', 'viewers']) assert.strictEqual((await fetch(B + '/overlays/' + f + '.html')).status, 200, f);
  console.log('video + overlay data test passed');
})().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; }).finally(() => { proc.kill(); setTimeout(() => process.exit(process.exitCode || 0), 200); });
