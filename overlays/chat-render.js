// Shared chat rendering: Twitch emotes + BTTV / FrankerFaceZ / 7TV emotes + badges.
// Data comes from the local server (/api/emotes, /api/badges). Used by overlays/chat.html and the mod dock.
(function () {
  const R = (window.ChatRender = { emotes: {}, badges: {}, base: '' });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  R.esc = esc;

  R.load = async function (base) {
    R.base = base || '';
    try {
      const [e, b] = await Promise.all([
        fetch(R.base + '/api/emotes').then((r) => r.json()),
        fetch(R.base + '/api/badges').then((r) => r.json()),
      ]);
      R.emotes = e.emotes || {}; R.badges = b || {};
    } catch (err) { /* server offline: Twitch emotes still render */ }
  };

  const twitchEmote = (id) => 'https://static-cdn.jtvnw.net/emoticons/v2/' + id + '/default/dark/2.0';
  const img = (url, name, cls, title) => '<img class="emote' + (cls ? ' ' + cls : '') + '" src="' + esc(url) + '" alt="' + esc(name) + '" title="' + esc(title || name) + '" loading="lazy">';

  /** HTML for the message text. msg.frags = [{type:'text'|'emote'|'cheermote'|'mention', text, id}] */
  R.body = function (msg) {
    const toks = [];
    (msg.frags || [{ type: 'text', text: msg.text || '' }]).forEach((f) => {
      if (f.type === 'emote' && f.id) toks.push({ e: true, html: img(twitchEmote(f.id), f.text) });
      else if (f.type === 'gif' && f.gif && /^https:\/\//.test(f.gif.url || '')) toks.push({ html: '<img class="gifpic" src="' + esc(f.gif.url) + '" alt="GIF" title="GIF" loading="lazy">' });
      else if (f.type === 'cheermote') toks.push({ html: '<span class="cheer">' + esc(f.text) + '</span>' });
      else if (f.type === 'mention') toks.push({ html: '<span class="mention">' + esc(f.text) + '</span>' });
      else String(f.text || '').split(/(\s+)/).forEach((w) => {
        if (!w) return;
        const ws = /^\s+$/.test(w), em = !ws && R.emotes[w];
        if (em) toks.push({ e: true, z: !!em.z, html: img(em.u, w, em.z ? 'zw' : '', w + ' (' + em.p + ')') });
        else toks.push({ ws, html: esc(w) });
      });
    });
    const out = [];
    for (const t of toks) {   // zero-width emotes are drawn on top of the emote before them
      if (t.z) {
        let i = out.length - 1; while (i >= 0 && out[i].ws) i--;
        if (i >= 0 && out[i].e) { out.length = i + 1; out[i].layers = (out[i].layers || '') + t.html; continue; }
      }
      out.push(t);
    }
    return out.map((t) => (t.layers ? '<span class="stack">' + t.html + t.layers + '</span>' : t.html)).join('');
  };

  // 7TV name paints (the colours, gradients, pictures and glow on a 7TV user's name): asked from the local server once per chatter, then drawn on the name
  const paints = new Map();
  R.applyPaint = function (node, uid, login) {
    if (!node || !uid) return;
    const key = uid + '/' + (login || '');
    if (!paints.has(key)) paints.set(key, fetch(R.base + '/api/seventv/paint?uid=' + encodeURIComponent(uid) + '&login=' + encodeURIComponent(login || '')).then((r) => r.json()).catch(() => ({})));
    paints.get(key).then((p) => {
      if (!p || !node.isConnected) return;
      if (p.style && !R.paintsOff) { node.style.cssText += ';' + p.style; node.title = '7TV paint: ' + (p.name || ''); }
      // the extra badges (7TV, BetterTTV, FrankerFaceZ) go in front of the name, after the Twitch badges
      if ((p.badges || []).length && !R.badgesOff) node.insertAdjacentHTML('beforebegin', p.badges.map((b) => '<img class="badge x3p" src="' + esc(b.url) + '" alt="" title="' + esc(b.title + ' (' + b.provider + ')') + '"' + (b.bg ? ' style="background:' + esc(b.bg) + '"' : '') + '>').join(''));
    });
  };

  R.badgeHTML = function (msg) {
    return (msg.badges || []).map((b) => {
      const u = R.badges[b.s + '/' + b.i];
      return u ? '<img class="badge" src="' + esc(u) + '" alt="' + esc(b.s) + '" title="' + esc(b.s) + '">' : '';
    }).join('');
  };

  /** build fragments from a tmi.js message (text + tags.emotes) so the anonymous fallback renders the same way */
  R.fromTmi = function (tags, text) {
    const spans = [];
    Object.keys(tags.emotes || {}).forEach((id) => tags.emotes[id].forEach((r) => { const [a, b] = r.split('-').map(Number); spans.push([a, b, id]); }));
    spans.sort((x, y) => x[0] - y[0]);
    const chars = Array.from(text), frags = []; let i = 0;
    spans.forEach(([a, b, id]) => {
      if (a > i) frags.push({ type: 'text', text: chars.slice(i, a).join('') });
      frags.push({ type: 'emote', id, text: chars.slice(a, b + 1).join('') }); i = b + 1;
    });
    if (i < chars.length) frags.push({ type: 'text', text: chars.slice(i).join('') });
    return { frags, text, badges: [] };
  };

  R.css = '.gifpic{display:block;max-width:100%;max-height:170px;margin:6px 0 2px;border-radius:4px}' +
    '.emote{height:1.5em;vertical-align:middle;margin:-.2em 1px 0}' +
    '.stack{position:relative;display:inline-block;vertical-align:middle}.stack .zw{position:absolute;left:0;top:0;margin:0}' +
    '.badge{height:1.1em;vertical-align:-.2em;margin-right:4px}.x3p{border-radius:3px}.cheer{color:#F39120;font-weight:700}.mention{color:#4FBBBC;font-weight:700}';
  const st = document.createElement('style'); st.textContent = R.css; document.head.appendChild(st);
})();
