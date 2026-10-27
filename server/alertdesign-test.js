'use strict';
// Alert Builder: design cleaning, the HTML sandbox page, and the real server (rules, overlay events, cross-site refusals). Run: node alertdesign-test.js
const assert = require('node:assert'), http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const AD = require('./alertdesign.js'), LIB = require('../overlays/alert-design.js');

const A = { images: ['logo.png', 'custom/cat.webp', 'bits/bits_100_180.png'], sounds: ['alert_follow.wav'], videos: ['custom/clip.webm'] };
const base = { type: 'text', text: '{name}' };

// ---- cleaning: everything is clamped or whitelisted
{
  const d = AD.sanitize({ name: '  My   alert ', mode: 'html', seconds: 999, parts: [
    Object.assign({}, base, { id: 'abc', x: 1e9, y: -1e9, w: -5, h: 'junk', size: 9999, color: 'red; background:url(x)', font: 'Evil"Font', align: 'justify', in: { a: 'explode', ms: 1e9, delay: -4, ease: 'warp' }, idle: 'nope' }),
    { type: 'image', src: '../../secret.png' }, { type: 'image', src: 'custom/cat.webp' }, { type: 'video', src: 'logo.png' }, { type: 'sound', src: 'alert_follow.wav', volume: 500 },
    { type: 'script', src: 'x' }, null, 'text', { type: 'text', id: 'abc', text: 'dup id' },
  ], html: '<b>{name}</b>' }, A);
  assert.strictEqual(d.name, 'My alert'); assert.strictEqual(d.mode, 'html'); assert.strictEqual(d.seconds, 30); assert.deepStrictEqual([d.w, d.h], [1920, 1080]);
  const t = d.parts[0];
  assert.deepStrictEqual([t.x, t.y, t.w, t.h, t.size], [6000, -4000, 1, 100, 400], 'numbers are clamped, junk falls back');
  assert.strictEqual(t.color, '#E2DAC2', 'a colour that is not #rrggbb is dropped'); assert.strictEqual(t.font, '@body'); assert.strictEqual(t.align, 'left');
  assert.deepStrictEqual(t.in, { a: 'fade', ms: 5000, delay: 0, ease: 'ease-out' }); assert.strictEqual(t.idle, 'none');
  assert.strictEqual(d.parts[1].src, '', 'a file outside the known lists is refused'); assert.strictEqual(d.parts[2].src, 'custom/cat.webp');
  assert.strictEqual(d.parts[3].src, '', 'a video part only takes videos'); assert.strictEqual(d.parts[4].volume, 100);
  assert.strictEqual(d.parts.length, 6, 'unknown part types and non-objects are dropped'); assert.strictEqual(new Set(d.parts.map((p) => p.id)).size, 6, 'part ids are unique');
  assert.strictEqual(AD.sanitize({ id: 'bad id!' }, A).id.startsWith('d-'), true, 'a bad id is replaced');
  assert.strictEqual(AD.sanitize({ parts: Array.from({ length: 200 }, () => base) }, A).parts.length, AD.LIMITS.parts);
  assert.throws(() => AD.sanitize({ html: 'x'.repeat(AD.LIMITS.html + 1) }, A), /HTML is over/); assert.throws(() => AD.sanitize({ css: 'x'.repeat(AD.LIMITS.css + 1) }, A), /CSS is over/); assert.throws(() => AD.sanitize({ js: 'x'.repeat(AD.LIMITS.js + 1) }, A), /JavaScript is over/);
  assert.throws(() => AD.sanitize(null, A), /No design/);
  assert.strictEqual(AD.sanitize({ parts: [{ type: 'text', group: 'abc123' }, { type: 'text', group: 'bad group!' }] }, A).parts.map((p) => p.group).join(), 'abc123,', 'a group id is plain letters and numbers');
  const F = AD.sanitize({ fields: { accent: { type: 'colorpicker', label: 'Accent', value: '#ff0000' }, 'bad name': { value: 1 }, n: { type: 'weird', value: 5 }, junk: 'x' } }, A).fields;
  assert.deepStrictEqual(Object.keys(F), ['accent', 'n']); assert.strictEqual(F.n.type, 'text', 'an unknown field type becomes text'); assert.strictEqual(F.n.value, 5);
  // theme colours and fonts: a part may name one (@accent, @heading) instead of a fixed value
  const th = AD.sanitize({ parts: [{ type: 'text', color: '@accent', font: '@heading', strokeColor: '@nope' }, { type: 'shape', fill: '@bg', fill2: '@primary', borderColor: '#ABCDEF' }, { type: 'image', src: 'logo.png', tint: '@secondary' }, { type: 'image', src: 'logo.png', tint: 'red' }] }, A).parts;
  assert.deepStrictEqual([th[0].color, th[0].font, th[0].strokeColor], ['@accent', '@heading', '#000000'], 'theme names are kept, unknown ones fall back'); assert.deepStrictEqual([th[1].fill, th[1].fill2, th[1].borderColor], ['@bg', '@primary', '#ABCDEF']);
  assert.deepStrictEqual([th[2].tint, th[3].tint], ['@secondary', ''], 'a tint is a colour or empty');
  const T2 = AD.sanitize({ theme: { colors: { primary: '#112233', accent: 'javascript:1', bogus: '#fff' }, fonts: { heading: 'Impact', body: 'Evil"Font' } } }, A).theme;
  assert.deepStrictEqual([T2.colors.primary, T2.colors.accent, Object.keys(T2.colors).length, T2.fonts.heading, T2.fonts.body], ['#112233', AD.DEFAULT_THEME.colors.accent, 6, 'Impact', 'Bahnschrift'], 'a theme is six colours and two known fonts'); assert.deepStrictEqual(AD.sanitize({}, A).theme, AD.DEFAULT_THEME);
  assert.deepStrictEqual(AD.vars({ vars: ['name', 'amount'] }, { name: 'Sam', amount: 5, secret: 'x' }), { name: 'Sam', amount: '5' }, 'only the event\'s own variables, as strings');
}

// ---- drawing helpers (the same file the OBS overlay and the builder load)
{
  assert.strictEqual(LIB.fill('{name} // {message}', { name: 'Sam', message: '' }), 'Sam', 'an empty variable leaves no dangling separator');
  assert.strictEqual(LIB.fill('{name} x {nope}', { name: 'A' }), 'A x', 'unknown variables are empty');
  const evil = '</script><img src=x onerror=alert(1)>"\'&';
  const doc = LIB.htmlDoc({ html: '<p title="{name}">{name}</p>', css: 'p{color:red}', js: 'var n = ALERT.vars.name;', seconds: 8 }, { name: evil }, { base: 'http://alerts.localhost:8420' });
  assert.ok(!doc.includes('<img src=x'), 'viewer text is escaped in the HTML'); assert.ok(doc.includes('&lt;/script&gt;&lt;img'), 'and shown as text');
  assert.strictEqual((doc.match(/<\/script>/g) || []).length, 3, 'the viewer text cannot close the script tags');
  assert.ok(doc.includes('\\u003c/script\\u003e'), 'the values handed to your JavaScript are escaped too');
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('<style>'), 'the security policy comes first');
  assert.ok(/connect-src 'none'/.test(doc) && /form-action 'none'/.test(doc) && /img-src http:\/\/alerts\.localhost:8420 data: blob:/.test(doc), 'no network from your page, only this app\'s files');
  assert.ok(LIB.htmlDoc({ js: 'a</script><b>' }, {}, { base: '' }).includes('a<\\/script><b>'), 'your own JavaScript cannot close its script tag early');
  const se = LIB.htmlDoc({ html: '<i>{{name}}|{amount}|{{accent}}</i>', css: '.a{color:{{accent}};width:{{w}}px}.b{x:{widgetDuration}}', js: '', fields: { accent: { value: '#00ff00' }, w: { value: '12px;}body{display:none' } }, seconds: 7 }, { name: 'S', months: '9' }, { base: '', event: 'resub' });
  assert.ok(se.includes('<i>S|9|#00ff00</i>'), 'StreamElements names work: {{name}}, amount = months for a resub, fields'); assert.ok(se.includes('width:12pxbodydisplaynone') === false && se.includes('width:12px'), 'a field cannot break out of a CSS rule'); assert.ok(se.includes('.b{x:7}'));
  assert.ok(se.includes('"listener":"subscriber-latest"') && se.includes('"amount":9'), 'the onEventReceived event is what a StreamElements widget expects'); assert.ok(se.indexOf('window.ALERT=') < se.indexOf('onWidgetLoad'));
  assert.strictEqual(LIB.col('@accent', '#000', { colors: { accent: '#112233' } }), '#112233'); assert.strictEqual(LIB.col('@accent', '#000'), LIB.THEME0.colors.accent, 'no theme: the app palette'); assert.strictEqual(LIB.col('@evil', '#000'), '#000'); assert.strictEqual(LIB.col('red;x', '#000'), '#000'); assert.strictEqual(LIB.fontOf('@heading', { fonts: { heading: 'Impact' } }), 'Impact');
  assert.ok(LIB.htmlDoc({ html: '', theme: { colors: { primary: '#112233' }, fonts: { heading: 'Impact' } } }, {}, { base: '' }).includes('--primary:#112233') && LIB.htmlDoc({ html: '' }, {}, { base: '' }).includes('--font-heading:"Bahnschrift"'), 'HTML designs get the theme as CSS variables');
  assert.ok(LIB.keyframes().includes('@keyframes adin-wipe') && LIB.keyframes().includes('@keyframes adout-wipe'));
  for (const a of LIB.ANIMS) assert.ok(AD.ANIM_IN.includes(a), a + ' is an allowed animation'); for (const a of AD.ANIM_IN.filter((x) => x !== 'none')) assert.ok(LIB.ANIMS.includes(a), a + ' can be drawn');
  for (const a of LIB.IDLES) assert.ok(AD.ANIM_IDLE.includes(a)); assert.deepStrictEqual(AD.ANIM_IDLE.filter((x) => x !== 'none').sort(), LIB.IDLES.slice().sort());
  const page = fs.readFileSync(path.join(__dirname, '..', 'overlays', 'alert-design.js'), 'utf8'); assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(page), 'the drawing code never builds markup from viewer text');
}

// ---- the real server
const PORT = 20000 + Math.floor(Math.random() * 20000), DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-ad-'));
const req = (method, p, headers, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: Object.assign({ Host: 'localhost:' + PORT }, headers) }, (res) => {
    if (p === '/events') { res.setEncoding('utf8'); let b = ''; res.on('data', (c) => { b += c; }); setTimeout(() => { res.destroy(); resolve({ status: res.statusCode, body: b }); }, 1500); return; }
    let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
  });
  r.on('error', reject); if (body) r.write(body); r.end();
});
const J = { 'Content-Type': 'application/json' }, api = async (p, b) => { const r = await req('POST', '/api/' + p, J, JSON.stringify(b || {})); return Object.assign(JSON.parse(r.body), { _status: r.status }); };
const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { ICM_PORT: String(PORT), ICM_DATA: DATA }), stdio: 'ignore' });
const done = (code) => { try { srv.kill(); } catch (e) { /* gone */ } setTimeout(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* busy */ } process.exit(code); }, 300); };

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await req('GET', '/api/health')).status === 200) break; } catch (e) { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  assert.equal((await req('GET', '/api/health')).status, 200, 'server is up');

  assert.equal((await req('GET', '/alert-builder')).status, 200, 'the builder page is served'); assert.equal((await req('GET', '/overlays/alert-design.js')).status, 200, 'and its drawing code');
  const mods = JSON.parse((await req('GET', '/api/modules')).body); assert.ok(mods.modules.some((m) => m.id === 'alert-builder'), 'it is in the menu');
  const list = JSON.parse((await req('GET', '/api/alertdesigns')).body);
  assert.deepStrictEqual(list.designs, []); assert.ok(list.assets.images.includes('bits/bits_100_180.png') && list.assets.images.includes('logo.png'), 'the shipped badges can be used'); assert.ok(list.events.follow && list.samples.follow.name);
  assert.ok(list.assets.images.includes('stock/icon_heart.png') && list.assets.images.includes('stock/frame_rounded.png'), 'the stock art can be used'); assert.deepStrictEqual(list.templates, []);
  const tpl = await api('alertdesign/template/save', { name: 'My bar', parts: [{ type: 'shape', x: 300, y: 200, w: 100, h: 20, group: 'abc123' }, { type: 'shape', x: 350, y: 250, w: 100, h: 20, group: 'abc123' }, { type: 'sound', src: 'nope.wav' }] });
  assert.deepStrictEqual(tpl.parts.map((p) => [p.x, p.y]), [[0, 0], [50, 50]], 'a template is moved to the top left corner; a sound with no file is dropped'); assert.equal((await api('alertdesign/template/save', { parts: [] })).error, 'Nothing to save');
  assert.equal((await req('POST', '/api/alertdesign/template/save', { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, '{}')).status, 403);
  const th1 = await api('alertdesign/theme/save', { name: 'Sea', colors: { primary: '#001122', bogus: 'x' }, fonts: { heading: 'Georgia' } }); assert.ok(/^th-/.test(th1.id) && th1.colors.primary === '#001122' && th1.colors.accent === AD.DEFAULT_THEME.colors.accent && th1.fonts.heading === 'Georgia');
  assert.equal((await api('alertdesign/theme/save', { id: th1.id, name: 'Sea 2' })).id, th1.id, 'the same id updates a theme'); let tl = JSON.parse((await req('GET', '/api/alertdesigns')).body); assert.deepStrictEqual(tl.themes.map((x) => x.name), ['Sea 2']); assert.deepStrictEqual(tl.defaultTheme, AD.DEFAULT_THEME);
  assert.equal((await req('POST', '/api/alertdesign/theme/save', { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, '{}')).status, 403); await api('alertdesign/theme/delete', { id: th1.id }); assert.equal(JSON.parse((await req('GET', '/api/alertdesigns')).body).themes.length, 0);
  assert.ok(list.assets.images.includes('stock/mono_star.png') && list.assets.images.includes('stock/mono_frame_corners.png'), 'the one-colour art that takes a theme colour is there');
  assert.equal(JSON.parse((await req('GET', '/api/alertdesigns')).body).templates.length, 1); await api('alertdesign/template/delete', { id: tpl.id }); assert.equal(JSON.parse((await req('GET', '/api/alertdesigns')).body).templates.length, 0);

  // saving: from the app itself it works; cross-site and sandboxed requests do not
  const design = { name: 'Neon follow', seconds: 5, parts: [{ type: 'text', text: 'Hi {name}', x: 100, y: 100, w: 800, h: 100 }, { type: 'image', src: 'nope.png' }] };
  const evil = { Origin: 'https://evil.example', 'Content-Type': 'application/json' };
  assert.equal((await req('POST', '/api/alertdesign/save', evil, JSON.stringify(design))).status, 403, 'another site cannot save a design');
  assert.equal((await req('POST', '/api/alertdesign/save', Object.assign({}, J, { Origin: 'null' }), JSON.stringify(design))).status, 403, 'a sandboxed page cannot save a design (it could run code in OBS)');
  assert.equal((await req('POST', '/api/alertdesign/test', evil, '{}')).status, 403); assert.equal((await req('POST', '/api/alertdesign/delete', evil, '{}')).status, 403);
  const saved = await api('alertdesign/save', design); assert.equal(saved._status, 200); assert.ok(saved.id.startsWith('d-')); assert.equal(saved.parts[1].src, '', 'unknown file dropped');
  const big = await api('alertdesign/save', { name: 'big', html: 'x'.repeat(AD.LIMITS.html + 1) }); assert.equal(big._status, 400); assert.match(big.error, /HTML is over/);
  assert.equal((await api('alertdesign/save', Object.assign({}, saved, { name: 'Renamed' })))._status, 200); assert.equal(JSON.parse((await req('GET', '/api/alertdesigns')).body).designs.length, 1, 'saving the same id updates it');
  assert.equal(JSON.parse((await req('GET', '/api/alertdesign?id=' + saved.id)).body).name, 'Renamed'); assert.equal((await req('GET', '/api/alertdesign?id=nope')).status, 404);

  // a rule can point at it; an old rule (no design) is unchanged
  const rules = JSON.parse((await req('GET', '/api/alerts')).body);
  assert.ok(rules.rules.every((r) => !r.design), 'old rules have no design'); assert.deepStrictEqual(rules.designs, [{ id: saved.id, name: 'Renamed' }]);
  const follow = rules.rules.find((r) => r.event === 'follow');
  assert.equal((await api('alerts/save', Object.assign({}, follow, { design: 'does-not-exist' }))).design, '', 'an unknown design id is dropped');
  assert.equal((await api('alerts/save', Object.assign({}, follow, { design: saved.id }))).design, saved.id);
  assert.equal((await api('alerts/save', Object.assign({}, follow, { design: saved.id, enabled: false }))).design, saved.id, 'toggling a rule keeps its design');
  await api('alerts/save', Object.assign({}, follow, { design: saved.id, enabled: true }));
  const sse = req('GET', '/events'); await new Promise((r) => setTimeout(r, 400));
  await api('alerts/test', { id: follow.id }); await api('alertdesign/test', { id: saved.id, event: 'bits' }); assert.match((await api('alertdesign/test', { id: 'nope' })).error, /Save the design first/);
  const feed = (await sse).body;
  const alerts = feed.split('\n\n').filter((b) => b.startsWith('data: ') && b.includes('"kind"')).map((b) => JSON.parse(b.slice(6)));
  const viaRule = alerts.find((a) => a.ruleId === follow.id), viaTest = alerts.find((a) => a.event === 'bits' && a.design);
  assert.equal(viaRule.design, saved.id); assert.deepStrictEqual(viaRule.vars, { name: 'RetroRider' }); assert.equal(viaRule.seconds, 5, 'the design sets how long it stays'); assert.equal(viaRule.name, 'RetroRider', 'the history text is still filled in');
  assert.deepStrictEqual(viaTest.vars, { name: 'BitBaron', amount: '500', message: 'Take my bits!' }); assert.equal(viaTest.sound, '');
  const plain = rules.rules.find((r) => r.event === 'raid'); await api('alerts/test', { id: plain.id });

  // deleting the design sends its rules back to the default banner
  assert.equal((await api('alertdesign/delete', { id: saved.id })).ok, true);
  assert.ok(JSON.parse((await req('GET', '/api/alerts')).body).rules.every((r) => !r.design), 'rules fall back to the default banner');
  console.log('alertdesign-test: ok'); done(0);
})().catch((e) => { console.error(e); done(1); });
