'use strict';
/**
 * The room behind the avatar (three to choose from: the streamer's room, a cosy room, a cyber room). The streamer's room is a wall with acoustic panels, a neon sign, framed posters, shelves with books, plants, figures and a console,
 * and RGB light strips that cycle through the rainbow. Drawn at 192x108 (16:9, like the webcam windows in the scenes) "pixels"; the renderer blurs it a little so the avatar stands out (like a camera's shallow focus).
 * AvatarRoom.create() -> { draw(t, style) -> canvas }
 */
(function (root, factory) { root.AvatarRoom = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const W = 192, H = 108;
  // a tiny 3x5 font for the neon sign (rows top to bottom, # = lit)
  const GLYPH = (() => {
    const g = {
      A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
      G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'], J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
      M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
      S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
      Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
      0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'], 3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
      6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '##.'], '!': ['.#.', '.#.', '.#.', '...', '.#.'], '?': ['##.', '..#', '.#.', '...', '.#.'], '-': ['...', '...', '###', '...', '...'], ' ': ['...', '...', '...', '...', '...'],
    };
    return g;
  })();
  const hsl = (h, s, l, a) => 'hsla(' + (((h % 360) + 360) % 360).toFixed(0) + ',' + s + '%,' + l + '%,' + (a == null ? 1 : a) + ')';
  const mix = (a, b, f) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), c = (s) => Math.round(((pa >> s) & 255) * (1 - f) + ((pb >> s) & 255) * f); return '#' + [16, 8, 0].map((s) => c(s).toString(16).padStart(2, '0')).join(''); };
  const hexHue = (hex) => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };

  function create() {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // the books on each shelf are chosen once, so they do not change from frame to frame
    const SHELF_BOOKS = [0, 1, 2].map(() => { const list = []; let x = 0; while (x < 24) { const w = 3 + Math.floor(rnd() * 2), h = 10 + Math.floor(rnd() * 7); list.push({ x, w, h, hue: Math.floor(rnd() * 360), lean: rnd() < 0.12 }); x += w + 1; } return list; });
    const accent = (rgb, t, pos) => (rgb === 'off' ? 'hsla(220,10%,35%,1)' : rgb === 'rainbow' ? hsl(t * 70 + pos * 2.6, 95, 62) : hsl(hexHue(rgb) + Math.sin(t * 1.6 + pos * 0.12) * 14, 92, 60 + Math.sin(t * 1.2) * 6));
    const spill = (rgb, t, pos) => (rgb === 'off' ? 'hsla(220,10%,40%,0.0)' : rgb === 'rainbow' ? hsl(t * 70 + pos * 2.6, 95, 60, 0.16) : hsl(hexHue(rgb), 92, 60, 0.16));

    function strip(x, y, len, vertical, rgb, t) {   // an RGB light strip: a glowing line, with a soft light on the wall beside it
      for (let i = 0; i < len; i++) { const col = accent(rgb, t, x + y + i); if (vertical) { px(x, y + i, 1, 1, col); px(x - 1, y + i, 1, 1, spill(rgb, t, x + y + i)); px(x + 1, y + i, 1, 1, spill(rgb, t, x + y + i)); } else { px(x + i, y, 1, 1, col); px(x + i, y + 1, 1, 1, spill(rgb, t, x + y + i)); px(x + i, y - 1, 1, 1, spill(rgb, t, x + y + i)); } }
    }
    function plant(x, y, hue) {   // a potted plant: pot, stem, leaves
      px(x - 3, y - 5, 7, 5, '#b5654a'); px(x - 3, y - 5, 7, 1, '#d0805f'); px(x - 2, y, 5, 1, '#8d4b36');
      for (const [dx, dy, w, h] of [[-5, -13, 4, 3], [2, -14, 4, 3], [-2, -17, 4, 4], [-6, -9, 4, 3], [3, -9, 4, 3], [-1, -11, 3, 6]]) { px(x + dx, y + dy, w, h, hsl(hue, 45, 38)); px(x + dx, y + dy, w, 1, hsl(hue, 50, 50)); }
    }
    function figure(x, y, hue) {   // a collectible figure with an oversized head
      px(x - 3, y - 4, 7, 4, hsl(hue + 180, 50, 45)); px(x - 4, y - 11, 9, 8, '#f1d5b3'); px(x - 4, y - 12, 9, 3, hsl(hue, 60, 35)); px(x - 2, y - 8, 1, 2, '#222'); px(x + 2, y - 8, 1, 2, '#222'); px(x - 4, y - 11, 1, 8, '#d9b995');
    }
    function console_(x, y, rgb, t) { px(x - 7, y - 5, 14, 5, '#1c1f26'); px(x - 7, y - 5, 14, 1, '#2f3542'); px(x + 3, y - 3, 3, 1, accent(rgb, t, x)); px(x - 6, y - 3, 6, 1, '#10131a'); }
    function playButton(x, y) { px(x - 7, y - 14, 15, 12, '#8a6b1f'); px(x - 6, y - 13, 13, 10, '#e6b93a'); px(x - 6, y - 13, 13, 2, '#f5d878'); px(x - 2, y - 11, 5, 6, '#fff3c4'); px(x - 1, y - 10, 3, 4, '#c8302b'); px(x, y - 9, 2, 2, '#fff3c4'); px(x - 4, y - 2, 9, 2, '#6b4f13'); }
    function pad(x, y) { px(x - 6, y - 4, 13, 4, '#2b2f3a'); px(x - 6, y - 5, 4, 1, '#2b2f3a'); px(x + 3, y - 5, 4, 1, '#2b2f3a'); px(x - 4, y - 3, 3, 1, '#9aa'); px(x + 3, y - 3, 1, 1, '#e44'); px(x + 5, y - 3, 1, 1, '#4c4'); }
    function mug(x, y) { px(x - 2, y - 5, 5, 5, '#e8e1d0'); px(x + 3, y - 4, 2, 3, '#e8e1d0'); px(x - 2, y - 5, 5, 1, '#6b3a2a'); }
    function frame(x, y, w, h, kind) {
      px(x - 1, y - 1, w + 2, h + 2, '#2a2118'); px(x, y, w, h, '#0f1220');
      if (kind === 0) { for (let i = 0; i < h; i++) px(x, y + i, w, 1, mix('#ff7a59', '#3b2a6e', i / h)); px(x + 2, y + h - 7, w - 4, 7, '#1a1230'); px(x + 4, y + h - 10, 6, 3, '#1a1230'); px(x + w - 8, y + 3, 4, 4, '#ffe08a'); }
      else { px(x + 2, y + 2, w - 4, h - 4, '#111a2b'); for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) px(x + 3 + q * 4, y + 4 + r * 4, 2, 2, ['#5ef2b0', '#f25ea1', '#5ec8f2'][r]); px(x + 6, y + h - 6, 6, 2, '#5ef2b0'); }
    }
    function neon(text, x, y, rgb, t) {
      text = String(text || 'LIVE').toUpperCase().replace(/[^A-Z0-9 !?-]/g, '').slice(0, 9) || 'LIVE'; const col = rgb === 'off' ? '#9aa4c0' : rgb === 'rainbow' ? hsl(300 + Math.sin(t * 0.5) * 40, 100, 70) : hsl(hexHue(rgb), 100, 70), glow = rgb === 'off' ? 'rgba(150,160,190,0.18)' : rgb === 'rainbow' ? hsl(300 + Math.sin(t * 0.5) * 40, 100, 60, 0.22) : hsl(hexHue(rgb), 100, 60, 0.22);
      const flick = Math.sin(t * 23) * Math.sin(t * 7.3) > 0.93 ? 0.35 : 1, w = text.length * 4 - 1; c.globalAlpha = flick;
      px(x - 3, y - 3, w + 6, 11, 'rgba(0,0,0,0.28)');   // the sign's backing
      let cx = x; for (const ch of text) { const g = GLYPH[ch] || GLYPH[' ']; for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r][q] === '#') { px(cx + q - 1, y + r * 1.0 - 1, 3, 3, glow); } cx += 4; }
      cx = x; for (const ch of text) { const g = GLYPH[ch] || GLYPH[' ']; for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r][q] === '#') px(cx + q, y + r, 1, 1, col); cx += 4; }
      c.globalAlpha = 1;
    }

    const wall = (c0, c1, mid) => { for (let y = 0; y < H; y++) px(0, y, W, 1, mix(c0, c1, 1 - Math.min(1, Math.abs(y - mid) / 60))); };
    const vignette = (a) => { const v = c.createRadialGradient(W / 2, H * 0.5, H * 0.35, W / 2, H * 0.5, W * 0.62); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,' + a + ')'); c.fillStyle = v; c.fillRect(0, 0, W, H); };
    const glow = (x, y, r, col) => { const g = c.createRadialGradient(x, y, 1, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); };
    const stars = (t, n, y1) => { let s2 = 5; for (let i = 0; i < n; i++) { s2 = (s2 * 16807) % 2147483647; const x = s2 % W, y = (s2 >> 4) % y1; if (Math.sin(t * 2 + i * 1.7) > -0.3) px(x, y, 1, 1, i % 3 ? '#cfd8ff' : '#fff2c0'); } };
    const blobShade = (x, y, w, h) => { for (let i = 0; i < h; i++) { const inset = Math.round(i * 0.3); px(x + inset, y + i, w - inset * 2, 1, mix('#f4d9a0', '#d89a4a', i / h)); } };

    // ---- 1. the streamer's room: foam panels, neon sign, posters, shelves with books, plants and a console, and RGB strips
    function streamer(t, st, rgb) {
      wall('#14172a', '#221f3d', 46);
      for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) { const x = 4 + gx * 9, y = 22 + gy * 9; px(x, y, 8, 8, (gx + gy) % 2 ? '#1c2236' : '#1f2640'); px(x, y, 8, 1, '#262e4d'); px(x + 2, y + 3, 4, 2, 'rgba(0,0,0,0.22)'); }
      neon(st.neon, 10, 9, rgb, t); frame(8, 62, 16, 20, 0); frame(30, 66, 12, 14, 1);
      const X = 146; px(X - 2, 10, 2, 88, '#2b211b'); px(X + 44, 10, 2, 88, '#2b211b');
      [34, 60, 86].forEach((y, i) => {
        px(X - 2, y, 48, 3, '#4a362b'); px(X - 2, y, 48, 1, '#6b4f3f'); strip(X, y + 3, 44, false, rgb, t);
        if (i === 0) { for (const b of SHELF_BOOKS[0]) { px(X + 1 + b.x, y - b.h, b.w, b.h, hsl(b.hue, 45, 42)); px(X + 1 + b.x, y - b.h, b.w, 1, hsl(b.hue, 50, 55)); px(X + 1 + b.x, y - b.h + 3, b.w, 1, 'rgba(255,255,255,0.25)'); } plant(X + 36, y, 130); }
        if (i === 1) { figure(X + 6, y, 20); console_(X + 22, y, rgb, t); mug(X + 37, y); }
        if (i === 2) { playButton(X + 9, y); pad(X + 27, y); plant(X + 38, y, 95); }
      });
      strip(0, 2, W, false, rgb, t); strip(W - 3, 6, 88, true, rgb, t); strip(2, 6, 88, true, rgb, t);
      glow(X + 22, 60, 44, rgb === 'off' ? 'rgba(0,0,0,0)' : spill(rgb, t, 90));
      px(0, 98, W, 10, '#141020'); px(0, 98, W, 1, '#2a2240'); vignette(0.5);
    }
    // ---- 2. a cosy room: a window on a night city, fairy lights, a lamp, plants and a bookshelf
    function cozy(t, st, rgb) {
      wall('#2b1f2c', '#3d2c36', 50);
      for (let x = 0; x < W; x += 6) px(x, 0, 1, 98, 'rgba(255,255,255,0.025)');
      const wx = 14, wy = 14, ww = 46, wh = 52; px(wx - 2, wy - 2, ww + 4, wh + 4, '#4a362b'); for (let y = 0; y < wh; y++) px(wx, wy + y, ww, 1, mix('#0b1030', '#3a2a5e', y / wh));
      px(wx + 31, wy + 6, 7, 7, '#fff3c4'); px(wx + 33, wy + 5, 5, 7, '#0b1030'); px(wx + 32, wy + 6, 5, 7, '#fff3c4');
      c.save(); c.beginPath(); c.rect(wx, wy, ww, wh); c.clip(); stars(t, 40, 90);
      for (let i = 0; i < 9; i++) { const bx = wx + i * 5.2, bh = 10 + ((i * 7) % 16); px(bx, wy + wh - bh, 6, bh, '#12142a'); for (let k = 0; k < 4; k++) if ((i * 3 + k * 5 + Math.floor(t / 4)) % 4 < 2) px(bx + 1 + (k % 2) * 2, wy + wh - bh + 2 + k * 3, 1, 1, '#ffd27a'); }
      c.restore(); px(wx + ww / 2 - 1, wy, 2, wh, '#4a362b'); px(wx, wy + wh / 2, ww, 2, '#4a362b'); px(wx - 4, wy + wh + 2, ww + 8, 3, '#5a4437');
      px(wx - 6, wy - 3, 6, wh + 8, '#8a3b4e'); px(wx + ww, wy - 3, 6, wh + 8, '#8a3b4e'); for (let y = 0; y < wh + 8; y += 3) { px(wx - 6, wy - 3 + y, 1, 2, '#6b2b3a'); px(wx + ww + 5, wy - 3 + y, 1, 2, '#6b2b3a'); }
      for (let i = 0; i < 24; i++) { const x = 4 + i * 8, y = 4 + Math.round(Math.sin(i / 24 * Math.PI * 3) * 3) + (i % 2) * 2, on = Math.sin(t * 1.6 + i) > -0.2; px(x - 2, y - 1, 5, 1, '#3a3036'); px(x, y, 2, 2, on ? '#ffd27a' : '#a88a4a'); if (on) px(x - 1, y - 1, 4, 4, 'rgba(255,210,122,0.10)'); }
      px(144, 24, 40, 3, '#5a4437'); px(144, 24, 40, 1, '#7b5e4d'); for (const b of SHELF_BOOKS[1].slice(0, 5)) px(147 + b.x, 24 - b.h + 3, b.w, b.h - 3, hsl(b.hue, 40, 40)); plant(178, 24, 120);
      px(144, 58, 40, 3, '#5a4437'); px(144, 58, 40, 1, '#7b5e4d'); figure(152, 58, 40); mug(166, 58); plant(176, 58, 100);
      px(168, 64, 2, 30, '#3a3036'); px(160, 62, 18, 2, '#3a3036'); blobShade(158, 44, 22, 14); glow(168, 54, 36, 'rgba(255,196,110,0.28)');
      plant(135, 98, 140); px(0, 98, W, 10, '#241a22'); px(0, 98, W, 1, '#3d2c36'); strip(0, 96, W, false, rgb === 'rainbow' ? '#ffb45e' : rgb, t); vignette(0.5);
    }
    // ---- 3. a cyber room: a neon sign, tube lights, a rain-lit skyline in a wide window and a grid on the wall
    function cyber(t, st, rgb) {
      wall('#0b0d1f', '#15122e', 44); for (let x = 0; x < W; x += 12) px(x, 0, 1, 98, 'rgba(120,140,255,0.07)'); for (let y = 6; y < 98; y += 12) px(0, y, W, 1, 'rgba(120,140,255,0.07)');
      const wx = 120, wy = 18, ww = 66, wh = 52; for (let y = 0; y < wh; y++) px(wx, wy + y, ww, 1, mix('#1b0f3a', '#5a1f5e', y / wh));
      for (let i = 0; i < 13; i++) { const bx = wx + i * 5, bh = 12 + ((i * 11) % 26), col = ['#10122a', '#14173a', '#0d0f22'][i % 3]; px(bx, wy + wh - bh, 5, bh, col); for (let k = 0; k < 6; k++) if ((i * 5 + k * 7 + Math.floor(t * 2)) % 5 < 2) px(bx + 1 + (k % 2) * 2, wy + wh - bh + 2 + k * 4, 1, 1, ['#5ef2ff', '#ff5ea1', '#ffd27a'][(i + k) % 3]); }
      for (let i = 0; i < 22; i++) { const x = wx + ((i * 37 + Math.floor(t * 40)) % ww), y = wy + ((i * 53 + Math.floor(t * 70)) % wh); px(x, y, 1, 3, 'rgba(160,200,255,0.35)'); }
      px(wx - 1, wy - 1, ww + 2, 1, '#2a2a4a'); px(wx - 1, wy + wh, ww + 2, 1, '#2a2a4a'); px(wx - 1, wy - 1, 1, wh + 2, '#2a2a4a'); px(wx + ww, wy - 1, 1, wh + 2, '#2a2a4a'); px(wx + ww / 2, wy, 1, wh, '#2a2a4a');
      neon(st.neon, 14, 12, rgb === 'rainbow' ? '#ff4fa0' : rgb, t);
      const tube = (x, y, w, h, col) => { px(x - 1, y - 1, w + 2, h + 2, 'rgba(255,255,255,0.08)'); px(x, y, w, h, col); px(x, y, w, 1, 'rgba(255,255,255,0.6)'); };
      const a = rgb === 'off' ? '#7a84a8' : rgb === 'rainbow' ? hsl(180 + Math.sin(t * 0.6) * 30, 100, 62) : accent(rgb, t, 0), b = rgb === 'off' ? '#7a84a8' : rgb === 'rainbow' ? hsl(320 + Math.sin(t * 0.6 + 1) * 30, 100, 64) : accent(rgb, t, 30);
      tube(12, 34, 2, 44, a); tube(20, 40, 24, 2, b); tube(20, 58, 24, 2, b); tube(20, 40, 2, 20, b); tube(42, 40, 2, 20, b); tube(30, 46, 4, 8, a);
      strip(0, 2, W, false, rgb, t); strip(W - 3, 6, 88, true, rgb, t); strip(2, 6, 88, true, rgb, t); strip(110, 76, 80, false, rgb, t);
      glow(150, 50, 60, rgb === 'off' ? 'rgba(0,0,0,0)' : spill(rgb, t, 40)); px(0, 98, W, 10, '#0c0a18'); px(0, 98, W, 1, '#251d44'); vignette(0.55);
    }
    function draw(t, st) { st = st || {}; const rgb = st.rgb || 'rainbow', room = st.room === 'cozy' ? cozy : st.room === 'cyber' ? cyber : streamer; room(t, st, rgb); return cv; }
    return { draw, W, H };
  }
  return { create, W, H };
});
