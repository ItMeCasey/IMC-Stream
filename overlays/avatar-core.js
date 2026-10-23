'use strict';
/**
 * The brains of the pixel avatar, with no drawing and no browser: face-tracking numbers in, a pose out.
 * It also makes the fallback for people without a camera: it blinks, looks around and sways by itself, and the mouth follows the microphone.
 * Used by the tracker page, the OBS overlay and the preview, and tested by avatar-test.js.
 *
 * A pose: yaw (turn), pitch (nod), roll (tilt) -1..1; blinkL / blinkR 0 open .. 1 shut (L = the left of the screen); browL / browR -1 down .. 1 up;
 * mouth 0 shut .. 1 wide open; round 0 wide .. 1 "oo"; smile -1 .. 1; gazeX / gazeY -1..1.
 */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.AvatarCore = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const FIELDS = ['yaw', 'pitch', 'roll', 'blinkL', 'blinkR', 'browL', 'browR', 'mouth', 'round', 'smile', 'gazeX', 'gazeY'];
  const rest = () => ({ yaw: 0, pitch: 0, roll: 0, blinkL: 0, blinkR: 0, browL: 0, browR: 0, mouth: 0, round: 0, smile: 0.15, gazeX: 0, gazeY: 0 });
  const DEFAULTS = { mode: 'auto', mouthSrc: 'mic', mirror: true, smooth: 0.5, sens: 1, micSens: 1, invertYaw: false, invertPitch: false, invertRoll: false, idleMove: true };

  /** the turn / nod / tilt of the head from MediaPipe's 4x4 face matrix (16 numbers, column by column) */
  function eulerFromMatrix(m) {
    const r = (i, j) => m[j * 4 + i];
    // scale is removed first: the matrix carries the face size too
    const sx = Math.hypot(r(0, 0), r(1, 0), r(2, 0)) || 1, sy = Math.hypot(r(0, 1), r(1, 1), r(2, 1)) || 1, sz = Math.hypot(r(0, 2), r(1, 2), r(2, 2)) || 1;
    const m02 = r(0, 2) / sz, m12 = r(1, 2) / sz, m22 = r(2, 2) / sz, m10 = r(1, 0) / sx, m11 = r(1, 1) / sy;
    return { x: Math.asin(-clamp(m12, -1, 1)), y: Math.atan2(m02, m22), z: Math.atan2(m10, m11) };
  }
  const bsGet = (bs, k) => (bs && typeof bs[k] === 'number' ? bs[k] : 0);

  /** MediaPipe's numbers (blendshape name -> score, and the matrix) into a raw pose. Calibration (neutral) is subtracted by the caller with applyNeutral. */
  function fromFace(bs, matrix, o) {
    o = Object.assign({}, DEFAULTS, o); const e = matrix && matrix.length >= 16 ? eulerFromMatrix(matrix) : { x: 0, y: 0, z: 0 }, s = o.sens;
    const blinkA = bsGet(bs, 'eyeBlinkLeft'), blinkB = bsGet(bs, 'eyeBlinkRight');           // the person's left / right eye
    const browUpA = Math.max(bsGet(bs, 'browOuterUpLeft'), bsGet(bs, 'browInnerUp') * 0.8), browUpB = Math.max(bsGet(bs, 'browOuterUpRight'), bsGet(bs, 'browInnerUp') * 0.8);
    const browA = browUpA - bsGet(bs, 'browDownLeft'), browB = browUpB - bsGet(bs, 'browDownRight');
    const lookX = (bsGet(bs, 'eyeLookOutRight') + bsGet(bs, 'eyeLookInLeft') - bsGet(bs, 'eyeLookOutLeft') - bsGet(bs, 'eyeLookInRight')) / 2, lookY = (bsGet(bs, 'eyeLookUpLeft') + bsGet(bs, 'eyeLookUpRight') - bsGet(bs, 'eyeLookDownLeft') - bsGet(bs, 'eyeLookDownRight')) / 2;
    const smile = (bsGet(bs, 'mouthSmileLeft') + bsGet(bs, 'mouthSmileRight')) / 2 - (bsGet(bs, 'mouthFrownLeft') + bsGet(bs, 'mouthFrownRight')) / 2;
    const flip = o.mirror ? 1 : -1, sgn = (inv) => (inv ? -1 : 1);
    return {
      yaw: clamp(e.y / 0.55 * s * flip * sgn(o.invertYaw), -1, 1), pitch: clamp(e.x / 0.45 * s * sgn(o.invertPitch), -1, 1), roll: clamp(e.z / 0.5 * s * flip * sgn(o.invertRoll), -1, 1),
      blinkL: o.mirror ? blinkA : blinkB, blinkR: o.mirror ? blinkB : blinkA, browL: clamp((o.mirror ? browA : browB) * 1.6, -1, 1), browR: clamp((o.mirror ? browB : browA) * 1.6, -1, 1),
      mouth: clamp(bsGet(bs, 'jawOpen') * 1.5 * s, 0, 1), round: clamp(bsGet(bs, 'mouthPucker') * 1.6 + bsGet(bs, 'mouthFunnel') * 1.2, 0, 1), smile: clamp(smile * 1.8, -1, 1),
      gazeX: clamp(lookX * 1.4 * flip, -1, 1), gazeY: clamp(lookY * 1.4, -1, 1),
    };
  }
  /** "this is how I sit": the head angles seen at calibration become the centre */
  function applyNeutral(p, n) { if (!n) return p; const q = Object.assign({}, p); for (const k of ['yaw', 'pitch', 'roll', 'gazeX', 'gazeY']) q[k] = clamp(p[k] - (n[k] || 0), -1, 1); for (const k of ['browL', 'browR']) q[k] = clamp(p[k] - (n[k] || 0), -1, 1); return q; }

  // ---------------------------------------------------------------- the microphone becomes a mouth
  function createMic() {
    let floor = 0.01, level = 0, ceil = 0.12, lastRound = 0.3;
    /** rms: loudness 0..1 of the last slice; low / high: the energy under / over about 1.2 kHz (vowels like "oo" are mostly low) */
    function push(rms, low, high, dt, sens) {
      dt = dt || 1 / 30; sens = sens || 1;
      floor = rms < floor ? floor * 0.9 + rms * 0.1 : Math.min(0.04, floor + (rms - floor) * Math.min(1, dt * 0.15));   // the room's noise: creeps up over a few seconds, drops fast, and speech never counts as noise
      ceil = Math.max(ceil * (1 - dt * 0.03), rms, floor + 0.04);                                         // the loudest recent speech: fades slowly
      const x = clamp((rms - floor * 1.6) / Math.max(1e-4, (ceil - floor * 1.6)) * sens, 0, 1), up = x > level;
      level += (x - level) * Math.min(1, dt * (up ? 28 : 11));                                             // opens fast, closes a little slower
      const tot = (low || 0) + (high || 0); if (tot > 1e-6 && x > 0.15) lastRound += (clamp(((low || 0) / tot - 0.55) * 3, 0, 1) - lastRound) * Math.min(1, dt * 12);
      return { mouth: level < 0.05 ? 0 : level, round: lastRound, speaking: level > 0.12, floor };
    }
    return { push, state: () => ({ floor, ceil, level }) };
  }

  // ---------------------------------------------------------------- the fallback: moves by itself
  function createIdle(rng) {
    rng = rng || Math.random; let t = 0, nextBlink = 1.2 + rng() * 3, blinkT = -1, double = false, nextLook = 1 + rng() * 2, gx = 0, gy = 0, tgx = 0, tgy = 0, ph = rng() * 10, nextBrow = 4 + rng() * 6, browT = -1, nextSmile = 6 + rng() * 8, smileT = -1;
    return function step(dt) {
      t += dt; ph += dt; nextBlink -= dt; nextLook -= dt; nextBrow -= dt; nextSmile -= dt;
      if (nextBlink <= 0 && blinkT < 0) { blinkT = 0; double = rng() < 0.2; nextBlink = 2 + rng() * 5; }
      let blink = 0; if (blinkT >= 0) { blinkT += dt; const d = 0.16; blink = blinkT < d ? Math.sin(blinkT / d * Math.PI) : 0; if (blinkT >= d) { if (double) { double = false; blinkT = 0; } else blinkT = -1; } }
      if (nextLook <= 0) { const big = rng() < 0.25; tgx = (rng() - 0.5) * (big ? 1.7 : 0.7); tgy = (rng() - 0.5) * 0.5; nextLook = 0.8 + rng() * 3; }
      gx += (tgx - gx) * Math.min(1, dt * 14); gy += (tgy - gy) * Math.min(1, dt * 14);   // the eyes jump quickly, like real ones
      if (nextBrow <= 0 && browT < 0) { browT = 0; nextBrow = 5 + rng() * 9; } let brow = 0; if (browT >= 0) { browT += dt; brow = Math.sin(clamp(browT / 0.8, 0, 1) * Math.PI) * 0.7; if (browT > 0.8) browT = -1; }
      if (nextSmile <= 0 && smileT < 0) { smileT = 0; nextSmile = 8 + rng() * 12; } let smile = 0.12; if (smileT >= 0) { smileT += dt; smile += Math.sin(clamp(smileT / 2.2, 0, 1) * Math.PI) * 0.6; if (smileT > 2.2) smileT = -1; }
      return { yaw: Math.sin(ph * 0.45) * 0.28 + Math.sin(ph * 0.17 + 1) * 0.18 + gx * 0.18, pitch: Math.sin(ph * 0.33 + 2) * 0.12 + gy * 0.1, roll: Math.sin(ph * 0.27 + 4) * 0.12,
        blinkL: blink, blinkR: blink, browL: brow, browR: brow, smile, gazeX: gx, gazeY: gy, breath: Math.sin(ph * 1.3) };
    };
  }

  // ---------------------------------------------------------------- putting it together
  /**
   * One avatar. feed(msg, now) takes what the tracker page sends: { face: bool, mic: bool, ...raw pose (from fromFace + applyNeutral), mouth, round, speaking }.
   * frame(now) returns the pose to draw. Without fresh messages (no tracker running) everything is the fallback.
   */
  function createAvatar(o) {
    o = o || {}; const rng = o.rng || Math.random, idle = createIdle(rng); let cfg = Object.assign({}, DEFAULTS, o.cfg), last = null, lastAt = -1e9, lastFrame = null, cur = rest(), breath = 0, nod = 0, faceAt = -1e9, micAt = -1e9, micMsg = { mouth: 0, round: 0.3 };
    const fresh = (now) => now - lastAt < 1.5;
    function feed(msg, now) {
      last = msg; lastAt = now;
      if (msg.face) faceAt = now; if (msg.mic) { micAt = now; micMsg = { mouth: msg.micMouth != null ? msg.micMouth : msg.mouth, round: msg.micRound != null ? msg.micRound : msg.round, speaking: !!msg.speaking }; }
    }
    function frame(now) {
      const dt = lastFrame == null ? 1 / 30 : clamp(now - lastFrame, 0.001, 0.25); lastFrame = now;
      const id = idle(dt), useFace = cfg.mode !== 'idle' && fresh(now) && now - faceAt < 0.6 && last && last.face, useMic = cfg.mode !== 'idle' && now - micAt < 1.0 && cfg.mouthSrc !== 'cam';
      const target = {}; for (const k of FIELDS) target[k] = id[k] != null ? id[k] : rest()[k];
      if (!cfg.idleMove) for (const k of ['yaw', 'pitch', 'roll', 'gazeX', 'gazeY', 'browL', 'browR']) target[k] = 0;
      if (useFace) for (const k of FIELDS) if (k !== 'mouth' && k !== 'round') target[k] = last[k];
      // the mouth: the camera, the microphone, or the bigger of the two
      const camMouth = useFace ? last.mouth : 0, camRound = useFace ? last.round : 0;
      if (cfg.mouthSrc === 'cam') { target.mouth = camMouth; target.round = camRound; }
      else if (cfg.mouthSrc === 'both') { target.mouth = Math.max(camMouth, useMic ? micMsg.mouth : 0); target.round = useMic && micMsg.mouth > camMouth ? micMsg.round : camRound; }
      else { target.mouth = useMic ? micMsg.mouth : 0; target.round = useMic ? micMsg.round : 0; }
      // while talking with no camera, the head bobs a little, as people do
      if (!useFace) { nod += (target.mouth - nod) * Math.min(1, dt * 6); target.pitch += nod * 0.16 * (cfg.idleMove ? 1 : 0); target.browL += nod * 0.25; target.browR += nod * 0.25; }
      const base = clamp(cfg.smooth, 0, 0.95), speed = (k) => (k.startsWith('blink') ? 60 : k === 'mouth' || k === 'round' ? 45 : k.startsWith('gaze') ? 30 : 22 * (1.05 - base));
      for (const k of FIELDS) cur[k] += (target[k] - cur[k]) * Math.min(1, dt * speed(k));
      breath += (id.breath - breath) * Math.min(1, dt * 8);
      const out = Object.assign({}, cur, { breath, talking: target.mouth > 0.1 }); for (const k of FIELDS) if (k !== 'mouth' && k !== 'round') out[k] = clamp(out[k], -1, 1);
      return out;
    }
    return { feed, frame, setConfig: (c) => { cfg = Object.assign({}, cfg, c); }, config: () => cfg, live: (now) => ({ tracker: fresh(now), face: fresh(now) && now - faceAt < 0.6, mic: now - micAt < 1.0 }) };
  }
  return { FIELDS, DEFAULTS, rest, clamp, eulerFromMatrix, fromFace, applyNeutral, createMic, createIdle, createAvatar };
});
