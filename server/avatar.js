'use strict';
/**
 * The pixel avatar's settings and the link between the tracker page (which owns the camera and microphone) and the overlays (OBS, the preview).
 * The tracker posts poses ~30 times a second; they are passed straight on to every overlay. Settings are saved in avatar.json.
 */
const fs = require('node:fs');
const path = require('node:path');

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULTS = {
  on: false, mode: 'auto', mouthSrc: 'mic', mirror: true, smooth: 0.5, sens: 1, micSens: 1, invertYaw: false, invertPitch: false, invertRoll: false, idleMove: true, fps: 30,
  camId: '', micId: '', neutral: null,
  style: { skin: '#E8B88F', hair: '#3b2a22', hairStyle: 'short', eyes: '#2e86c1', shirt: '#4FBBBC', glasses: false, headphones: false, blush: true, bg: 'transparent' },
};
const ENUM = { mode: ['auto', 'camera', 'mic', 'idle'], mouthSrc: ['mic', 'cam', 'both'] }, STYLE_ENUM = { hairStyle: ['short', 'long', 'bun', 'none'] };

module.exports = function createAvatar(ctx) {
  const log = ctx.log || (() => {}), broadcast = ctx.broadcast || (() => {}), FILE = ctx.file;
  let S = JSON.parse(JSON.stringify(DEFAULTS)), devices = { cams: [], mics: [] }, tracker = { running: false, cam: false, mic: false, fps: 0, error: '', at: 0 }, lastPose = 0;
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); S = Object.assign(S, j, { style: Object.assign({}, S.style, j.style) }); } catch (e) { /* first run */ }
  const save = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(S, null, 2)); } catch (e) { log('avatar save failed:', e.message); } };
  const num = (v, a, b, d) => (Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : d);

  function configure(b) {
    b = b || {};
    for (const k of ['on', 'mirror', 'invertYaw', 'invertPitch', 'invertRoll', 'idleMove']) if (b[k] !== undefined) S[k] = !!b[k];
    for (const k of Object.keys(ENUM)) if (b[k] !== undefined && ENUM[k].includes(b[k])) S[k] = b[k];
    if (b.smooth !== undefined) S.smooth = num(b.smooth, 0, 0.95, S.smooth); if (b.sens !== undefined) S.sens = num(b.sens, 0.3, 3, S.sens); if (b.micSens !== undefined) S.micSens = num(b.micSens, 0.2, 4, S.micSens); if (b.fps !== undefined) S.fps = [15, 20, 30, 60].includes(+b.fps) ? +b.fps : S.fps;
    for (const k of ['camId', 'micId']) if (b[k] !== undefined) S[k] = String(b[k]).slice(0, 300);
    if (b.neutral !== undefined) S.neutral = b.neutral && typeof b.neutral === 'object' ? Object.fromEntries(['yaw', 'pitch', 'roll', 'gazeX', 'gazeY', 'browL', 'browR'].map((k) => [k, num(b.neutral[k], -1, 1, 0)])) : null;
    if (b.style && typeof b.style === 'object') {
      for (const k of ['skin', 'hair', 'eyes', 'shirt']) if (HEX.test(b.style[k] || '')) S.style[k] = b.style[k];
      for (const k of Object.keys(STYLE_ENUM)) if (STYLE_ENUM[k].includes(b.style[k])) S.style[k] = b.style[k];
      for (const k of ['glasses', 'headphones', 'blush']) if (b.style[k] !== undefined) S.style[k] = !!b.style[k];
      if (b.style.bg !== undefined) S.style.bg = b.style.bg === 'transparent' || HEX.test(b.style.bg || '') ? b.style.bg : S.style.bg;
    }
    save(); broadcast('avatarcfg', cfg()); return view();
  }
  const cfg = () => Object.assign({}, S);
  /** one pose from the tracker, passed on at once (kept tiny: this happens 30 times a second) */
  function pose(p) { if (!p || typeof p !== 'object') return; lastPose = Date.now(); broadcast('avatar', p); }
  function report(b) {
    b = b || {}; if (Array.isArray(b.cams)) devices.cams = b.cams.slice(0, 20).map((d) => ({ id: String(d.id || '').slice(0, 300), label: String(d.label || 'Camera').slice(0, 100) }));
    if (Array.isArray(b.mics)) devices.mics = b.mics.slice(0, 20).map((d) => ({ id: String(d.id || '').slice(0, 300), label: String(d.label || 'Microphone').slice(0, 100) }));
    if (b.status) tracker = { running: !!b.status.running, cam: !!b.status.cam, mic: !!b.status.mic, fps: num(b.status.fps, 0, 240, 0), error: String(b.status.error || '').slice(0, 200), at: Date.now() };
    return view();
  }
  const view = () => Object.assign(cfg(), { devices, tracker: Object.assign({}, tracker, { alive: Date.now() - tracker.at < 6000 && Date.now() - lastPose < 6000 }) });
  return { view, configure, pose, report, cfg, DEFAULTS };
};
