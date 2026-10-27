/* Picking an audio output from the list a browser gives us. Plain functions, no browser APIs, so the tests can run them in Node. */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make(); else root.IMCMatch = make();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const low = (s) => String(s == null ? '' : s).toLowerCase();

  /** the outputs worth showing: Chrome lists "default" and "communications" twice over, so the communications copy is dropped; blank names get a number */
  function usable(devices) {
    const out = (devices || []).filter((d) => d && d.deviceId !== 'communications');
    let n = 0;
    return out.map((d) => ({ deviceId: d.deviceId, label: d.label ? d.label.replace(/^Default - /i, 'System default - ') : (d.deviceId === 'default' ? 'System default' : 'Audio output ' + (++n)) }));
  }

  /** the first device whose name contains the text the user typed ("aux" finds "Voicemeeter AUX Input"), or null */
  function pickPreferred(devices, text) {
    const t = low(text).trim(); if (!t) return null;
    return (devices || []).find((d) => low(d.label).includes(t)) || null;
  }

  /** which device to preselect in a select box: the one already in use, else the preferred match, else the first */
  function preselect(devices, currentId, preferText) {
    const list = devices || [];
    if (currentId && list.some((d) => d.deviceId === currentId)) return currentId;
    const p = pickPreferred(list, preferText); if (p) return p.deviceId;
    return list[0] ? list[0].deviceId : '';
  }

  return { usable, pickPreferred, preselect };
});
