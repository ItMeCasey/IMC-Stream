'use strict';
// Version scheme: YYYY.M.Increment (for example 2026.10.3).
//   node bump-version.js          next version: same year and month -> increment + 1, a new month -> YYYY.M.1
//   node bump-version.js --show   print the current version and the next one
// Updates app/package.json (the installer name and the app's own version both come from it).
const fs = require('node:fs'), path = require('node:path');
const file = path.join(__dirname, 'package.json'), pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
function next(cur, date) {
  const y = date.getFullYear(), m = date.getMonth() + 1, [cy, cm, ci] = String(cur).split('.').map((x) => parseInt(x, 10));
  return cy === y && cm === m && Number.isFinite(ci) ? y + '.' + m + '.' + (ci + 1) : y + '.' + m + '.1';
}
module.exports = { next };
if (require.main === module) {
  const n = next(pkg.version, new Date());
  if (process.argv.includes('--show')) { console.log('current ' + pkg.version + ', next ' + n); process.exit(0); }
  pkg.version = n; fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n'); console.log('version ' + n);
}
