'use strict';
// The browser extension: device-picking logic, manifests and that every file they name exists after a build. Run: node test.js
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), M = require('./shared/match.js'), { build } = require('./build.js');

// ---- picking a device
const raw = [{ deviceId: 'default', label: 'Default - Speakers (Realtek)' }, { deviceId: 'communications', label: 'Communications - Speakers' }, { deviceId: 'a', label: 'Speakers (Realtek)' }, { deviceId: 'v', label: 'Voicemeeter AUX Input (VB-Audio Voicemeeter VAIO)' }, { deviceId: 'v2', label: 'Voicemeeter Input (VB-Audio Voicemeeter VAIO)' }];
const list = M.usable(raw);
assert.deepEqual(list.map((d) => d.deviceId), ['default', 'a', 'v', 'v2'], 'the duplicate "communications" entry is dropped');
assert.equal(list[0].label, 'System default - Speakers (Realtek)');
assert.deepEqual(M.usable([{ deviceId: 'default', label: '' }, { deviceId: 'x', label: '' }, { deviceId: 'y', label: '' }]).map((d) => d.label), ['System default', 'Audio output 1', 'Audio output 2'], 'names are numbered while the browser hides them');
assert.equal(M.pickPreferred(list, 'aux').deviceId, 'v', 'case-insensitive, finds the AUX input');
assert.equal(M.pickPreferred(list, 'Voicemeeter Input').deviceId, 'v2'); assert.equal(M.pickPreferred(list, ''), null); assert.equal(M.pickPreferred(list, 'nothing like this'), null);
assert.equal(M.preselect(list, 'a', 'aux'), 'a', 'the device already in use wins'); assert.equal(M.preselect(list, 'gone', 'aux'), 'v'); assert.equal(M.preselect(list, null, ''), 'default'); assert.equal(M.preselect([], null, 'aux'), '');

// ---- manifests and files
const dirs = build();
for (const dir of dirs) {
  const name = path.basename(dir), mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(mf.manifest_version, 3, name + ': Manifest V3');
  const files = new Set(Object.values(mf.icons || {}));
  for (const cs of mf.content_scripts || []) cs.js.forEach((f) => files.add(f));
  if (mf.background && mf.background.service_worker) files.add(mf.background.service_worker);
  if (mf.action && mf.action.default_popup) files.add(mf.action.default_popup);
  for (const f of files) assert.ok(fs.existsSync(path.join(dir, f)), name + ': missing ' + f);
  // every script is valid JavaScript
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: name + '/' + f });
  // every local script an HTML page asks for is there
  for (const h of fs.readdirSync(dir).filter((x) => x.endsWith('.html'))) for (const m of fs.readFileSync(path.join(dir, h), 'utf8').matchAll(/<script src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(dir, m[1])), name + '/' + h + ': missing ' + m[1]);
}
const chrome = JSON.parse(fs.readFileSync(path.join(dirs[0], 'manifest.json'), 'utf8')), ff = JSON.parse(fs.readFileSync(path.join(dirs[1], 'manifest.json'), 'utf8'));
assert.deepEqual(chrome.permissions.sort(), ['activeTab', 'offscreen', 'storage', 'tabCapture'], 'Chrome asks for nothing more than it needs');
assert.deepEqual(ff.permissions, ['storage'], 'Firefox only stores the choice per site');
assert.ok(ff.content_scripts[0].matches.every((m) => m.startsWith('https://')), 'Firefox: the sink API needs https pages');
assert.equal(chrome.version, ff.version, 'same version in both');
assert.ok(!JSON.stringify(chrome).includes('<all_urls>') || chrome.content_scripts[0].matches[0] === '<all_urls>', 'the page-wide access is only the glyph script');
console.log('extension test: ok');
