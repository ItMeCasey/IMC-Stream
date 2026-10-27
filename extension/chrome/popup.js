/* IMC Audio Router, Chrome / Edge: the select box that opens from the toolbar icon. Opening it counts as "the user invoked the extension on this tab",
   which is what Chrome requires before a tab's sound may be captured. */
const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(Object.assign({ target: 'background' }, m));
let tabId = null, devices = [];

function say(t, ok) { $('msg').textContent = t || ''; $('msg').className = ok ? 'ok' : ''; }
function draw(route) {
  $('state').className = route ? 'on' : ''; $('state').textContent = route ? 'This tab plays on: ' + route.label : 'This tab plays on your normal output.';
  $('stop').disabled = !route;
}
// ask the background for something; "error" answers become a message under the buttons
async function ask(m) { const r = await send(m); if (r && r.error) throw new Error(r.error); return r; }

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = tab && tab.id;
  const prefer = (await chrome.storage.local.get({ prefer: 'Aux' })).prefer; $('prefer').value = prefer;
  if (tabId == null || !/^https?:|^file:/.test(tab.url || '')) { $('state').textContent = 'The browser does not allow capturing this kind of page.'; $('go').disabled = true; $('stop').disabled = true; $('dev').disabled = true; return; }
  try {
    const [st, dv] = await Promise.all([ask({ type: 'status', tabId }), ask({ type: 'devices' })]);
    devices = dv.devices; $('names').hidden = !!dv.hasLabels || !devices.length;
    $('dev').innerHTML = ''; for (const d of devices) { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label; $('dev').appendChild(o); }
    $('dev').value = IMCMatch.preselect(devices, st.route && st.route.deviceId, prefer); draw(st.route);
    if (!devices.length) { $('go').disabled = true; say('No audio outputs found.'); }
  } catch (e) { say(e.message); }
}

$('go').onclick = async () => {
  const d = devices.find((x) => x.deviceId === $('dev').value); if (!d) return;
  $('go').disabled = true; say('');
  try { await ask({ type: 'route', tabId, deviceId: d.deviceId, label: d.label }); draw({ deviceId: d.deviceId, label: d.label }); say('Done.', true); }
  catch (e) { say(/Cannot capture|active stream/i.test(e.message) ? 'This tab is already being captured (by this or another extension).' : e.message); }
  $('go').disabled = false;
};
$('stop').onclick = async () => { try { await ask({ type: 'stop', tabId }); draw(null); say('Back on the normal output.', true); } catch (e) { say(e.message); } };
$('prefer').onchange = () => { chrome.storage.local.set({ prefer: $('prefer').value.trim() }); const p = IMCMatch.pickPreferred(devices, $('prefer').value); if (p) $('dev').value = p.deviceId; };
$('grant').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('grant.html') }); window.close(); };
init();
