// Regenerates ../LABELS.md from the label list in server.js. Run: node make-label-docs.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
process.env.ICM_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-docs-'));
const S = require('./server.js');
S.renderLabels();
const groups = [
  ['Followers', /follower/], ['Subscribers & gifts', /sub|gift/], ['Bits', /bits|cheer/], ['Raids', /raid/],
  ['Channel points', /redemption|channel_points/], ['Tips', /tip/], ['Hype train', /hype/], ['Creator goal', /^goal/],
  ['Polls', /^poll/], ['Predictions', /^prediction/], ['Stream info', /^stream|viewers|channel_name/], ['Chat', /chat/],
  ['Ads', /ad_|next_ad/], ['Charity', /charity/],
];
const names = Object.keys(S.labelDocs), used = new Set();
let md = '# Label files\n\nEvery label is a UTF-8 text file in `data/labels/<name>.txt`, rewritten live by `server/server.js`.\nIn OBS: **Add > Text (GDI+) > Read from file**, pick the file. Multi-line labels hold one entry per line, newest/top first.\n"Session" labels reset when the stream goes online; "alltime" labels count since you installed the server.\n`all_labels.json` holds every label in one file.\n';
for (const [title, re] of groups) {
  const m = names.filter((n) => !used.has(n) && re.test(n));
  if (!m.length) continue;
  md += '\n## ' + title + '\n\n| File | What it holds |\n|---|---|\n' + m.map((n) => '| `' + n + '.txt` | ' + S.labelDocs[n] + ' |').join('\n') + '\n';
  m.forEach((n) => used.add(n));
}
const rest = names.filter((n) => !used.has(n));
if (rest.length) md += '\n## Other\n\n| File | What it holds |\n|---|---|\n' + rest.map((n) => '| `' + n + '.txt` | ' + S.labelDocs[n] + ' |').join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, '..', 'LABELS.md'), md);
console.log(names.length + ' labels documented');
process.exit(0);
