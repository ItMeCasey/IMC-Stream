/* IMC Audio Router, Firefox: Firefox has no way to capture a tab's sound, so this works on the page's own <video> and <audio> elements instead.
   The glyph opens a small menu; "Choose a device" shows Firefox's own device picker (selectAudioOutput, which needs a click on the page and is
   where Firefox asks permission), and the chosen device is applied with setSinkId to every media element, now and later.
   Limits: sound made with Web Audio (some games and players) and media inside other sites' frames are not covered. */
(function () {
  if (window.top !== window) return;   // only the top page; a frame belongs to another site and would need its own permission
  const ext = typeof browser !== 'undefined' ? browser : chrome;
  const KEY = 'sink:' + location.hostname, HIDE = 'hide:' + location.hostname;
  const canPick = !!(navigator.mediaDevices && navigator.mediaDevices.selectAudioOutput) && typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  const glyph = window.__imcGlyph.create({ title: 'Choose where this page plays its sound' });
  let sink = null, shown = false, hidden = false;   // sink = { deviceId, label } chosen for this site

  const media = () => [...document.querySelectorAll('video,audio')];
  const reveal = () => { if (!shown && !hidden) { shown = true; glyph.show(); } };
  // point one element at the chosen device (or back to the default); returns an error name, or '' when it worked
  async function apply(el) { try { await el.setSinkId(sink ? sink.deviceId : ''); return ''; } catch (e) { return e.name || 'Error'; } }
  async function applyAll() { const errs = await Promise.all(media().map(apply)); return errs.find(Boolean) || ''; }

  // the saved choice for this site, and the elements that appear later
  (async () => {
    try { const s = await ext.storage.local.get([KEY, HIDE]); sink = s[KEY] || null; hidden = !!s[HIDE]; } catch (e) { /* storage unavailable */ }
    glyph.setRouted(sink && sink.label);
    if (media().length) { reveal(); if (sink) applyAll(); }
  })();
  document.addEventListener('play', (e) => { reveal(); if (sink && e.target && e.target.setSinkId) apply(e.target); }, true);   // play events do not bubble: listen in the capture phase
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches('video,audio') || n.querySelector('video,audio'))) { reveal(); if (sink) applyAll(); return; }
  }).observe(document.documentElement, { childList: true, subtree: true });

  const save = () => ext.storage.local.set({ [KEY]: sink }).catch(() => {});

  // the device picker; must run straight from a click, so it is called by the menu button itself
  async function choose() {
    if (!canPick) return glyph.say('This Firefox cannot choose an audio output for a page (it needs Firefox 116 or newer with the speaker selection feature turned on).');
    try {
      const d = await navigator.mediaDevices.selectAudioOutput();
      sink = { deviceId: d.deviceId, label: d.label || 'chosen device' }; await save(); glyph.setRouted(sink.label);
      const err = await applyAll();
      glyph.say(err ? 'The device was chosen, but the page refused it (' + err + '). Some sites block this.' : media().length ? 'This page\'s sound now plays on: ' + sink.label : 'Saved: ' + sink.label + '. It is used as soon as this page plays sound.');
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') glyph.say('Could not choose a device (' + (e.name || e.message) + ').'); }
  }
  async function reset() { sink = null; await ext.storage.local.remove(KEY).catch(() => {}); await applyAll(); glyph.setRouted(null); glyph.say('Back on the normal output.'); }
  async function hide() { hidden = true; await ext.storage.local.set({ [HIDE]: true }).catch(() => {}); glyph.hide(); }

  glyph.onClick(() => {
    if (glyph.isOpen()) return glyph.close();
    glyph.menu({
      title: 'AUDIO ROUTER',
      text: sink ? 'Sound from this site goes to: ' + sink.label : 'This site plays on your normal output.',
      items: [{ label: 'Choose a device...', run: choose }].concat(sink ? [{ label: 'Back to normal', ghost: true, run: reset }] : [], [{ label: 'Hide this button on this site', ghost: true, run: hide }])
    });
  });
})();
