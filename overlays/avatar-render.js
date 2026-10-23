'use strict';
/**
 * Draws the pixel avatar from a pose (see avatar-core.js). Everything is drawn at 80x96 "pixels" and scaled up with hard edges.
 * AvatarRender.create(canvas) -> { draw(pose, style) }
 */
(function (root, factory) { root.AvatarRender = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const W = 80, H = 96, CX = 40;
  const DEFAULT_STYLE = { skin: '#E8B88F', hair: '#3b2a22', hairStyle: 'short', eyes: '#2e86c1', shirt: '#4FBBBC', glasses: false, headphones: false, blush: true, bg: 'transparent', outline: '#1A2020' };
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16), c = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join(''); };

  function create(canvas) {
    const lo = document.createElement('canvas'), hd = document.createElement('canvas'); lo.width = hd.width = W; lo.height = hd.height = H;
    const L = lo.getContext('2d'), Hd = hd.getContext('2d'), out = canvas.getContext('2d');
    let C = Hd;
    const px = (x, y, w, h, col) => { C.fillStyle = col; C.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
    /** a rounded block, built row by row so the corners are stepped like pixel art */
    function blob(x, y, w, h, r, col) { for (let i = 0; i < h; i++) { const d = i < r ? r - i : i >= h - r ? i - (h - r - 1) : 0, inset = d ? Math.round(r - Math.sqrt(Math.max(0, r * r - (d - 0.5) * (d - 0.5)))) : 0; px(x + inset, y + i, w - inset * 2, 1, col); } }

    function draw(p, st) {
      st = Object.assign({}, DEFAULT_STYLE, st); const skin = st.skin, skinD = shade(skin, 0.82), skinL = shade(skin, 1.08), hair = st.hair, hairD = shade(hair, 0.7), hairL = shade(hair, 1.35), ol = st.outline;
      const yaw = p.yaw, pitch = p.pitch, bob = Math.round((p.breath || 0) * 0.8), fx = Math.round(yaw * 5), fy = Math.round(pitch * 3), sx = Math.round(yaw * 1.5);
      // ---- body (does not turn with the head, only breathes)
      C = L; L.clearRect(0, 0, W, H);
      if (st.hairStyle === 'long') { blob(CX - 20, 40, 40, 50, 8, hairD); }
      blob(CX - 28, 74 + bob, 56, 30, 9, ol); blob(CX - 27, 75 + bob, 54, 30, 8, st.shirt); px(CX - 27, 90 + bob, 54, 1, shade(st.shirt, 0.85)); px(CX - 22, 77 + bob, 8, 1, shade(st.shirt, 1.2));
      px(CX - 5 + Math.round(yaw * 1), 68 + bob, 10, 9, ol); px(CX - 4 + Math.round(yaw * 1), 68 + bob, 8, 8, skinD); px(CX - 7, 74 + bob, 14, 3, shade(st.shirt, 0.8));
      // ---- head (drawn on its own so it can tilt as one piece)
      C = Hd; Hd.clearRect(0, 0, W, H);
      const hw = 34 - Math.round(Math.abs(yaw) * 3), hx = CX - Math.round(hw / 2) + sx, hy = 22 + Math.round(pitch * 1), hh = 40;
      if (st.hairStyle === 'long') { blob(hx - 4, hy + 2, hw + 8, 44, 9, ol); blob(hx - 3, hy + 3, hw + 6, 43, 9, hairD); }
      if (st.hairStyle === 'bun') { blob(CX - 7 + Math.round(yaw * 3), hy - 12, 14, 12, 5, ol); blob(CX - 6 + Math.round(yaw * 3), hy - 11, 12, 10, 4, hair); }
      // ears (the far one hides when the head is turned)
      const earY = hy + 17;
      if (yaw < 0.55) { px(hx - 3, earY, 4, 8, ol); px(hx - 2, earY + 1, 3, 6, skinD); }
      if (yaw > -0.55) { px(hx + hw - 1, earY, 4, 8, ol); px(hx + hw - 1, earY + 1, 3, 6, skinD); }
      blob(hx - 1, hy - 1, hw + 2, hh + 2, 11, ol); blob(hx, hy, hw, hh, 10, skin);
      px(hx + 3, hy + hh - 6, hw - 6, 2, skinL);   // a light chin
      // ---- face
      const ex = 5.5 * (1 - Math.abs(yaw) * 0.22), ey = hy + 18 + fy, gx = Math.round(p.gazeX * 2), gy = Math.round(p.gazeY * 1);
      const later = [], eye = (cx, blink, brow, side) => {
        const open = Math.round((1 - Math.min(1, blink)) * 7), x0 = Math.round(cx - 4);
        if (open <= 1) { px(x0, ey + 3, 8, 1, ol); px(x0 + 1, ey + 4, 6, 1, shade(skin, 0.7)); }   // shut: a curved line with a lash shadow
        else {
          px(x0, ey + 1, 8, open + 1, ol); px(x0 + 1, ey + 2, 6, Math.max(1, open - 1), '#f4f1ea');
          const pxx = x0 + 3 + gx + Math.round(yaw * 0.5), pyy = ey + 2 + Math.max(0, Math.round((open - 3) / 2)) + gy; px(Math.max(x0 + 1, Math.min(x0 + 5, pxx)), Math.min(ey + 1 + open - 2, pyy), 3, Math.min(3, open - 1), st.eyes); px(Math.max(x0 + 1, Math.min(x0 + 5, pxx)) + 1, Math.min(ey + 1 + open - 2, pyy), 1, 1, '#0d1212');
          if (open > 3) px(Math.max(x0 + 1, Math.min(x0 + 5, pxx)), Math.min(ey + 1 + open - 2, pyy), 1, 1, '#ffffff');
          px(x0, ey, 8, 1, ol); if (blink > 0.15) px(x0 + 1, ey + 1, 6, Math.round(blink * 3), skin);   // the lid comes down over the white
        }
        const by = ey - 5 - Math.round(brow * 3);   // eyebrows: raised, lowered, or knitted when well down
        later.push(() => { px(x0 - 1, by, 3, 2, hairD); px(x0 + 2, by + (brow < -0.35 ? 1 : 0), 3, 2, hairD); px(x0 + 5, by + (brow < -0.35 ? 1 : 0) + (brow > 0.4 ? -1 : 0), 3, 2, hairD); });   // drawn after the hair, so the fringe never hides them
      };
      const lx = CX + fx - ex - 1.5 + 0, rx = CX + fx + ex + 1.5;
      eye(lx, p.blinkL, p.browL, -1); eye(rx, p.blinkR, p.browR, 1);
      if (st.blush) { px(lx - 3, ey + 9, 4, 2, '#e8908f'); px(rx, ey + 9, 4, 2, '#e8908f'); }
      px(CX + Math.round(fx * 1.5) - 1, ey + 7, 2, 3, skinD); px(CX + Math.round(fx * 1.5) - 1, ey + 10, 3, 1, shade(skin, 0.7));   // nose
      // mouth: a smile line, or an opening shaped by "ah" (wide) .. "oo" (round)
      const my = hy + 33 + fy, mx = CX + Math.round(fx * 1.2), m = p.mouth, rnd = p.round, sm = p.smile;
      if (m < 0.12) {
        const w = 8 + Math.round(sm * 2); px(mx - w / 2, my + 1, w, 1, '#7a3b3b'); if (sm > 0.25) { px(mx - w / 2 - 1, my, 1, 1, '#7a3b3b'); px(mx + w / 2, my, 1, 1, '#7a3b3b'); if (sm > 0.7) { px(mx - w / 2, my + 2, w, 1, '#7a3b3b'); } } else if (sm < -0.3) { px(mx - w / 2 - 1, my + 2, 1, 1, '#7a3b3b'); px(mx + w / 2, my + 2, 1, 1, '#7a3b3b'); }
      } else {
        const mh = 2 + Math.round(m * 8), mw = Math.round((9 + Math.max(0, sm) * 3) * (1 - rnd * 0.45)); const x0 = Math.round(mx - mw / 2);
        px(x0 - 1, my, mw + 2, mh + 2, '#4a1a20'); px(x0, my + 1, mw, mh, '#6b232b');
        if (rnd < 0.55 && mh >= 3) px(x0 + 1, my + 1, mw - 2, 2, '#f4f1ea');   // top teeth
        if (mh >= 6) px(x0 + 2, my + mh - 1, Math.max(2, mw - 4), 2, '#d96a78');   // tongue
        if (rnd > 0.6) { px(x0 - 1, my + 1, 1, mh, '#4a1a20'); }
      }
      // ---- hair: a cap, side locks and a fringe, shifted a bit more than the face so a turn looks round
      const hs = Math.round(yaw * 2.5), hw2 = hw + 4, hxx = hx - 2 + hs, top = hy - 4;
      if (st.hairStyle !== 'none') {
        blob(hxx - 1, top - 1, hw2 + 2, 24, 11, ol); blob(hxx, top, hw2, 22, 10, hair); px(hxx + 6, top + 2, hw2 - 16, 2, hairL);
        px(hxx, top + 10, 5, 16, hair); px(hxx + hw2 - 5, top + 10, 5, 16, hair);                 // sideburns
        px(hxx + 5, top + 17, hw2 - 10, 8, skin);                                                // the forehead showing under the fringe
        for (let i = 0; i < hw2 - 10; i += 3) px(hxx + 5 + i, top + 13 + ((i / 3) % 2) * 2, 3, 3 + ((i / 3) % 2), hair);   // fringe teeth
      }
      later.forEach((f) => f());
      if (st.headphones) { px(hxx - 1, top + 1, hw2 + 2, 3, '#2a3434'); px(hx - 6, earY - 2, 6, 12, '#2a3434'); px(hx - 6, earY - 2, 2, 12, st.shirt); px(hx + hw, earY - 2, 6, 12, '#2a3434'); px(hx + hw + 4, earY - 2, 2, 12, st.shirt); }
      if (st.glasses) { for (const x of [lx, rx]) { px(x - 6, ey - 1, 12, 1, '#222'); px(x - 6, ey + 9, 12, 1, '#222'); px(x - 6, ey - 1, 1, 11, '#222'); px(x + 5, ey - 1, 1, 11, '#222'); } px(lx + 5, ey + 3, rx - lx - 10, 1, '#222'); }
      // ---- put the head on the body, tilted (in steps, so it stays chunky)
      C = L; const ang = Math.round(p.roll * 0.32 / 0.045) * 0.045; L.save(); L.imageSmoothingEnabled = false; L.translate(CX, 70 + bob); L.rotate(ang); L.translate(-CX, -(70 + bob)); L.drawImage(hd, 0, bob); L.restore();
      // ---- to the screen, scaled up by whole steps where it fits
      const s = Math.max(1, Math.min(canvas.width / W, canvas.height / H)), sc = s >= 2 ? Math.floor(s) : s, dw = W * sc, dh = H * sc;
      out.imageSmoothingEnabled = false; out.clearRect(0, 0, canvas.width, canvas.height);
      if (st.bg && st.bg !== 'transparent') { out.fillStyle = st.bg; out.fillRect(0, 0, canvas.width, canvas.height); }
      out.drawImage(lo, Math.round((canvas.width - dw) / 2), Math.round(canvas.height - dh), dw, dh);
    }
    return { draw, W, H };
  }
  return { create, DEFAULT_STYLE, W, H };
});
