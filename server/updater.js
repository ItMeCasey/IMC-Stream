'use strict';
/**
 * Installing an update from a GitHub release: pick the installer and its SHA256SUMS.txt from the release, download the installer,
 * check its SHA-256 against the sums file, then start it silently (it closes this app, installs over it and starts the new version).
 * Only https links on github.com / githubusercontent.com are followed, and an installer without a matching checksum is never started.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn: nodeSpawn } = require('node:child_process');

const MAX_BYTES = 600 * 1024 * 1024;
const hostOk = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)(github\.com|githubusercontent\.com)$/.test(x.hostname); } catch (e) { return false; } };

/** the installer (.exe) and the checksum file of a GitHub release object; empty strings when the release has none */
function pickAssets(release) {
  const list = (release && release.assets) || [], pick = (re) => list.find((a) => re.test(String(a.name || '')) && hostOk(a.browser_download_url)) || null;
  const exe = pick(/\.exe$/i), sums = pick(/^SHA256SUMS\.txt$/i);
  return { name: exe ? exe.name : '', url: exe ? exe.browser_download_url : '', size: exe ? Number(exe.size) || 0 : 0, sumsUrl: sums ? sums.browser_download_url : '' };
}
/** the expected hash of a file from a sums file ("<hash>  <name>" per line) */
function expectedHash(sumsText, name) {
  for (const line of String(sumsText).split(/\r?\n/)) { const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i); if (m && m[2].trim() === name) return m[1].toLowerCase(); }
  return '';
}

function createUpdater(ctx) {
  const fetchFn = ctx.fetch || fetch, spawn = ctx.spawn || nodeSpawn, log = ctx.log || (() => {}), DIR = ctx.dir;
  let st = { state: 'idle', percent: 0, error: '', version: '' };   // idle | downloading | verifying | starting | error
  const set = (o) => { st = Object.assign({}, st, o); return st; };

  async function get(url, signal) {
    if (!hostOk(url)) throw new Error('Refusing to download from ' + url);
    const r = await fetchFn(url, { headers: { 'User-Agent': 'IMC-Stream' }, signal, redirect: 'follow' });
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    if (r.url && !hostOk(r.url)) throw new Error('The download was redirected somewhere unexpected');
    return r;
  }
  /** info = { latest, asset: { name, url, size, sumsUrl } } from the update check */
  async function install(info) {
    if (st.state === 'downloading' || st.state === 'verifying') throw new Error('An update is already being downloaded');
    const a = info && info.asset;
    if (!a || !a.url || !a.name) throw new Error('This release has no installer to download. Use the release page instead.');
    if (!a.sumsUrl) throw new Error('This release has no SHA256SUMS.txt, so the installer cannot be checked. Use the release page instead.');
    if (!/^[\w .()+-]+\.exe$/i.test(a.name)) throw new Error('Unexpected installer name');
    set({ state: 'downloading', percent: 0, error: '', version: info.latest || '' });
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 15 * 60e3);
    try {
      const sumsText = await (await get(a.sumsUrl, ac.signal)).text(), want = expectedHash(sumsText, a.name);
      if (!want) throw new Error('SHA256SUMS.txt does not list ' + a.name);
      const r = await get(a.url, ac.signal), total = Number(r.headers.get('content-length')) || a.size || 0;
      if (total > MAX_BYTES) throw new Error('The installer is larger than expected');
      fs.mkdirSync(DIR, { recursive: true });
      const dest = path.join(DIR, a.name), tmp = dest + '.part', hash = crypto.createHash('sha256'), out = fs.createWriteStream(tmp);
      let got = 0;
      try {
        for await (const chunk of r.body) {
          got += chunk.length; if (got > MAX_BYTES) throw new Error('The installer is larger than expected');
          hash.update(chunk); if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
          if (total) set({ percent: Math.min(99, Math.floor(got * 100 / total)) });
        }
        await new Promise((res, rej) => { out.on('error', rej); out.end(res); });
      } catch (e) { out.destroy(); try { fs.unlinkSync(tmp); } catch (x) { /* nothing to remove */ } throw e; }
      set({ state: 'verifying', percent: 100 });
      if (hash.digest('hex') !== want) { try { fs.unlinkSync(tmp); } catch (x) { /* nothing to remove */ } throw new Error('The download did not match its checksum, so it was thrown away'); }
      fs.renameSync(tmp, dest);
      set({ state: 'starting' }); log('update: starting', dest);
      const child = spawn(dest, ['/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref();
      return { ok: true, file: dest };
    } catch (e) { set({ state: 'error', error: e.name === 'AbortError' ? 'The download took too long' : e.message }); throw new Error(st.error); }
    finally { clearTimeout(timer); }
  }
  return { install, status: () => st };
}
module.exports = createUpdater;
module.exports.pickAssets = pickAssets; module.exports.expectedHash = expectedHash; module.exports.hostOk = hostOk;
