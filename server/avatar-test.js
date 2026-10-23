'use strict';
// The pixel avatar's brains and settings, with no camera or browser. Run: node avatar-test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), core = require('../overlays/avatar-core'), createAvatarStore = require('./avatar');

// ---- head angles from MediaPipe's matrix (column-major): a turn of 0.3 rad about Y, a nod of 0.2 about X, a tilt of 0.1 about Z
const rot = (x, y, z) => { // Ry * Rx * Rz, returned column by column
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const r = [[cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx], [cx * sz, cx * cz, -sx], [-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx]];
  return [r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, 0, 0, 0, 1];
};
const e = core.eulerFromMatrix(rot(0.2, 0.3, 0.1)); assert.ok(Math.abs(e.x - 0.2) < 1e-6 && Math.abs(e.y - 0.3) < 1e-6 && Math.abs(e.z - 0.1) < 1e-6, JSON.stringify(e));
const big = rot(0.2, 0.3, 0.1).map((v, i) => (i % 4 === 3 ? v : v * 7)); const e2 = core.eulerFromMatrix(big); assert.ok(Math.abs(e2.y - 0.3) < 1e-6, 'the size of the face does not matter');

// ---- blendshapes become a pose; mirror swaps the eyes; strength scales the head
const bs = { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1, jawOpen: 0.4, mouthSmileLeft: 0.5, mouthSmileRight: 0.5, browInnerUp: 0.5, mouthPucker: 0.3 };
let p = core.fromFace(bs, rot(0, 0.2, 0), { mirror: true }); assert.ok(p.blinkL > 0.8 && p.blinkR < 0.2, 'mirror: my left eye is the left of the screen'); assert.ok(p.mouth > 0.5 && p.smile > 0.4 && p.browL > 0.4 && p.round > 0.3);
const q = core.fromFace(bs, rot(0, 0.2, 0), { mirror: false }); assert.ok(q.blinkR > 0.8 && q.blinkL < 0.2); assert.ok(Math.sign(q.yaw) === -Math.sign(p.yaw), 'not mirrored: the turn goes the other way');
assert.ok(core.fromFace(bs, rot(0, 0.2, 0), { sens: 2 }).yaw > p.yaw, 'a stronger setting turns more'); assert.ok(core.fromFace(bs, rot(0, 0.2, 0), { invertYaw: true }).yaw < 0);
assert.equal(core.fromFace({}, null, {}).mouth, 0, 'nothing in, nothing out');
const n = core.applyNeutral({ yaw: 0.3, pitch: 0.2, roll: 0, gazeX: 0, gazeY: 0, browL: 0, browR: 0 }, { yaw: 0.25, pitch: 0.2 }); assert.ok(Math.abs(n.yaw - 0.05) < 1e-9 && n.pitch === 0, 'calibration moves the centre');

// ---- the microphone becomes a mouth
const m = core.createMic(); let r = null;
for (let i = 0; i < 60; i++) r = m.push(0.004, 1, 1, 1 / 30, 1); assert.equal(r.mouth, 0, 'a quiet room keeps the mouth shut'); assert.equal(r.speaking, false);
for (let i = 0; i < 20; i++) r = m.push(0.12, 5, 1, 1 / 30, 1); assert.ok(r.mouth > 0.6 && r.speaking, 'speech opens it: ' + r.mouth); assert.ok(r.round > 0.5, 'low, hollow sound is a round "oo"');
for (let i = 0; i < 20; i++) r = m.push(0.12, 1, 5, 1 / 30, 1); assert.ok(r.round < 0.3, 'bright sound is a wide "ee"');
for (let i = 0; i < 40; i++) r = m.push(0.004, 1, 1, 1 / 30, 1); assert.equal(r.mouth, 0, 'and it closes again');
const loud = core.createMic(); for (let i = 0; i < 300; i++) r = loud.push(0.05, 1, 1, 1 / 30, 1); const fl = loud.state().floor; assert.ok(fl > 0.03 && r.mouth === 0, 'a constant hum becomes the noise floor: ' + fl);

// ---- the fallback: blinks and looks around by itself
let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647, step = core.createIdle(rng); let blinks = 0, was = 0, yawMin = 9, yawMax = -9, gazeMoved = 0;
for (let i = 0; i < 30 * 60; i++) { const s = step(1 / 30); if (s.blinkL > 0.5 && was <= 0.5) blinks++; was = s.blinkL; yawMin = Math.min(yawMin, s.yaw); yawMax = Math.max(yawMax, s.yaw); if (Math.abs(s.gazeX) > 0.2) gazeMoved++; }
assert.ok(blinks >= 8 && blinks <= 30, 'a blink every few seconds: ' + blinks + ' a minute'); assert.ok(yawMax - yawMin > 0.3, 'it sways'); assert.ok(gazeMoved > 20, 'it looks around');

// ---- the whole avatar
const T = (cfg) => core.createAvatar({ cfg, rng: (() => { let s = 3; return () => (s = (s * 16807) % 2147483647) / 2147483647; })() });
const run = (av, from, secs, msg) => { let f; for (let t = from; t < from + secs; t += 1 / 30) { if (msg) av.feed(msg, t); f = av.frame(t); } return f; };
// no tracker at all: pure fallback, mouth shut
let av = T({ mode: 'auto', mouthSrc: 'mic' }); let f = run(av, 0, 3); assert.equal(av.live(3).tracker, false); assert.ok(f.mouth < 0.05);
// a microphone but no camera: the mouth moves, and the head bobs a little
av = T({ mode: 'auto', mouthSrc: 'mic' }); f = run(av, 0, 1, { face: false, mic: true, micMouth: 0.9, micRound: 0.2, speaking: true }); assert.ok(f.mouth > 0.7, 'the mouth follows the microphone: ' + f.mouth); assert.ok(f.talking);
// a camera with a face: the head follows it exactly
av = T({ mode: 'auto', mouthSrc: 'cam' }); f = run(av, 0, 1.2, { face: true, mic: false, yaw: 0.8, pitch: 0, roll: 0, blinkL: 1, blinkR: 1, browL: 0, browR: 0, mouth: 0.6, round: 0, smile: 0.5, gazeX: 0, gazeY: 0 }); assert.ok(f.yaw > 0.7 && f.blinkL > 0.9 && f.mouth > 0.5);
// the camera is lost: back to the fallback within a moment, not frozen
f = run(av, 1.2, 3); assert.equal(av.live(4.2).face, false); assert.ok(Math.abs(f.yaw) < 0.6 && f.blinkL < 1);
// mouth source "both" uses the bigger one; "idle" mode ignores everything
av = T({ mode: 'auto', mouthSrc: 'both' }); f = run(av, 0, 1, { face: true, mic: true, yaw: 0, pitch: 0, roll: 0, blinkL: 0, blinkR: 0, browL: 0, browR: 0, mouth: 0.2, round: 0, smile: 0, gazeX: 0, gazeY: 0, micMouth: 0.9, micRound: 0.9 }); assert.ok(f.mouth > 0.7);
av = T({ mode: 'idle' }); f = run(av, 0, 1, { face: true, mic: true, yaw: 1, mouth: 1, micMouth: 1, micRound: 0 }); assert.ok(f.mouth < 0.05 && Math.abs(f.yaw) < 0.6, 'idle mode does not listen');

// ---- the settings store: bad values are fixed, colours checked, the file survives a restart
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icm-av-')), 'avatar.json'), sent = [];
const st = createAvatarStore({ file, broadcast: (ev, d) => sent.push([ev, d]) });
assert.equal(st.view().on, false); assert.equal(st.view().mode, 'auto');
st.configure({ on: true, mode: 'hax', mouthSrc: 'both', smooth: 5, sens: 'x', style: { skin: 'red', hair: '#112233', hairStyle: 'long', glasses: true, bg: 'url(x)' }, neutral: { yaw: 9, pitch: 'a' } });
const v = st.view(); assert.equal(v.on, true); assert.equal(v.mode, 'auto', 'unknown mode ignored'); assert.equal(v.mouthSrc, 'both'); assert.equal(v.smooth, 0.95); assert.equal(v.sens, 1); assert.equal(v.style.skin, '#E8B88F'); assert.equal(v.style.hair, '#112233'); assert.equal(v.style.hairStyle, 'long'); assert.equal(v.style.glasses, true); assert.equal(v.style.bg, 'transparent'); assert.deepEqual(v.neutral.yaw, 1); assert.equal(v.neutral.pitch, 0);
assert.ok(sent.some((x) => x[0] === 'avatarcfg'), 'overlays are told'); st.pose({ face: true }); assert.equal(sent[sent.length - 1][0], 'avatar');
st.report({ cams: [{ id: 'c1', label: 'Webcam' }], status: { running: true, cam: true, mic: false, fps: 29, error: '' } }); assert.equal(st.view().devices.cams[0].label, 'Webcam'); assert.equal(st.view().tracker.alive, true);
const again = createAvatarStore({ file }); assert.equal(again.view().on, true); assert.equal(again.view().style.hair, '#112233');
console.log('avatar test passed');
