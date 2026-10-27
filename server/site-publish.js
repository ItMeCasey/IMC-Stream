'use strict';
/**
 * Puts the viewers' website (site.js) on the streamer's own free Cloudflare Pages project and keeps it up to date by itself.
 * It uses Cloudflare's own command line tool (wrangler, fetched on first use with npx), so it needs Node.js on this PC. The streamer logs in once in the
 * browser window wrangler opens (the app never sees the login or any password); after that publishing needs nothing from them:
 *   - "Publish now" builds the pages and uploads them,
 *   - with "automatic" on, the app looks every few minutes at what the pages would say and uploads again only when something changed.
 */
const crypto = require('node:crypto');
const { spawn: nodeSpawn } = require('node:child_process');

// Cloudflare's command line tool, pinned to major version 3 so a new major release cannot break publishing
const WRANGLER = 'wrangler@3';
// make a valid Cloudflare project name: lowercase letters, digits and single dashes, at most 40 characters
const clean = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-').slice(0, 40);

module.exports = function createPublisher(ctx) {
  const st = () => ctx.state.site, log = ctx.log || (() => {}), spawn = ctx.spawn || nodeSpawn, now = ctx.now || Date.now;
  const win = process.platform === 'win32';
  // busy: the publish running now (a second request joins it); loginProc: the wrangler login process; timer: the automatic check
  let busy = null, loginProc = null, timer = null;

  /** run `npx wrangler <args>`; resolves { code, out } (stdout + stderr) */
  function run(args, opts = {}) {
    return new Promise((resolve) => {
      // on Windows npx runs through the shell, so arguments with special characters are quoted (and stripped of quotes, never passed through)
      const q = (a) => (win && /[\s&|<>^()]/.test(a) ? '"' + a.replace(/"/g, '') + '"' : a);
      let out = '', c;
      // CI=1 and no colour or metrics, so wrangler never stops to ask a question and its output is easy to read
      try { c = spawn(win ? 'npx.cmd' : 'npx', ['--yes', WRANGLER].concat(args.map(q)), { shell: win, windowsHide: true, env: Object.assign({}, process.env, { CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1', FORCE_COLOR: '0' }, opts.env || {}), stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { return resolve({ code: -1, out: 'Could not start npx (is Node.js installed?): ' + e.message }); }
      const timer2 = setTimeout(() => { try { c.kill(); } catch (e) { /* gone */ } out += '\nTimed out'; }, opts.timeout || 240000); if (timer2.unref) timer2.unref();
      c.stdout.on('data', (d) => { out += d.toString('utf8'); }); c.stderr && c.stderr.on('data', (d) => { out += d.toString('utf8'); });
      c.on('error', (e) => { clearTimeout(timer2); resolve({ code: -1, out: out + '\nCould not run npx (is Node.js installed?): ' + e.message }); });
      c.on('exit', (code) => { clearTimeout(timer2); resolve({ code: code == null ? -1 : code, out }); });
      if (opts.onProc) opts.onProc(c);
    });
  }

  /** is the streamer logged in to Cloudflare in wrangler: { ok, email } */
  async function whoami() {
    const r = await run(['whoami'], { timeout: 120000 });
    if (/not authenticated|not logged in/i.test(r.out)) return { ok: false, email: '', node: true };
    if (r.code === -1 || /could not (start|run) npx|command not found|is not recognized/i.test(r.out)) return { ok: false, email: '', node: false, error: r.out.trim().split('\n').pop() };
    const m = /email\s+([^\s,.]+@[^\s,]+)/i.exec(r.out) || /([^\s]+@[^\s]+\.[a-z]+)/i.exec(r.out);
    return { ok: r.code === 0, email: m ? m[1].replace(/[.,]$/, '') : '', node: true };
  }
  /** open the browser log-in (wrangler prints a link and opens it); the page then asks for status until it says logged in */
  function login() {
    if (loginProc) return { started: true };
    run(['login'], { timeout: 5 * 60000, onProc: (p) => { loginProc = p; } }).then(() => { loginProc = null; });
    return { started: true };
  }

  /** a fingerprint of what the pages say (not of the date in their footer), to know when something changed */
  function fingerprint() {
    const h = crypto.createHash('sha1');
    for (const [k, fn] of Object.entries(ctx.site.pages)) h.update(k + String(fn()).replace(/Last updated \d{4}-\d{2}-\d{2}/, ''));
    try { for (const x of ctx.tts.view().sfx || []) h.update(x.name); } catch (e) { /* ignore */ }
    return h.digest('hex');
  }

  // build the site and upload it; one publish at a time (callers share the running job). The result is saved in the site settings
  async function publish(why) {
    if (busy) return busy;
    const job = (async () => {
      const S = st(); S.lastTry = now();
      try {
        const name = clean(S.project); if (!name) throw new Error('Choose a name for the website first (it becomes yourname.pages.dev)');
        const dir = ctx.siteDir(), fp = fingerprint(); ctx.site.build(dir);
        // the project is made once (it is fine when it already exists)
        const mk = await run(['pages', 'project', 'create', name, '--production-branch', 'main']);
        if (mk.code !== 0 && !/already exists|already taken|8000002/i.test(mk.out)) { if (/authenticat|login|not logged/i.test(mk.out)) throw new Error('Not logged in to Cloudflare yet: press Connect Cloudflare'); throw new Error('Could not create the Cloudflare project: ' + mk.out.trim().split('\n').slice(-2).join(' ')); }
        const r = await run(['pages', 'deploy', dir, '--project-name', name, '--branch', 'main', '--commit-dirty=true'], { timeout: 600000 });
        if (r.code !== 0) throw new Error('Upload failed: ' + r.out.trim().split('\n').slice(-3).join(' '));
        // wrangler prints the address of this one deploy (abc12345.name.pages.dev); strip that prefix to get the permanent address
        const url = (/https:\/\/[a-z0-9-]+\.pages\.dev/gi.exec(r.out.replace(/https:\/\/[a-f0-9]{8}\.([a-z0-9-]+\.pages\.dev)/gi, 'https://$1')) || [])[0] || 'https://' + name + '.pages.dev';
        Object.assign(S, { lastHash: fp, lastDeploy: now(), lastUrl: url, lastError: '', published: true }); ctx.persist(); log('website published (' + (why || 'manual') + '): ' + url);
        return { ok: true, url };
      } catch (e) { S.lastError = e.message; ctx.persist(); log('website publish failed:', e.message); throw e; }
    })();
    busy = job; job.then(() => { busy = null; }, () => { busy = null; });   // (cleared once it is over, whether it worked or not)
    return job;
  }

  /** every few minutes: publish again when the pages would be different from what is online */
  function tick() {
    const S = st(); if (!S.auto || !S.published || busy || !clean(S.project)) return;
    let fp; try { fp = fingerprint(); } catch (e) { return; }
    if (fp !== S.lastHash && now() - (S.lastTry || 0) > 5 * 60000) publish('automatic').catch(() => { /* shown on the page */ });
  }
  // check every 5 minutes (unref so the timer alone does not keep the app alive)
  function start() { if (!timer) { timer = setInterval(tick, 5 * 60000); if (timer.unref) timer.unref(); } }
  function stop() { clearInterval(timer); timer = null; }

  // change the project name or the automatic switch; a new name means nothing is published there yet
  function settings(b) {
    const S = st();
    if (b.project !== undefined) { const n = clean(b.project); if (!n || n.length < 3) throw new Error('Use at least 3 letters, numbers or dashes for the name'); if (n !== S.project) { S.project = n; S.published = false; S.lastHash = ''; S.lastUrl = ''; } }
    if (b.auto !== undefined) S.auto = !!b.auto;
    ctx.persist(); return view();
  }
  // what the Setup page shows
  const view = () => { const S = st(); return { project: S.project || '', auto: !!S.auto, published: !!S.published, url: S.lastUrl || '', lastDeploy: S.lastDeploy || 0, lastError: S.lastError || '', busy: !!busy, loggingIn: !!loginProc, defaultName: clean(ctx.channel && ctx.channel()) || '' }; };
  return { whoami, login, publish, settings, view, start, stop, tick, fingerprint, clean };
};
