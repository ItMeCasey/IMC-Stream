'use strict';
/**
 * Builds the two browser extensions into extension/dist/chrome and extension/dist/firefox (each folder is complete: its own files + shared/ + icons/).
 *   node build.js          build both
 *   node build.js --zip    also make dist/imc-audio-router-<browser>-<version>.zip (for the Firefox add-on store, or to hand around)
 * Chrome / Edge: open chrome://extensions, turn on Developer mode, "Load unpacked", pick dist/chrome.
 * Firefox: about:debugging > This Firefox > "Load Temporary Add-on", pick dist/firefox/manifest.json (or install the signed zip).
 */
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const ROOT = __dirname, DIST = path.join(ROOT, 'dist');

function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  for (const b of ['chrome', 'firefox']) {
    const out = path.join(DIST, b);
    fs.cpSync(path.join(ROOT, b), out, { recursive: true });
    fs.cpSync(path.join(ROOT, 'shared'), out, { recursive: true });
    fs.cpSync(path.join(ROOT, 'icons'), path.join(out, 'icons'), { recursive: true });
  }
  return ['chrome', 'firefox'].map((b) => path.join(DIST, b));
}
function zip(dir) {
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version, out = path.join(DIST, 'imc-audio-router-' + path.basename(dir) + '-' + v + '.zip');
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe') : 'tar';
  const r = spawnSync(tar, process.platform === 'win32' ? ['-a', '-c', '-f', out, '-C', dir, '.'] : ['-a', '-c', '-f', out, '-C', dir, '.'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('zip failed: ' + (r.stderr || r.error));
  return out;
}
module.exports = { build, zip };
if (require.main === module) {
  const dirs = build(); console.log('built: ' + dirs.join(', '));
  if (process.argv.includes('--zip')) for (const d of dirs) console.log('zip: ' + zip(d));
}
