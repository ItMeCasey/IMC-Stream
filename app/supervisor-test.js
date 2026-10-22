// Watchdog behaviour with a real child process and a real HTTP health endpoint. Run: node supervisor-test.js
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert');
const createSupervisor = require('./supervisor.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9941, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-sup-')), script = path.join(dir, 'fake-server.js'), counter = path.join(dir, 'runs.txt');
// a fake "server": answers /api/health, and misbehaves on purpose depending on how many times it has been started
fs.writeFileSync(script, `
const http = require('http'), fs = require('fs'); const f = ${JSON.stringify(counter)};
const n = (fs.existsSync(f) ? +fs.readFileSync(f, 'utf8') : 0) + 1; fs.writeFileSync(f, String(n));
const mode = process.env.MODE;
if (mode === 'crash' && n <= 2) process.exit(1);                 // first two starts crash at once
if (mode === 'restart75' && n === 1) setTimeout(() => process.exit(75), 100);
let hang = false; if (mode === 'hang' && n === 1) setTimeout(() => { hang = true; }, 600);   // first run stops answering after a moment
http.createServer((req, res) => { if (hang) return; res.end(JSON.stringify({ ok: true, light: 'green', n })); }).listen(${PORT}, '127.0.0.1');
`);
const make = (mode, extra) => { fs.rmSync(counter, { force: true }); const states = [], logs = []; const sup = createSupervisor(Object.assign({ command: process.execPath, args: [script], cwd: dir, env: Object.assign({}, process.env, { MODE: mode }), port: PORT, log: (...a) => logs.push(a.join(' ')),
  onState: (s) => states.push(s), healthIntervalMs: 150, healthTimeoutMs: 300, maxHealthFails: 2, stableMs: 100000 }, extra)); return { sup, states, logs }; };
const runs = () => +fs.readFileSync(counter, 'utf8');

(async () => {
  // normal: starts, becomes healthy, stops cleanly and stays stopped
  let t = make('ok'); t.sup.start(); await sleep(800); assert.strictEqual(t.sup.view().state, 'running'); assert.strictEqual(t.sup.view().health.light, 'green');
  t.sup.stop(); await sleep(400); assert.strictEqual(t.sup.view().state, 'stopped'); assert.strictEqual(runs(), 1, 'no restart after stop'); await sleep(700); assert.strictEqual(runs(), 1);

  // crashes twice: it keeps restarting with a growing pause and ends up running
  t = make('crash'); t.sup.start(); await sleep(5000); assert.strictEqual(t.sup.view().state, 'running', 'recovered after crashes'); assert.ok(runs() >= 3, 'restarted ' + runs());
  assert.ok(t.logs.some((l) => /restarting in 1s/.test(l)) && t.logs.some((l) => /restarting in 2s/.test(l)), 'backoff grows: ' + t.logs.join(' | ')); t.sup.stop(); await sleep(400);

  // exit code 75 = restart requested: immediate, no backoff
  t = make('restart75'); t.sup.start(); await sleep(1500); assert.strictEqual(runs(), 2); assert.strictEqual(t.sup.view().state, 'running'); t.sup.stop(); await sleep(400);

  // stops answering while still alive: killed and restarted
  t = make('hang'); t.sup.start(); await sleep(5000); assert.ok(runs() >= 2, 'restarted a hung server: ' + runs() + ' ' + t.logs.join(' | ')); assert.strictEqual(t.sup.view().state, 'running'); assert.ok(t.logs.some((l) => /stopped answering/.test(l))); t.sup.stop(); await sleep(400);
  console.log('supervisor test passed');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
