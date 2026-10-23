'use strict';
/** Settings backup / restore as a .zip (made with the tar.exe that ships with Windows 10/11, no extra software). */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = function createBackup(ctx) {
  const DATA = ctx.DATA, DIR = path.join(DATA, 'backups'), log = ctx.log || (() => {});
  const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const LOGINS = ['tokens.json', 'spotify.json', 'bot-account.json', 'paypal.json'];
  const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

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
  function create(opts = {}) {
    fs.mkdirSync(DIR, { recursive: true });
    const files = members(!!opts.includeLogins); if (!files.length) throw new Error('Nothing to back up yet');
    const out = opts.out || path.join(DIR, (opts.auto ? 'auto-' : 'backup-') + (opts.auto ? stamp().slice(0, 10) : stamp()) + '.zip');
    try { fs.unlinkSync(out); } catch (e) { /* new file */ }
    tar(['-a', '-c', '-f', out].concat(files), DATA);
    return { file: out, size: fs.statSync(out).size, files };
  }
  function list() {
    try { return fs.readdirSync(DIR).filter((f) => f.endsWith('.zip')).map((f) => ({ name: f, size: fs.statSync(path.join(DIR, f)).size, mtime: fs.statSync(path.join(DIR, f)).mtimeMs })).sort((a, b) => b.mtime - a.mtime); } catch (e) { return []; }
  }
  function restore(zip) {
    const names = tar(['-t', '-f', zip]).split(/\r?\n/).filter(Boolean);
    if (!names.length) throw new Error('That file is empty');
    const ok = new Set(['state.json', 'bot.json', 'config.json', 'tokens.json', 'spotify.json', 'bot-account.json', 'paypal.json', 'custom', 'modules']);
    for (const n of names) {
      const top = n.replace(/\\/g, '/').split('/')[0];
      if (n.includes('..') || path.isAbsolute(n) || /^[a-zA-Z]:/.test(n) || !ok.has(top)) throw new Error('That does not look like an IMC-Stream backup (unexpected file: ' + n + ')');
    }
    create({ out: path.join(DIR, 'before-restore-' + stamp() + '.zip'), includeLogins: true });   // always keep a way back
    const tmp = fs.mkdtempSync(path.join(DIR, 'restore-'));
    try {
      tar(['-x', '-f', zip, '-C', tmp]);
      for (const n of fs.readdirSync(tmp)) { const to = path.join(DATA, n); fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(path.join(tmp, n), to, { recursive: true }); }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    return { ok: true, restored: names.length, restart: true };
  }
  /** keep a daily automatic backup (no logins), newest 7 */
  function auto() {
    try {
      const today = path.join(DIR, 'auto-' + stamp().slice(0, 10) + '.zip');
      if (!fs.existsSync(today) && members(false).length) create({ auto: true });
      for (const f of list().filter((x) => x.name.startsWith('auto-')).slice(7)) fs.unlinkSync(path.join(DIR, f.name));
    } catch (e) { log('automatic backup failed:', e.message); }
  }
  return { create, restore, list, auto, dir: DIR };
};
