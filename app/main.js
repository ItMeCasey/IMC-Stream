'use strict';
/** IMC-Stream: the desktop app. Runs the local stream server in the background, shows the dashboard, lives in the tray. */
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, Notification, session, desktopCapturer } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const createSupervisor = require('./supervisor.js');

// PACKED: the installed app; otherwise it runs from the source folder
const PACKED = app.isPackaged;
const RES = PACKED ? process.resourcesPath : path.join(__dirname, '..');       // folder holding server/ overlays/ assets/ sounds/
const SERVER_DIR = path.join(RES, 'server');
const BUILD = path.join(__dirname, 'build');

// The app is called IMC-Stream now, but its profile folder keeps the old name so nothing (logins, settings, bot data) has to move.
if (!app.isPackaged || !process.env.ICM_NEW_PROFILE) app.setPath('userData', path.join(app.getPath('appData'), 'ItMeCasey Stream'));
// only one copy at a time: a second launch just brings the first window forward (see 'second-instance' below)
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// win: dashboard window; tray: tray icon; sup: server supervisor; light: health colour of the tray icon
let win = null, tray = null, sup = null, quitting = false, port = 8420, light = 'grey', settings = null;
// Microsoft Store (MSIX) installs redirect writes under AppData into a private copy that uninstalling deletes, and OBS cannot see. There the data lives in Documents instead.
const PACKAGED = !!process.windowsStore, userData = app.getPath('userData'), DOCS = path.join(app.getPath('documents'), 'ItMeCasey Stream'), DATA = PACKAGED ? path.join(DOCS, 'data') : path.join(userData, 'data'), SETTINGS_FILE = path.join(userData, 'app-settings.json');
// app settings with defaults; a missing or broken file gives the defaults
const loadSettings = () => {
  const d = { startWithWindows: false, startObs: false, obsPath: '', closeToTray: true, startHidden: false };
  try { return Object.assign(d, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch (e) { return d; }
};
// write the app settings (a read-only profile is ignored)
const saveSettings = () => { try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { /* read-only profile */ } };
// append to app.log in the data folder (and to the console when run from the source)
const log = (...a) => { const line = new Date().toISOString() + ' ' + a.join(' '); try { fs.mkdirSync(DATA, { recursive: true }); fs.appendFileSync(path.join(DATA, 'app.log'), line + '\n'); } catch (e) { /* ignore */ } if (!PACKED) { try { console.log(line); } catch (e) { /* the terminal that started the app is gone */ } } };
for (const st of [process.stdout, process.stderr]) if (st && st.on) st.on('error', () => { /* a closed terminal must never crash the app (EPIPE) */ });

// the server port from config.json (the data folder first), 8420 by default
function readPort() {
  for (const f of [path.join(DATA, 'config.json'), path.join(SERVER_DIR, 'config.json')]) { try { const p = Number(JSON.parse(fs.readFileSync(f, 'utf8')).port); if (p > 0) return p; } catch (e) { /* next */ } }
  return 8420;
}
const url = (p) => 'http://localhost:' + port + (p || '/');
const icon = (name) => nativeImage.createFromPath(path.join(BUILD, name));

// ---------------------------------------------------------------- server process
// start the server through the supervisor, as a plain Node process (ELECTRON_RUN_AS_NODE) that gets its folders through ICM_* variables
function startServer() {
  port = readPort();
  fs.mkdirSync(DATA, { recursive: true });
  const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', ICM_DATA: DATA, ICM_ROOT: RES, ICM_PACKAGED: PACKAGED ? '1' : '', ICM_INSTALLED: PACKED ? '1' : '', ICM_DOCS: DOCS, ICM_KOKORO_DIR: path.join(userData, 'kokoro'), ICM_VERSION: app.getVersion() });
  // the port comes from config.json, never from a stray environment variable
  delete env.ICM_PORT;
  sup = createSupervisor({
    command: process.execPath, args: [path.join(SERVER_DIR, 'server.js')], cwd: SERVER_DIR, env, port, log,
    onOutput: (t) => { try { fs.appendFileSync(path.join(DATA, 'server.log'), t); } catch (e) { /* ignore */ } },
    onState: (s) => { if (s === 'restarting') note('Stream server restarted', 'It stopped, so the app started it again.'); refreshTray(); },
    onHealth: (h) => { light = h ? h.light : sup.view().state === 'running' ? 'amber' : 'red'; refreshTray(); },
  });
  sup.start();
}
let lastNote = 0;
// desktop notification, at most one a minute so a crash loop does not flood the screen
function note(title, body) { if (Date.now() - lastNote < 60000 || !Notification.isSupported()) return; lastNote = Date.now(); try { new Notification({ title, body, icon: path.join(BUILD, 'icon.png') }).show(); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- window
// shown at once while the server is still starting
const SPLASH = 'data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#222A2A;color:#E2DAC2;font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:22px;letter-spacing:6px;color:#4FBBBC">ITMECASEY</div><p style="margin-top:14px;color:#9aa39f">Starting the stream server&hellip;</p></div></body>');
// open the dashboard (or one of its pages), or bring the existing window forward
function openWindow(pathName) {
  if (!win) {
    const ws = settings.window || {}, screens = require('electron').screen.getAllDisplays();
    const onScreen = ws.x != null && screens.some((d) => ws.x >= d.bounds.x - 50 && ws.x < d.bounds.x + d.bounds.width - 100 && ws.y >= d.bounds.y - 50 && ws.y < d.bounds.y + d.bounds.height - 100);   // ignore a saved spot on a monitor that is gone
    win = new BrowserWindow({ width: ws.width || 1280, height: ws.height || 860, x: onScreen ? ws.x : undefined, y: onScreen ? ws.y : undefined, minWidth: 900, minHeight: 600, backgroundColor: '#222A2A', title: 'IMC-Stream', icon: path.join(BUILD, process.platform === 'win32' ? 'window.ico' : 'window.png'), autoHideMenuBar: true, show: false,
      titleBarStyle: 'hidden', titleBarOverlay: { color: '#1A2020', symbolColor: '#E2DAC2', height: 32 } });   // slim title bar: the page's own top strip is the drag area
    if (ws.maximized) win.maximize();
    const remember = () => { if (!win || win.isMinimized() || win.isFullScreen()) return; settings.window = Object.assign({}, win.isMaximized() ? settings.window : win.getNormalBounds(), { maximized: win.isMaximized() }); };
    let saveT = null; const later = () => { remember(); clearTimeout(saveT); saveT = setTimeout(saveSettings, 600); };
    win.on('resize', later); win.on('move', later); win.on('maximize', later); win.on('unmaximize', later); win.on('close', () => { remember(); saveSettings(); });
    win.once('ready-to-show', () => win.show());
    win.on('close', (e) => { if (!quitting && settings.closeToTray) { e.preventDefault(); win.hide(); } });
    win.on('closed', () => { win = null; });
    // local pages stay in the app, every other link opens in the real browser (same for navigation below)
    win.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) return { action: 'allow' }; if (/^https:\/\//i.test(u)) shell.openExternal(u); return { action: 'deny' }; })   // only https links go to the real browser: never file:, ms-*: or other schemes;
    win.webContents.on('will-navigate', (e, u) => { if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) { e.preventDefault(); if (/^https:\/\//i.test(u)) shell.openExternal(u); } });
    win.webContents.on('did-fail-load', (e, code, desc, u) => { if (code !== -3 && !quitting) setTimeout(() => win && win.loadURL(u && u.startsWith('http') ? u : url()).catch(() => {}), 1500); });   // server still starting: try again
    win.loadURL(SPLASH).then(() => waitForServer().then(() => win && win.loadURL(url(pathName)))).catch(() => {});
  } else { if (pathName) win.loadURL(url(pathName)); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}
// hidden helper window: listens to the PC's audio output (loopback) so overlays can draw a real spectrum
let vizWin = null, trackWin = null;
// only the two hidden helper pages may use the camera and microphone: the audio capture page and the avatar tracker
const isHelper = (wc) => !!wc && [vizWin, trackWin].some((w) => w && !w.isDestroyed() && w.webContents.id === wc.id);
function installMediaPermissions() { try { session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && isHelper(wc))); session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media' && isHelper(wc)); } catch (e) { /* older Electron */ } }
// the avatar tracker reads the camera and the microphone while the Avatar page says the avatar is on (so the camera light is off otherwise)
async function syncTracker() {
  let on = false; try { on = !!(await (await fetch(url('/api/avatar/status'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).on; } catch (e) { return; }
  if (on && !trackWin) {
    trackWin = new BrowserWindow({ show: false, width: 320, height: 260, webPreferences: { backgroundThrottling: false } });
    trackWin.on('closed', () => { trackWin = null; }); trackWin.loadURL(url('/avatar-tracker')).catch(() => {});
  } else if (!on && trackWin) { trackWin.destroy(); trackWin = null; }
}
// Windows only: capture what the PC plays (loopback) in a hidden page
function startViz() {
  if (vizWin || process.platform !== 'win32') return;
  try { session.defaultSession.setDisplayMediaRequestHandler((req, cb) => { desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb({ video: s[0], audio: 'loopback' })).catch(() => cb({})); }, { useSystemPicker: false }); } catch (e) { return log('viz: capture handler failed:', e.message); }
  vizWin = new BrowserWindow({ show: false, width: 200, height: 100, webPreferences: { backgroundThrottling: false } });
  vizWin.on('closed', () => { vizWin = null; });
  waitForServer().then(() => vizWin && vizWin.loadURL(url('/viz-capture'))).catch(() => {});
}
// wait up to a minute for the server to answer /api/health
async function waitForServer() { for (let i = 0; i < 120; i++) { try { const r = await fetch(url('/api/health')); if (r.ok) return; } catch (e) { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } }

// ---------------------------------------------------------------- OBS + start with Windows
// where OBS is normally installed
const OBS_CANDIDATES = [process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'obs-studio', 'bin', '64bit', 'obs64.exe'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'obs-studio', 'bin', '64bit', 'obs64.exe')].filter(Boolean);
// the location the streamer chose, else a normal install
const findObs = () => (settings.obsPath && fs.existsSync(settings.obsPath) ? settings.obsPath : OBS_CANDIDATES.find((f) => fs.existsSync(f)) || '');
// is obs64.exe in the task list
function obsRunning() { try { return /obs64\.exe/i.test(spawnSync('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], { encoding: 'utf8', windowsHide: true }).stdout || ''); } catch (e) { return false; } }
// start OBS when asked (the setting, or force from the menu), never a second copy
function startObs(force) {
  if (process.platform !== 'win32' || (!force && !settings.startObs) || obsRunning()) return;
  const exe = findObs(); if (!exe) return log('OBS not found; set its location from the tray menu');
  try { spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref(); log('started OBS'); } catch (e) { log('could not start OBS:', e.message); }
}
// Voicemeeter must be running before OBS, or OBS has no Voicemeeter devices: start it with the app when it is installed and not already running
const VM_DIR = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VB', 'Voicemeeter'), VM_EXES = ['voicemeeter8x64.exe', 'voicemeeterpro.exe', 'voicemeeter8.exe', 'voicemeeter.exe'];
function startVoicemeeter() {
  if (process.platform !== 'win32' || settings.startVoicemeeter === false) return;
  const exe = VM_EXES.map((e) => path.join(VM_DIR, e)).find((f) => fs.existsSync(f)); if (!exe) return;
  try { const out = (spawnSync('tasklist', [], { encoding: 'utf8', windowsHide: true }).stdout || '').toLowerCase(); if (VM_EXES.some((e) => out.includes(e))) return; } catch (e) { return; }
  try { spawn(exe, [], { cwd: VM_DIR, detached: true, stdio: 'ignore' }).unref(); log('started Voicemeeter'); } catch (e) { log('could not start Voicemeeter:', e.message); }
}
// add or remove the start-with-Windows entry (--hidden = start in the tray)
function applyLogin() { try { app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows, args: ['--hidden'] }); } catch (e) { /* not supported */ } }

// ---------------------------------------------------------------- tray
// tray status words for each health colour
const LIGHT_TEXT = { green: 'All good', amber: 'Needs attention (see Setup)', red: 'Server problem', grey: 'Starting…' };
// redraw the tray icon, tooltip and menu from the current health colour and settings
function refreshTray() {
  if (!tray) return;
  tray.setImage(icon('tray-' + light + '.png').resize({ width: 24, height: 24 }));
  tray.setToolTip('IMC-Stream: ' + LIGHT_TEXT[light]);
  // a checkbox item that saves a true / false setting
  const toggle = (label, key, after) => ({ label, type: 'checkbox', checked: !!settings[key], click: (m) => { settings[key] = m.checked; saveSettings(); if (after) after(); } });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Status: ' + LIGHT_TEXT[light], enabled: false },
    { type: 'separator' },
    { label: 'Open dashboard', click: () => openWindow('/') },
    { label: 'Control board', click: () => openWindow('/board') },
    { label: 'Setup & health', click: () => openWindow('/setup') },
    { label: 'Open OBS now', click: () => startObs(true) },
    { type: 'separator' },
    toggle('Start with Windows', 'startWithWindows', applyLogin),
    toggle('Open OBS when the app starts', 'startObs'),
    { label: 'Start Voicemeeter if it is not running', type: 'checkbox', checked: settings.startVoicemeeter !== false, click: (m) => { settings.startVoicemeeter = m.checked; saveSettings(); } },
    toggle('Keep running in the tray when the window is closed', 'closeToTray'),
    { label: 'Choose OBS location…', click: async () => { const r = await dialog.showOpenDialog({ title: 'Find obs64.exe', filters: [{ name: 'OBS', extensions: ['exe'] }], properties: ['openFile'] }); if (!r.canceled && r.filePaths[0]) { settings.obsPath = r.filePaths[0]; saveSettings(); } } },
    { type: 'separator' },
    { label: 'Restart stream server', click: () => sup && sup.restart() },
    { label: 'Open my data folder', click: () => shell.openPath(DATA) },
    { type: 'separator' },
    { label: 'Quit (stops alerts and overlays)', click: () => { quitting = true; app.quit(); } },
  ]));
}
// create the tray icon; a click opens the dashboard
function makeTray() {
  tray = new Tray(icon('tray-grey.png').resize({ width: 24, height: 24 }));
  tray.on('click', () => openWindow()); refreshTray();
}

// ---------------------------------------------------------------- lifecycle
app.on('second-instance', () => openWindow());
app.whenReady().then(() => {
  settings = loadSettings(); app.setAppUserModelId('com.itmecasey.stream');
  const hidden = process.argv.includes('--hidden');
  makeTray(); applyLogin(); startServer(); startVoicemeeter(); startObs(false); installMediaPermissions(); startViz(); setInterval(syncTracker, 3000);
  if (!hidden) openWindow();
});
app.on('window-all-closed', () => { /* stay in the tray */ });
app.on('before-quit', () => { quitting = true; if (sup) sup.stop(); });
app.on('will-quit', () => { if (sup) sup.stop(); });
