'use strict';
/**
 * Text-to-speech. Two engines, chosen by the voice name:
 *  - Windows voices (David, Zira...): instant, offline, robotic-ish.  e.g. "Microsoft Zira Desktop"
 *  - Kokoro (optional, installed in server/kokoro): realistic, offline, ~2x real time on a normal CPU.  e.g. "af_heart"
 * Clips are cached as WAV files and played by overlays/alerts.html.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const KOKORO_VOICE = /^[abefhip][fm]_[a-z]+$/;   // af_heart, am_adam, bf_emma ...

module.exports = function createTts(ctx) {
  const cfg = () => ctx.state.ttsCfg;
  const log = ctx.log || (() => {});
  const spawnFn = ctx.spawn || spawn;
  const DIR = path.join(ctx.DATA, 'tts'); fs.mkdirSync(DIR, { recursive: true });
  const SCRIPT = path.join(__dirname, 'media', 'tts.ps1'), WORKER = path.join(__dirname, 'media', 'kokoro_worker.py');
  const KDIR = ctx.kokoroDir || process.env.ICM_KOKORO_DIR || path.join(__dirname, 'kokoro');
  const KPY = path.join(KDIR, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const canWin = () => process.platform === 'win32' || !!ctx.spawn;
  let voicesCache = null, chain = Promise.resolve(), seq = 0;
  const history = [];
  const PS = (args) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT].concat(args);

  function run(args) {
    return new Promise((resolve, reject) => {
      let out = '', err = '', c;
      try { c = spawnFn('powershell.exe', PS(args), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return reject(new Error('Could not start PowerShell')); }
      c.stdout.on('data', (d) => { out += d.toString('utf8'); }); c.stderr && c.stderr.on('data', (d) => { err += d.toString('utf8'); });
      c.on('error', () => reject(new Error('Could not start PowerShell')));
      c.on('exit', (code) => (code === 0 || code === null ? resolve(out) : reject(new Error((err.trim().split('\n')[0] || 'Speech engine failed')))));
    });
  }

  // ---------------------------------------------------------------- Kokoro worker (a Python process that keeps the model loaded)
  const kokoroModel = () => ['kokoro-v1.0.onnx', 'kokoro-v1.0.int8.onnx'].map((f) => path.join(KDIR, 'models', f)).find((f) => fs.existsSync(f)) || null;
  const kokoroVoicesFile = () => path.join(KDIR, 'models', 'voices-v1.0.bin');
  const kokoroInstalled = () => !!(fs.existsSync(KPY) && kokoroModel() && fs.existsSync(kokoroVoicesFile()));
  let worker = null, workerReady = null, kokoroVoices = [], pend = new Map(), idleT = null, wbuf = '', wseq = 0;
  function startWorker() {
    if (workerReady) return workerReady;
    workerReady = new Promise((resolve, reject) => {
      let c;
      try { c = spawnFn(ctx.kokoroPython || KPY, ['-I', WORKER, kokoroModel(), kokoroVoicesFile()], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { workerReady = null; return reject(new Error('Could not start Kokoro')); }
      worker = c; wbuf = '';
      let stderr = '';
      c.stderr && c.stderr.on('data', (d) => { stderr = (stderr + d.toString('utf8')).slice(-600); });
      c.stdout.on('data', (d) => {
        wbuf += d.toString('utf8'); let i;
        while ((i = wbuf.indexOf('\n')) >= 0) {
          const line = wbuf.slice(0, i).trim(); wbuf = wbuf.slice(i + 1); if (!line) continue;
          let j; try { j = JSON.parse(line); } catch (e) { continue; }
          if (j.ready === true) { kokoroVoices = j.voices || []; voicesCache = null; resolve(); }
          else if (j.ready === false) { workerReady = null; reject(new Error('Kokoro could not start: ' + j.error)); }
          else if (j.id != null && pend.has(j.id)) { const p = pend.get(j.id); pend.delete(j.id); j.ok ? p.resolve(j) : p.reject(new Error(j.error || 'Kokoro failed')); }
        }
      });
      c.on('error', () => { workerReady = null; reject(new Error('Could not start Kokoro')); });
      c.on('exit', () => { if (worker === c) { worker = null; workerReady = null; } for (const p of pend.values()) p.reject(new Error('Kokoro stopped')); pend.clear(); if (stderr.trim()) log('kokoro:', stderr.trim().split('\n').pop()); });
    });
    return workerReady;
  }
  function bumpIdle() { clearTimeout(idleT); idleT = setTimeout(() => { if (worker) { try { worker.kill(); } catch (e) { /* gone */ } } }, 15 * 60000); if (idleT.unref) idleT.unref(); }
  async function kokoroSynth(text, voice, speed, out) {
    await startWorker(); bumpIdle();
    const id = ++wseq;
    return new Promise((resolve, reject) => {
      pend.set(id, { resolve, reject });
      try { worker.stdin.write(JSON.stringify({ id, text, voice, speed, out }) + '\n'); } catch (e) { pend.delete(id); reject(new Error('Kokoro stopped')); }
      const t = setTimeout(() => { if (pend.delete(id)) reject(new Error('Kokoro took too long')); }, 120000); if (t.unref) t.unref();
    });
  }
  const stopKokoro = () => { clearTimeout(idleT); if (worker) { try { worker.kill(); } catch (e) { /* gone */ } } };

  // ---------------------------------------------------------------- voices
  async function winVoices() {
    if (!canWin()) return [];
    try { const j = JSON.parse((await run(['-Action', 'voices'])).trim() || '[]'); return (Array.isArray(j) ? j : [j]).map((v) => Object.assign({ engine: 'windows' }, v)); } catch (e) { log('tts: could not list Windows voices:', e.message); return []; }
  }
  async function voices(force) {
    if (voicesCache && !force) return voicesCache;
    const w = await winVoices();
    let k = [];
    if (kokoroInstalled()) {
      try { await startWorker(); k = kokoroVoices.map((n) => ({ engine: 'kokoro', name: n, gender: n[1] === 'f' ? 'Female' : 'Male', culture: { a: 'en-US', b: 'en-GB', e: 'es', f: 'fr', h: 'hi', i: 'it', p: 'pt-BR' }[n[0]] || '' })); } catch (e) { log('tts: Kokoro unavailable:', e.message); }
    }
    return (voicesCache = k.concat(w));
  }
  const engineFor = (o = {}) => { const v = o.voice !== undefined ? o.voice : cfg().voice; return KOKORO_VOICE.test(String(v || '')) && kokoroInstalled() ? 'kokoro' : 'windows'; };

  /** make the text safe and pleasant to read aloud; throws Error('blocked') / Error('Nothing to say') */
  function clean(text) {
    let t = String(text == null ? '' : text);
    t = t.replace(/https?:\/\/\S+|www\.\S+/gi, ' link ').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ').replace(/[\r\n\t]+/g, ' ')
      .replace(/(.)\1{3,}/g, '$1$1$1').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
    t = t.slice(0, cfg().maxChars).trim();
    if (!t || !/[\p{L}\p{N}]/u.test(t)) throw new Error('Nothing to say');
    const words = (cfg().blockWords || []).concat(ctx.blockWords ? ctx.blockWords() : []), low = t.toLowerCase();
    for (let w of words) {
      w = String(w).trim(); if (!w) continue; const rx = /^\/(.+)\/([a-z]*)$/.exec(w);
      if (rx) { try { if (new RegExp(rx[1], rx[2] || 'i').test(t)) throw new Error('blocked'); } catch (e) { if (e.message === 'blocked') throw e; } } else if (low.includes(w.toLowerCase())) throw new Error('blocked');
    }
    return t;
  }

  function synth(text, o) {
    const c = cfg(), voice0 = o.voice !== undefined ? o.voice : c.voice, rate = o.rate != null ? o.rate : c.rate, pitch = o.pitch != null ? o.pitch : c.pitch;
    const engine = engineFor({ voice: voice0 }), voice = engine === 'kokoro' ? voice0 : (KOKORO_VOICE.test(String(voice0 || '')) ? '' : voice0);   // Kokoro voice but Kokoro missing: use the Windows default
    const key = crypto.createHash('sha1').update([engine, text, voice, rate, engine === 'kokoro' ? 0 : pitch].join('\u0001')).digest('hex'), file = path.join(DIR, key + '.wav');
    if (fs.existsSync(file) && fs.statSync(file).size > 44) return Promise.resolve(key + '.wav');
    if (engine === 'windows' && !canWin()) return Promise.reject(new Error('Text-to-speech needs Windows or Kokoro'));
    const job = chain.then(async () => {
      if (engine === 'kokoro') {
        try { await kokoroSynth(text, voice, Math.min(1.5, Math.max(0.6, 1 + (rate || 0) * 0.05)), file); }
        catch (e) {   // fall back to a Windows voice rather than saying nothing
          log('tts: Kokoro failed (' + e.message + '), using a Windows voice'); if (!canWin()) throw e;
          const txt = path.join(DIR, key + '.txt'); fs.writeFileSync(txt, text, 'utf8');
          try { await run(['-Action', 'speak', '-TextFile', txt, '-Out', file, '-Voice', '', '-Rate', String(rate || 0), '-Pitch', '0']); } finally { try { fs.unlinkSync(txt); } catch (x) { /* gone */ } }
        }
      } else {
        const txt = path.join(DIR, key + '.txt'); fs.writeFileSync(txt, text, 'utf8');
        try { await run(['-Action', 'speak', '-TextFile', txt, '-Out', file, '-Voice', voice || '', '-Rate', String(rate || 0), '-Pitch', String(pitch || 0)]); }
        finally { try { fs.unlinkSync(txt); } catch (e) { /* gone */ } }
      }
      if (!fs.existsSync(file) || fs.statSync(file).size <= 44) throw new Error('The speech engine made no sound');
      return key + '.wav';
    });
    chain = job.catch(() => {});   // one clip at a time; one failure must not block the next
    return job;
  }

  /** returns {url, text, volume}: a playable clip */
  async function speak(text, o = {}) {
    if (!cfg().on) throw new Error('Text-to-speech is turned off');
    const t = clean(text), f = await synth(t, o);
    return { url: '/tts/' + f, text: t, volume: o.volume != null ? o.volume : cfg().volume };
  }
  /** speak it now through the overlay (chat !tts, reward hooks, test button) */
  async function say(text, o = {}) {
    const item = await speak(text, o); item.id = ++seq; item.by = o.by || ''; item.ts = Date.now();
    history.unshift(item); history.length = Math.min(history.length, 30);
    ctx.broadcast('tts', item); return item;
  }
  const ctl = (action) => { if (action === 'skip' || action === 'clear') ctx.broadcast('ttsctl', { action }); return { ok: true }; };
  function clip(name) { return /^[a-f0-9]{40}\.wav$/.test(name) && fs.existsSync(path.join(DIR, name)) ? path.join(DIR, name) : null; }
  function cleanup() { try { for (const f of fs.readdirSync(DIR)) { const p = path.join(DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600e3) fs.unlinkSync(p); } } catch (e) { /* ignore */ } }
  // First run: fill the hidden never-read list with the starter set of slurs, hate phrases, threats and their spaced / leet / sound-alike spellings.
  setImmediate(function seedBlockList() {
    const c = cfg(); if (c.blockSeeded) return;
    try { settings({ addBlock: fs.readFileSync(path.join(__dirname, 'never-read-seed.txt'), 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean) }); } catch (e) { log('could not load the starter never-read list:', e.message); }
    c.blockSeeded = 1; ctx.persist();
  });
  cleanup(); const iv = setInterval(cleanup, 3600e3); if (iv.unref) iv.unref();

  function settings(b) {
    const c = cfg(), n = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
    if (b.on !== undefined) c.on = !!b.on;
    if (typeof b.voice === 'string') { c.voice = b.voice.replace(/[^\w .\-()]/g, '').slice(0, 100); c.chosen = true; }
    if (b.rate !== undefined) c.rate = n(b.rate, 0, -10, 10); if (b.pitch !== undefined) c.pitch = n(b.pitch, 0, -2, 2);
    if (b.volume !== undefined) c.volume = n(b.volume, 80, 0, 100); if (b.maxChars !== undefined) c.maxChars = n(b.maxChars, 200, 20, 400);
    // The never-read list is write-only: words can be added, but never listed, edited or removed from the app.
    if (b.addBlock !== undefined) {
      const have = new Set((c.blockWords || []).map((x) => x.toLowerCase())), add = (Array.isArray(b.addBlock) ? b.addBlock : String(b.addBlock).split('\n')).map((x) => String(x).trim().slice(0, 400)).filter((x) => { const k = x.toLowerCase(); if (!x || have.has(k)) return false; have.add(k); return true; });
      c.blockWords = (c.blockWords || []).concat(add).slice(0, 2000);
    }
    if (b.command) { const x = b.command; c.command = { on: !!x.on, level: ['everyone', 'subscriber', 'vip', 'moderator'].includes(x.level) ? x.level : 'subscriber', cost: n(x.cost, 0, 0, 1e7), userCd: n(x.userCd, 60, 0, 3600) }; }
    ctx.persist(); return view();
  }
  const view = () => { const { blockWords, ...open } = cfg(); return { cfg: Object.assign(open, { blockCount: (blockWords || []).length }), history, voices: voicesCache || [], canSpeak: canWin() || kokoroInstalled(),
    kokoro: { installed: kokoroInstalled(), model: kokoroModel() ? path.basename(kokoroModel()) : '', running: !!worker } }; };
  return { cfg, speak, say, ctl, clip, voices, settings, view, clean, engineFor, stopKokoro, kokoroInstalled };
};
