'use strict';
/** Settings backup / restore as a .zip (made with the tar.exe that ships with Windows 10/11, no extra software). */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = function createBackup(ctx) {
  const DATA = ctx.DATA, DIR = path.join(DATA, 'backups'), log = ctx.log || (() => {});
  const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  // login files are left out of a backup unless asked for, so a shared zip does not hand out access
  const LOGINS = ['tokens.json', 'spotify.json', 'bot-account.json', 'paypal.json'];
  // secrets that live inside settings files; a backup made without logins gets these blanked, and a restore keeps the ones already on this PC
  const SECRETS = { 'state.json': [['obsCfg', 'password'], ['access', 'hash'], ['access', 'salt']], 'config.json': [['stripe', 'apiKey']] };
  const getAt = (o, p) => p.reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
  function setAt(o, p, v) { let x = o; for (const k of p.slice(0, -1)) { if (!x[k] || typeof x[k] !== 'object') x[k] = {}; x = x[k]; } x[p[p.length - 1]] = v; }
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
  // UTC timestamp usable in a file name, like 2026-10-26-14-03-59
  const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

  // run tar and return its output; throws a plain-English error when it fails
  function tar(args, cwd) {
    const r = spawnSync(TAR, args, { cwd, windowsHide: true, encoding: 'utf8' });
    if (r.error || r.status !== 0) throw new Error('The zip tool failed: ' + ((r.stderr || (r.error && r.error.message) || '').trim().split('\n')[0] || 'unknown error'));
    return r.stdout;
  }
  /** what goes in: settings, bot data, your uploads (+ logins only when asked). Not caches, logs or voice clips. */
  function members(includeLogins) {
    const keep = ['state.json', 'bot.json', 'config.json', 'custom', 'modules'].concat(includeLogins ? LOGINS : []);
    return keep.filter((f) => fs.existsSync(path.join(DATA, f)));
  }
  // write a new zip; the daily automatic one has a date-only name, so there is one per day
  function create(opts = {}) {
    fs.mkdirSync(DIR, { recursive: true });
    const files = members(!!opts.includeLogins); if (!files.length) throw new Error('Nothing to back up yet');
    const out = opts.out || path.join(DIR, (opts.auto ? 'auto-' : 'backup-') + (opts.auto ? stamp().slice(0, 10) : stamp()) + '.zip');
    try { fs.unlinkSync(out); } catch (e) { /* new file */ }
    if (opts.includeLogins) tar(['-a', '-c', '-f', out].concat(files), DATA);
    else {   // without logins: pack a copy of the files in which the passwords and keys are blanked, so a shared zip does not hand out access
      const stage = fs.mkdtempSync(path.join(DIR, 'stage-'));
      try {
        for (const f of files) {
          const j = SECRETS[f] && readJson(path.join(DATA, f));
          if (j) { for (const p of SECRETS[f]) if (getAt(j, p)) setAt(j, p, ''); if (f === 'state.json' && j.access) j.access.lan = false; fs.writeFileSync(path.join(stage, f), JSON.stringify(j, null, 2)); }
          else fs.cpSync(path.join(DATA, f), path.join(stage, f), { recursive: true });
        }
        tar(['-a', '-c', '-f', out].concat(files), stage);
      } finally { fs.rmSync(stage, { recursive: true, force: true }); }
    }
    return { file: out, size: fs.statSync(out).size, files };
  }
  // the backup zips that exist, newest first
  function list() {
    try { return fs.readdirSync(DIR).filter((f) => f.endsWith('.zip')).map((f) => ({ name: f, size: fs.statSync(path.join(DIR, f)).size, mtime: fs.statSync(path.join(DIR, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime); } catch (e) { return []; }
  }
  // refuse an unpacked folder that contains a symbolic link or junction: it could point outside the data folder
  function refuseLinks(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (fs.lstatSync(f).isSymbolicLink()) throw new Error('That zip contains a link (' + e.name + '), so it was not restored');
      if (e.isDirectory()) refuseLinks(f);
    }
  }
  // put a backup back. Every entry is checked first, so a foreign zip cannot write outside the data folder (.. or absolute paths)
  function restore(zip) {
    const names = tar(['-t', '-f', zip]).split(/\r?\n/).filter(Boolean);
    if (!names.length) throw new Error('That file is empty');
    const ok = new Set(['state.json', 'bot.json', 'config.json', 'tokens.json', 'spotify.json', 'bot-account.json', 'paypal.json', 'custom', 'modules']);
    for (const n of names) {
      const top = n.replace(/\\/g, '/').split('/')[0];
      if (n.includes('..') || path.isAbsolute(n) || /^[a-zA-Z]:/.test(n) || !ok.has(top)) throw new Error('That does not look like an IMC-Stream backup (unexpected file: ' + n + ')');
    }
    create({ out: path.join(DIR, 'before-restore-' + stamp() + '.zip'), includeLogins: true });   // always keep a way back
    // unpack to a temp folder first, so the real data is only touched once the zip has opened properly
    const tmp = fs.mkdtempSync(path.join(DIR, 'restore-'));
    try {
      tar(['-x', '-f', zip, '-C', tmp]);
      refuseLinks(tmp);
      // a backup made without logins has the passwords and keys blanked: keep the ones this PC already has instead of wiping them
      for (const f of Object.keys(SECRETS)) {
        const inc = readJson(path.join(tmp, f)), cur = readJson(path.join(DATA, f)); if (!inc || !cur) continue;
        let changed = false; for (const p of SECRETS[f]) if (!getAt(inc, p) && getAt(cur, p)) { setAt(inc, p, getAt(cur, p)); changed = true; }
        if (changed) { if (f === 'state.json' && inc.access && getAt(cur, ['access', 'lan'])) inc.access.lan = true; fs.writeFileSync(path.join(tmp, f), JSON.stringify(inc, null, 2)); }
      }
      for (const n of fs.readdirSync(tmp)) { const to = path.join(DATA, n); fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(path.join(tmp, n), to, { recursive: true }); }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    return { ok: true, restored: names.length, restart: true };
  }
  /** keep a daily automatic backup (no logins), newest 7 */
  function auto() {
    try {
      const today = path.join(DIR, 'auto-' + stamp().slice(0, 10) + '.zip');
      if (!fs.existsSync(today) && members(false).length) create({ auto: true });
      // list() is newest first, so slice(7) is everything older than the newest 7
      for (const f of list().filter((x) => x.name.startsWith('auto-')).slice(7)) fs.unlinkSync(path.join(DIR, f.name));
    } catch (e) { log('automatic backup failed:', e.message); }
  }
  return { create, restore, list, auto, dir: DIR, refuseLinks };
};
