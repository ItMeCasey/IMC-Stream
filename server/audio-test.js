// The audio mixer client against a fake OBS: inputs, meters, mute, volume, per-scene filtering, connection lifecycle. Run: node audio-test.js
const http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert');
const createAudio = require('./audio.js');
const PORT = 9946, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (txt) => { const b = Buffer.from(txt); const h = b.length < 126 ? Buffer.from([0x81, b.length]) : b.length < 65536 ? Buffer.from([0x81, 126, b.length >> 8, b.length & 255]) : null; return Buffer.concat([h, b]); };
function parse(buf) { const out = []; let i = 0; while (i + 2 <= buf.length) { const op = buf[i] & 15; let len = buf[i + 1] & 127; i += 2; if (len === 126) { len = buf.readUInt16BE(i); i += 2; } const mask = buf.slice(i, i + 4); i += 4; const d = Buffer.from(buf.slice(i, i + len)); i += len; for (let k = 0; k < d.length; k++) d[k] ^= mask[k % 4]; if (op === 1) out.push(d.toString()); } return out; }

const obsState = { inputs: { 'Desktop Audio': { kind: 'wasapi_output_capture', muted: true, db: -3 }, 'Mic/Aux': { kind: 'wasapi_input_capture', muted: false, db: 0 }, 'Alerts': { kind: 'browser_source', muted: false, db: 0 }, 'Quiet Overlay': { kind: 'browser_source', muted: false, db: 0 }, 'Game': { kind: 'game_capture', muted: false, db: 0 } },
  scenes: { Gameplay: ['Game', 'Alerts', 'Quiet Overlay'], Chat: ['Alerts'], Nested: ['Chat'] }, program: 'Gameplay' };
let conns = 0, subs = 0, socks = [];
const server = http.createServer();
server.on('upgrade', (req, sock) => {
  conns++; socks.push(sock);
  const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n'); sock.on('error', () => {});
  const ev = (type, data) => sock.write(frame(JSON.stringify({ op: 5, d: { eventType: type, eventIntent: 0, eventData: data } })));
  sock.write(frame(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1 } })));
  sock.on('data', (buf) => {
    for (const t of parse(buf)) {
      const m = JSON.parse(t);
      if (m.op === 1) { subs = m.d.eventSubscriptions; sock.write(frame(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))); sock.meter = setInterval(() => ev('InputVolumeMeters', { inputs: [{ inputName: 'Mic/Aux', inputLevelsMul: [[0, 0.5, 0.5], [0, 0.25, 0.25]] }, { inputName: 'Alerts', inputLevelsMul: [[0, 0.1, 0.1]] }, { inputName: 'Quiet Overlay', inputLevelsMul: [[0, 0, 0]] }] }), 30); }
      else if (m.op === 6) {
        const { requestType: type, requestId, requestData: d } = m.d; let data = {}, result = true, comment;
        const inp = d && obsState.inputs[d.inputName];
        if (type === 'GetInputList') data = { inputs: Object.entries(obsState.inputs).map(([n, v]) => ({ inputName: n, inputKind: v.kind })) };
        else if (type === 'GetInputMute') data = { inputMuted: inp.muted };
        else if (type === 'GetInputVolume') { if (inp.kind === 'game_capture') { result = false; comment = 'no audio'; } else data = { inputVolumeMul: 1, inputVolumeDb: inp.db }; }
        else if (type === 'GetSpecialInputs') data = { desktop1: 'Desktop Audio', mic1: 'Mic/Aux', desktop2: null };
        else if (type === 'GetCurrentProgramScene') data = { sceneName: obsState.program };
        else if (type === 'GetSceneItemList') data = { sceneItems: (obsState.scenes[d.sceneName] || []).map((n) => (obsState.scenes[n] ? { sourceName: n, sourceType: 'OBS_SOURCE_TYPE_SCENE', inputKind: null } : { sourceName: n, sourceType: 'OBS_SOURCE_TYPE_INPUT', inputKind: obsState.inputs[n] && obsState.inputs[n].kind })) };
        else if (type === 'SetInputMute') { inp.muted = d.inputMuted; setTimeout(() => ev('InputMuteStateChanged', { inputName: d.inputName, inputMuted: inp.muted }), 5); }
        else if (type === 'ToggleInputMute') { inp.muted = !inp.muted; data = { inputMuted: inp.muted }; setTimeout(() => ev('InputMuteStateChanged', { inputName: d.inputName, inputMuted: inp.muted }), 5); }
        else if (type === 'SetInputVolume') { inp.db = d.inputVolumeDb; setTimeout(() => ev('InputVolumeChanged', { inputName: d.inputName, inputVolumeDb: inp.db, inputVolumeMul: 1 }), 5); }
        else if (type === 'GetSceneList') data = { scenes: Object.keys(obsState.scenes).map((n) => ({ sceneName: n })) };
        sock.write(frame(JSON.stringify({ op: 7, d: { requestType: type, requestId, requestStatus: { result, code: result ? 100 : 600, comment }, responseData: data } })));
      }
    }
  });
  sock.on('close', () => clearInterval(sock.meter));
});

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const pushes = []; const a = createAudio({ getCfg: () => ({ host: "127.0.0.1", port: PORT }), log: () => {}, broadcast: (e, d) => pushes.push([e, d]), idleMs: 2500 });
  assert.strictEqual(conns, 0, 'nothing connects until a mixer looks');
  a.touch(); await sleep(700);
  assert.strictEqual(conns, 1); assert.ok(subs & (1 << 16), 'asks OBS for the meter stream'); assert.ok(subs & 8, 'and input changes');
  let v = a.view(); assert.strictEqual(v.connected, true); assert.strictEqual(v.program, 'Gameplay');
  const names = v.inputs.map((i) => i.name).sort();
  assert.deepStrictEqual(names, ['Alerts', 'Desktop Audio', 'Mic/Aux'], 'real audio kinds + anything that made sound; silent overlays and no-audio sources are hidden: ' + names);
  const mic = v.inputs.find((i) => i.name === 'Mic/Aux'); assert.ok(mic.peak > -7 && mic.peak < -5, 'peak 0.5 is about -6 dB: ' + mic.peak); assert.strictEqual(v.inputs.find((i) => i.name === 'Desktop Audio').muted, true);
  assert.ok(pushes.length > 3 && pushes[pushes.length - 1][0] === 'audio', 'meters are pushed to the app');
  // per scene: global inputs + that scene's sources (nested scenes followed)
  assert.deepStrictEqual((await a.forScene('Chat')).inputs.sort(), ['Alerts', 'Desktop Audio', 'Mic/Aux']);
  assert.deepStrictEqual((await a.forScene('Nested')).inputs.sort(), ['Alerts', 'Desktop Audio', 'Mic/Aux'], 'nested scene');
  assert.deepStrictEqual((await a.forScene('')).inputs.sort(), ['Alerts', 'Desktop Audio', 'Game', 'Mic/Aux', 'Quiet Overlay'].filter((n) => n !== 'Game'), 'blank = the program scene (Gameplay)');
  // mute + volume
  await a.toggleMute('Mic/Aux'); await sleep(60); assert.strictEqual(a.view().inputs.find((i) => i.name === 'Mic/Aux').muted, true); await a.setMute('Mic/Aux', false); await sleep(60); assert.strictEqual(a.view().inputs.find((i) => i.name === 'Mic/Aux').muted, false);
  await a.setVolumeDb('Mic/Aux', -12); await sleep(60); assert.strictEqual(a.view().inputs.find((i) => i.name === 'Mic/Aux').db, -12);
  await a.setVolumeDb('Mic/Aux', 99); await sleep(60); assert.strictEqual(a.view().inputs.find((i) => i.name === 'Mic/Aux').db, 26, 'volume is clamped to what OBS allows');
  // keeps the connection while a widget keeps asking, drops it when nobody does
  for (let i = 0; i < 5; i++) { await sleep(400); a.touch(); } assert.strictEqual(conns, 1, 'one connection while in use');
  await sleep(3000); assert.strictEqual(a.view().connected, false, 'closed after the idle time'); const before = pushes.length; await sleep(200); assert.strictEqual(pushes.length, before, 'no more meter traffic when closed');
  a.touch(); await sleep(500); assert.strictEqual(conns, 2); assert.strictEqual(a.view().connected, true, 'reconnects on demand');
  a.close(); socks.forEach((s) => s.destroy()); server.close();
  console.log('audio test passed');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message, '\n', (e.stack || '').split('\n').slice(1, 3).join('\n')); process.exit(1); });
