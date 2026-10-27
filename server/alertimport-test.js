'use strict';
// Alert Builder importer: art and custom code from a .zip you own, with the safety checks (zip slip, links, wrong file types, size). Run: node alertimport-test.js
const assert = require('node:assert'), http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib'), { spawn, spawnSync } = require('node:child_process');
const IMP = require('./alertimport.js'), LIB = require('../overlays/alert-design.js'), AD = require('./alertdesign.js');

// ---- small fixture files
const png = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([30, 0, 0, 0]), Buffer.from('WEBPVP8X'), Buffer.from([10, 0, 0, 0, 0, 0, 0, 0]), Buffer.from([0x63, 0x01, 0, 0x37, 0x01, 0]), Buffer.alloc(8)]);   // VP8X, 356 x 312
const webm = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40)]);
const mp3 = () => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40)]);
// a .zip written by hand (stored, no compression), so names like "../x" can be tested without a tool that refuses to make them
function zip(entries) {
  const out = [], cen = []; let off = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name), d = Buffer.isBuffer(data) ? data : Buffer.from(data), crc = zlib.crc32(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    out.push(lh, n, d); cen.push(ch, n); off += 30 + n.length + d.length;
  }
  const c = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(c.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...out, c, e]);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-imp-')), put = (n, b) => { const f = path.join(tmp, n); fs.writeFileSync(f, b); return f; };
const fresh = () => { const d = fs.mkdtempSync(path.join(tmp, 'custom-')); return d; };

// ---- file type checks
assert.ok(IMP.magicOk('image', '.png', png(1, 1)) && !IMP.magicOk('image', '.png', Buffer.from('MZ not a picture at all....')), 'a program renamed to .png is refused');
assert.ok(IMP.magicOk('image', '.webp', webp()) && IMP.magicOk('video', '.webm', webm()) && IMP.magicOk('sound', '.mp3', mp3()));
assert.deepStrictEqual(IMP.dims('.png', png(640, 200)), [640, 200]); assert.deepStrictEqual(IMP.dims('.webp', webp()), [356, 312]);

// ---- a StreamElements-style widget pack
const widget = `<!doctype html><html><head><style>.who{font-size:60px;background:url("images/Back.WEBP")}</style><script src="https://cdn.example/gsap.js"></script></head>
<body><div class="who">{{name}}</div><img src="./images/logo.png"><img src="https://evil.example/x.png"><img src="missing.png"><script>var s='sounds/ding.mp3'; window.addEventListener('onEventReceived',function(o){});</script></body></html>`;
const pack = put('pack.zip', zip([
  ['MyPack/widget.html', widget], ['MyPack/widget.json', JSON.stringify({ accent: { type: 'colorpicker', label: 'Accent', value: '#ff0000' }, pic: { type: 'image-input', label: 'Pic', value: 'logo.png' } })],
  ['MyPack/images/logo.png', png(300, 100)], ['MyPack/images/Back.webp', webp()], ['MyPack/sounds/ding.mp3', mp3()], ['MyPack/clip.webm', webm()],
  ['MyPack/fake.png', 'this is not a png'], ['MyPack/Pack.overlay', '{}'], ['MyPack/buy.url', '[InternetShortcut]'], ['__MACOSX/._x', 'junk'], ['MyPack/unused.gif', 'GIF89a' + 'x'.repeat(20)],
]));
let C = fresh(), r = IMP.run({ file: pack, name: 'My Pack.zip', custom: C });
assert.strictEqual(r.design.mode, 'html'); assert.strictEqual(r.design.name, 'My Pack');
assert.ok(/class="who">\{\{name\}\}</.test(r.design.html) && !/<style|<script/i.test(r.design.html), 'the page body is kept and the inline style / script move out');
assert.ok(r.design.css.includes('url("/assets/custom/back.webp")'), 'a picture the CSS uses is re-pointed at the copied file: ' + r.design.css);
assert.ok(r.design.html.includes('src="/assets/custom/logo.png"') && r.design.html.includes('src="https://evil.example/x.png"'), 'local pictures are re-pointed, web addresses are left alone');
assert.ok(r.design.js.includes("'/sounds/custom/ding.mp3'") && r.design.js.includes('onEventReceived'), 'the script keeps its code and its file names are re-pointed');
assert.strictEqual(r.design.fields.pic.value, '/assets/custom/logo.png', 'a fields value that names a picture points at the same copy');
assert.ok(fs.existsSync(path.join(C, 'assets', 'logo.png')) && fs.existsSync(path.join(C, 'assets', 'back.webp')) && fs.existsSync(path.join(C, 'sounds', 'ding.mp3')), 'used media is copied into the custom folders');
assert.ok(!fs.existsSync(path.join(C, 'assets', 'fake.png')) && !fs.existsSync(path.join(C, 'video')), 'a file that is not what its name says, and media nothing uses, are not copied');
const why = (f) => (r.report.skipped.find((x) => x.file.includes(f)) || {}).reason || '';
assert.match(why('fake.png'), /do not match/); assert.match(why('.overlay'), /not supported/); assert.match(why('buy.url'), /not supported/); assert.match(why('clip.webm'), /not used/);
assert.ok(r.report.warnings.some((w) => /evil\.example/.test(w) && /no network/.test(w)), 'web addresses are reported'); assert.ok(r.report.warnings.some((w) => /missing\.png/.test(w)), 'files that are not in the pack are reported');
assert.ok(r.report.warnings.some((w) => /script from the web/.test(w)) && r.report.warnings.some((w) => /sandbox/.test(w)));
// the result is a valid design, and it runs like a StreamElements widget (variables, fields, events)
const sane = AD.sanitize(r.design, { images: ['custom/logo.png', 'custom/back.webp'], sounds: [], videos: [] });
assert.strictEqual(sane.mode, 'html'); assert.strictEqual(sane.fields.accent.value, '#ff0000');
const doc = LIB.htmlDoc(Object.assign({}, sane, { css: '.a{color:{{accent}}}' }), { name: '<b>Sam</b>' }, { base: 'http://x', event: 'bits' });
assert.ok(doc.includes('&lt;b&gt;Sam') && doc.includes('color:#ff0000') && doc.includes('"listener":"cheer-latest"') && doc.includes('"fieldData":{"accent":"#ff0000"'));

// ---- art only: placed as parts
C = fresh(); r = IMP.run({ file: put('art.zip', zip([['a/Hero.png', png(1200, 400)], ['a/spin.webp', webp()], ['a/clip.webm', webm()], ['a/ding.mp3', mp3()]])), name: 'art.zip', custom: C });
assert.strictEqual(r.design.mode, 'builder'); assert.deepStrictEqual(r.design.parts.map((p) => p.type).sort(), ['image', 'image', 'sound', 'video']); const pt = (n) => r.design.parts.find((p) => p.name.toLowerCase() === n);
assert.deepStrictEqual([pt('hero.png').w, pt('hero.png').h], [600, 200], 'a big picture is shrunk to fit but keeps its shape'); assert.deepStrictEqual([pt('spin.webp').w, pt('spin.webp').h], [356, 312]);
assert.ok(AD.sanitize(r.design, { images: ['custom/hero.png', 'custom/spin.webp'], sounds: ['custom/ding.mp3'], videos: ['custom/clip.webm'] }).parts.every((p) => p.src), 'every part points at a copied file');
// a single picture, and our own design JSON
C = fresh(); r = IMP.run({ file: put('one.png', png(50, 50)), name: 'one.png', custom: C }); assert.strictEqual(r.design.parts.length, 1);
C = fresh(); r = IMP.run({ file: put('d.json', JSON.stringify({ name: 'Mine', mode: 'builder', parts: [{ type: 'text', text: 'Hi {name}' }] })), name: 'd.json', custom: C }); assert.strictEqual(r.design.name, 'Mine'); assert.strictEqual(r.design.id, '', 'imported as a new design');
C = fresh(); r = IMP.run({ file: put('w.json', JSON.stringify({ HTML: '<p>{name}</p>', CSS: 'p{color:red}', js: '', fields: { a: { type: 'text', value: 'x' } } })), name: 'w.json', custom: C }); assert.strictEqual(r.design.mode, 'html'); assert.strictEqual(r.design.fields.a.value, 'x');
C = fresh(); r = IMP.run({ file: put('nothing.zip', zip([['a.overlay', '{}'], ['b.exe', 'MZ']])), name: 'nothing.zip', custom: C }); assert.strictEqual(r.design, null); assert.strictEqual(r.report.skipped.length, 2);

// ---- safety
assert.throws(() => IMP.run({ file: put('slip.zip', zip([['../evil.png', png(1, 1)]])), name: 'slip.zip', custom: fresh() }), /leaves its folder/, 'a path with .. is refused');
assert.throws(() => IMP.run({ file: put('slip2.zip', zip([['a/..\\..\\evil.png', png(1, 1)]])), name: 'slip2.zip', custom: fresh() }), /leaves its folder/);
assert.throws(() => IMP.run({ file: put('abs.zip', zip([['C:/evil.png', png(1, 1)]])), name: 'abs.zip', custom: fresh() }), /leaves its folder/, 'a drive path is refused');
assert.throws(() => IMP.run({ file: put('junk.zip', 'not a zip'), name: 'junk.zip', custom: fresh() }), /not a valid \.zip/);
assert.throws(() => IMP.run({ file: put('empty.zip', zip([])), name: 'empty.zip', custom: fresh() }), /empty|not a valid/);
assert.throws(() => IMP.run({ file: put('many.zip', zip(Array.from({ length: IMP.LIMIT.files + 1 }, (_, i) => ['f' + i + '.txt', 'x']))), name: 'many.zip', custom: fresh() }), /more than/, 'too many files');
{
  const big = Buffer.concat([png(1, 1), Buffer.alloc(IMP.LIMIT.image)]);   // one byte over the 15 MB picture limit
  C = fresh(); r = IMP.run({ file: put('big.zip', zip([['big.png', big]])), name: 'big.zip', custom: C }); assert.strictEqual(r.design, null); assert.match(r.report.skipped[0].reason, /over 15 MB/); assert.ok(!fs.existsSync(path.join(C, 'assets')), 'an oversized file is not written');
  const html = '<p>x</p>' + ' '.repeat(IMP.LIMIT.code); C = fresh(); r = IMP.run({ file: put('bigcode.zip', zip([['w.html', html]])), name: 'bigcode.zip', custom: C }); assert.strictEqual(r.design, null, 'oversized code is not imported');
}
{   // a link in a zip could point outside the folder: made with the zip tool when this PC lets us create one
  const dir = path.join(tmp, 'lnk'); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'a.png'), png(1, 1));
  let linked = true; try { fs.symlinkSync(path.join(tmp, 'pack.zip'), path.join(dir, 'b.png')); } catch (e) { linked = false; }
  if (linked) {
    const z = path.join(tmp, 'lnk.zip'); const t = spawnSync(process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar', ['-a', '-c', '-f', z, '-C', dir, 'a.png', 'b.png'], { windowsHide: true });
    if (t.status === 0) assert.throws(() => IMP.run({ file: z, name: 'lnk.zip', custom: fresh() }), /contains a link/, 'links in a zip are refused');
  }
}

// ---- through the real server: only from the app itself, and the result is a saved design
const PORT = 20000 + Math.floor(Math.random() * 20000), DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-ai-'));
const req = (method, p, headers, body) => new Promise((resolve, reject) => {
  const q = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: Object.assign({ Host: 'localhost:' + PORT }, headers) }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
  q.on('error', reject); if (body) q.write(body); q.end();
});
const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { ICM_PORT: String(PORT), ICM_DATA: DATA }), stdio: 'ignore' });
const done = (code) => { try { srv.kill(); } catch (e) { /* gone */ } setTimeout(() => { for (const d of [DATA, tmp]) try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* busy */ } process.exit(code); }, 300); };
(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await req('GET', '/api/health')).status === 200) break; } catch (e) { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  const body = fs.readFileSync(pack), url = '/api/alertdesign/import?name=' + encodeURIComponent('My Pack.zip');
  assert.equal((await req('POST', url, { Origin: 'https://evil.example' }, body)).status, 403, 'another site cannot import');
  assert.equal((await req('POST', url, { Origin: 'null' }, body)).status, 403);
  const ok = await req('POST', url, {}, body), j = JSON.parse(ok.body); assert.equal(ok.status, 200); assert.ok(j.ok && j.id && j.report.imported.length >= 4);
  const list = JSON.parse((await req('GET', '/api/alertdesigns')).body); const d = list.designs.find((x) => x.id === j.id);
  assert.ok(d && d.mode === 'html' && d.css.includes('/assets/custom/back.webp'), 'saved as a design that points at the copied files'); assert.ok(list.assets.images.includes('custom/logo.png'));
  assert.equal(JSON.parse((await req('POST', '/api/alertdesign/import?name=x.zip', {}, Buffer.from('nope'))).body).error, 'That is not a valid .zip file');
  console.log('alertimport-test: ok'); done(0);
})().catch((e) => { console.error(e); done(1); });
