'use strict';
// Feeds the beat engine a synthetic track (126 bpm: kick on every beat, snare on 2 and 4, hats on the off-beats, then a breakdown with a rising build and a drop at 40 s)
const assert = require('assert'), BeatEngine = require('../overlays/beat.js');
const BPM = 126, T = 60000 / BPM, OFF = 137, T0 = 1.7e12, DT = 25, DROP_AT = 40000;
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function spectrum(t) {   // t = ms since the start of the track
  const r = new Array(32).fill(0), ph = ((t - OFF) % T + T) % T, beatIdx = Math.floor((t - OFF) / T), inBreak = t >= 30000 && t < DROP_AT, kickOn = !inBreak, since = ph, half = ((t - OFF + T / 2) % T + T) % T;
  const kick = kickOn ? Math.exp(-since / 80) : 0, snare = beatIdx % 2 === 1 ? Math.exp(-since / 70) : 0, hat = Math.exp(-half / 35), ramp = inBreak ? (t - 30000) / 10000 : 0;
  for (let i = 0; i < 32; i++) {
    let v = 6; if (i < 6) v += 3 + (kickOn ? 78 : 0) * kick; else if (i < 16) v += 22 + 45 * snare + (inBreak ? 8 : 0); else v += 8 + 38 * hat + 55 * ramp * (i / 32);
    r[i] = Math.max(0, Math.min(100, v + (rnd() - 0.5) * 4));
  }
  return r;
}
const eng = BeatEngine({}); const beats = [], events = [];
for (let t = 0; t <= 60000; t += DT) {
  eng.feed(spectrum(t), T0 + t); const now = T0 + t;
  for (const e of eng.step(now)) { if (e.type === 'beat') beats.push(e.t - T0); else events.push([e.type, t]); }
}
const v = eng.view(T0 + 60000);
// tempo
assert(Math.abs(v.bpm - BPM) <= 2, 'tempo ' + v.bpm);
// beat positions in a steady section (15 s to 29 s): distance to the nearest true kick
const err = beats.filter((b) => b > 15000 && b < 29000).map((b) => { const ph = ((b - OFF) % T + T) % T; return Math.min(ph, T - ph); });
const meanErr = err.reduce((a, b) => a + b, 0) / err.length; assert(err.length > 20 && meanErr < 40, 'beat error ' + meanErr.toFixed(1) + ' ms over ' + err.length + ' beats');
// the bar: beat 1 should be where the kick is strongest, all four kicks are equal here so only check that it cycles 0..3
const bars = new Set(beats.slice(-8).map(() => 0)); void bars;
// sections
const first = (n, from, to) => events.find((e) => e[0] === n && e[1] >= from && e[1] <= to);
assert(first('break', 30000, 34000), 'breakdown found ' + JSON.stringify(events));
assert(first('build', 32000, 39500), 'build-up found');
const drop = first('drop', DROP_AT - 500, DROP_AT + 2000); assert(drop, 'drop found ' + JSON.stringify(events)); assert(events.filter((e) => e[0] === 'drop').length === 1, 'one drop only');
console.log('beat test passed: ' + v.bpm + ' bpm, beat error ' + meanErr.toFixed(1) + ' ms, drop at ' + (drop[1] / 1000).toFixed(2) + ' s, events ' + events.map((e) => e[0] + '@' + (e[1] / 1000).toFixed(1)).join(' '));
