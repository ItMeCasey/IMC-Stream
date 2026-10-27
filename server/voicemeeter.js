'use strict';
/**
 * Voicemeeter helper for the Setup page: download + install (official VB-Audio files only, signature checked), set up the routing,
 * and change OBS so music and alert sounds stay out of the Twitch VOD (they are left off audio Track 2, the VOD track).
 */
const fs = require('node:fs'), path = require('node:path');
const { spawn, execFile } = require('node:child_process');

module.exports = function createVm(ctx) {
  const log = ctx.log || (() => {}), fetchFn = ctx.fetch || globalThis.fetch, ps = ctx.ps || runPs;
  const DIR = ctx.dir || path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VB', 'Voicemeeter');
  // the two editions we support: official page, installer zip name pattern, program files
  const KINDS = {
    banana: { name: 'Voicemeeter Banana', page: 'https://vb-audio.com/Voicemeeter/banana.htm', zip: /VoicemeeterSetup[^"']*\.zip/i, exes: ['voicemeeterpro.exe'] },
    potato: { name: 'Voicemeeter Potato', page: 'https://vb-audio.com/Voicemeeter/potato.htm', zip: /Voicemeeter8Setup[^"']*\.zip/i, exes: ['voicemeeter8x64.exe', 'voicemeeter8.exe'] },
  };
  // the only host anything is ever downloaded from
  const DOWNLOAD_HOST = 'download.vb-audio.com';
  const st = { banana: { state: 'idle', msg: '' }, potato: { state: 'idle', msg: '' } };   // idle | working | ready | error
  const dl = () => path.join(ctx.DATA, 'downloads');

  // run PowerShell and resolve with its output
  function runPs(args, opts) {
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'].concat(args), Object.assign({ windowsHide: true, timeout: 120000, maxBuffer: 4e6 }, opts), (err, out, errOut) => (err ? reject(new Error((errOut || err.message).toString().trim().split('\n')[0])) : resolve(String(out))));
    });
  }
  // is this edition's program in the Voicemeeter folder?
  const installed = (k) => KINDS[k].exes.some((e) => fs.existsSync(path.join(DIR, e)));

  // what the Setup page shows: Windows or not, the remote DLL, and each edition's install and download state
  function status() {
    return { platform: process.platform, dll: fs.existsSync(path.join(DIR, 'VoicemeeterRemote64.dll')), banana: Object.assign({ installed: installed('banana') }, st.banana), potato: Object.assign({ installed: installed('potato') }, st.potato) };
  }

  /** find the current setup zip on the official page, and only ever accept a link on VB-Audio's download host */
  async function resolveUrl(kind) {
    const K = KINDS[kind]; if (!K) throw new Error('Pick Banana or Potato');
    const html = await (await fetchFn(K.page)).text(), re = new RegExp('https?://' + DOWNLOAD_HOST.replace(/\./g, '\\.') + '/[^"\'\\s]*', 'gi');
    const hit = (html.match(re) || []).find((u) => K.zip.test(u)); if (!hit) throw new Error('Could not find the download on vb-audio.com (the page changed): use the Open vb-audio.com button');
    if (new URL(hit).hostname !== DOWNLOAD_HOST) throw new Error('Unexpected download address'); return hit;
  }

  // download and verify in the background; returns at once and progress shows up in st[kind]
  async function download(kind) {
    if (!KINDS[kind]) throw new Error('Pick Banana or Potato');
    if (st[kind].state === 'working') return st[kind];
    st[kind] = { state: 'working', msg: 'Finding the official download...' };
    (async () => {
      try {
        const url = await resolveUrl(kind); st[kind].msg = 'Downloading ' + path.basename(url) + '...';
        const r = await fetchFn(url); if (!r.ok) throw new Error('Download failed (HTTP ' + r.status + ')');
        const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 100000 || buf.length > 80e6) throw new Error('The download looks wrong (' + buf.length + ' bytes)');
        const dir = path.join(dl(), kind); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
        const zip = path.join(dir, path.basename(new URL(url).pathname)); fs.writeFileSync(zip, buf);
        st[kind].msg = 'Unpacking...'; await ps(['-Command', 'Expand-Archive -LiteralPath "' + zip + '" -DestinationPath "' + path.join(dir, 'x') + '" -Force']);
        const exe = findSetup(path.join(dir, 'x')); if (!exe) throw new Error('No installer found inside the download');
        st[kind].msg = 'Checking the signature...';
        const sig = (await ps(['-Command', '$s = Get-AuthenticodeSignature -LiteralPath "' + exe + '"; "$($s.Status)|$($s.SignerCertificate.Subject)"'])).trim();
        if (!/^Valid\|/.test(sig) || !/VB-?Audio|Burel/i.test(sig)) throw new Error('The installer is not signed by VB-Audio (' + sig + '): not running it');
        st[kind] = { state: 'ready', msg: 'Downloaded and verified (' + path.basename(exe) + ')', exe }; log('voicemeeter: ' + kind + ' installer ready');
      } catch (e) { st[kind] = { state: 'error', msg: e.message }; log('voicemeeter download failed:', e.message); }
    })();
    return st[kind];
  }
  // pick the installer exe inside the unpacked zip
  function findSetup(dir) {
    let best = ''; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/setup.*\.exe$/i.test(e.name) && (!best || /x64/i.test(e.name))) best = f; } };
    try { walk(dir); } catch (e) { /* none */ } return best;
  }

  /** runs the (already verified) installer; Windows shows its permission prompt, then Voicemeeter's own installer window */
  function install(kind) {
    const s = st[kind]; if (!s || s.state !== 'ready' || !s.exe || !fs.existsSync(s.exe)) throw new Error('Download it first');
    // "start" hands the file to Windows' shell, which shows the permission prompt for installers that need admin rights (a plain spawn cannot)
    const c = spawn('cmd.exe', ['/c', 'start', '', s.exe], { detached: true, stdio: 'ignore', windowsHide: true, cwd: path.dirname(s.exe) });
    c.on('error', (e) => { st[kind].msg = 'Could not start the installer: ' + e.message; }); c.unref();
    return { ok: true, file: s.exe };
  }

  /** audio devices Windows has, to pick the mic and headphones from */
  async function devices() {
    const out = await ps(['-Command', 'Get-PnpDevice -Class AudioEndpoint -Status OK | ForEach-Object { $_.InstanceId + "|" + $_.FriendlyName }']);
    const r = { inputs: [], outputs: [] };
    for (const line of out.split(/\r?\n/)) {
      const i = line.indexOf('|'); if (i < 0) continue; const id = line.slice(0, i), name = line.slice(i + 1).trim(); if (!name || /voicemeeter|vb-audio|cable/i.test(name)) continue;
      (/\{0\.0\.1\./.test(id) ? r.inputs : r.outputs).push(name);
    }
    r.inputs = [...new Set(r.inputs)]; r.outputs = [...new Set(r.outputs)]; return r;
  }

  // run the PowerShell script that sets Voicemeeter's routing (mic and headphones)
  async function configure(b) {
    const kind = b.kind === 'potato' ? 'potato' : 'banana'; if (!installed(kind)) throw new Error(KINDS[kind].name + ' is not installed yet (install it and restart Windows first)');
    const args = ['-File', path.join(__dirname, 'media', 'vm-config.ps1'), '-Kind', kind, '-Mic', String(b.mic || ''), '-Out', String(b.out || '')]; if (b.hearMic) args.push('-HearMic');
    const out = (await ps(args)).trim().split(/\r?\n/).pop(); let j; try { j = JSON.parse(out); } catch (e) { throw new Error('Voicemeeter setup gave no answer: ' + out.slice(0, 200)); }
    if (!j.ok) throw new Error(j.error || 'Voicemeeter setup failed'); return j;
  }

  // ------------------------------------------------------------------ OBS
  // OBS audio track map {1..6: bool} with only the listed tracks on
  const TRACKS = (on) => { const t = {}; for (let i = 1; i <= 6; i++) t[String(i)] = on.includes(i); return t; };
  // OBS sources with their track 2 state, and a guess at which ones should stay out of the VOD (by source kind)
  async function obsInputs() {
    return ctx.obs.raw(async (call) => {
      const list = (await call('GetInputList')).inputs || [], out = [];
      for (const i of list) {
        let tracks = null; try { tracks = (await call('GetInputAudioTracks', { inputName: i.inputName })).inputAudioTracks; } catch (e) { continue; }   // no audio: skip
        out.push({ name: i.inputName, kind: i.inputKind, track2: !!(tracks && tracks['2']), keepOut: /browser_source|ffmpeg_source|vlc_source/.test(i.inputKind) || /music|alert|spotify|song/i.test(i.inputName) });
      }
      return out;
    });
  }
  /** B1 (game, chat, mic) -> tracks 1+2; B2 (music) and the chosen sources (alerts, music players) -> track 1 only, so the VOD never hears them */
  async function obsApply(b) {
    const exclude = (Array.isArray(b.exclude) ? b.exclude : []).map(String), muteOld = b.muteOld !== false, steps = [];
    // run one setup action and record how it went; a failure is reported but does not stop the rest
    const step = async (label, fn) => { try { const d = await fn(); steps.push({ ok: true, label, detail: d || '' }); return true; } catch (e) { steps.push({ ok: false, label, detail: e.message }); return false; } };
    await ctx.obs.raw(async (call) => {
      const NAMES = { b1: 'Voicemeeter B1 (game + mic)', b2: 'Voicemeeter B2 (music)' };
      const have = new Set(((await call('GetInputList')).inputs || []).map((i) => i.inputName));
      const scenes = ((await call('GetSceneList')).scenes || []).map((s) => s.sceneName);
      // [id, Voicemeeter device name to find in OBS, audio tracks]
      for (const [key, want, tracks] of [['b1', 'Voicemeeter Out B1', [1, 2]], ['b2', 'Voicemeeter Out B2', [1]]]) {
        const name = NAMES[key];
        await step('Add ' + name, async () => {
          if (!have.has(name)) {
            if (!scenes.length) throw new Error('OBS has no scenes');
            await call('CreateInput', { sceneName: scenes[0], inputName: name, inputKind: 'wasapi_input_capture', inputSettings: {}, sceneItemEnabled: true }); have.add(name);
            for (const sc of scenes.slice(1)) { try { await call('CreateSceneItem', { sceneName: sc, sourceName: name, sceneItemEnabled: true }); } catch (e) { /* already there */ } }
          }
          const items = (await call('GetInputPropertiesListPropertyItems', { inputName: name, propertyName: 'device_id' })).propertyItems || [];
          const dev = items.find((x) => String(x.itemName).toLowerCase().includes(want.toLowerCase())); if (!dev) throw new Error('"' + want + '" is not listed: install Voicemeeter, restart Windows and open it once');
          await call('SetInputSettings', { inputName: name, inputSettings: { device_id: dev.itemValue }, overlay: true });
          await call('SetInputAudioTracks', { inputName: name, inputAudioTracks: TRACKS(tracks) }); return 'tracks ' + tracks.join('+');
        });
      }
      for (const n of exclude) await step('Keep "' + n + '" out of the VOD', async () => { await call('SetInputAudioTracks', { inputName: n, inputAudioTracks: TRACKS([1]) }); return 'track 1 only'; });
      if (muteOld && steps.filter((s) => s.ok && /^Add/.test(s.label)).length === 2) {
        // mute OBS's own desktop and mic inputs so nothing is heard twice
        const sp = await call('GetSpecialInputs').catch(() => ({}));
        for (const n of [sp.desktop1, sp.desktop2, sp.mic1].filter(Boolean)) await step('Mute the old "' + n + '" (Voicemeeter replaces it)', async () => { await call('SetInputMute', { inputName: n, inputMuted: true }); return 'muted'; });
      }
      // per-source audio tracks only exist in OBS's Advanced output mode
      await step('Switch OBS to Advanced output mode', async () => { await call('SetProfileParameter', { parameterCategory: 'Output', parameterName: 'Mode', parameterValue: 'Advanced' }); return 'takes effect after OBS restarts'; });
    });
    return { steps };
  }

  // ------------------------------------------------------------------ live volumes (Voicemeeter bus gains), through one long-running helper
  // the bridge: one long-running PowerShell helper that talks to Voicemeeter; waiters are answered in order
  let br = null, brBuf = '', brWait = [], brIdle = null, chain = Promise.resolve();
  const spawnFn = ctx.spawn || spawn;
  // kill the helper and fail anything still waiting
  function bridgeStop() { const c = br; br = null; clearTimeout(brIdle); if (c) { try { c.stdin.end(); c.kill(); } catch (e) { /* gone */ } } for (const w of brWait.splice(0)) w.rej(new Error('Voicemeeter helper stopped')); }
  // start the helper if it is not running; it answers with one JSON line per request
  function bridgeStart() {
    if (br) return; brBuf = '';
    const c = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'media', 'vm-bridge.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); br = c;
    c.stdout.on('data', (d) => { brBuf += d.toString('utf8'); let i; while ((i = brBuf.indexOf('\n')) >= 0) { const line = brBuf.slice(0, i).trim(); brBuf = brBuf.slice(i + 1); const w = brWait.shift(); if (w && line) { try { w.res(JSON.parse(line)); } catch (e) { w.rej(new Error('Bad answer from the helper')); } } } });
    c.on('exit', () => { if (br === c) { br = null; for (const w of brWait.splice(0)) w.rej(new Error('Voicemeeter helper stopped')); } }); c.on('error', () => { if (br === c) bridgeStop(); });
  }
  function ask(cmd) {   // one request at a time, in order
    const run = () => new Promise((res, rej) => {
      bridgeStart(); const w = { res, rej }; brWait.push(w); br.stdin.write(JSON.stringify(cmd) + '\n');
      const t = setTimeout(() => { const i = brWait.indexOf(w); if (i >= 0) { brWait.splice(i, 1); bridgeStop(); rej(new Error('Voicemeeter did not answer')); } }, 8000); if (t.unref) t.unref();
      clearTimeout(brIdle); brIdle = setTimeout(bridgeStop, 90000); if (brIdle.unref) brIdle.unref();
    });
    const p = chain.then(run, run); chain = p.catch(() => {}); return p;
  }
  /** { ok, kind, local, b1, b2 } in dB, or { ok: false, error } when Voicemeeter is not installed or not running */
  async function volumes() { if (!installed('banana') && !installed('potato') && !ctx.spawn) return { ok: false, error: 'Voicemeeter is not installed' }; try { return await ask({ op: 'get' }); } catch (e) { return { ok: false, error: e.message }; } }
  // set a bus gain in dB; which = local | b1 | b2
  async function setVolume(which, db) { if (!['local', 'b1', 'b2'].includes(which)) throw new Error('Unknown volume'); const r = await ask({ op: 'set', which, db: Number(db) }); if (!r.ok) throw new Error(r.error || 'Could not set the volume'); return r; }

  return { volumes, setVolume, stop: bridgeStop, status, download, install, devices, configure, obsInputs, obsApply, resolveUrl };
};
