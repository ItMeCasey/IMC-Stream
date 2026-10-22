// Tests the OBS WebSocket client against a fake OBS (v5 protocol incl. password auth). Run: node obs-test.js
const http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert');
const createObs = require('./obs.js');
const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');

const PORT = 9944, PASSWORD = 'hunter2', salt = 'SALT123', challenge = 'CHAL456';
const out = { stream: false, record: false }; const calls = []; let items = { Scene1: [{ sourceName: 'Confetti', sceneItemId: 7 }] }, enabled = {}, current = 'Scene1', requireAuth = true;

const frame = (txt) => { const b = Buffer.from(txt); const h = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); return Buffer.concat([h, b]); };
function parse(buf) {   // client frames are masked text frames
  const out = []; let i = 0;
  while (i + 2 <= buf.length) {
    const op = buf[i] & 15; let len = buf[i + 1] & 127; i += 2;
    if (len === 126) { len = buf.readUInt16BE(i); i += 2; }
    const mask = buf.slice(i, i + 4); i += 4; const d = Buffer.from(buf.slice(i, i + len)); i += len;
    for (let k = 0; k < d.length; k++) d[k] ^= mask[k % 4];
    if (op === 1) out.push(d.toString());
  }
  return out;
}
const server = http.createServer();
server.on('upgrade', (req, sock) => {
  const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  sock.on('error', () => {});
  sock.write(frame(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1, ...(requireAuth ? { authentication: { challenge, salt } } : {}) } })));
  sock.on('data', (buf) => {
    for (const t of parse(buf)) {
      const m = JSON.parse(t);
      if (m.op === 1) {
        if (requireAuth && m.d.authentication !== sha(sha(PASSWORD + salt) + challenge)) { sock.end(); return; }
        sock.write(frame(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })));
      } else if (m.op === 6) {
        const { requestType: type, requestId, requestData: d } = m.d; calls.push([type, d]); let data = {}, result = true, comment;
        if (type === 'GetVersion') data = { obsVersion: '30.2.0', obsWebSocketVersion: '5.5.0' };
        else if (type === 'GetStreamStatus') data = { outputActive: out.stream, outputReconnecting: false, outputDuration: 5000 };
        else if (type === 'GetRecordStatus') data = { outputActive: out.record, outputPaused: false, outputDuration: 2000 };
        else if (type === 'StartStream') out.stream = true; else if (type === 'StopStream') out.stream = false; else if (type === 'StartRecord') out.record = true; else if (type === 'StopRecord') out.record = false;
        else if (type === 'GetSceneList') data = { scenes: [{ sceneName: 'Scene2' }, { sceneName: 'Scene1' }] };   // OBS lists bottom-to-top
        else if (type === 'GetCurrentProgramScene') data = { sceneName: current };
        else if (type === 'GetSceneItemList') data = { sceneItems: items[d.sceneName] || [] };
        else if (type === 'GetSceneItemId') { const it = (items[d.sceneName] || []).find((x) => x.sourceName === d.sourceName); if (it) data = { sceneItemId: it.sceneItemId }; else { result = false; comment = 'No scene items were found in the specified scene by that name or offset.'; } }
        else if (type === 'SetSceneItemEnabled') enabled[d.sceneItemId] = d.sceneItemEnabled;
        else if (type === 'SetCurrentProgramScene') current = d.sceneName;
        sock.write(frame(JSON.stringify({ op: 7, d: { requestType: type, requestId, requestStatus: { result, code: result ? 100 : 600, comment }, responseData: data } })));
      }
    }
  });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const cfg = { host: '127.0.0.1', port: PORT, password: PASSWORD };
  const obs = createObs(() => cfg);
  try {
    assert.deepStrictEqual(await obs.test(), { obsVersion: '30.2.0', websocketVersion: '5.5.0' }, 'connects and authenticates');
    assert.deepStrictEqual(await obs.scenes(), ['Scene1', 'Scene2']);
    assert.deepStrictEqual(await obs.sources(''), ['Confetti'], 'blank scene = current scene');
    await obs.setScene('Scene2'); assert.strictEqual(current, 'Scene2'); await obs.setScene('Scene1');
    const r = await obs.showSource({ scene: '', source: 'Confetti', seconds: 1 });
    assert.strictEqual(r.scene, 'Scene1'); assert.strictEqual(enabled[7], true, 'source shown');
    await sleep(1800); assert.strictEqual(enabled[7], false, 'source hidden again after the timer');
    await assert.rejects(obs.showSource({ scene: 'Scene1', source: 'Nope', seconds: 0 }), /No scene items were found/);
    cfg.password = 'wrong'; await assert.rejects(obs.test(), /closed|password/i, 'wrong password is rejected');
    cfg.password = ''; await assert.rejects(obs.test(), /password/i, 'missing password is explained');
    requireAuth = false; cfg.password = ''; assert.strictEqual((await obs.test()).obsVersion, '30.2.0', 'works without a password too');
    assert.deepStrictEqual(await obs.status(), { streaming: false, reconnecting: false, seconds: 5, recording: false, paused: false, recordSeconds: 2 });
    await obs.stream('start'); assert.strictEqual(out.stream, true); await obs.stream('start'); assert.strictEqual(calls.filter((c) => c[0] === 'StartStream').length, 1, 'start twice only starts once');
    assert.strictEqual((await obs.status()).streaming, true); await obs.stream('stop'); assert.strictEqual(out.stream, false); await obs.stream('stop'); assert.strictEqual(calls.filter((c) => c[0] === 'StopStream').length, 1);
    await obs.stream('toggle'); assert.strictEqual(out.stream, true); await obs.stream('toggle'); assert.strictEqual(out.stream, false);
    await obs.record('toggle'); assert.strictEqual(out.record, true); await obs.record('stop'); assert.strictEqual(out.record, false);
    cfg.port = 9; await assert.rejects(obs.test(), /Could not connect|closed/, 'OBS not running is explained');
    console.log('obs test passed (' + calls.length + ' requests)');
  } catch (e) { console.error('FAILED:', e.message, '\n', (e.stack || '').split('\n').slice(1, 3).join('\n')); process.exitCode = 1; }
  server.close(); setTimeout(() => process.exit(), 100);
})();
