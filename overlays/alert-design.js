// Draws an Alert Builder design: parts on a 1920x1080 canvas, or your own HTML/CSS/JS in a sandboxed frame.
// The OBS alert overlay and the builder page both use this file, so what you see in the builder is what plays on stream.
// Viewer text (names, messages) only ever goes in through textContent or HTML-escaping, never as markup.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AlertDesign = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const W = 1920, H = 1080;

  // {name} -> value; empty variables can leave double spaces or a dangling "//" separator, so tidy up like the server does for the default banner
  function fill(text, vars) {
    return String(text == null ? '' : text).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : ''))
      .replace(/(\s*\/\/\s*)+$/, '').replace(/^(\s*\/\/\s*)+/, '').replace(/[ \t]{2,}/g, ' ').trim();
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
  // colours may be a theme colour (@primary ...): looked up in the design's theme, so one change recolours every part that follows it
  const THEME0 = { colors: { primary: '#4FBBBC', secondary: '#EC4624', accent: '#F39120', text: '#E2DAC2', bg: '#222A2A', muted: '#9aa39f' }, fonts: { heading: 'Bahnschrift', body: 'Bahnschrift' } };
  const col = (c, d, th) => {
    c = String(c || ''); if (c[0] === '@') { const v = ((th && th.colors) || THEME0.colors)[c.slice(1)]; return HEX.test(String(v || '')) ? v : d; }
    return HEX.test(c) ? c : d;
  };
  const fontOf = (f, th) => { f = String(f || ''); if (f[0] === '@') f = ((th && th.fonts) || THEME0.fonts)[f.slice(1)] || 'Bahnschrift'; return f; };
  const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const FILE = /^[A-Za-z0-9_./-]+$/;   // file names the server already vetted; checked again so a bad value can never become part of a URL
  const url = (base, dir, f) => (f && FILE.test(f) && !f.includes('..') ? base + dir + f : '');

  // ---- animations: every entrance has a matching exit (the same keyframes backwards)
  const FROM = {
    fade: 'opacity:0', left: 'opacity:0;transform:translateX(-400px)', right: 'opacity:0;transform:translateX(400px)', top: 'opacity:0;transform:translateY(-400px)',
    bottom: 'opacity:0;transform:translateY(400px)', zoom: 'opacity:0;transform:scale(.2)', spin: 'opacity:0;transform:rotate(-270deg) scale(.3)',
    flip: 'opacity:0;transform:perspective(900px) rotateY(90deg)', wipe: 'clip-path:inset(0 100% 0 0)',
  };
  const IDLE = {
    pulse: '0%,100%{transform:scale(1)}50%{transform:scale(1.06)}', float: '0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}',
    wiggle: '0%,100%{transform:rotate(0)}25%{transform:rotate(-4deg)}75%{transform:rotate(4deg)}', glow: '0%,100%{filter:drop-shadow(0 0 0 transparent)}50%{filter:drop-shadow(0 0 18px #ffffffcc)}',
    spin: '0%{transform:rotate(0)}100%{transform:rotate(360deg)}',
  };
  const IDLE_TIME = { pulse: 1.4, float: 3, wiggle: 1.2, glow: 1.8, spin: 8 };
  const EASE = { 'ease-out': 'cubic-bezier(.2,.9,.2,1)', 'ease-in-out': 'ease-in-out', linear: 'linear', bounce: 'cubic-bezier(.34,1.56,.64,1)' };
  function keyframes() {
    let css = '';
    for (const k of Object.keys(FROM)) css += '@keyframes adin-' + k + '{from{' + FROM[k] + '}to{opacity:1;transform:none;clip-path:inset(0 0 0 0)}}@keyframes adout-' + k + '{from{opacity:1;transform:none;clip-path:inset(0 0 0 0)}to{' + FROM[k] + '}}';
    css += '@keyframes adsheen{0%{transform:translateX(-160%) skewX(-20deg)}40%,100%{transform:translateX(520%) skewX(-20deg)}}';
    for (const k of Object.keys(IDLE)) css += '@keyframes adidle-' + k + '{' + IDLE[k] + '}';
    return css + '.adp{position:absolute;box-sizing:border-box}.adp>.adm,.adp>.adm>.adi{position:absolute;inset:0}';
  }
  function ensureStyle(doc) {
    if (doc.getElementById('ad-style')) return;
    const s = doc.createElement('style'); s.id = 'ad-style'; s.textContent = keyframes(); doc.head.appendChild(s);
  }
  const anim = (dir, a, delayShift) => (a && a.a !== 'none' && FROM[a.a] ? 'ad' + dir + '-' + a.a + ' ' + n(a.ms, 500) + 'ms ' + (EASE[a.ease] || EASE['ease-out']) + ' ' + (n(a.delay, 0) + (delayShift || 0)) + 'ms both' : '');

  // ---- one part
  function textStyle(s, p, th) {
    s.fontFamily = '"' + fontOf(p.font || 'Bahnschrift', th).replace(/[^A-Za-z0-9 ]/g, '') + '", "Segoe UI", sans-serif'; s.fontSize = n(p.size, 64) + 'px'; s.fontWeight = n(p.weight, 700);
    s.fontStyle = p.italic ? 'italic' : 'normal'; s.textTransform = p.caps ? 'uppercase' : 'none'; s.color = col(p.color, '#E2DAC2', th); s.letterSpacing = n(p.spacing, 0) + 'px'; s.lineHeight = n(p.lh, 1.1);
    s.textAlign = ['left', 'center', 'right'].includes(p.align) ? p.align : 'left';
    s.textShadow = p.shadow ? '0 4px 14px ' + col(p.shadowColor, '#000000', th) + ', 0 0 3px ' + col(p.shadowColor, '#000000', th) : 'none';
    s.webkitTextStroke = n(p.stroke, 0) > 0 ? n(p.stroke, 0) + 'px ' + col(p.strokeColor, '#000000', th) : '0'; s.paintOrder = 'stroke fill';
  }
  function partContent(doc, p, vars, o) {
    const c = doc.createElement('div'), s = c.style; s.width = s.height = '100%';
    if (p.type === 'text') {
      s.display = 'flex'; s.alignItems = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[p.valign] || 'center'; s.justifyContent = { left: 'flex-start', center: 'center', right: 'flex-end' }[p.align] || 'flex-start';
      const t = doc.createElement('div'); t.textContent = fill(p.text, vars); textStyle(t.style, p, o.theme); t.style.whiteSpace = p.fit === 'shrink' ? 'nowrap' : 'pre-wrap'; t.style.maxWidth = '100%'; t.style.overflowWrap = 'anywhere';
      t.setAttribute('data-fit', p.fit === 'shrink' ? '1' : ''); c.appendChild(t);
    } else if (p.type === 'shape') {
      const b = doc.createElement('div'), bs = b.style; bs.width = bs.height = '100%'; bs.boxSizing = 'border-box';
      bs.background = p.fill2 ? 'linear-gradient(' + n(p.angle, 90) + 'deg,' + col(p.fill, '#222A2A', o.theme) + ',' + col(p.fill2, '#4FBBBC', o.theme) + ')' : col(p.fill, '#222A2A', o.theme);
      if (n(p.border, 0) > 0) bs.border = n(p.border, 0) + 'px solid ' + col(p.borderColor, '#4FBBBC', o.theme);
      bs.borderRadius = p.kind === 'ellipse' ? '50%' : n(p.radius, 0) + 'px';
      const sh = [];   // glow, a soft drop shadow, and a light edge along the top, for a lit, raised look
      if (n(p.glow, 0) > 0) sh.push('0 0 ' + n(p.glow, 0) + 'px ' + col(p.glowColor, '#4FBBBC', o.theme));
      if (p.drop) sh.push('0 18px 34px rgba(0,0,0,.55)');
      if (p.bevel) sh.push('inset 0 2px 0 rgba(255,255,255,.28)', 'inset 0 0 0 1px rgba(255,255,255,.08)');
      if (sh.length) bs.boxShadow = sh.join(',');
      if (p.sheen && !o.edit) {   // (not while editing) a soft light that sweeps across now and then
        bs.overflow = 'hidden'; bs.position = 'relative'; const l = doc.createElement('div');
        l.style.cssText = 'position:absolute;top:0;bottom:0;left:0;width:26%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.3),transparent);animation:adsheen 4.5s ease-in-out 1.4s infinite'; b.appendChild(l);
      }
      if (n(p.skew, 0)) bs.transform = 'skewX(' + n(p.skew, 0) + 'deg)';
      c.appendChild(b);
    } else if (p.type === 'image') {
      const u = url(o.base, '/assets/', p.src);
      if (u && p.tint) {   // a one-colour picture filled with a colour: the picture's shape is the mask
        const t = doc.createElement('div'), ts = t.style, fit = ['contain', 'cover'].includes(p.fit) ? p.fit : '100% 100%';
        ts.cssText = 'width:100%;height:100%;border-radius:' + n(p.radius, 0) + 'px;background:' + col(p.tint, '#FFFFFF', o.theme) + ';-webkit-mask:url(' + u + ') center/' + fit + ' no-repeat;mask:url(' + u + ') center/' + fit + ' no-repeat'; c.appendChild(t);
      } else if (u) { const i = doc.createElement('img'); i.src = u; i.alt = ''; i.draggable = false; i.style.cssText = 'width:100%;height:100%;display:block;object-fit:' + (['contain', 'cover', 'fill'].includes(p.fit) ? p.fit : 'contain') + ';border-radius:' + n(p.radius, 0) + 'px' + (p.pixel ? ';image-rendering:pixelated' : ''); c.appendChild(i); }
    } else if (p.type === 'video') {
      const u = url(o.base, '/video/', p.src);
      if (u) {
        const v = doc.createElement('video'); v.src = u; v.loop = !!p.loop; v.playsInline = true; v.preload = 'auto'; v.muted = !!o.muted || n(p.volume, 0) === 0; v.volume = Math.min(1, (n(o.vol, 1)) * n(p.volume, 0) / 100);
        v.style.cssText = 'width:100%;height:100%;display:block;object-fit:' + (['contain', 'cover', 'fill'].includes(p.fit) ? p.fit : 'contain') + ';border-radius:' + n(p.radius, 0) + 'px'; c.appendChild(v);
      }
    }
    return c;
  }
  /** One part as an element at its place on the canvas (not animated). Sound parts have no picture: they return null. */
  function partEl(doc, p, vars, o) {
    if (p.type === 'sound') return null;
    ensureStyle(doc);
    const el = doc.createElement('div'), s = el.style; el.className = 'adp'; if (p.id) el.setAttribute('data-id', p.id);
    s.left = n(p.x, 0) + 'px'; s.top = n(p.y, 0) + 'px'; s.width = n(p.w, 100) + 'px'; s.height = n(p.h, 100) + 'px'; s.opacity = Math.min(1, Math.max(0, n(p.opacity, 1)));
    if (n(p.rot, 0)) s.transform = 'rotate(' + n(p.rot, 0) + 'deg)';
    const mid = doc.createElement('div'), inn = doc.createElement('div'); mid.className = 'adm'; inn.className = 'adi';
    if (IDLE[p.idle]) inn.style.animation = 'adidle-' + p.idle + ' ' + IDLE_TIME[p.idle] + 's ease-in-out infinite';
    inn.appendChild(partContent(doc, p, vars, o)); mid.appendChild(inn); el.appendChild(mid);
    return el;
  }
  // shrink one-line text until it fits its box (needs to be on the page to measure)
  function fitText(root) {
    root.querySelectorAll('[data-fit="1"]').forEach((t) => {
      const box = t.parentNode; let size = parseFloat(t.style.fontSize) || 64;
      for (let i = 0; i < 40 && size > 10 && (t.scrollWidth > box.clientWidth + 1 || t.scrollHeight > box.clientHeight + 1); i++) { size *= 0.94; t.style.fontSize = size + 'px'; }
    });
  }

  // ---- HTML mode: the page runs inside a sandboxed frame (scripts allowed, but no access to this app or the network)
  const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  // StreamElements names for the same events (their widgets listen for these in onEventReceived)
  const LISTENER = { follow: 'follower-latest', sub: 'subscriber-latest', resub: 'subscriber-latest', giftsub: 'subscriber-latest', bits: 'cheer-latest', tip: 'tip-latest', charity: 'tip-latest', raid: 'raid-latest' };
  const TIER = { 'Tier 1': '1000', 'Tier 2': '2000', 'Tier 3': '3000' };
  // our variables plus the StreamElements / Streamlabs names (amount means months for a resub, viewers for a raid ...), all plain strings
  function varMap(d, vars, ev) {
    const m = {}; for (const k of Object.keys(vars || {})) m[k] = String(vars[k]);
    const alias = { amount: m.amount || m.months || m.total || m.viewers || '', count: m.viewers || m.total || '', sender: ev === 'giftsub' ? m.name || '' : '', gifter: ev === 'giftsub' ? m.name || '' : '', messageRaw: m.message || '', announcement: '', currency: '', image: '', video: '', audio: '', videoVolume: '1', audioVolume: '1', widgetDuration: String(d.seconds || 8) };
    for (const k of Object.keys(alias)) if (!(k in m)) m[k] = alias[k];
    return m;
  }
  const fieldVals = (d) => { const o = {}; for (const k of Object.keys(d.fields || {})) o[k] = d.fields[k] && d.fields[k].value != null ? d.fields[k].value : ''; return o; };
  const cssSafe = (v) => String(v).replace(/[^\w #%.,()\/:+-]/g, '');   // a field value can be a colour, size or font name, but never break out of a CSS rule
  function htmlDoc(d, vars, o) {
    const ev = o.event || 'follow', m = varMap(d, vars, ev), f = fieldVals(d), site = o.base || '';
    const csp = "default-src 'none'; img-src " + site + " data: blob:; media-src " + site + " data: blob:; font-src " + site + " data:; style-src 'unsafe-inline' " + site + "; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; form-action 'none'";
    const name = /\{\{\s*(\w+)\s*\}\}|\{(\w+)\}/g;   // {{name}} (StreamElements) or {name}
    const body = String(d.html || '').replace(name, (x, a, b) => { const k = a || b; return esc(k in m ? m[k] : k in f ? f[k] : ''); });
    const css = String(d.css || '').replace(name, (x, a, b) => { const k = a || b; return k in f ? cssSafe(f[k]) : k === 'widgetDuration' ? cssSafe(m.widgetDuration) : x; });
    const num = Number(m.amount), detail = {
      listener: LISTENER[ev] || ev + '-latest',
      event: { name: m.name || '', amount: m.amount !== '' && Number.isFinite(num) ? num : m.amount, message: m.message || '', tier: TIER[m.tier] || m.tier || '', gifted: ev === 'giftsub', sender: m.sender, bulkGifted: ev === 'giftsub', isCommunityGift: false, playedAsCommunityGift: ev === 'giftsub' && Number(m.total) > 1 },
    };
    const load = { fieldData: f, channel: { username: '', apiToken: '' }, currency: { code: 'USD', name: 'US Dollar', symbol: '$' }, session: { data: {} }, recents: [] };
    // ALERT is there before your script runs; after it has run, it is told the widget loaded and that this event happened (the StreamElements way); alertleave fires when the alert is about to leave
    const pre = 'window.ALERT=' + jsonForScript({ vars: m, seconds: d.seconds || 8 }) + ';window.addEventListener("message",function(e){if(e.data&&e.data.adLeave){document.dispatchEvent(new Event("alertleave"))}});';
    const go = 'setTimeout(function(){window.dispatchEvent(new CustomEvent("onWidgetLoad",{detail:' + jsonForScript(load) + '}));window.dispatchEvent(new CustomEvent("onEventReceived",{detail:' + jsonForScript(detail) + '}))},0);';
    return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><style>html,body{margin:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:transparent}</style><style>:root{' + Object.keys((d.theme && d.theme.colors) || THEME0.colors).map((k) => '--' + k + ':' + col('@' + k, '#000000', d.theme)).join(';') + ';--font-heading:"' + fontOf('@heading', d.theme) + '";--font-body:"' + fontOf('@body', d.theme) + '"}</style><style>' + css + '</style></head><body>'
      + body + '<script>' + pre + '<\/script><script>' + String(d.js || '').replace(/<\/script/gi, '<\\/script') + '<\/script><script>' + go + '<\/script></body></html>';
  }

  /**
   * Build a whole design for the given variables. Returns { el, enter(), leave(done), stop() }.
   * o = { base: 'http://host:port' (where /assets and /video are served), muted, vol (0-1), edit (builder canvas: no animation, no sound) }
   */
  function build(doc, d, vars, o) {
    o = o || {}; o.base = o.base || ''; o.theme = o.theme || d.theme; ensureStyle(doc);
    const root = doc.createElement('div'), timers = [], media = []; root.className = 'ad-root'; root.style.cssText = 'position:relative;width:' + W + 'px;height:' + H + 'px';
    let frame = null, outMs = 0;
    const parts = [];
    if (d.mode === 'html') {
      frame = doc.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('title', 'alert'); frame.srcdoc = htmlDoc(d, vars, o);
      frame.style.cssText = 'position:absolute;left:0;top:0;width:' + W + 'px;height:' + H + 'px;border:0;background:transparent'; root.appendChild(frame); outMs = n(d.outMs, 500);
    } else {
      for (const p of d.parts || []) {
        const el = partEl(doc, p, vars, o); if (el) { root.appendChild(el); parts.push({ p, el }); }
        if (p.type === 'sound') parts.push({ p, el: null });
        if (p.type === 'video' && el) media.push({ p, v: el.querySelector('video') });
        if (el) { outMs = Math.max(outMs, p.out && p.out.a !== 'none' ? n(p.out.delay, 0) + n(p.out.ms, 0) : 0); }
      }
    }
    return {
      el: root, outMs,
      enter() {
        if (frame) return;
        fitText(root);
        for (const { p, el } of parts) {
          if (el && !o.edit) el.querySelector('.adm').style.animation = anim('in', p.in);
          if (o.edit) continue;
          const delay = n(p.in && p.in.delay, 0);
          if (p.type === 'sound' && !o.muted && p.src) { const u = url(o.base, '/sounds/', p.src); timers.push(setTimeout(() => { try { const a = new Audio(u); a.volume = Math.min(1, n(o.vol, 1) * n(p.volume, 60) / 100); a.play().catch(() => {}); media.push({ a }); } catch (e) { /* no audio */ } }, delay)); }
        }
        if (!o.edit) for (const m of media) if (m.v) { const dl = n(m.p.in && m.p.in.delay, 0); timers.push(setTimeout(() => { m.v.play().catch(() => {}); }, dl)); }
      },
      leave(done) {
        if (frame) { try { frame.contentWindow.postMessage({ adLeave: true }, '*'); } catch (e) { /* frame gone */ } timers.push(setTimeout(done, outMs)); return; }
        for (const { p, el } of parts) if (el && p.out && p.out.a !== 'none') el.querySelector('.adm').style.animation = anim('out', p.out);
        timers.push(setTimeout(done, outMs + 50));
      },
      stop() {
        for (const t of timers) clearTimeout(t); timers.length = 0;
        for (const m of media) { try { if (m.v) m.v.pause(); if (m.a) m.a.pause(); } catch (e) { /* gone */ } }
      },
    };
  }

  return { W, H, col, fontOf, THEME0, fill, esc, htmlDoc, partEl, fitText, build, ensureStyle, keyframes, ANIMS: Object.keys(FROM), IDLES: Object.keys(IDLE) };
});
