'use strict';
/**
 * Pets for the avatar: a cat, dog, bunny or parrot that wanders in now and then. They walk (or hop) along the bottom behind the streamer, sit down, peek up from the bottom edge,
 * race across in front, hop onto the streamer's lap for a nap, or (a parrot) fly in and perch on a shoulder.
 * The behaviour is plain logic (update) and the pictures are drawn through a px(x, y, w, h, colour) function, so both work without a browser.
 * Positions are in the avatar's pixel grid: x/y in "pixels" (80 across the avatar), view = what is on screen in those units.
 */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.AvatarPets = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const TYPES = {
    cat: { colors: ['orange', 'black', 'gray', 'white', 'tuxedo'], speed: 13, weights: { walk: 0.32, sit: 0.2, lap: 0.26, peek: 0.12, zoom: 0.10 } },
    dog: { colors: ['brown', 'golden', 'black', 'white'], speed: 15, weights: { walk: 0.32, sit: 0.24, lap: 0.16, peek: 0.16, zoom: 0.12 } },
    bunny: { colors: ['white', 'gray', 'brown'], speed: 11, weights: { walk: 0.42, sit: 0.24, lap: 0.16, peek: 0.18, zoom: 0 } },
    parrot: { colors: ['green', 'red', 'blue'], speed: 34, weights: { fly: 0.3, perch: 0.6, peek: 0.1 } },
  };
  const FREQ = { rare: 0.5, normal: 1, often: 2.4 };
  const lerp = (a, b, f) => a + (b - a) * f;

  function create(o) {
    o = o || {}; const rng = o.rng || Math.random; let freq = FREQ[o.freq] || 1, slots = [];
    const busy = { lap: false, perch: false };
    const wait = (first) => (first ? 2 + rng() * 6 : (14 + rng() * 40) / freq);
    function setConfig(pets, f) {
      freq = FREQ[f] || freq; const want = (pets || []).filter((p) => TYPES[p.type] && TYPES[p.type].colors.includes(p.color)).slice(0, 4);
      const same = want.length === slots.length && want.every((w, i) => w.type === slots[i].type && w.color === slots[i].color);
      if (same) return;
      slots = want.map((w) => { const old = slots.find((s) => s.type === w.type && s.color === w.color && !s.kept); if (old) { old.kept = true; return old; } return { type: w.type, color: w.color, state: 'away', timer: wait(true), x: 0, y: 0, dir: 1, pose: 'sit', layer: 'behind', clock: rng() * 5, t: 0 }; });
      slots.forEach((s) => { s.kept = false; }); busy.lap = slots.some((s) => s.state === 'lap' || s.state === 'hopIn' || s.state === 'hopOut'); busy.perch = slots.some((s) => s.state === 'perch' || s.state === 'flyIn' || s.state === 'flyOut');
    }
    const pick = (w) => { let r = rng() * Object.values(w).reduce((a, b) => a + b, 0); for (const k of Object.keys(w)) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };
    const ground = (v) => v.bottom - 3;

    function begin(p, v) {
      let kind = pick(TYPES[p.type].weights);
      if (kind === 'lap' && busy.lap) kind = 'walk'; if (kind === 'perch' && busy.perch) kind = 'fly';
      const fromLeft = rng() < 0.5, spd = TYPES[p.type].speed; p.kind = kind; p.t = 0;
      if (kind === 'walk' || kind === 'sit') {   // along the bottom, behind the streamer
        p.layer = 'behind'; p.dir = fromLeft ? 1 : -1; p.x = fromLeft ? v.left - 14 : v.right + 14; p.y = ground(v); p.state = 'walk'; p.pose = 'walk'; p.speed = spd;
        p.stopAt = kind === 'sit' ? (fromLeft ? lerp(v.left + 10, v.cx - 36, rng()) : lerp(v.cx + 36, v.right - 10, rng())) : (rng() < 0.3 ? lerp(v.left + 20, v.right - 20, rng()) : null); p.stopFor = 4 + rng() * 12;
      } else if (kind === 'lap') {
        busy.lap = true; p.layer = 'front'; p.state = 'hopIn'; p.dir = fromLeft ? 1 : -1; p.x0 = fromLeft ? v.left - 12 : v.right + 12; p.x1 = v.cx + (rng() - 0.5) * 12; p.y1 = v.bottom + 1; p.pose = 'walk'; p.dur = 1.4;
      } else if (kind === 'peek') {
        p.layer = 'front'; p.state = 'peek'; p.x = lerp(v.left + 14, v.right - 14, rng()); p.dir = rng() < 0.5 ? 1 : -1; p.y = v.bottom + 9; p.pose = 'peek'; p.hold = 3 + rng() * 4;
      } else if (kind === 'zoom') {
        p.layer = 'front'; p.dir = fromLeft ? 1 : -1; p.x = fromLeft ? v.left - 14 : v.right + 14; p.y = v.bottom - 1; p.state = 'zoom'; p.pose = 'walk'; p.speed = 62; p.passes = 1 + (rng() < 0.5 ? 1 : 0);
      } else if (kind === 'fly') {
        p.layer = 'front'; p.dir = fromLeft ? 1 : -1; p.x0 = fromLeft ? v.left - 12 : v.right + 12; p.x1 = fromLeft ? v.right + 12 : v.left - 12; p.y0 = v.top + 8 + rng() * 14; p.state = 'fly'; p.pose = 'fly'; p.dur = Math.abs(p.x1 - p.x0) / 40;
      } else if (kind === 'perch') {
        busy.perch = true; p.layer = 'front'; p.dir = fromLeft ? 1 : -1; p.side = rng() < 0.5 ? 1 : -1; p.x0 = fromLeft ? v.left - 12 : v.right + 12; p.y0 = v.top + 8 + rng() * 10; p.x1 = v.cx + p.side * 25; p.y1 = Math.min(v.shoulderY, v.bottom - 3); p.state = 'flyIn'; p.pose = 'fly'; p.dur = 1.8;
      }
    }
    function update(dt, v) {
      dt = Math.min(dt, 0.25);
      for (const p of slots) {
        p.clock += dt; p.t += dt;
        switch (p.state) {
          case 'away': p.timer -= dt; if (p.timer <= 0) begin(p, v); break;
          case 'walk': {
            p.x += p.dir * p.speed * dt; p.y = ground(v); p.pose = 'walk';
            if (p.stopAt != null && (p.dir > 0 ? p.x >= p.stopAt : p.x <= p.stopAt)) { p.state = 'rest'; p.t = 0; p.pose = 'sit'; break; }
            if (p.x < v.left - 16 || p.x > v.right + 16) { p.state = 'away'; p.timer = wait(false); }
            break;
          }
          case 'rest': p.pose = 'sit'; if (p.t > p.stopFor) { p.stopAt = null; p.dir = p.x < v.cx ? -1 : 1; p.state = 'walk'; p.t = 0; } break;   // then leaves the way it is closest to
          case 'hopIn': { const f = Math.min(1, p.t / p.dur); p.x = lerp(p.x0, p.x1, f); p.y = lerp(v.bottom + 14, p.y1, f) - Math.sin(f * Math.PI) * 16; p.pose = 'walk'; if (f >= 1) { p.state = 'lap'; p.t = 0; p.pose = 'lap'; p.stay = 15 + rng() * 30; p.x = p.x1; p.y = p.y1; } break; }
          case 'lap': p.pose = 'lap'; p.y = v.bottom + 1; if (p.t > p.stay) { p.state = 'hopOut'; p.t = 0; p.dir = rng() < 0.5 ? 1 : -1; p.x0 = p.x; p.dur = 1.1; } break;
          case 'hopOut': { const f = Math.min(1, p.t / p.dur); p.x = p.x0 + p.dir * f * 40; p.y = v.bottom + 1 + f * 16 - Math.sin(f * Math.PI) * 12; p.pose = 'walk'; if (f >= 1) { busy.lap = false; p.state = 'away'; p.timer = wait(false); } break; }
          case 'peek': { const f = p.t < 0.8 ? p.t / 0.8 : p.t > p.hold + 0.8 ? Math.max(0, 1 - (p.t - p.hold - 0.8) / 0.8) : 1; p.y = v.bottom + 9 - f * 8; p.pose = 'peek'; if (p.t > p.hold + 1.6) { p.state = 'away'; p.timer = wait(false); } break; }
          case 'zoom': p.x += p.dir * p.speed * dt; p.pose = 'walk'; if (p.x < v.left - 16 || p.x > v.right + 16) { if (p.passes-- > 0) { p.dir = -p.dir; p.x = Math.max(v.left - 15, Math.min(v.right + 15, p.x)); } else { p.state = 'away'; p.timer = wait(false); } } break;
          case 'fly': { const f = Math.min(1, p.t / p.dur); p.x = lerp(p.x0, p.x1, f); p.y = p.y0 + Math.sin(f * Math.PI * 2) * 5; p.pose = 'fly'; if (f >= 1) { p.state = 'away'; p.timer = wait(false); } break; }
          case 'flyIn': { const f = Math.min(1, p.t / p.dur), e = 1 - Math.pow(1 - f, 2); p.x = lerp(p.x0, p.x1, e); p.y = lerp(p.y0, p.y1, e) - Math.sin(f * Math.PI) * 8; p.pose = 'fly'; if (f >= 1) { p.state = 'perch'; p.t = 0; p.pose = 'perch'; p.stay = 15 + rng() * 25; p.dir = -p.side; } break; }
          case 'perch': p.x = v.cx + p.side * 25; p.y = Math.min(v.shoulderY, v.bottom - 3); p.pose = 'perch'; if (p.t > p.stay) { p.state = 'flyOut'; p.t = 0; p.dir = p.side; p.x0 = p.x; p.y0 = p.y; p.x1 = p.side > 0 ? v.right + 14 : v.left - 14; p.dur = 1.6; } break;
          case 'flyOut': { const f = Math.min(1, p.t / p.dur); p.x = lerp(p.x0, p.x1, f * f); p.y = lerp(p.y0, v.top + 6, f) - Math.sin(f * Math.PI) * 6; p.pose = 'fly'; if (f >= 1) { busy.perch = false; p.state = 'away'; p.timer = wait(false); } break; }
          default: p.state = 'away';
        }
      }
    }
    return { setConfig, update, slots: () => slots, visible: () => slots.filter((p) => p.state !== 'away'), busy: () => Object.assign({}, busy) };
  }

  // ---------------------------------------------------------------- the pictures
  const PAL = {
    orange: { b: '#e08a3c', l: '#f3c38a', d: '#b8641f' }, black: { b: '#2a2a32', l: '#4a4a55', d: '#15151a' }, gray: { b: '#8a8f99', l: '#c4c8d0', d: '#5f636c' }, white: { b: '#ecebe6', l: '#ffffff', d: '#bdbab0' },
    tuxedo: { b: '#2a2a32', l: '#f4f2ec', d: '#15151a' }, brown: { b: '#9a6a3a', l: '#d8b88a', d: '#6b4524' }, golden: { b: '#d9a84a', l: '#f3dc9a', d: '#a8782a' },
    green: { b: '#3cb043', l: '#8fe08f', d: '#1f7a2a' }, red: { b: '#d9362b', l: '#f08a7a', d: '#8f1f18' }, blue: { b: '#2e86c1', l: '#8ac4ec', d: '#1c5a8a' },
  };
  /** draws one pet. P(x, y, w, h, colour) fills a rectangle in avatar pixels; (p.x, p.y) is where the feet touch the ground */
  function drawPet(P, p, t) {
    const pal = PAL[p.color] || PAL.orange, b = pal.b, l = pal.l, d = pal.d, dir = p.dir >= 0 ? 1 : -1, ax = Math.round(p.x), ay = Math.round(p.y), f = Math.floor(p.clock * (TYPES[p.type].speed / 3.5)) % 2, eye = '#111', nose = '#e8908f';
    const r = (lx, ly, w, h, col) => P(dir > 0 ? ax + lx : ax - lx - w, ay + ly, w, h, col), pose = p.pose;
    const zz = () => { for (let i = 0; i < 3; i++) { const k = (t * 0.8 + i / 3) % 1, y = -14 - k * 10, x = 11 + i * 3 + k * 2; r(x, y, 3, 1, 'rgba(255,255,255,' + (0.9 - k * 0.7).toFixed(2) + ')'); r(x + 1, y + 1, 1, 1, 'rgba(255,255,255,' + (0.9 - k * 0.7).toFixed(2) + ')'); r(x, y + 2, 3, 1, 'rgba(255,255,255,' + (0.9 - k * 0.7).toFixed(2) + ')'); } };
    const breath = Math.sin(t * 2.2 + p.clock) > 0 ? 1 : 0;
    if (p.type === 'cat') {
      const belly = p.color === 'tuxedo' ? l : (p.color === 'white' ? l : b), tail = p.color === 'tuxedo' ? l : d;
      if (pose === 'walk') {
        const dy = f ? -1 : 0; r(-7, -8, 11, 5, b); r(-6, -4, 9, 1, belly); r(2 + f, -3, 2, 3, b); r(5 - f, -3, 2, 3, b); r(-7 + (1 - f), -3, 2, 3, b); r(-4 - (1 - f), -3, 2, 3, b); r(2 + f, -1, 2, 1, belly); r(5 - f, -1, 2, 1, belly);
        r(4, -11, 6, 6, b); r(4, -13, 2, 2, b); r(8, -13, 2, 2, b); r(5, -12, 1, 1, '#e8908f'); r(8, -12, 1, 1, '#e8908f'); r(8, -9, 1, 2, eye); r(10, -8, 1, 1, nose); r(7, -7, 3, 1, belly);
        r(-9, -9 + dy, 2, 1, b); r(-10, -12 + dy, 1, 4, b); r(-10, -13 + dy, 1, 1, tail);
      } else if (pose === 'sit') {
        r(-3, -11, 7, 11, b); r(3, -9, 2, 8, belly); r(0, -17, 7, 6, b); r(0, -19, 2, 2, b); r(5, -19, 2, 2, b); r(1, -18, 1, 1, '#e8908f'); r(5, -18, 1, 1, '#e8908f'); r(4, -15, 1, 2, eye); r(7, -13, 1, 1, nose); r(3, -3, 2, 3, belly); r(-7, -2, 5, 2, b); r(-8, -4, 1, 3, b); r(-8, -5 + f, 1, 1, tail);
      } else if (pose === 'lap') {
        r(-12, -8 - breath, 22, 8 + breath, b); r(-11, -9 - breath, 20, 1, b); r(-12, -2, 22, 1, b); r(-12, -8 - breath, 1, 2, 'rgba(0,0,0,0)'); r(6, -8, 9, 7, b); r(7, -11, 2, 3, b); r(12, -11, 2, 3, b); r(8, -10, 1, 1, '#e8908f'); r(12, -10, 1, 1, '#e8908f'); r(10, -5, 3, 1, d); r(14, -3, 1, 1, nose);
        r(-14, -5, 3, 2, b); r(-15, -6, 1, 3, b); r(-15, -7 + (breath ? 0 : 1), 1, 1, tail); r(4, -1, 5, 2, belly); r(-12, -5, 22, 1, 'rgba(0,0,0,0.12)'); zz();
      } else if (pose === 'peek') {
        r(-5, -7, 10, 7, b); r(-5, -10, 3, 3, b); r(2, -10, 3, 3, b); r(-4, -9, 1, 2, '#e8908f'); r(3, -9, 1, 2, '#e8908f'); r(-3, -5, 1, 2, eye); r(2, -5, 1, 2, eye); r(-1, -3, 2, 1, nose); r(-6, -1, 4, 2, belly); r(2, -1, 4, 2, belly);
      }
    } else if (p.type === 'dog') {
      const belly = p.color === 'white' ? '#d6d2c6' : l, ear = d;
      if (pose === 'walk') {
        const wag = f ? -1 : 0; r(-9, -9, 14, 6, b); r(-8, -4, 12, 1, belly); r(2 + f, -4, 2, 4, b); r(5 - f, -4, 2, 4, b); r(-8 + (1 - f), -4, 2, 4, b); r(-5 - (1 - f), -4, 2, 4, b); r(2 + f, -1, 2, 1, belly); r(5 - f, -1, 2, 1, belly);
        r(5, -14, 7, 7, b); r(11, -11, 4, 3, belly); r(14, -11, 1, 1, '#111'); r(5, -14, 3, 6, ear); r(9, -12, 1, 1, eye); r(-11, -12 + wag, 2, 4, b);
        if (p.color === 'white') { r(-5, -9, 4, 3, '#9a6a3a'); r(5, -14, 3, 6, '#9a6a3a'); }
      } else if (pose === 'sit') {
        r(-4, -12, 8, 12, b); r(0, -19, 8, 7, b); r(7, -15, 4, 3, belly); r(0, -19, 3, 6, ear); r(5, -17, 1, 1, eye); r(10, -15, 1, 1, '#111'); r(4, -4, 2, 4, belly); r(-8, -2, 5, 2, b); r(-9, -3 - f, 1, 2, b); if (breath) r(8, -12, 1, 2, '#e8668a');
        if (p.color === 'white') r(0, -19, 3, 6, '#9a6a3a');
      } else if (pose === 'lap') {
        r(-12, -8 - breath, 22, 8 + breath, b); r(-12, -2, 22, 1, b); r(8, -9, 10, 8, b); r(9, -10, 3, 6, ear); r(16, -6, 4, 3, belly); r(19, -6, 1, 1, '#111'); r(14, -7, 2, 1, '#111'); r(-14, -6, 3, 2, b); r(-15, -7 + (breath ? 0 : 1), 1, 2, b); r(8, -1, 6, 2, belly); zz();
        if (p.color === 'white') r(9, -10, 3, 6, '#9a6a3a');
      } else if (pose === 'peek') {
        r(-6, -8, 12, 8, b); r(-8, -9, 3, 7, ear); r(5, -9, 3, 7, ear); r(-2, -4, 4, 3, belly); r(-1, -4, 2, 1, '#111'); r(-4, -6, 1, 2, eye); r(3, -6, 1, 2, eye); r(-7, -1, 4, 2, belly); r(3, -1, 4, 2, belly);
      }
    } else if (p.type === 'bunny') {
      const up = f ? 3 : 0, pink = '#e8a8b0';
      if (pose === 'walk') {
        r(-5, -8 - up, 10, 7, b); r(3, -12 - up, 6, 6, b); r(4, -20 - up, 2, 8, b); r(7, -19 - up, 2, 7, b); r(5, -19 - up, 1, 5, pink); r(7, -10 - up, 1, 1, eye); r(9, -9 - up, 1, 1, nose); r(-7, -7 - up, 3, 3, '#fff'); r(-5 - up, -2, 6 + up, 2, b); r(3 + up, -2 - (up ? 1 : 0), 2, 2, b);
      } else if (pose === 'sit') {
        r(-4, -10, 9, 10, b); r(-3, -16, 8, 6, b); r(-2, -26, 2, 10, b); r(2, -25, 2, 9, b); r(-1, -25, 1, 6, pink); r(2, -14, 1, 1, eye); r(5, -12, 1, 1, nose); r(-6, -4, 3, 3, '#fff'); r(-4, -2, 8, 2, b); r(0, -6, 4, 3, l);
      } else if (pose === 'lap') {
        r(-9, -8 - breath, 18, 8 + breath, b); r(5, -9, 8, 7, b); r(1, -11, 9, 2, b); r(3, -11, 5, 1, pink); r(10, -6, 2, 1, d); r(13, -5, 1, 1, nose); r(-11, -5, 3, 3, '#fff'); r(4, -1, 5, 2, l); zz();
      } else if (pose === 'peek') {
        r(-5, -7, 10, 7, b); r(-4, -17, 3, 10, b); r(1, -17, 3, 10, b); r(-3, -16, 1, 7, pink); r(2, -16, 1, 7, pink); r(-3, -5, 1, 2, eye); r(2, -5, 1, 2, eye); r(-1, -3, 2, 1, nose); r(-6, -1, 4, 2, l); r(2, -1, 4, 2, l);
      }
    } else if (p.type === 'parrot') {
      const beak = '#e8c14a', beakD = '#c9a23a', bob = Math.sin(p.clock * 3) > 0.85 ? 1 : 0, wing = d, tail = pal.d;
      if (pose === 'perch' || pose === 'walk' || pose === 'sit' || pose === 'lap' || pose === 'peek') {
        r(-3, -13, 6, 12, b); r(0, -11, 3, 8, l); r(-4, -12, 3, 9, wing); r(-3, -19 + bob, 7, 7, b); r(-2, -21 + bob, 3, 2, b); r(4, -17 + bob, 3, 3, beak); r(6, -15 + bob, 1, 2, beakD); r(1, -17 + bob, 2, 2, '#fff'); r(2, -17 + bob, 1, 1, eye); r(-3, -3, 3, 8, tail); r(-1, -1, 1, 1, '#c98'); r(1, -1, 1, 1, '#c98');
      } else {
        const up = f === 0; r(-4, -8, 8, 5, b); r(-3, -6, 5, 3, l); r(3, -11, 5, 5, b); r(8, -9, 2, 2, beak); r(5, -9, 1, 1, eye); r(-10, -7, 6, 3, tail);
        if (up) { r(-3, -16, 3, 8, wing); r(-6, -14, 3, 6, wing); } else { r(-3, -4, 3, 6, wing); r(-6, -3, 3, 4, wing); }
      }
    }
  }
  return { TYPES, FREQ, PAL, create, drawPet };
});
