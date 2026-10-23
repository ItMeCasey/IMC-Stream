'use strict';
/** Tiny WAV tools for mixing text-to-speech with sound effects: read a PCM or float WAV as mono samples, change the sample rate, join pieces and write a 16-bit WAV. */

/** { rate, samples: Float32Array (mono, -1..1) } from a WAV file's bytes; throws on anything that is not a PCM / float WAV */
function parse(buf) {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4); let size = buf.readUInt32LE(pos + 4); const start = pos + 8;
    if (id === 'fmt ') fmt = { code: buf.readUInt16LE(start), channels: buf.readUInt16LE(start + 2), rate: buf.readUInt32LE(start + 4), bits: buf.readUInt16LE(start + 14) };
    else if (id === 'data') { size = Math.min(size, buf.length - start); data = buf.subarray(start, start + size); break; }   // (streamed files can claim a size that is too big)
    pos = start + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV has no audio');
  let code = fmt.code; if (code === 0xFFFE) code = fmt.bits === 32 ? 3 : 1;   // "extensible": guess from the bit depth
  if (![8, 16, 24, 32].includes(fmt.bits) || (code !== 1 && code !== 3) || !fmt.channels) throw new Error('unsupported WAV format');
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.channels)), out = new Float32Array(frames);
  const read = (o) => (code === 3 && fmt.bits === 32 ? data.readFloatLE(o) : fmt.bits === 16 ? data.readInt16LE(o) / 32768 : fmt.bits === 8 ? (data.readUInt8(o) - 128) / 128 : fmt.bits === 24 ? data.readIntLE(o, 3) / 8388608 : data.readInt32LE(o) / 2147483648);
  for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < fmt.channels; c++) s += read((i * fmt.channels + c) * bytes); out[i] = s / fmt.channels; }
  return { rate: fmt.rate, samples: out };
}
/** linear resampling */
function resample(x, from, to) {
  if (from === to || !x.length) return x; const n = Math.max(1, Math.round(x.length * to / from)), out = new Float32Array(n), k = (x.length - 1) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) { const p = i * k, i0 = Math.floor(p), f = p - i0; out[i] = x[i0] * (1 - f) + (x[Math.min(x.length - 1, i0 + 1)] * f); }
  return out;
}
/** pieces ({ rate, samples }) joined at one sample rate, with `gap` seconds of silence between them */
function join(pieces, rate, gap) {
  const parts = []; pieces.forEach((p, i) => { if (i && gap) parts.push(new Float32Array(Math.round(rate * gap))); parts.push(resample(p.samples, p.rate, rate)); });
  const out = new Float32Array(parts.reduce((a, b) => a + b.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
/** a 16-bit mono WAV file */
function write(samples, rate) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'latin1'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8, 'latin1'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1'); buf.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}
module.exports = { parse, resample, join, write };
