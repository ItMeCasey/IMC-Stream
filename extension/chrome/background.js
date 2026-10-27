/* IMC Audio Router, Chrome / Edge: the coordinator. The popup (and the glyph on the page) ask it to send a tab's sound to an audio device;
   it gets a capture id for the tab and hands it to the offscreen page, which plays the captured sound through the chosen device.
   While a tab is captured Chrome stops playing it on the normal output, so the sound only comes out where we send it. */
importScripts('match.js');

const OFFSCREEN = 'offscreen.html';
const NOTE = '♪';   // the badge on the toolbar icon of a tab whose sound is being sent somewhere

// make sure the offscreen page exists (it has to be there for as long as any tab is being routed)
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: OFFSCREEN, reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'], justification: 'Plays a tab\'s captured sound through the audio device the user picked' });
}
// ask the offscreen page to do something; its errors become ours
async function offscreen(msg) {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage(Object.assign({ target: 'offscreen' }, msg));
  if (r && r.error) throw new Error(r.error);
  return r || {};
}
// which tabs are routed right now (the offscreen page knows; without it nothing is)
async function routes() {
  if (!(await chrome.offscreen.hasDocument())) return {};
  return (await offscreen({ type: 'routes' })).routes || {};
}
// toolbar badge + a note to the glyph in the page
function paint(tabId, route) {
  chrome.action.setBadgeText({ tabId, text: route ? NOTE : '' }).catch(() => {});
  if (route) chrome.action.setBadgeBackgroundColor({ tabId, color: '#F39120' }).catch(() => {});
  chrome.tabs.sendMessage(tabId, { type: 'state', routed: route ? route.label : null }).catch(() => {});   // the page may have no glyph (browser pages)
}

const actions = {
  // where this tab's sound goes now
  async status({ tabId }) { return { route: (await routes())[tabId] || null }; },
  // the audio outputs the browser knows; names are blank until the user has allowed it once (see grant.html)
  async devices() { const r = await offscreen({ type: 'devices' }); return { devices: IMCMatch.usable(r.devices), hasLabels: r.hasLabels }; },
  // start routing (or change the device of an already routed tab). Needs the user to have just invoked the extension on that tab (the popup does).
  async route({ tabId, deviceId, label }) {
    if ((await routes())[tabId]) await offscreen({ type: 'sink', tabId, deviceId, label });
    else {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      await offscreen({ type: 'start', tabId, streamId, deviceId, label });
    }
    paint(tabId, { deviceId, label }); return { ok: true };
  },
  // back to normal: stop the capture and the tab plays on the system's output again
  async stop({ tabId }) { await offscreen({ type: 'stop', tabId }); paint(tabId, null); return { ok: true }; },
  // the glyph on the page asks us to open the popup (Chrome 127+); false means the user has to click the toolbar icon
  async 'open-popup'(m, sender) { try { await chrome.action.openPopup({ windowId: sender.tab && sender.tab.windowId }); return { ok: true }; } catch (e) { return { ok: false }; } },
  // the offscreen page tells us a captured tab ended by itself (closed, or capture stopped)
  async ended({ tabId }) { paint(tabId, null); return { ok: true }; }
};

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (!m || m.target !== 'background' || !actions[m.type]) return false;
  if (m.tabId == null && sender.tab) m.tabId = sender.tab.id;   // messages from the glyph are about the tab they came from
  actions[m.type](m, sender).then(send, (e) => send({ error: e.message || String(e) }));
  return true;
});

// a closed tab: stop its capture. A navigation clears the toolbar badge, so put it back for tabs that are still routed.
chrome.tabs.onRemoved.addListener((tabId) => { routes().then((r) => { if (r[tabId]) offscreen({ type: 'stop', tabId }).catch(() => {}); }).catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === 'complete') routes().then((r) => { if (r[tabId]) paint(tabId, r[tabId]); }).catch(() => {}); });
