/* IMC Audio Router, Chrome / Edge: the hidden page that actually plays the sound. It takes the captured stream of a tab and plays it
   through an <audio> element whose output device is set with setSinkId. It also lists the audio outputs for the popup. */
const live = new Map();   // tabId -> { stream, el, deviceId, label }

function stop(tabId) {
  const r = live.get(tabId); if (!r) return;
  live.delete(tabId);
  try { r.el.pause(); r.el.srcObject = null; } catch (e) { /* already gone */ }
  r.stream.getTracks().forEach((t) => t.stop());   // letting go of the capture gives the tab its normal sound back
}

const handlers = {
  // the audio outputs; "hasLabels" is false until the extension page has been allowed to see device names
  async devices() {
    const out = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
    return { devices: out, hasLabels: out.some((d) => d.label) };
  },
  async routes() { return { routes: Object.fromEntries([...live].map(([id, r]) => [id, { deviceId: r.deviceId, label: r.label }])) }; },
  // capture the tab and play it on the chosen device
  async start({ tabId, streamId, deviceId, label }) {
    stop(tabId);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }, video: false });
    const el = new Audio(); el.srcObject = stream;
    try { await el.setSinkId(deviceId || ''); await el.play(); } catch (e) { stream.getTracks().forEach((t) => t.stop()); throw e; }
    stream.getAudioTracks().forEach((t) => { t.onended = () => { if (live.get(tabId) && live.get(tabId).stream === stream) { live.delete(tabId); chrome.runtime.sendMessage({ target: 'background', type: 'ended', tabId }).catch(() => {}); } }; });
    live.set(tabId, { stream, el, deviceId, label }); return { ok: true };
  },
  // move an already captured tab to another device
  async sink({ tabId, deviceId, label }) {
    const r = live.get(tabId); if (!r) throw new Error('That tab is not being routed any more');
    await r.el.setSinkId(deviceId || ''); r.deviceId = deviceId; r.label = label; return { ok: true };
  },
  async stop({ tabId }) { stop(tabId); return { ok: true }; }
};

chrome.runtime.onMessage.addListener((m, sender, send) => {
  if (!m || m.target !== 'offscreen' || !handlers[m.type]) return false;
  handlers[m.type](m).then(send, (e) => send({ error: e.message || String(e) }));
  return true;
});
