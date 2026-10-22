/* Beat engine for the Dance Party: finds the tempo, the beats and the bar from a 32-band spectrum stream, and spots breakdowns, build-ups and drops.
 * How it works (the usual approach in beat trackers):
 *   1. Onsets: "spectral flux" = how much each band rose since the last frame, weighted towards the bass (kicks). Peaks above a moving threshold are onsets.
 *   2. Tempo: every inter-onset interval votes for a tempo (and its multiples), the votes favour 90-170 bpm.
 *   3. Phase: the onsets are folded on one beat length and their circular mean says where the beats sit. A smoothed beat grid then runs on its own, so
 *      the visuals hit every beat on time and never jitter with single detections.
 *   4. Bar: the kick strength at each of 4 beat positions shows which one is "1".
 *   5. Sections: bass, high and total energy are tracked over short, medium and long windows. Bass gone for a while = breakdown, highs rising after
 *      that = build-up, bass coming back hard = drop.
 * Works in a browser (window.BeatEngine) and in Node (tests).  All times are epoch milliseconds. */
(function (root) {
  'use strict';
  function BeatEngine(opts) {
    opts = opts || {};
    const NB = 32, clamp = (x, a, b) => Math.max(a, Math.min(b, x)), mean = (r, a, b) => { let s = 0; for (let i = a; i < b; i++) s += r[i]; return s / (b - a); };
    const S = {
      prev: null, flux: [], onsets: [], lastOnset: 0, lastFeed: 0,
      grid: null, nextBeat: 0, beatN: 0, bar: 0, barAcc: [0, 0, 0, 0], barOff: 0, lastEst: 0, conf: 0, lastBeatT: 0,
      avg: { bass: { f: 0, m: 0, s: 0 }, mid: { f: 0, m: 0, s: 0 }, high: { f: 0, m: 0, s: 0 }, total: { f: 0, m: 0, s: 0 } },
      state: 'normal', since: 0, buildP: 0, dropAt: 0, cool: 0, lowSince: 0, events: [], flatSince: 0,
    };
    const ema = (o, v, dt) => { o.f += (v - o.f) * (1 - Math.exp(-dt / 250)); o.m += (v - o.m) * (1 - Math.exp(-dt / 2000)); o.s += (v - o.s) * (1 - Math.exp(-dt / 10000)); };

    /** r: 32 raw band levels 0..100, ts: when they were measured */
    function feed(r, ts) {
      if (!r || r.length < NB) return; const dt = S.lastFeed ? clamp(ts - S.lastFeed, 5, 500) : 40; if (!S.lastFeed) S.first = ts; S.lastFeed = ts;
      const bass = mean(r, 0, 6), mid = mean(r, 6, 16), high = mean(r, 16, 32), total = mean(r, 0, 32);
      ema(S.avg.bass, bass, dt); ema(S.avg.mid, mid, dt); ema(S.avg.high, high, dt); ema(S.avg.total, total, dt);
      // 1. onsets by spectral flux (bass weighs most)
      let flux = 0, kick = 0; if (S.prev) for (let i = 0; i < NB; i++) { const d = Math.max(0, r[i] - S.prev[i]); flux += d * (i < 8 ? 1 : i < 20 ? 0.5 : 0.25); if (i < 8) kick += d; }
      S.prev = r.slice(0, NB); S.flux.push({ t: ts, v: flux, k: kick }); while (S.flux.length > 60) S.flux.shift();
      const n = S.flux.length; if (n >= 4) {
        const a = S.flux[n - 3], b = S.flux[n - 2], c = S.flux[n - 1]; let m = 0, sd = 0; for (const f of S.flux) m += f.v; m /= n; for (const f of S.flux) sd += (f.v - m) * (f.v - m); sd = Math.sqrt(sd / n);
        if (b.v > a.v && b.v >= c.v && b.v > m + 0.9 * sd && b.v > 4 && b.t - S.lastOnset > 140) { S.onsets.push({ t: b.t, s: b.v, k: b.k }); S.lastOnset = b.t; while (S.onsets.length > 120) S.onsets.shift(); }
      }
      sections(ts, dt, flux);
    }

    function sections(ts, dt, flux) {
      const A = S.avg, audible = A.total.s > 5; if (ts - S.first < 5000) return;   // the averages need a few seconds to settle
      const quiet = A.bass.f < 0.55 * A.bass.s && audible; if (quiet) { if (!S.lowSince) S.lowSince = ts; } else S.lowSince = 0;
      if ((S.state === 'normal' || S.state === 'high') && S.lowSince && ts - S.lowSince > 1000 && ts > S.cool - 8000) { S.state = 'break'; S.since = ts; S.buildP = 0; S.events.push({ type: 'break', t: ts }); }
      if (S.state === 'break' || S.state === 'build') {
        const age = ts - S.since;
        if (S.state === 'break' && age > 2500 && A.high.f > A.high.m * 1.06) { S.state = 'build'; S.events.push({ type: 'build', t: ts }); }
        S.buildP = clamp(age / 7000, 0, 1);
        if (age > 1200 && A.bass.f > 1.5 * A.bass.m && A.bass.f > 0.55 * A.bass.s && ts > S.cool) { S.state = 'drop'; S.dropAt = ts; S.cool = ts + 14000; S.buildP = 0; S.events.push({ type: 'drop', t: ts }); }
        else if (age > 30000) { S.state = 'normal'; S.buildP = 0; }
      } else if (S.state === 'drop') { if (ts - S.dropAt > 7000) S.state = 'high'; }
      else if (S.state === 'high') { if (ts - S.dropAt > 18000) S.state = 'normal'; }
      else if (ts > S.cool && A.total.f > 1.7 * A.total.m && flux > 10 && A.total.m > 4) { S.cool = ts + 8000; S.events.push({ type: 'hit', t: ts }); }
    }

    /** 2 + 3: tempo from the onset intervals, phase from the circular mean of the onsets */
    function estimate(now) {
      const on = S.onsets.filter((o) => now - o.t < 8000); if (on.length < 6) return;
      const hist = new Float64Array(200);   // bpm 0..199
      for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
        const d = on[j].t - on[i].t; if (d > 2600) break; if (d < 230) continue;
        for (let k = 1; k <= 4; k++) { const P = d / k, bpm = 60000 / P; if (bpm < 70 || bpm > 180) continue; const w = (on[i].s + on[j].s) / k; for (let b = -1; b <= 1; b++) { const x = Math.round(bpm) + b; if (x > 0 && x < 200) hist[x] += w * (b === 0 ? 1 : 0.5); } }
      }
      let best = 0, bv = 0; for (let b = 70; b <= 180; b++) { const prior = Math.exp(-Math.pow(Math.log(b / 125), 2) / (2 * 0.4 * 0.4)); const v = hist[b] * prior; if (v > bv) { bv = v; best = b; } }
      if (!best) return;
      // refine the tempo around the winning bin using the votes of its neighbours
      let num = 0, den = 0; for (let b = best - 2; b <= best + 2; b++) { num += b * hist[b]; den += hist[b]; } const bpm = den ? num / den : best, T = 60000 / bpm;
      let x = 0, y = 0, sw = 0; for (const o of on) { const w = o.k > 0 ? o.k + 0.3 * o.s : o.s, ang = (((o.t - now) % T) + T) % T / T * 2 * Math.PI; x += w * Math.cos(ang); y += w * Math.sin(ang); sw += w; }
      const conf = sw ? Math.hypot(x, y) / sw : 0; S.conf = conf; if (conf < 0.4) return;
      const a = now + ((Math.atan2(y, x) / (2 * Math.PI) * T) % T);   // one beat time (beats sit at a + k*T)
      if (!S.grid || S.grid.fallback) { S.grid = { T, a }; S.nextBeat = firstBeat(now); return; }
      const Tg = S.grid.T; let dp = ((a - S.grid.a) % Tg + Tg) % Tg; if (dp > Tg / 2) dp -= Tg;   // how far the new phase is from the old grid, the short way round
      if (Math.abs(T - Tg) / Tg <= 0.06) S.grid.T += (T - Tg) * 0.2; else if (Math.abs(T - Tg) / Tg > 0.12 && Math.abs(T - Tg) / Tg < 0.9 && conf > 0.6) S.grid.T += (T - Tg) * 0.1;
      const k = Math.round((now - S.grid.a) / Tg); S.grid.a = S.grid.a + k * Tg + dp * 0.35;   // re-anchor near now so tempo drift cannot pile up
      if (S.lastBeatT) { const g = S.grid; S.nextBeat = g.a + Math.ceil((S.lastBeatT + 0.5 * g.T - g.a) / g.T) * g.T; }
    }
    function firstBeat(now) { const g = S.grid; return g.a + Math.ceil((now - 20 - g.a) / g.T) * g.T; }

    /** call every frame with the current time; returns the events that happened (beats, drops, ...) */
    function step(now) {
      if (now - S.lastEst > 250) { S.lastEst = now; estimate(now); }
      const ev = S.events.splice(0), beats = [];
      if (S.grid) {
        if (S.nextBeat < now - S.grid.T * 2) S.nextBeat = firstBeat(now);   // after a long pause: re-sync
        while (S.nextBeat <= now + (opts.lead || 0)) {
          const t = S.nextBeat; S.beatN++; S.lastBeatT = t;
          // 4. bar: which of 4 positions carries the strongest kick?
          let ks = 0; for (const o of S.onsets) if (Math.abs(o.t - t) < 70 && o.k > ks) ks = o.k; const idx = S.beatN % 4; S.barAcc[idx] = S.barAcc[idx] * 0.85 + ks * 0.15;
          let bi = 0, mx = -1, sum = 0; for (let i = 0; i < 4; i++) { sum += S.barAcc[i]; if (S.barAcc[i] > mx) { mx = S.barAcc[i]; bi = i; } } if (mx > 1.12 * sum / 4) S.barOff = bi;
          S.bar = ((S.beatN - S.barOff) % 4 + 4) % 4; beats.push({ type: 'beat', t, n: S.beatN, bar: S.bar });
          // the grid's own phase stays locked: next beat = previous + T, re-anchored to phi so tempo changes do not accumulate drift
          S.nextBeat = t + S.grid.T;
        }
      }
      return ev.concat(beats);
    }

    function view(now) {
      const g = S.grid, T = g ? g.T : 0, phase = g && S.lastBeatT ? clamp((now - S.lastBeatT) / T, 0, 1.5) : 0;
      return { bpm: g ? Math.round(60000 / g.T) : 0, period: T, phase: phase % 1, beatN: S.beatN, bar: S.bar, pulse: Math.exp(-Math.min(1.5, phase) * 3.2), state: S.state, buildP: S.buildP, sinceDrop: S.dropAt ? (now - S.dropAt) / 1000 : 99, conf: S.conf, locked: !!g,
        energy: { bass: S.avg.bass.f, mid: S.avg.mid.f, high: S.avg.high.f, total: S.avg.total.f }, lastFeed: S.lastFeed };
    }
    /** no audio data: run a plain grid so everything still moves in time */
    function setFallback(now, bpm) { if (S.grid && !S.grid.fallback && now - S.lastFeed < 12000) return;   // a real grid keeps running through short gaps in the data
      if (!S.grid || !S.grid.fallback) { S.grid = { T: 60000 / (bpm || 120), a: now, fallback: true }; S.nextBeat = firstBeat(now); } }
    function clearFallback() { if (S.grid && S.grid.fallback) S.grid = null; }
    return { feed, step, view, setFallback, clearFallback, _S: S };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = BeatEngine; else root.BeatEngine = BeatEngine;
})(typeof window !== 'undefined' ? window : globalThis);
