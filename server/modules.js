'use strict';
/**
 * The app is a set of modules (pages). Built-in ones ship with the app; you can add your own:
 *   - a link to any page (a website, a local tool),
 *   - a folder in  <data>/modules/<id>/  with a module.json and your own HTML/JS/CSS (installed from a .zip on the Modules page),
 * and put any module on the Home screen as a widget.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// pages that ship with the app, shown on the Modules page and the menu (group = where they are listed)
const BUILTIN = [
  { id: 'dashboard', name: 'Dashboard', icon: '\u25A6', group: 'Stream', url: '/dashboard', description: 'Alerts, goals, labels, test buttons' },
  { id: 'tips', name: 'Tips (PayPal)', icon: '♥', group: 'Stream', url: '/tips', description: 'Instant PayPal tip page, !tip command, tip alerts' },
  { id: 'panels', name: 'Panels', icon: '▤', group: 'Stream', url: '/panels', description: 'Design your Twitch channel panels, export the images, sync them to chat commands' },
  { id: 'goals', name: 'Goals', icon: '⚑', group: 'Stream', url: '/goals', description: 'Progress bars for followers, subs, bits and your own targets' },
  { id: 'mixer', name: 'Audio Mixer', icon: '♬', group: 'Stream', url: '/widgets/mixer.html?full=1', description: 'Level meters, mute and volume for every scene' },
  { id: 'board', name: 'Control Board', icon: '\u25A3', group: 'Stream', url: '/board', description: 'Scenes, ads, clips and your own buttons' },
  { id: 'dock', name: 'Chat + Mod', icon: '\u2709', group: 'Stream', url: '/dock', description: 'Live chat with moderation and AutoMod review' },
  { id: 'stream', name: 'Stream Info', icon: '\u2139', group: 'Stream', url: '/stream', description: 'Title and category' },
  { id: 'polls', name: 'Polls & Predictions', icon: '\u2637', group: 'Stream', url: '/polls', description: 'Run polls and predictions' },
  { id: 'ads', name: 'Ads', icon: '\u25B6', group: 'Stream', url: '/ads', description: 'Run and snooze ad breaks' },
  { id: 'bot', name: 'Chat Bot', icon: '\u2699', group: 'Automate', url: '/bot', description: 'Commands, timers, currency, games' },
  { id: 'games', name: 'Chat Games', icon: '⚄', group: 'Automate', url: '/games', description: 'Built-in games and games you create' },
  { id: 'avatar', name: 'Avatar', icon: '☺', group: 'Stream', url: '/avatar', description: 'A pixel avatar that copies your face and voice' },
  { id: 'recap', name: 'Chat recap', icon: '✎', group: 'Stream', url: '/recap', description: 'Summaries of your chat, written by Claude' },
  { id: 'discord', name: 'Discord', icon: '☍', group: 'Stream', url: '/discord', description: 'Set up your Discord server and run a bot for it' },
  { id: 'site', name: 'Website', icon: '⌂', group: 'Stream', url: '/site', description: 'Pages for your viewers (commands, games, text-to-speech) to put on a free host' },
  { id: 'emotes', name: 'Emote Rewards', icon: '☺', group: 'Automate', url: '/emotes', description: 'Viewers add a 7TV emote to your channel with channel points' },
  { id: 'hooks', name: 'Reward Hooks', icon: '\u2693', group: 'Automate', url: '/hooks', description: 'Channel point rewards that do things' },
  { id: 'overlay-editor', name: 'Overlay Editor', icon: '\u270E', group: 'Overlays', url: '/overlay-editor', description: 'Alert and recent events overlay settings' },
  { id: 'subathon', name: 'Subathon', icon: '\u231B', group: 'Stream', url: '/subathon', description: 'Subathon timer: time added per sub, bits, follow, raid; its own OBS overlay' },
  { id: 'countdown', name: 'Start Countdown', icon: '\u23F1', group: 'Overlays', url: '/countdown', description: 'Countdown timer' },
  { id: 'music', name: 'Music', icon: '\u266B', group: 'Overlays', url: '/music', description: 'Now playing and controls' },
  { id: 'tts', name: 'Speech', icon: '\u260E', group: 'Overlays', url: '/tts', description: 'Text-to-speech' },
  { id: 'setup', name: 'Setup & Health', icon: '\u2692', group: 'App', url: '/setup', description: 'Login, OBS, backup, remote access' },
];
const WIDGETS = [   // small parts for the Home screen (not whole pages)
  { id: 'golive', name: 'Go live / record', url: '/widgets/golive.html', size: 's', description: 'Start and stop the stream and recording in OBS' },
  { id: 'goals', name: 'Goals', url: '/widgets/goals.html', size: 'm', description: 'Progress bars for your goals (+1 / +10 on manual ones)' },
  { id: 'obsstats', name: 'OBS stats', url: '/widgets/obsstats.html', size: 'm', w: 4, h: 3, description: 'CPU, FPS, dropped frames, bitrate and more from OBS' },
  { id: 'mixer', name: 'Audio mixer', url: '/widgets/mixer.html', size: 'l', description: 'Level bars, mute and volume per scene' },
  { id: 'status', name: 'Stream status', url: '/widgets/status.html', size: 's', w: 4, h: 2, description: 'Live, viewers, uptime, followers, subs' },
  { id: 'buttons', name: 'My buttons', url: '/widgets/buttons.html', size: 'm', description: 'The buttons you made on the Control Board' },
  { id: 'scenes', name: 'OBS scenes', url: '/widgets/scenes.html', size: 'm', description: 'Switch scene' },
  { id: 'ads', name: 'Ad timer', url: '/widgets/ads.html', size: 's', description: 'Next ad countdown, run and snooze' },
  { id: 'music', name: 'Now playing', url: '/widgets/music.html', size: 's', description: 'Song and play / next / previous' },
  { id: 'subathon', name: 'Subathon timer', url: '/widgets/subathon.html', size: 's', description: 'Subathon clock with +/- 5 min and pause' },
  { id: 'timer', name: 'Start countdown', url: '/widgets/timer.html', size: 's', description: 'Countdown with +/- 1 min' },
  { id: 'recent', name: 'Alerts & events', url: '/widgets/recent.html', size: 'm', description: 'Latest events plus pause, mute, skip and test alert buttons' },
  { id: 'hype', name: 'Hype train', url: '/widgets/hype.html', size: 's', description: 'Level and progress' },
  { id: 'chat', name: 'Chat + moderation', url: '/dock', size: 'l', description: 'Live chat with mod tools and AutoMod review' },
];
// file types a custom module may contain (and the server will serve): no executables
const FILE_OK = new Set(['.html', '.htm', '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.woff', '.woff2', '.txt']);
// turn any text into a safe id: lowercase letters, digits, - and _ only
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

module.exports = function createModules(ctx) {
  // state is the saved app state; DIR is where installed module folders live
  const state = ctx.state, DIR = path.join(ctx.DATA, 'modules');
  // Windows 10+ ships tar.exe which can also unpack .zip files, so no extra library is needed
  const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const gi = (v, d, lo, hi) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };   // grid units
  // clean text: one line, trimmed, at most n characters
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

  // read every folder in <data>/modules and turn its module.json into a module entry; folders with no usable page or widget are skipped
  function installed() {
    let ids = []; try { ids = fs.readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { return []; }
    const out = [];
    for (const id of ids) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(DIR, id, 'module.json'), 'utf8')), entry = m.entry === false || m.entry === '' ? '' : String(m.entry || 'index.html');
        // an entry file must exist inside the module folder (no '..' to climb out of it)
        const ok = (e) => e && !e.includes('..') && fs.existsSync(path.join(DIR, id, e));
        const widgets = (Array.isArray(m.widgets) ? m.widgets : []).filter((w) => w && ok(String(w.entry || ''))).map((w) => ({ id: 'mod-' + id + ':' + slug(w.id || w.name), name: str(w.name, 40) || str(m.name, 40), url: '/modules/' + id + '/' + w.entry, size: ['s', 'm', 'l', 'xl'].includes(w.size) ? w.size : 'm', description: str(w.description, 120) || str(m.name, 40), custom: 'folder' }));
        if (!ok(entry) && !widgets.length) continue;
        out.push({ id: 'mod-' + id, name: str(m.name, 40) || id, icon: str(m.icon, 4) || '\u25C7', group: str(m.group, 20) || 'My modules', url: ok(entry) ? '/modules/' + id + '/' + entry : '', hasPage: !!ok(entry), widgets, description: str(m.description, 120), custom: 'folder', folder: id });
      } catch (e) { /* not a module */ }
    }
    return out;
  }
  // modules that are just a link to a page the user added
  const links = () => state.modules.links.map((l) => ({ id: l.id, name: l.name, icon: l.icon || '\u25C7', group: 'My modules', url: l.url, hasPage: true, description: l.url, custom: 'link' }));
  // every module: built-in, installed and links
  const all = () => BUILTIN.map((m) => Object.assign({ builtin: true, hasPage: true }, m)).concat(installed(), links());
  // every Home widget: built-in and the ones from installed modules
  const widgets = () => WIDGETS.map((w) => Object.assign({ builtin: true }, w)).concat(...installed().map((m) => m.widgets));
  // everything the Modules page and Home screen need; also repairs an old Home layout that had no pages
  const view = () => {
    if (!Array.isArray(state.home.pages) || !state.home.pages.length) state.home = { pages: [{ id: 'p1', name: 'Home', widgets: Array.isArray(state.home.widgets) ? state.home.widgets : [] }] };
    for (const pg of state.home.pages) pg.widgets = pg.widgets.filter((w) => w.mod !== 'alerts');   // folded into 'Alerts & events'
    return { modules: all(), widgets: widgets(), hidden: state.modules.hidden, home: { pages: state.home.pages } };
  };

  /** absolute path for /modules/<id>/<file>, or null */
  function file(p) {
    const m = /^\/modules\/([a-z0-9_-]+)\/(.+)$/.exec(p); if (!m || m[2].includes('..') || m[2].includes('\\')) return null;
    if (!FILE_OK.has(path.extname(m[2]).toLowerCase())) return null;
    const f = path.join(DIR, m[1], m[2]); return f.startsWith(DIR + path.sep) ? f : null;
  }

  // install a module from a .zip: list it first and refuse bad file types or paths that escape the folder, unpack to a temp folder, check module.json, then replace any older copy
  function install(zip) {
    const r = spawnSync(TAR, ['-t', '-f', zip], { encoding: 'utf8', windowsHide: true });
    if (r.error || r.status !== 0) throw new Error('That is not a valid .zip file');
    const names = r.stdout.split(/\r?\n/).filter(Boolean).map((n) => n.replace(/\\/g, '/'));
    if (!names.length) throw new Error('The zip is empty');
    for (const n of names) if (n.includes('..') || path.isAbsolute(n) || /^[a-zA-Z]:/.test(n) || (!n.endsWith('/') && !FILE_OK.has(path.extname(n).toLowerCase()))) throw new Error('The zip contains a file type that is not allowed: ' + n);
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'icm-mod-'));
    try {
      const x = spawnSync(TAR, ['-x', '-f', zip, '-C', tmp], { encoding: 'utf8', windowsHide: true }); if (x.status !== 0) throw new Error('Could not unpack the zip');
      let root = tmp; const top = fs.readdirSync(tmp);
      if (!fs.existsSync(path.join(root, 'module.json')) && top.length === 1 && fs.statSync(path.join(tmp, top[0])).isDirectory()) root = path.join(tmp, top[0]);   // zipped as one folder
      if (!fs.existsSync(path.join(root, 'module.json'))) throw new Error('module.json is missing (see the example on the Modules page)');
      const meta = JSON.parse(fs.readFileSync(path.join(root, 'module.json'), 'utf8')), id = slug(meta.id || meta.name); if (!id) throw new Error('module.json needs a "name"');
      if (meta.entry !== false && !Array.isArray(meta.widgets) && !fs.existsSync(path.join(root, String(meta.entry || 'index.html')))) throw new Error('The page named in "entry" (default index.html) is missing');
      fs.mkdirSync(DIR, { recursive: true }); const to = path.join(DIR, id); fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(root, to, { recursive: true });
      return { ok: true, id: 'mod-' + id };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // requests from the Modules page; throws an Error with a plain-English message that is shown to the user
  function api(action, b) {
    switch (action) {
      // save hidden modules and the Home layout (pages and widget positions), with limits on every value
      case 'save': {
        if (Array.isArray(b.hidden)) state.modules.hidden = b.hidden.map((x) => str(x, 60)).slice(0, 100);
        if (b.home && Array.isArray(b.home.pages)) state.home = { pages: b.home.pages.slice(0, 12).map((pg, n) => ({ id: str(pg.id, 20) || 'p' + n + Math.random().toString(36).slice(2, 5), name: str(pg.name, 24) || 'Page ' + (n + 1),
          widgets: (Array.isArray(pg.widgets) ? pg.widgets : []).slice(0, 24).map((w, k) => ({ id: str(w.id, 20) || 'w' + k + Math.random().toString(36).slice(2, 5), mod: str(w.mod, 80), size: ['s', 'm', 'l', 'xl'].includes(w.size) ? w.size : 'm', x: gi(w.x, 0, 0, 11), y: gi(w.y, 0, 0, 400), w: gi(w.w, 0, 0, 12), h: gi(w.h, 0, 0, 60) })) })) };
        if (!state.home.pages.length) state.home.pages = [{ id: 'p1', name: 'Home', widgets: [] }];
        ctx.persist(); return view();
      }
      // add a link module; only https:// addresses or pages of this app are allowed
      case 'link/save': {
        const url = str(b.url, 500); if (!/^(https?:\/\/|\/)/i.test(url)) throw new Error('The address must start with https:// (or / for a page on this app)');
        const name = str(b.name, 40) || url; const l = { id: 'link-' + Math.random().toString(36).slice(2, 7), name, icon: str(b.icon, 4), url };
        state.modules.links.push(l); ctx.persist(); return view();
      }
      // remove a link or an installed folder (built-ins can only be hidden), and drop its widgets from Home
      case 'delete': {
        const m = all().find((x) => x.id === b.id); if (!m || m.builtin) throw new Error('Built-in modules cannot be removed (hide them instead)');
        if (m.custom === 'link') state.modules.links = state.modules.links.filter((x) => x.id !== b.id); else fs.rmSync(path.join(DIR, m.folder), { recursive: true, force: true });
        for (const pg of state.home.pages) pg.widgets = pg.widgets.filter((w) => w.mod !== b.id && !String(w.mod).startsWith(b.id + ':')); ctx.persist(); return view();
      }
      default: throw new Error('unknown action');
    }
  }
  return { view, api, file, install, all, dir: DIR };
};
