'use strict';
/**
 * Imports alert art and custom alert code you already own into the Alert Builder (see docs/ALERT_IMPORT.md for the formats and what is not supported).
 * Reads a .zip (made with the tar.exe that ships with Windows, like backups and modules) or single files. Nothing is downloaded and no account is touched:
 *  - media (PNG / GIF / WebP / JPG, WebM / MP4, WAV / MP3 / OGG) is copied into the custom asset folders under the same size limits as alert uploads,
 *  - HTML + CSS + JS + fields JSON (StreamElements widget layout, or any .html / .css / .js / fields.json) becomes an HTML-mode design,
 *  - our own design JSON is accepted too.
 * run() returns { design, report }; the caller saves the design. A .zip is checked first: no paths that escape, no links, limited size and count.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { svgOk, fontOk } = require('./alertdesign.js');

const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const KINDS = { image: ['.png', '.gif', '.webp', '.jpg', '.jpeg', '.svg'], video: ['.webm', '.mp4'], sound: ['.wav', '.mp3', '.ogg', '.m4a', '.flac', '.opus'], font: ['.ttf', '.otf', '.woff', '.woff2'] };
const MEDIA_EXT = 'png|gif|webp|jpe?g|svg|webm|mp4|wav|mp3|ogg|ttf|otf|woff2?';
const DIRS = { image: 'assets', video: 'video', sound: 'sounds', font: 'fonts' }, URLS = { image: '/assets/', video: '/video/', sound: '/sounds/', font: '/fonts/' };   // folder under custom/ and the URL the server uses for it
const LIMIT = { image: 15e6, sound: 15e6, video: 80e6, font: 5e6, code: 300e3, files: 600, total: 500e6 };
const kindOf = (ext) => Object.keys(KINDS).find((k) => KINDS[k].includes(ext)) || '';
const LINE_ZIP = /^[^\s]+\s+\d+\s+\S+\s+\S+\s+(\d+)\s/;   // a line of `tar -tv`: permissions, links, owner, group, SIZE, date, name

// the first bytes must match the file type, so a renamed program or page does not get in as a picture
function magicOk(kind, ext, b) {
  const s = (from, to) => b.subarray(from, to).toString('latin1');
  if (kind === 'font') return fontOk(ext, b);
  if (kind === 'image' && ext === '.svg') return svgOk(b);
  if (kind === 'image') return ext === '.png' ? b[0] === 0x89 && s(1, 4) === 'PNG' : ext === '.gif' ? s(0, 4) === 'GIF8' : ext === '.webp' ? s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP' : b[0] === 0xff && b[1] === 0xd8;
  if (kind === 'video') return ext === '.webm' ? b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 : s(4, 8) === 'ftyp';
  return ext === '.wav' ? s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE' : ext === '.ogg' || ext === '.opus' ? s(0, 4) === 'OggS' : ext === '.flac' ? s(0, 4) === 'fLaC' : ext === '.m4a' ? s(4, 8) === 'ftyp' : s(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
}
// picture size from the file header (PNG, GIF, WebP), so imported pictures land at a sensible size
function dims(ext, b) {
  try {
    if (ext === '.svg') {   // from the viewBox, or width and height
      const t = b.toString('utf8', 0, 2000), vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(t), wh = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)(?:px)?["'][^>]*\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(t), m = vb || wh;
      return m && +m[1] > 0 && +m[2] > 0 ? [Math.round(+m[1]), Math.round(+m[2])] : null;
    }
    if (ext === '.png') return [b.readUInt32BE(16), b.readUInt32BE(20)];
    if (ext === '.gif') return [b.readUInt16LE(6), b.readUInt16LE(8)];
    if (ext === '.webp') {
      const t = b.toString('latin1', 12, 16);
      if (t === 'VP8X') return [1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16))];
      if (t === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
      if (t === 'VP8L') return [1 + (((b[22] & 0x3f) << 8) | b[21]), 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6))];
    }
  } catch (e) { /* too short */ }
  return null;
}
const unique = (dir, raw, ext) => {
  const base = path.basename(raw, ext).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'import';
  let f = base + ext, n = 1; while (fs.existsSync(path.join(dir, f))) f = base + '-' + (++n) + ext;
  return f;
};

// list a zip and refuse bad names; returns the entry names
function listZip(zip) {
  const r = spawnSync(TAR, ['-t', '-f', zip], { encoding: 'utf8', windowsHide: true, maxBuffer: 20e6, timeout: 120000 });
  if (r.error || r.status !== 0) throw new Error('That is not a valid .zip file');
  const names = r.stdout.split(/\r?\n/).filter(Boolean);
  if (!names.length) throw new Error('The zip is empty');
  if (names.length > LIMIT.files) throw new Error('The zip has more than ' + LIMIT.files + ' files');
  for (const n of names) if (n.includes('..') || path.isAbsolute(n) || /^[a-zA-Z]:/.test(n) || n.startsWith('/') || n.startsWith('\\')) throw new Error('The zip contains a path that leaves its folder: ' + n);
  const v = spawnSync(TAR, ['-t', '-v', '-f', zip], { encoding: 'utf8', windowsHide: true, maxBuffer: 20e6, timeout: 120000 });
  let total = 0; for (const l of (v.stdout || '').split(/\r?\n/)) { const m = LINE_ZIP.exec(l); if (m) total += Number(m[1]); }
  if (total > LIMIT.total) throw new Error('The zip unpacks to more than ' + Math.round(LIMIT.total / 1e6) + ' MB');
  return names;
}
// unpack into a fresh temp folder; links are refused because they could point outside it
function unpack(zip, tmp) {
  const x = spawnSync(TAR, ['-x', '-f', zip, '-C', tmp], { encoding: 'utf8', windowsHide: true, timeout: 300000 });
  if (x.status !== 0) throw new Error('Could not unpack the zip');
  const out = [];
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (fs.lstatSync(f).isSymbolicLink()) throw new Error('The zip contains a link (' + e.name + ')');
      if (e.isDirectory()) walk(f, r); else out.push({ rel: r, abs: f, size: fs.statSync(f).size });
    }
  })(tmp, '');
  return out;
}

const SRC_REF = /\b(src|href|poster|data-src)\s*=\s*(["'])(.*?)\2|url\(\s*(["']?)([^"')]+)\4\s*\)/gi;
const STR_REF = new RegExp('(["\'])([^"\'\\n\\\\]*\\.(?:' + MEDIA_EXT + '))\\1', 'gi');
const IS_MEDIA = new RegExp('\\.(' + MEDIA_EXT + ')$', 'i');
const baseOf = (ref) => { try { return decodeURIComponent(String(ref).split(/[?#]/)[0].split(/[\\/]/).pop()).toLowerCase(); } catch (e) { return String(ref).split(/[\\/]/).pop().toLowerCase(); } };
const REMOTE = /^(https?:)?\/\//i;

/**
 * opts = { file (a path on disk), name (the original file name), custom (the custom folder), seconds? }
 * returns { design (not yet saved; null when there was only media and nothing could be placed), report: { imported, skipped, warnings, summary } }
 */
function run(opts) {
  const rep = { imported: [], skipped: [], warnings: [], summary: '' };
  const skip = (f, why) => rep.skipped.push({ file: f, reason: why });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-import-'));
  try {
    const ext0 = path.extname(opts.name || '').toLowerCase();
    let files;
    if (ext0 === '.zip') { listZip(opts.file); files = unpack(opts.file, tmp); }
    else { const st = fs.statSync(opts.file); files = [{ rel: path.basename(opts.name || 'file'), abs: opts.file, size: st.size }]; }

    // ---- sort every file into media, code or "not supported"
    const media = [], code = { html: [], css: [], js: [], json: [] };
    for (const f of files) {
      const ext = path.extname(f.rel).toLowerCase(), k = kindOf(ext), base = path.basename(f.rel);
      if (/^(__macosx|\.)/i.test(f.rel.split('/')[0]) || base.startsWith('._') || base === '.DS_Store' || base === 'Thumbs.db') continue;
      if (k) {
        if (f.size > LIMIT[k]) { skip(f.rel, 'over ' + Math.round(LIMIT[k] / 1e6) + ' MB'); continue; }
        const b = fs.readFileSync(f.abs); if (!magicOk(k, ext, b)) { skip(f.rel, 'the contents do not match a ' + ext + ' file'); continue; }
        media.push({ f, k, ext, b });
      } else if (['.html', '.htm'].includes(ext)) code.html.push(f);
      else if (ext === '.css') code.css.push(f); else if (ext === '.js') code.js.push(f); else if (ext === '.json') code.json.push(f);
      else skip(f.rel, ['.overlay', '.url', '.lnk'].includes(ext) ? 'overlay / import-link files from the services are not supported (see docs/ALERT_IMPORT.md)' : 'not a supported file type');
    }
    const text = (f) => { if (f.size > LIMIT.code) { skip(f.rel, 'over ' + LIMIT.code / 1000 + ' KB'); return null; } return fs.readFileSync(f.abs, 'utf8').replace(/^\uFEFF/, ''); };
    const named = (list, ...names) => list.find((f) => names.includes(path.basename(f.rel).toLowerCase())) || list[0];

    // ---- code: widget.html / .css / .js / fields json, or one JSON with those keys, or our own design JSON
    let design = null, html = '', css = '', js = '', fields = {}, found = false, extScript = false;
    for (const f of code.json) {
      const t = text(f); if (t == null) continue; let j; try { j = JSON.parse(t); } catch (e) { skip(f.rel, 'not valid JSON'); continue; }
      if (!j || typeof j !== 'object' || Array.isArray(j)) { skip(f.rel, 'not a design or fields file'); continue; }
      const low = {}; for (const k of Object.keys(j)) low[k.toLowerCase()] = j[k];
      if (Array.isArray(j.parts) || j.mode === 'html' || j.mode === 'builder') { design = Object.assign({}, j); rep.imported.push({ file: f.rel, as: 'design' }); found = true; }
      else if (typeof low.html === 'string' || typeof low.js === 'string' || typeof low.css === 'string') {
        html = html || String(low.html || ''); css = css || String(low.css || ''); js = js || String(low.js || low.javascript || '');
        const fl = low.fields || low.fielddata; if (fl && typeof fl === 'object') fields = Object.assign(fields, fl); else if (typeof low.fieldsjson === 'string') { try { fields = Object.assign(fields, JSON.parse(low.fieldsjson)); } catch (e) { rep.warnings.push('The fields JSON in ' + f.rel + ' is not valid'); } }
        rep.imported.push({ file: f.rel, as: 'widget code' }); found = true;
      } else if (Object.keys(j).length && Object.keys(j).every((k) => j[k] && typeof j[k] === 'object' && ('type' in j[k] || 'value' in j[k]))) { fields = Object.assign(fields, j); rep.imported.push({ file: f.rel, as: 'fields' }); }   // StreamElements FIELDS
      else skip(f.rel, 'not a design, widget or fields file');
    }
    if (code.html.length) {
      const hf = named(code.html, 'widget.html', 'index.html'), t = text(hf);
      if (t != null) {   // a <style> or <script> block inside the page moves to the CSS and JS boxes
        let c2 = '', j2 = '';
        html = t.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, c) => { c2 += c + '\n'; return ''; }).replace(/<script[^>]*\ssrc=[^>]*>\s*<\/script>/gi, () => { extScript = true; return ''; }).replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (m, c) => { j2 += c + '\n'; return ''; })
          .replace(/<\/?(html|head|body)[^>]*>|<!doctype[^>]*>|<meta[^>]*>|<title>[\s\S]*?<\/title>/gi, '').trim();
        css = css || c2.trim(); js = js || j2.trim(); rep.imported.push({ file: hf.rel, as: 'HTML' }); found = true;
      }
      for (const f of code.html) if (f !== hf) skip(f.rel, 'only one HTML page is used per design');
    }
    if (code.css.length) { const cf = code.css.map((f) => text(f)).filter((t) => t != null); if (cf.length) { css = (css ? css + '\n' : '') + cf.join('\n'); rep.imported.push({ file: code.css.map((f) => f.rel).join(', '), as: 'CSS' }); found = true; } }
    if (code.js.length) { const jf = named(code.js, 'widget.js', 'script.js', 'index.js'), t = text(jf); if (t != null) { js = js || t; rep.imported.push({ file: jf.rel, as: 'JavaScript' }); found = true; } for (const f of code.js) if (f !== jf) skip(f.rel, 'only one script is used per design'); }

    // ---- media: copied only when something uses it (the design's code or, with no code, placed as parts)
    const byBase = new Map(); for (const m of media) { const b = path.basename(m.f.rel).toLowerCase(); if (!byBase.has(b)) byBase.set(b, m); }
    const copied = new Map();
    const bring = (m) => {
      if (copied.has(m)) return copied.get(m);
      const dir = path.join(opts.custom, DIRS[m.k]); fs.mkdirSync(dir, { recursive: true });
      const file = unique(dir, path.basename(m.f.rel), m.ext); fs.writeFileSync(path.join(dir, file), m.b);
      const r = { rel: 'custom/' + file, url: URLS[m.k] + 'custom/' + file }; copied.set(m, r); rep.imported.push({ file: m.f.rel, as: r.rel }); return r;
    };
    for (const m of media) if (m.k === 'font') bring(m);   // fonts are always added to your fonts, for any text part to use
    const remote = new Set(), missing = new Set();
    const point = (ref, urlMode) => {   // a reference in the code -> the copied file (or the ref unchanged)
      if (REMOTE.test(ref)) { remote.add(ref); return ref; }
      if (/^(data|blob):/i.test(ref)) return ref;
      const m = byBase.get(baseOf(ref)); if (!m) { if (IS_MEDIA.test(baseOf(ref))) missing.add(baseOf(ref)); return ref; }
      return urlMode ? bring(m).url : bring(m).rel;
    };
    const fix = (s, isJs) => {
      s = String(s || '').replace(SRC_REF, (all, a, q, v, q2, u) => (u != null ? 'url(' + q2 + point(u, true) + q2 + ')' : a + '=' + q + point(v, true) + q));
      return isJs ? s.replace(STR_REF, (all, q, v) => q + point(v, true) + q) : s;
    };
    let usedCode = false;
    if (design) {
      for (const p of Array.isArray(design.parts) ? design.parts : []) if (p && typeof p.src === 'string' && p.src) { const m = byBase.get(baseOf(p.src)); p.src = m ? bring(m).rel : p.src; }
      design.html = fix(design.html); design.css = fix(design.css); design.js = fix(design.js, true);
    } else if (found) {
      usedCode = true;
      for (const k of Object.keys(fields)) if (fields[k] && typeof fields[k] === 'object' && typeof fields[k].value === 'string' && IS_MEDIA.test(baseOf(fields[k].value))) fields[k].value = point(fields[k].value, true);
      design = { name: '', mode: 'html', html: fix(html), css: fix(css), js: fix(js, true), fields, parts: [] };
      if (extScript) rep.warnings.push('The page loads a script from the web (blocked: designs have no network). Libraries it needs must be pasted into the JavaScript box.');
    } else if (media.some((m) => m.k !== 'font')) {   // only art: place it as parts, pictures at their own size (shrunk to fit 600 x 400), sounds as sound parts
      design = { name: '', mode: 'builder', parts: [] }; let x = 40, y = 40, rowH = 0;
      for (const m of media.filter((x) => x.k !== 'font').slice(0, 40)) {
        const r = bring(m);
        if (m.k === 'sound') { design.parts.push({ type: 'sound', name: path.basename(m.f.rel), src: r.rel, volume: 60 }); continue; }
        let [w, h] = (m.k === 'image' && dims(m.ext, m.b)) || [640, 360]; const s = Math.min(1, 600 / w, 400 / h); w = Math.max(8, Math.round(w * s)); h = Math.max(8, Math.round(h * s));
        if (x + w > 1880) { x = 40; y += rowH + 30; rowH = 0; }
        design.parts.push({ type: m.k, name: path.basename(m.f.rel).slice(0, 30), src: r.rel, x, y, w, h, fit: 'contain', loop: m.k === 'video', volume: 0 });
        x += w + 30; rowH = Math.max(rowH, h);
      }
      if (media.length > 40) rep.warnings.push('Only the first 40 media files were placed; the rest were not copied.');
    }
    if (usedCode || design) for (const m of media) if (!copied.has(m) && usedCode && m.k !== 'font') rep.skipped.push({ file: m.f.rel, reason: 'not used by the code, so not copied' });
    if (remote.size) rep.warnings.push('Not loaded (designs have no network): ' + Array.from(remote).slice(0, 5).join(', ') + (remote.size > 5 ? ' and ' + (remote.size - 5) + ' more' : '') + '. Download these files and import them too.');
    if (missing.size) rep.warnings.push('Files the code refers to were not in the import: ' + Array.from(missing).slice(0, 8).join(', '));
    if (usedCode || (design && design.mode === 'html')) rep.warnings.push('Imported code runs in the sandbox like your own HTML: it cannot reach the network or this app. Only import code you trust.');
    if (design) { design.name = String(design.name || '').trim() || path.basename(opts.name || 'Imported', path.extname(opts.name || '')).slice(0, 40) || 'Imported'; design.id = ''; design.seconds = design.seconds || opts.seconds || 8; }
    const fontsAdded = media.filter((m) => m.k === 'font' && copied.has(m)).length;
    rep.summary = !design && fontsAdded ? 'Added ' + fontsAdded + ' font' + (fontsAdded > 1 ? 's' : '') + ' to your fonts.' : design ? 'Made the design "' + design.name + '" (' + (design.mode === 'html' ? 'HTML' : design.parts.length + ' parts') + ') from ' + rep.imported.length + ' file(s).' : 'Nothing could be imported.';
    return { design, report: rep };
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* busy */ } }
}

module.exports = { run, magicOk, dims, LIMIT, KINDS };
