'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'); const createVm = require('./voicemeeter');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-vm-')), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (z) => '<a href="https://download.vb-audio.com/Download_CABLE/' + z + '">dl</a><a href="https://evil.example/Download_CABLE/VoicemeeterSetup_v9.zip">x</a>';
let sig = 'Valid|CN=VB-Audio Software, O=VB-Audio', psCalls = [];
const fetchFn = async (u) => (/\.htm$/.test(u) ? { ok: true, text: async () => page(/potato/.test(u) ? 'Voicemeeter8Setup_v3130.zip' : 'VoicemeeterSetup_v2130.zip') } : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(200000) });
const ps = async (args) => { const c = args.join(' '); psCalls.push(c);
  if (/Expand-Archive/.test(c)) { const d = /-DestinationPath "([^"]+)"/.exec(c)[1]; fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'VoicemeeterSetup.exe'), 'x'); return ''; }
  if (/Get-AuthenticodeSignature/.test(c)) return sig + '\n'; if (/Get-PnpDevice/.test(c)) return 'SWD\MMDEVAPI\{0.0.0.00000000}.{a}|Headphones (Realtek)\nSWD\MMDEVAPI\{0.0.1.00000000}.{b}|Microphone (USB Mic)\nSWD\MMDEVAPI\{0.0.0.00000000}.{c}|Voicemeeter Input (VB-Audio)\n'; return ''; };
const calls = [], inputs = [{ inputName: 'Alerts', inputKind: 'browser_source' }, { inputName: 'Game', inputKind: 'game_capture' }, { inputName: 'Mic/Aux', inputKind: 'wasapi_input_capture' }];
const obs = { raw: async (fn) => fn(async (type, data) => { calls.push([type, data]);
  if (type === 'GetInputList') return { inputs }; if (type === 'GetSceneList') return { scenes: [{ sceneName: 'B' }, { sceneName: 'A' }] };
  if (type === 'GetInputAudioTracks') { if (data.inputName === 'Game') throw new Error('no audio'); return { inputAudioTracks: { 1: true, 2: true } }; }
  if (type === 'GetInputPropertiesListPropertyItems') return { propertyItems: [{ itemName: 'Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)', itemValue: 'id-b1' }, { itemName: 'Voicemeeter Out B2 (VB-Audio Voicemeeter VAIO)', itemValue: 'id-b2' }] };
  if (type === 'GetSpecialInputs') return { desktop1: 'Desktop Audio', mic1: 'Mic/Aux' }; return {}; }) };
(async () => {
  const vm = createVm({ DATA, dir: path.join(DATA, 'nope'), fetch: fetchFn, ps, obs, log: () => {} });
  assert.equal((await vm.resolveUrl('banana')), 'https://download.vb-audio.com/Download_CABLE/VoicemeeterSetup_v2130.zip');
  assert(/Voicemeeter8Setup/.test(await vm.resolveUrl('potato')));
  assert.equal(vm.status().banana.installed, false);
  vm.download('banana'); for (let i = 0; i < 50 && vm.status().banana.state === 'working'; i++) await sleep(20);
  assert.equal(vm.status().banana.state, 'ready', vm.status().banana.msg);
  sig = 'Valid|CN=Somebody Else'; vm.download('potato'); for (let i = 0; i < 50 && vm.status().potato.state === 'working'; i++) await sleep(20);
  assert.equal(vm.status().potato.state, 'error'); assert(/not signed by VB-Audio/.test(vm.status().potato.msg));
  assert.throws(() => vm.install('potato'), /Download it first/);
  const d = await vm.devices(); assert.deepEqual(d, { inputs: ['Microphone (USB Mic)'], outputs: ['Headphones (Realtek)'] });
  const ins = await vm.obsInputs(); assert.deepEqual(ins.map((i) => [i.name, i.keepOut]), [['Alerts', true], ['Mic/Aux', false]]);
  const r = await vm.obsApply({ exclude: ['Alerts'] }); assert(r.steps.every((s) => s.ok), JSON.stringify(r.steps));
  const set = (n) => calls.filter((c) => c[0] === 'SetInputAudioTracks' && c[1].inputName === n).map((c) => c[1].inputAudioTracks);
  assert.deepEqual(set('Voicemeeter B1 (game + mic)')[0], { 1: true, 2: true, 3: false, 4: false, 5: false, 6: false }); assert.equal(set('Voicemeeter B2 (music)')[0]['2'], false); assert.equal(set('Alerts')[0]['2'], false);
  assert(calls.some((c) => c[0] === 'SetInputMute' && c[1].inputName === 'Desktop Audio')); assert(calls.some((c) => c[0] === 'SetProfileParameter' && c[1].parameterValue === 'Advanced'));
  assert(calls.filter((c) => c[0] === 'CreateSceneItem').length === 2, 'sources added to the other scene');
  // live volumes through the helper process (fake child: answers every line with the current state)
  const EE = require('events'); let gains = { local: -12, b1: 0, b2: -3 }, sent = [];
  const fake = () => { const c = new EE(); c.stdout = new EE(); c.stdin = { write: (l) => { const m = JSON.parse(l); sent.push(m); if (m.op === 'set') gains[m.which] = m.db; setImmediate(() => c.stdout.emit('data', Buffer.from(JSON.stringify(Object.assign({ ok: true, kind: 'banana' }, gains)) + String.fromCharCode(10)))); }, end() {} }; c.kill = () => {}; return c; };
  const vm2 = createVm({ DATA, dir: path.join(DATA, 'nope'), spawn: fake, log: () => {} });
  assert.deepEqual(await vm2.volumes(), { ok: true, kind: 'banana', local: -12, b1: 0, b2: -3 });
  const r2 = await vm2.setVolume('b2', -6); assert.equal(r2.b2, -6); assert.deepEqual(sent[1], { op: 'set', which: 'b2', db: -6 });
  await assert.rejects(vm2.setVolume('nope', 0), /Unknown volume/); vm2.stop();
  await assert.rejects(vm.configure({ kind: 'banana' }), /not installed/);
  console.log('voicemeeter test passed');
})().catch((e) => { console.error(e); process.exit(1); });
