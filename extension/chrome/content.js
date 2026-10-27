/* IMC Audio Router, Chrome / Edge: the glyph in the page. It shows up once the page plays (or has) a video or audio, lights up while the tab's sound is
   being sent to a device, and opens the toolbar popup when clicked (Chrome only lets the popup start a capture, because that counts as the user invoking the extension). */
(function () {
  if (window.top !== window) return;   // only the top page gets a glyph
  const glyph = window.__imcGlyph.create({ title: 'Choose where this tab plays its sound' });
  const hasMedia = () => !!document.querySelector('video,audio');
  let shown = false;
  const reveal = () => { if (!shown) { shown = true; glyph.show(); } };

  // show the glyph when something plays: play events do not bubble, so listen while they travel down (capture)
  document.addEventListener('play', reveal, true);
  if (hasMedia()) reveal(); else new MutationObserver((_, o) => { if (hasMedia()) { reveal(); o.disconnect(); } }).observe(document.documentElement, { childList: true, subtree: true });

  glyph.onClick(async () => {
    let r = null; try { r = await chrome.runtime.sendMessage({ target: 'background', type: 'open-popup' }); } catch (e) { /* extension was reloaded */ }
    if (!r || !r.ok) glyph.say('Click the speaker icon in the browser toolbar (pin it from the puzzle-piece menu) to choose a device for this tab.');
  });

  // routed state: ask once, then follow the background's updates
  const paint = (label) => { glyph.setRouted(label); if (label) reveal(); };
  chrome.runtime.sendMessage({ target: 'background', type: 'status' }).then((r) => paint(r && r.route ? r.route.label : null)).catch(() => {});
  chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'state') paint(m.routed); });
})();
