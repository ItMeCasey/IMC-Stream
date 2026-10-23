'use strict';
/**
 * Draws the pixel avatar from a pose (see avatar-core.js), in front of the blurred room (avatar-room.js).
 * The avatar is drawn at 80x96 "pixels" and scaled up with hard edges; the room is softened to look like a camera with a shallow focus.
 * AvatarRender.create(canvas) -> { draw(pose, style, seconds) }
 */
(function (root, factory) { root.AvatarRender = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const W = 80, H = 96, CX = 40;
  const DEFAULT_STYLE = { skin: '#E8B88F', hair: '#3b2a22', hairStyle: 'short', eyes: '#2e86c1', shirt: '#4FBBBC', outfit: 'hoodie', glasses: false, headphones: false, blush: true, gender: 'neutral', facialHair: 'none', lips: '#b9575c', bg: 'transparent', room: 'room', blur: 4, rgb: 'rainbow', neon: '', zoom: 1.4, pets: [], petFreq: 'normal' };
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16), c = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join(''); };
  const mixHex = (a, b, f) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), c = (s) => Math.round(((pa >> s) & 255) * (1 - f) + ((pb >> s) & 255) * f); return '#' + [16, 8, 0].map((s) => c(s).toString(16).padStart(2, '0')).join(''); };
  const hueOf = (hex) => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; return 60 * (mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4); };
  const accentOf = (rgb, t) => (rgb === 'off' ? 'hsl(220,10%,45%)' : rgb === 'rainbow' ? 'hsl(' + Math.round((t * 70) % 360) + ',95%,62%)' : 'hsl(' + Math.round(hueOf(rgb)) + ',92%,62%)');

  function create(canvas) {
    const lo = document.createElement('canvas'), hd = document.createElement('canvas'); lo.width = hd.width = W; lo.height = hd.height = H;
    const L = lo.getContext('2d'), Hd = hd.getContext('2d'), out = canvas.getContext('2d'), room = (typeof AvatarRoom !== 'undefined') ? AvatarRoom.create() : null, pets = (typeof AvatarPets !== 'undefined') ? AvatarPets.create() : null; let lastT = null;
    let C = Hd;
    const px = (x, y, w, h, col) => { C.fillStyle = col; C.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
    /** a rounded block, built row by row so the corners are stepped like pixel art */
    function blob(x, y, w, h, r, col) { for (let i = 0; i < h; i++) { const d = i < r ? r - i : i >= h - r ? i - (h - r - 1) : 0, inset = d ? Math.round(r - Math.sqrt(Math.max(0, r * r - (d - 0.5) * (d - 0.5)))) : 0; px(x + inset, y + i, w - inset * 2, 1, col); } }

    function draw(p, st, t) {
      st = Object.assign({}, DEFAULT_STYLE, st); t = t || 0;
      const skin = st.skin, skinD = shade(skin, 0.86), skinDD = shade(skin, 0.7), skinL = shade(skin, 1.1), skinOl = shade(skin, 0.45);
      const hair = st.hair, hairD = shade(hair, 0.72), hairDD = shade(hair, 0.48), hairL = shade(hair, 1.45), hairLL = shade(hair, 2.0), shirtD = shade(st.shirt, 0.8), shirtOl = shade(st.shirt, 0.42), shirtL = shade(st.shirt, 1.2), accent = accentOf(st.rgb, t);
      const fem = st.gender === 'feminine', masc = st.gender === 'masculine', lipC = /^#[0-9a-f]{6}$/i.test(st.lips) ? st.lips : '#b9575c', sw = fem ? 27 : masc ? 31 : 29;
      const yaw = p.yaw, pitch = p.pitch, bob = Math.round((p.breath || 0) * 0.8), fx = Math.round(yaw * 5), fy = Math.round(pitch * 3), sx = Math.round(yaw * 1.5);
      // ---------------------------------------------------------------- body (does not turn with the head, only breathes)
      C = L; L.clearRect(0, 0, W, H);
      if (st.hairStyle === 'long') blob(CX - 20, 40, 40, 50, 8, hairDD), blob(CX - 19, 41, 38, 49, 8, hairD);
      const by = 74 + bob, nw = masc ? 12 : fem ? 8 : 10, skinB = [skinOl, skinD];
      const outfit = ['hoodie', 'tee', 'collared', 'tank', 'turtleneck'].includes(st.outfit) ? st.outfit : 'hoodie', neckX = CX - nw / 2 + Math.round(yaw);
      if (outfit === 'hoodie') { blob(CX - 15, by - 8, 30, 14, 6, shirtOl); blob(CX - 14, by - 7, 28, 13, 5, shirtD); }   // the hood, down behind the neck
      if (outfit === 'tank') {   // bare shoulders, then the top with its straps
        blob(CX - sw, by, sw * 2, 32, 10, skinOl); blob(CX - sw + 1, by + 1, sw * 2 - 2, 31, 9, skin); px(CX - sw + 4, by + 2, 8, 1, skinL); px(CX + sw - 12, by + 2, 8, 1, skinL);
        blob(CX - sw + 5, by + 9, sw * 2 - 10, 24, 7, shirtOl); blob(CX - sw + 6, by + 10, sw * 2 - 12, 23, 6, st.shirt); px(CX - 15, by + 2, 8, 9, shirtOl); px(CX - 14, by + 2, 6, 9, st.shirt); px(CX + 7, by + 2, 8, 9, shirtOl); px(CX + 8, by + 2, 6, 9, st.shirt);
      } else {
        blob(CX - sw, by, sw * 2, 32, 10, shirtOl); blob(CX - sw + 1, by + 1, sw * 2 - 2, 31, 9, st.shirt);
        px(CX - sw + 5, by + 2, 10, 1, shirtL); px(CX + sw - 14, by + 2, 8, 1, shirtL); px(CX - sw + 1, by + 12, 1, 18, shirtD); px(CX + sw - 2, by + 12, 1, 18, shirtD);
        for (const [fxp, fyp, fl] of [[-14, 12, 7], [9, 14, 6], [-4, 20, 5]]) { px(CX + fxp, by + fyp, fl, 1, shirtD); px(CX + fxp + 1, by + fyp + 1, fl - 2, 1, shirtD); }   // folds
      }
      px(neckX - 1, by - 7, nw + 2, 10, skinOl); px(neckX, by - 7, nw, 9, skinD); px(neckX, by - 2, nw, 3, skinDD);   // the neck, shaded under the chin
      if (outfit === 'hoodie') {
        px(CX - 8, by + 1, 16, 3, shirtOl); px(CX - 7, by + 2, 14, 1, shirtD); px(CX - 6, by - 1, 12, 2, shirtD);   // collar
        px(CX - 5, by + 4, 1, 9, '#f1efe8'); px(CX + 4, by + 4, 1, 9, '#f1efe8'); px(CX - 5, by + 12, 1, 2, '#c7c2b4'); px(CX + 4, by + 12, 1, 2, '#c7c2b4');   // drawstrings
        px(CX - 14, by + 22, 28, 1, shirtD);   // the top of the pocket
      } else if (outfit === 'tee') {
        px(CX - 9, by, 18, 2, shirtOl); px(CX - 8, by, 16, 1, shirtD);   // a round neck
        px(CX - 3, by + 11, 7, 1, accent); px(CX - 2, by + 10, 5, 1, accent); px(CX - 1, by + 9, 3, 1, accent); px(CX - 2, by + 12, 5, 2, accent); px(CX - 3, by + 14, 2, 1, accent); px(CX + 2, by + 14, 2, 1, accent);   // a little star in the light colour
      } else if (outfit === 'collared') {
        const white = mixHex(st.shirt, '#ffffff', 0.78), whiteD = mixHex(st.shirt, '#ffffff', 0.5);
        for (let i = 0; i < 7; i++) { px(CX - 11 + i, by - 1 + i, 3, 1, shirtOl); px(CX - 10 + i, by - 1 + i, 2, 1, white); px(CX + 8 - i, by - 1 + i, 3, 1, shirtOl); px(CX + 8 - i, by - 1 + i, 2, 1, white); }   // the collar points
        px(CX - 8, by - 1, 16, 2, white); px(CX, by + 6, 1, 25, shirtD); for (let y = by + 9; y < by + 30; y += 5) px(CX - 1, y, 3, 1, whiteD);   // the buttons
        px(CX - 22, by + 12, 9, 8, shirtD); px(CX - 21, by + 13, 7, 6, st.shirt);   // a chest pocket
      } else if (outfit === 'turtleneck') {
        px(CX - 8, by - 7, 16, 10, shirtOl); px(CX - 7, by - 7, 14, 9, st.shirt); for (let i = -6; i <= 6; i += 2) px(CX + i, by - 7, 1, 9, shirtD); px(CX - 7, by - 7, 14, 1, shirtL); px(CX - 8, by + 2, 16, 1, shirtOl);   // a tall ribbed collar
        px(CX - sw + 2, by + 28, sw * 2 - 4, 3, shirtD); for (let i = -sw + 4; i < sw - 4; i += 2) px(CX + i, by + 28, 1, 3, shirtOl);   // the ribbed hem
      }
      // ---------------------------------------------------------------- head (on its own, so it can tilt as one piece)
      C = Hd; Hd.clearRect(0, 0, W, H);
      const hw = 34 + (fem ? -2 : masc ? 2 : 0) - Math.round(Math.abs(yaw) * 3), hx = CX - Math.round(hw / 2) + sx, hy = 22 + Math.round(pitch * 1), hh = 40;
      if (st.hairStyle === 'long') { blob(hx - 4, hy + 2, hw + 8, 44, 9, hairDD); blob(hx - 3, hy + 3, hw + 6, 43, 9, hairD); px(hx - 1, hy + 20, 2, 22, hair); px(hx + hw - 1, hy + 20, 2, 22, hair); }
      if (st.hairStyle === 'bun') { const bx = CX - 7 + Math.round(yaw * 3); blob(bx - 1, hy - 14, 16, 14, 6, hairDD); blob(bx, hy - 13, 14, 12, 5, hair); px(bx + 3, hy - 12, 5, 1, hairL); px(bx + 3, hy - 8, 8, 1, hairD); }
      if (st.hairStyle === 'bob') { blob(hx - 4, hy + 4, hw + 8, 34, 8, hairDD); blob(hx - 3, hy + 5, hw + 6, 33, 8, hairD); }
      if (st.hairStyle === 'ponytail') { const tx = hx + hw - 3 + Math.round(yaw * 2); blob(tx, hy + 6, 10, 32, 4, hairDD); blob(tx + 1, hy + 7, 8, 30, 3, hairD); px(tx + 2, hy + 10, 2, 22, hair); px(tx, hy + 8, 6, 3, accent); }
      if (st.hairStyle === 'afro') { blob(hx - 10, hy - 14, hw + 20, 46, 20, hairDD); blob(hx - 9, hy - 13, hw + 18, 44, 19, hair); for (let i = 0; i < 26; i++) px(hx - 7 + (i * 7) % (hw + 14), hy - 11 + (i * 11) % 36, 2, 1, i % 2 ? hairD : hairL); }
      const earY = hy + 17;
      if (yaw < 0.55) { px(hx - 3, earY, 4, 8, skinOl); px(hx - 2, earY + 1, 3, 6, skin); px(hx - 2, earY + 3, 2, 3, skinDD); }
      if (yaw > -0.55) { px(hx + hw - 1, earY, 4, 8, skinOl); px(hx + hw - 1, earY + 1, 3, 6, skin); px(hx + hw, earY + 3, 2, 3, skinDD); }
      blob(hx - 1, hy - 1, hw + 2, hh + 2, 11, skinOl); blob(hx, hy, hw, hh, 10, skin);
      // shading: a shadow under the fringe, down the side away from the light, and under the chin; a light cheek and chin
      const sh = yaw > 0.2 ? 4 : 2; px(hx + hw - sh, hy + 12, sh, 22, skinD); px(hx + 6, hy + hh - 3, hw - 12, 2, skinD); px(hx + 3, hy + hh - 7, hw - 6, 1, skinL); px(hx + 4, hy + 24, 4, 1, skinL);
      const fh = ['stubble', 'mustache', 'goatee', 'beard'].includes(st.facialHair) ? st.facialHair : 'none', myy = hy + 33 + fy, mxx = CX + Math.round(fx * 1.2), beardC = hairD, beardL = hair;
      if (fh === 'stubble') { for (let y = myy - 5; y < hy + hh - 2; y++) for (let x = hx + 4; x < hx + hw - 4; x++) if ((x + y) % 3 === 0 && (y > myy - 1 || Math.abs(x - mxx) > 5)) { px(x, y, 1, 1, shade(hair, 0.9)); C.globalAlpha = 1; } px(hx + 5, hy + hh - 8, hw - 10, 1, skinD); }
      if (fh === 'beard') { for (let y = myy - 6; y < hy + hh; y++) { const d = y > hy + hh - 11 ? Math.round(10 - Math.sqrt(Math.max(0, 100 - Math.pow(y - (hy + hh - 11), 2)))) : 0; px(hx + d, y, hw - d * 2, 1, beardC); } px(hx + 3, myy - 6, hw - 6, 1, beardL); for (let i = 0; i < 14; i++) px(hx + 3 + (i * 5) % (hw - 6), myy + 3 + (i * 3) % 12, 2, 1, beardL); px(mxx - 6, myy - 1, 12, 5, skinD); }
      if (fh === 'goatee') { px(mxx - 5, myy + 4, 10, hy + hh - myy - 4, beardC); px(mxx - 4, myy + 5, 8, 2, beardL); px(mxx - 3, hy + hh - 2, 6, 2, skinOl); }
      // ---- face
      const ex = 5.5 * (1 - Math.abs(yaw) * 0.22), ey = hy + 18 + fy, gx = Math.round(p.gazeX * 2), gy = Math.round(p.gazeY * 1);
      const later = [], eye = (cx, blink, brow, side) => {
        const open = Math.round((1 - Math.min(1, blink)) * 7), x0 = Math.round(cx - 4.5), outer = side < 0 ? x0 - 1 : x0 + 9;
        if (open <= 1) { px(x0, ey + 4, 9, 1, hairDD); px(x0 + 1, ey + 5, 7, 1, skinDD); px(x0 - 1 + (side > 0 ? 10 : 0), ey + 3, 1, 1, hairDD); }   // shut: a curved lash line
        else {
          px(x0, ey + 1, 9, open + 1, hairDD); px(x0 + 1, ey + 2, 7, Math.max(1, open - 1), '#f6f3ee'); px(x0 + 1, ey + open, 7, 1, '#d9d4ca');
          const irisW = 4, irisH = Math.max(2, Math.min(5, open - 1)), ix = Math.max(x0 + 1, Math.min(x0 + 8 - irisW, x0 + 3 + gx + Math.round(yaw * 0.5))), iy = Math.min(ey + 2 + Math.max(0, Math.round((open - irisH) / 2)) + gy, ey + 1 + open - irisH);
          px(ix, iy, irisW, irisH, st.eyes); px(ix, iy, irisW, 1, shade(st.eyes, 0.6)); px(ix + 1, iy + 1, 2, Math.max(1, irisH - 2), '#0d1212');
          if (irisH >= 3) { px(ix, iy + 1, 1, 1, '#ffffff'); px(ix + 3, iy + irisH - 1, 1, 1, shade(st.eyes, 1.5)); }
          px(x0 - 1, ey, 11, 1, hairDD); px(outer, ey - 1, 1, 2, hairDD); if (fem) { px(outer + (side < 0 ? -1 : 1), ey - 1, 1, 1, hairDD); px(outer, ey - 2, 1, 1, hairDD); px(x0 + 1, ey + open + 1, 7, 1, hairD); }   // longer lashes   // upper lash line, with a little flick at the outer corner
          if (blink > 0.15) px(x0 + 1, ey + 1, 7, Math.round(blink * 3), skin);   // the lid comes down over the white
        }
        const bY = ey - 6 - Math.round(brow * 3), tilt = brow < -0.35 ? 1 : 0, a = side < 0 ? 0 : tilt, c = side < 0 ? tilt : 0;   // knitted (inner ends down) when well lowered
        const bt = masc ? 3 : fem ? 1 : 2; later.push(() => { px(x0 - 1, bY + a + (fem ? 1 : 0), 3, bt, hairD); px(x0 + 2, bY, 4, bt, hairD); px(x0 + 6, bY + c + (fem ? 1 : 0), 3, bt, hairD); px(x0 + 2, bY, 4, 1, hairDD); });   // drawn after the hair, so the fringe never hides them
      };
      const lx = CX + fx - ex - 1.5, rx = CX + fx + ex + 1.5;
      eye(lx, p.blinkL, p.browL, -1); eye(rx, p.blinkR, p.browR, 1);
      if (st.blush) { px(lx - 4, ey + 10, 5, 2, '#e8908f'); px(lx - 3, ey + 9, 3, 1, '#f0a8a0'); px(rx - 1, ey + 10, 5, 2, '#e8908f'); px(rx, ey + 9, 3, 1, '#f0a8a0'); }
      const nx = CX + Math.round(fx * 1.5); px(nx - 1, ey + 8, 2, 3, skinD); px(nx, ey + 10, 2, 1, skinDD); px(nx - 1, ey + 7, 1, 1, skinL);   // nose
      if (fh === 'mustache' || fh === 'goatee' || fh === 'beard') { const ys = myy - 3; px(mxx - 7, ys, 14, 3, beardC); px(mxx - 8, ys + 2, 2, 2, beardC); px(mxx + 6, ys + 2, 2, 2, beardC); px(mxx - 6, ys, 12, 1, beardL); px(mxx - 1, ys + 2, 2, 1, skinD); }   // the moustache
      const my = hy + 33 + fy, mx = CX + Math.round(fx * 1.2), m = p.mouth, rnd = p.round, sm = p.smile, lip = fem ? shade(lipC, 1.1) : lipC, lipD = shade(lipC, 0.62);
      if (m < 0.12) {
        const w = 8 + Math.round(sm * 2); px(mx - w / 2, my + 1, w, 1, lipD); px(mx - w / 2 + 1, my + 2, w - 2, 1, lip);   // closed: a line with a lower lip
        if (sm > 0.25) { px(mx - w / 2 - 1, my, 1, 1, lipD); px(mx + w / 2, my, 1, 1, lipD); if (sm > 0.7) { px(mx - w / 2, my + 2, w, 1, '#f4f1ea'); px(mx - w / 2 + 1, my + 3, w - 2, 1, lipD); } } else if (sm < -0.3) { px(mx - w / 2 - 1, my + 2, 1, 1, lipD); px(mx + w / 2, my + 2, 1, 1, lipD); }
      } else {
        const mh = 2 + Math.round(m * 8), mw = Math.round((9 + Math.max(0, sm) * 3) * (1 - rnd * 0.45)), x0 = Math.round(mx - mw / 2);
        px(x0 - 1, my, mw + 2, mh + 2, lipD); px(x0, my + 1, mw, mh, '#5e1f28');
        if (rnd < 0.55 && mh >= 3) px(x0 + 1, my + 1, mw - 2, 2, '#f4f1ea');   // top teeth
        if (mh >= 6) { px(x0 + 2, my + mh - 1, Math.max(2, mw - 4), 2, '#d96a78'); px(x0 + 3, my + mh - 1, Math.max(1, mw - 6), 1, '#ee8a96'); }   // tongue
        px(x0, my + mh + 1, mw, 1, lip);   // lower lip
      }
      // ---- hair: a cap with highlights and strands, side locks and a swept fringe; it moves a little more than the face so a turn looks round
      const hs = Math.round(yaw * 2.5), hw2 = hw + 4, hxx = hx - 2 + hs, top = hy - 4, style = ['short', 'long', 'bun', 'none', 'spiky', 'bob', 'ponytail', 'buzz', 'afro', 'mohawk'].includes(st.hairStyle) ? st.hairStyle : 'short';
      const cap = (h) => { blob(hxx - 1, top - 1, hw2 + 2, h + 2, 11, hairDD); blob(hxx, top, hw2, h, 10, hair); };
      if (style === 'buzz' || style === 'mohawk') {
        const sh2 = style === 'mohawk' ? shade(hair, 0.55) : shade(hair, 0.85); blob(hxx - 1, top + 2, hw2 + 2, 20, 11, sh2); blob(hxx, top + 3, hw2, 18, 10, sh2); px(hxx + 5, top + 17, hw2 - 10, 8, skin); px(hxx + 5, top + 17, hw2 - 10, 1, skinD);
        for (let y = top + 6; y < top + 17; y += 2) for (let x = hxx + 3 + (y % 4); x < hxx + hw2 - 3; x += 4) px(x, y, 1, 1, shade(hair, 1.2));
        if (style === 'mohawk') { const mxh = CX + hs; for (let i = -3; i <= 3; i++) { const hgt = 14 - Math.abs(i) * 2; px(mxh + i * 1, top - hgt + 2, 1, hgt + 8, i % 2 ? hair : hairD); } px(mxh - 4, top + 4, 9, 6, hair); px(mxh - 1, top - 10, 2, 3, hairL); }
      } else if (style !== 'none') {
        cap(22); px(hxx + 7, top + 2, hw2 - 18, 1, hairL); px(hxx + 10, top + 4, hw2 - 24, 1, hairL); px(hxx + 12, top + 2, 4, 1, hairLL);   // shine
        for (let i = 8; i < hw2 - 6; i += 5) px(hxx + i, top + 5, 1, 7, hairD);   // strands
        const side = style === 'bob' ? 30 : 17; px(hxx, top + 10, 5, side, hair); px(hxx + hw2 - 5, top + 10, 5, side, hair); px(hxx, top + 10, 1, side, hairD); px(hxx + hw2 - 1, top + 10, 1, side, hairD);   // side locks (long ones for a bob)
        if (style === 'bob') { px(hxx - 1, top + 10 + side, 7, 1, hairDD); px(hxx + hw2 - 6, top + 10 + side, 7, 1, hairDD); }
        px(hxx + 5, top + 17, hw2 - 10, 9, skin);   // the forehead showing under the fringe
        const spikes = style === 'bob' ? [4, 4, 4, 4, 4, 4, 4, 4] : [5, 7, 4, 6, 3, 5, 4, 6], n = Math.floor((hw2 - 10) / 3);   // a fringe swept to one side (a bob's is straight)
        for (let i = 0; i < n; i++) { const h = 3 + Math.round(spikes[i % spikes.length] * (style === 'bob' ? 1 : 1 - i / (n * 1.4))); px(hxx + 5 + i * 3, top + 13, 3, h, hair); px(hxx + 5 + i * 3, top + 13 + h - 1, 3, 1, hairD); }
        px(hxx + 5, top + 17, hw2 - 10, 1, skinD); px(hxx + 5, top + 18, hw2 - 10, 1, skinD);   // shadow under the fringe
        if (style === 'spiky') for (let i = 0; i < 7; i++) { const x = hxx + 3 + i * Math.floor((hw2 - 6) / 7), hgt = 5 + ((i * 3) % 4) * 2; px(x, top - hgt + 1, 5, hgt + 2, hair); px(x + 1, top - hgt - 1, 3, 2, hair); px(x + 2, top - hgt - 2, 1, 1, hair); px(x, top - hgt + 1, 1, hgt, hairD); px(x + 3, top - hgt + 2, 1, 3, hairL); }
      }
      later.forEach((f) => f());
      if (st.headphones) {
        px(hxx - 1, top + 1, hw2 + 2, 3, '#232b2b'); px(hxx + 2, top, hw2 - 4, 1, '#3a4545');
        for (const x of [hx - 7, hx + hw]) { px(x, earY - 3, 7, 14, '#232b2b'); px(x + (x < hx ? 0 : 5), earY - 3, 2, 14, accent); px(x + 2, earY, 3, 8, '#3a4545'); }   // the cups glow in the light colour
      }
      if (st.glasses) { const frame = '#1b1f26'; for (const x of [lx, rx]) { px(x - 6, ey - 1, 13, 1, frame); px(x - 6, ey + 10, 13, 1, frame); px(x - 6, ey - 1, 1, 12, frame); px(x + 6, ey - 1, 1, 12, frame); px(x - 5, ey, 11, 10, 'rgba(160,210,255,0.12)'); px(x - 4, ey + 1, 3, 1, 'rgba(255,255,255,0.55)'); px(x - 4, ey + 2, 1, 2, 'rgba(255,255,255,0.4)'); } px(lx + 6, ey + 3, rx - lx - 12, 1, frame); }
      // ---- put the head on the body, tilted (in steps, so it stays chunky)
      C = L; const ang = Math.round(p.roll * 0.32 / 0.045) * 0.045; L.save(); L.imageSmoothingEnabled = false; L.translate(CX, 70 + bob); L.rotate(ang); L.translate(-CX, -(70 + bob)); L.drawImage(hd, 0, bob); L.restore();

      // ---------------------------------------------------------------- to the screen
      // the avatar fills the frame: scaled up (in whole pixel steps) so the head and shoulders take most of it, with the head kept in view and the body cropped at the bottom
      const zoom = Math.max(0.6, Math.min(2.2, +st.zoom || 1.4)), s = Math.max(1, Math.min(canvas.width / W, canvas.height / H) * zoom), sc = s >= 2 ? Math.floor(s) : s, dw = W * sc, dh = H * sc, ox = Math.round((canvas.width - dw) / 2), oy = Math.round(Math.max(canvas.height - dh, canvas.height * 0.05 - 8 * sc));
      const view = { left: -ox / sc, right: (canvas.width - ox) / sc, top: -oy / sc, bottom: (canvas.height - oy) / sc, cx: CX, shoulderY: 72 + bob };
      if (pets) { pets.setConfig(st.pets, st.petFreq); pets.update(lastT == null ? 0.033 : Math.max(0.001, Math.min(0.25, t - lastT)), view); lastT = t; }
      const petPx = (x, y, w, h, col) => { out.fillStyle = col; out.fillRect(Math.round(ox + x * sc), Math.round(oy + y * sc), Math.round(w * sc), Math.round(h * sc)); };
      const drawPets = (layer) => { if (pets) for (const p of pets.visible()) if (p.layer === layer) AvatarPets.drawPet(petPx, p, t); };
      out.setTransform(1, 0, 0, 1, 0, 0); out.globalAlpha = 1; out.filter = 'none'; out.imageSmoothingEnabled = false; out.clearRect(0, 0, canvas.width, canvas.height);
      if (st.bg && st.bg !== 'transparent') { out.fillStyle = st.bg; out.fillRect(0, 0, canvas.width, canvas.height); }
      if (room && st.room !== 'none') {   // the room, filling the picture, softened
        const bg = room.draw(t, st), k = Math.max(canvas.width / bg.width, canvas.height / bg.height), bw = bg.width * k, bh = bg.height * k; out.imageSmoothingEnabled = true; out.imageSmoothingQuality = 'high';
        const blur = Math.max(0, Math.min(12, +st.blur || 0)) * canvas.width / 900 * 1.1; out.filter = blur > 0.2 ? 'blur(' + blur.toFixed(1) + 'px)' : 'none'; out.drawImage(bg, Math.round((canvas.width - bw) / 2), Math.round(canvas.height - bh), bw, bh); out.filter = 'none'; out.imageSmoothingEnabled = false;
      }
      drawPets('behind'); out.imageSmoothingEnabled = false; out.drawImage(lo, ox, oy, dw, dh); drawPets('front');
    }
    return { draw, W, H };
  }
  return { create, DEFAULT_STYLE, W, H };
});
