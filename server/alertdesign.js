'use strict';
/**
 * Alert Builder designs: an alert laid out on a 1920x1080 canvas from parts (text, shapes, images, video, sound), or raw HTML/CSS/JS.
 * This file only checks and cleans a design that comes from the browser: every number is clamped, every colour, font and animation is
 * whitelisted, and every file must be one the app already knows (the same lists the alert rules use). overlays/alert-design.js draws it.
 */

const W = 1920, H = 1080;
const LIMITS = { designs: 40, templates: 60, themes: 30, fields: 40, parts: 60, text: 300, html: 100000, css: 50000, js: 50000, name: 40 };
const FONTS = ['Bahnschrift', 'Segoe UI', 'Impact', 'Arial Black', 'Arial', 'Georgia', 'Consolas', 'Trebuchet MS', 'Verdana', 'Comic Sans MS'];
const ANIM_IN = ['none', 'fade', 'left', 'right', 'top', 'bottom', 'zoom', 'spin', 'flip', 'wipe'];   // entrance / exit
const ANIM_IDLE = ['none', 'pulse', 'float', 'wiggle', 'glow', 'spin'];                              // loops while the alert is up
const EASES = ['ease-out', 'ease-in-out', 'linear', 'bounce'];
const TYPES = ['text', 'shape', 'image', 'video', 'sound'];
// field types of the StreamElements FIELDS tab (kept so imported widgets show their settings; only the value is used)
const FIELD_TYPES = ['text', 'number', 'slider', 'checkbox', 'dropdown', 'colorpicker', 'image-input', 'googleFont', 'hidden', 'video-input', 'sound-input', 'button'];

const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const pick = (v, list, d) => (list.includes(v) ? v : d);
// a colour is #rrggbb (or #rrggbbaa), or a theme colour written @primary, @accent ... that follows the design's theme
const TOKENS = ['primary', 'secondary', 'accent', 'text', 'bg', 'muted'];
const color = (v, d) => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(v || '')) || (String(v || '')[0] === '@' && TOKENS.includes(String(v).slice(1))) ? String(v) : d);
const DEFAULT_THEME = { colors: { primary: '#4FBBBC', secondary: '#EC4624', accent: '#F39120', text: '#E2DAC2', bg: '#222A2A', muted: '#9aa39f' }, fonts: { heading: 'Bahnschrift', body: 'Bahnschrift' } };
const oneLine = (t, n) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);
// a file name is accepted only if it is in the known list (so a saved design can never point outside the asset folders)
const asset = (v, list) => (v && !String(v).includes('..') && list.includes(v) ? v : '');
const id = (v, pre) => (/^[a-z0-9-]{3,24}$/.test(String(v || '')) ? String(v) : pre + Math.random().toString(36).slice(2, 8));

// entrance, exit and loop settings, the same for every kind of part
function motion(p) {
  const i = p.in || {}, o = p.out || {};
  return {
    in: { a: pick(i.a, ANIM_IN, 'fade'), ms: Math.round(num(i.ms, 0, 5000, 500)), delay: Math.round(num(i.delay, 0, 30000, 0)), ease: pick(i.ease, EASES, 'ease-out') },
    out: { a: pick(o.a, ANIM_IN, 'fade'), ms: Math.round(num(o.ms, 0, 5000, 400)), delay: Math.round(num(o.delay, 0, 30000, 0)), ease: pick(o.ease, EASES, 'ease-out') },
    idle: pick(p.idle, ANIM_IDLE, 'none'),
  };
}

function sanitizePart(p, A) {
  if (!p || typeof p !== 'object' || !TYPES.includes(p.type)) return null;
  const o = Object.assign({
    id: id(p.id, 'p'), type: p.type, name: oneLine(p.name, 30), locked: !!p.locked, group: /^[a-z0-9]{3,12}$/.test(String(p.group || '')) ? p.group : '',
    x: Math.round(num(p.x, -4000, 6000, 0)), y: Math.round(num(p.y, -4000, 6000, 0)), w: Math.round(num(p.w, 1, 6000, 200)), h: Math.round(num(p.h, 1, 6000, 100)),
    rot: num(p.rot, -360, 360, 0), opacity: num(p.opacity, 0, 1, 1),
  }, motion(p));
  if (p.type === 'text') {
    Object.assign(o, {
      text: String(p.text == null ? '' : p.text).slice(0, LIMITS.text), font: pick(p.font, FONTS.concat(['@heading', '@body']), '@body'), size: Math.round(num(p.size, 8, 400, 64)), weight: pick(Number(p.weight), [300, 400, 500, 700, 900], 700),
      italic: !!p.italic, caps: !!p.caps, color: color(p.color, '#E2DAC2'), align: pick(p.align, ['left', 'center', 'right'], 'left'), valign: pick(p.valign, ['top', 'middle', 'bottom'], 'middle'),
      spacing: num(p.spacing, -5, 60, 0), lh: num(p.lh, 0.8, 3, 1.1), shadow: !!p.shadow, shadowColor: color(p.shadowColor, '#000000'),
      stroke: num(p.stroke, 0, 20, 0), strokeColor: color(p.strokeColor, '#000000'), fit: pick(p.fit, ['wrap', 'shrink'], 'wrap'),
    });
  } else if (p.type === 'shape') {
    Object.assign(o, {
      kind: pick(p.kind, ['rect', 'ellipse'], 'rect'), fill: color(p.fill, '#222A2A'), fill2: p.fill2 ? color(p.fill2, '') : '', angle: num(p.angle, 0, 360, 90),
      border: num(p.border, 0, 60, 0), borderColor: color(p.borderColor, '#4FBBBC'), radius: num(p.radius, 0, 3000, 0), skew: num(p.skew, -45, 45, 0),
      glow: num(p.glow, 0, 80, 0), glowColor: color(p.glowColor, '#4FBBBC'), drop: !!p.drop, bevel: !!p.bevel, sheen: !!p.sheen,
    });
  } else if (p.type === 'image') {
    Object.assign(o, { tint: color(p.tint, ''), src: asset(p.src, A.images), fit: pick(p.fit, ['contain', 'cover', 'fill'], 'contain'), radius: num(p.radius, 0, 3000, 0), pixel: !!p.pixel });
  } else if (p.type === 'video') {
    Object.assign(o, { src: asset(p.src, A.videos), fit: pick(p.fit, ['contain', 'cover', 'fill'], 'contain'), radius: num(p.radius, 0, 3000, 0), loop: !!p.loop, volume: Math.round(num(p.volume, 0, 100, 0)) });
  } else {
    Object.assign(o, { src: asset(p.src, A.sounds), volume: Math.round(num(p.volume, 0, 100, 60)) });
  }
  return o;
}

// {name: {type, label, value}} from a StreamElements-style fields JSON: short plain values only
function sanitizeFields(f) {
  const out = {};
  if (!f || typeof f !== 'object' || Array.isArray(f)) return out;
  for (const k of Object.keys(f).slice(0, LIMITS.fields)) {
    const v = f[k]; if (!/^\w{1,40}$/.test(k) || !v || typeof v !== 'object') continue;
    const val = v.value;
    out[k] = { type: pick(v.type, FIELD_TYPES, 'text'), label: oneLine(v.label, 60), value: typeof val === 'number' || typeof val === 'boolean' ? val : String(val == null ? '' : val).slice(0, 200) };
  }
  return out;
}
const sanitizeParts = (list, A) => (Array.isArray(list) ? list : []).slice(0, LIMITS.parts).map((p) => sanitizePart(p, A)).filter(Boolean);

// the theme: six colours and two fonts that parts using @colors and @fonts follow
function sanitizeTheme(t) {
  t = t && typeof t === 'object' ? t : {}; const out = { colors: {}, fonts: {} };
  for (const k of TOKENS) out.colors[k] = /^#[0-9a-f]{6}$/i.test(String(t.colors && t.colors[k] || '')) ? t.colors[k] : DEFAULT_THEME.colors[k];
  for (const k of ['heading', 'body']) out.fonts[k] = pick(t.fonts && t.fonts[k], FONTS, DEFAULT_THEME.fonts[k]);
  return out;
}

/** Clean a design from the editor. assets = { images, sounds, videos } (the names the app knows). Throws on something that cannot be saved. */
function sanitize(b, A) {
  if (!b || typeof b !== 'object') throw new Error('No design');
  const mode = b.mode === 'html' ? 'html' : 'builder';
  const html = String(b.html == null ? '' : b.html), css = String(b.css == null ? '' : b.css), js = String(b.js == null ? '' : b.js);
  if (html.length > LIMITS.html) throw new Error('The HTML is over ' + LIMITS.html / 1000 + ' KB');
  if (css.length > LIMITS.css) throw new Error('The CSS is over ' + LIMITS.css / 1000 + ' KB');
  if (js.length > LIMITS.js) throw new Error('The JavaScript is over ' + LIMITS.js / 1000 + ' KB');
  const parts = sanitizeParts(b.parts, A);
  const seen = new Set(); for (const p of parts) { while (seen.has(p.id)) p.id = id('', 'p'); seen.add(p.id); }   // part ids must be unique
  return { id: id(b.id, 'd-'), name: oneLine(b.name, LIMITS.name) || 'My alert', mode, w: W, h: H, seconds: Math.round(num(b.seconds, 2, 30, 8)), parts, html, css, js, fields: sanitizeFields(b.fields), theme: sanitizeTheme(b.theme), outMs: Math.round(num(b.outMs, 0, 5000, 500)) };
}

/** The values a design may use as {name}, {amount}, ...: only the variables of that event, as short plain strings. */
function vars(ev, v) {
  const o = {};
  for (const k of (ev && ev.vars) || []) o[k] = v && v[k] != null ? String(v[k]).slice(0, 200) : '';
  return o;
}

module.exports = { sanitize, sanitizeParts, sanitizeFields, sanitizeTheme, TOKENS, DEFAULT_THEME, vars, FIELD_TYPES, LIMITS, FONTS, ANIM_IN, ANIM_IDLE, EASES, TYPES, W, H };
