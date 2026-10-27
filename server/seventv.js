'use strict';
/**
 * 7TV emote rewards: a viewer redeems a channel point reward and pastes the link of a 7TV emote (https://7tv.app/emotes/<id>); the emote is added to the
 * streamer's real 7TV emote set for a number of days (30 by default) and removed again when the time is up.
 * It talks to 7TV's own API: public reads (the emote, the channel's emote set) and one authenticated GraphQL mutation (emoteSet.emotes ADD / REMOVE) with the
 * streamer's 7TV login token (7tv.app > log in > the token is kept in the browser's local storage; see the page for how to copy it).
 * Only 7TV links are supported. BetterTTV has no public API for adding emotes to a channel, so BTTV links are turned away (and refunded by the hook).
 * Everything the viewer can influence is checked first: the link must be an emote link, the emote must be live and public, adult / flashing / "edgy" /
 * Twitch-disallowed emotes are refused, the channel's set must have room, the name must be free, and only a few borrowed emotes may be active at a time.
 * The token never leaves this file's data (data/emotes7tv.json) and is never sent to the page.
 */
const fs = require('node:fs');
const path = require('node:path');

// 7TV addresses: v3 GraphQL (add / remove emotes), v4 GraphQL (paints and badges), v3 REST (reads)
const GQL = 'https://7tv.io/v3/gql', GQL4 = 'https://7tv.io/v4/gql', REST = 'https://7tv.io/v3';
const FLAG_PRIVATE = 1, FLAG_SEXUAL = 1 << 16, FLAG_EPILEPSY = 1 << 17, FLAG_EDGY = 1 << 18, FLAG_TWITCH_DISALLOWED = 1 << 24;   // 7TV's emote flag bits (zero width is 256 and is fine)
const DAY = 86400000;

/** the id of the emote in a 7TV link (a 7tv.app/emotes/<id> page or a cdn.7tv.app/emote/<id> image), or '' */
function parseEmoteId(text) {
  const m = String(text || '').match(/(?:7tv\.app\/emotes|cdn\.7tv\.app\/emote)\/([0-9A-Za-z]{24,26})\b/i);
  return m ? m[1] : '';
}
// BetterTTV links are only recognised so they can be turned away with a clear message
const isBttv = (text) => /betterttv\.com\/emotes\//i.test(String(text || ''));

module.exports = function createSevenTV(ctx) {
  const now = ctx.now || Date.now, log = ctx.log || (() => {}), doFetch = ctx.fetch || ((...a) => fetch(...a)), FILE = ctx.file;
  // S: saved settings (data/emotes7tv.json) with the 7TV token and the list of borrowed emotes (active)
  let S = { token: '', days: 30, max: 20, blockEdgy: true, rewardId: '', active: [], paints: true, badges: true };
  try { S = Object.assign(S, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* first run */ }
  // write the settings; the token only ever lives in this file
  const save = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(S, null, 2)); } catch (e) { log('7tv save failed:', e.message); } };
  // a whole number clamped into lo..hi, or d when it is not a number
  const num = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d; };

  // public 7TV read
  async function rest(p) {
    const r = await doFetch(REST + p, { headers: { Accept: 'application/json' } });
    if (!r.ok) { const e = new Error(r.status === 404 ? 'not found' : '7TV answered HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  // GraphQL call; auth adds the streamer's token. 7TV can report errors in the body, so those are checked before the HTTP status
  async function gql(query, variables, auth) {
    const headers = { 'Content-Type': 'application/json' }; if (auth) headers.Authorization = 'Bearer ' + S.token;
    const r = await doFetch(GQL, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
    if (j && j.errors && j.errors.length) throw new Error(String(j.errors[0].message || 'the 7TV request failed').replace(/^\d+\s*/, ''));
    if (!r.ok) throw new Error('7TV answered HTTP ' + r.status);
    return j && j.data;
  }

  /** the emote behind a link, checked: it has to exist, be live and public and not be one of the kinds we never allow */
  async function lookup(id) {
    let e; try { e = await rest('/emotes/' + id); } catch (x) { throw new Error(x.status === 404 ? 'that emote does not exist on 7TV' : 'could not look the emote up (' + x.message + ')'); }
    const why = refusal(e); if (why) throw new Error('that emote is ' + why);
    return { id: e.id, name: String(e.name || 'emote'), animated: !!e.animated, owner: e.owner && (e.owner.display_name || e.owner.username) || '' };
  }

  /** the streamer's own 7TV emote set (the one 7TV shows on their Twitch channel) */
  async function channelSet() {
    const tid = ctx.twitchId && ctx.twitchId(); if (!tid) throw new Error('not connected to Twitch');
    let u; try { u = await rest('/users/twitch/' + tid); } catch (x) { throw new Error(x.status === 404 ? 'your Twitch channel has no 7TV account yet (log in at 7tv.app once)' : 'could not read your 7TV channel (' + x.message + ')'); }
    if (!u.emote_set_id) throw new Error('your 7TV channel has no active emote set');
    const set = u.emote_set || {}; return { id: u.emote_set_id, name: set.name || '', capacity: set.capacity || 0, emotes: (set.emotes || []).map((x) => ({ id: x.id, name: x.name })) };
  }

  // 7TV emote names must be unique in a set and use few characters: clean it and add a number when taken
  const freeName = (name, taken) => {
    let n = String(name).replace(/[^-_A-Za-z():0-9]/g, '').slice(0, 90) || 'emote', k = 1, out = n;
    while (taken.has(out.toLowerCase())) out = n + (++k); return out;
  };

  /** why an emote may not be added (a viewer's link or a search result), or '' when it is fine; `flags` is 7TV's bit field */
  function refusal(e) {
    if (e.lifecycle !== undefined && e.lifecycle !== 3) return 'not live on 7TV yet';
    if (e.listed === false) return 'not listed on 7TV';
    const f = Number(e.flags) || 0;
    if (f & FLAG_PRIVATE) return 'private';
    if (f & (FLAG_SEXUAL | FLAG_EPILEPSY | FLAG_TWITCH_DISALLOWED)) return 'not allowed on Twitch';
    if (S.blockEdgy && (f & FLAG_EDGY)) return 'marked as edgy or disturbing';
    return '';
  }

  /** put an emote in the channel's set. days > 0: borrowed, it is taken away again after that many days; days = 0: it stays until removed by hand. */
  async function addEmote(id, by, days) {
    if (!S.token) throw new Error('the 7TV login is not set up yet');
    if (days > 0) await expireDue().catch(() => {});
    if (days > 0 && S.active.length >= S.max) throw new Error('there are already ' + S.max + ' borrowed emotes: try again when one expires');
    if (S.active.some((a) => a.emoteId === id)) throw new Error('that emote is already added');
    // all checks happen before anything is changed on 7TV
    const emote = await lookup(id), set = await channelSet();
    if (set.emotes.some((x) => x.id === id)) throw new Error('that emote is already in the channel');
    if (set.capacity && set.emotes.length >= set.capacity) throw new Error('the 7TV emote set is full');
    const name = freeName(emote.name, new Set(set.emotes.map((x) => String(x.name).toLowerCase())));
    await gql('mutation($set: ObjectID!, $id: ObjectID!, $name: String) { emoteSet(id: $set) { emotes(id: $id, action: ADD, name: $name) { id name } } }', { set: set.id, id, name }, true);
    let expiresAt = 0;
    if (days > 0) { const rec = { emoteId: id, name, setId: set.id, by: String(by || ''), addedAt: now(), expiresAt: now() + days * DAY, animated: emote.animated }; expiresAt = rec.expiresAt; S.active.push(rec); save(); }
    log('7tv: added ' + name + ' for ' + by);
    return { name, id, days, expiresAt, animated: emote.animated };
  }
  /** a viewer's link (a reward redemption): added for S.days days. Throws an Error with a viewer-friendly reason. */
  async function add({ url, by }) {
    if (!S.token) throw new Error('the 7TV login is not set up yet');
    if (isBttv(url)) throw new Error('only 7TV emote links work (BetterTTV has no way to add emotes automatically)');
    const id = parseEmoteId(url); if (!id) throw new Error('paste a 7TV emote link, like https://7tv.app/emotes/...');
    return addEmote(id, by, S.days);
  }
  /** the streamer's own choice from the search page: for good (days = 0) or for a number of days */
  const addById = (id, { by, days }) => { if (!/^[0-9A-Za-z]{24,26}$/.test(String(id))) throw new Error('not an emote id'); return addEmote(String(id), by || 'you', Math.max(0, Math.min(365, Math.floor(Number(days) || 0)))); };

  /** search 7TV; every result says whether it can be added (and why not) */
  async function search(q, page) {
    q = String(q || '').trim().slice(0, 60); if (!q) return { count: 0, items: [] };
    const d = await gql('query($q: String!, $page: Int, $limit: Int) { emotes(query: $q, page: $page, limit: $limit, filter: { exact_match: false }) { count items { id name animated flags listed lifecycle owner { username display_name } } } }', { q, page: num(page, 1, 1, 500), limit: 24 });
    const e = (d && d.emotes) || { count: 0, items: [] };
    return { count: e.count || 0, items: (e.items || []).map((x) => ({ id: x.id, name: x.name, animated: !!x.animated, owner: x.owner ? (x.owner.display_name || x.owner.username) : '', refused: refusal(x) })) };
  }

  /** the emotes in the channel's set right now, with the borrowed ones marked */
  async function mySet() {
    const set = await channelSet(), borrowed = new Map(S.active.map((a) => [a.emoteId, a]));
    return { name: set.name, capacity: set.capacity, count: set.emotes.length, emotes: set.emotes.map((x) => { const b = borrowed.get(x.id); return { id: x.id, name: x.name, borrowed: !!b, daysLeft: b ? Math.max(0, Math.ceil((b.expiresAt - now()) / DAY)) : 0, by: b ? b.by : '' }; }) };
  }
  /** take any emote out of the channel's set (also ones that were not borrowed) */
  async function removeFromSet(emoteId) {
    if (!S.token) throw new Error('the 7TV login is not set up yet'); const set = await channelSet();
    if (!set.emotes.some((x) => x.id === emoteId)) throw new Error('that emote is not in your set');
    await gql('mutation($set: ObjectID!, $id: ObjectID!) { emoteSet(id: $set) { emotes(id: $id, action: REMOVE) { id } } }', { set: set.id, id: emoteId }, true);
    S.active = S.active.filter((a) => a.emoteId !== emoteId); save(); return { ok: true };
  }

  // take one borrowed emote out of the 7TV set and off our list
  async function removeRecord(rec) {
    await gql('mutation($set: ObjectID!, $id: ObjectID!) { emoteSet(id: $set) { emotes(id: $id, action: REMOVE) { id } } }', { set: rec.setId, id: rec.emoteId }, true);
    S.active = S.active.filter((a) => a !== rec); save(); log('7tv: removed ' + rec.name);
  }
  /** take away every borrowed emote whose time is up (an emote that is already gone is just forgotten) */
  async function expireDue() {
    if (!S.token) return 0; let n = 0;
    for (const rec of S.active.filter((a) => a.expiresAt <= now())) {
      try { await removeRecord(rec); n++; } catch (e) { if (/not found|not in|unknown emote|no such/i.test(e.message)) { S.active = S.active.filter((a) => a !== rec); save(); n++; } else log('7tv: could not remove ' + rec.name + ':', e.message); }
    }
    return n;
  }
  // remove a borrowed emote right now instead of waiting for its time
  async function removeNow(emoteId) {
    const rec = S.active.find((a) => a.emoteId === emoteId); if (!rec) throw new Error('that emote is not on the list');
    if (!S.token) throw new Error('the 7TV login is not set up yet'); await removeRecord(rec); return { ok: true };
  }

  /** check the token and the channel: who the login belongs to and how full the emote set is */
  async function test() {
    if (!S.token) throw new Error('paste your 7TV token first');
    const d = await gql('{ actor { id username } }', {}, true); if (!d || !d.actor) throw new Error('7TV did not accept that token: log in at 7tv.app again and copy a fresh one');
    const set = await channelSet();
    return { user: d.actor.username, set: set.name, emotes: set.emotes.length, capacity: set.capacity };
  }

  // settings from the Setup page, clamped to sane ranges; the token is cleaned of 'Bearer' and quotes
  function configure(b) {
    b = b || {};
    if (typeof b.token === 'string' && b.token.trim()) S.token = b.token.trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').slice(0, 4000);
    if (b.clearToken) S.token = '';
    if (b.days !== undefined) S.days = num(b.days, 30, 1, 365); if (b.max !== undefined) S.max = num(b.max, 20, 1, 200); if (b.blockEdgy !== undefined) S.blockEdgy = !!b.blockEdgy;
    if (b.rewardId !== undefined) S.rewardId = String(b.rewardId).slice(0, 80);
    if (b.paints !== undefined) { S.paints = !!b.paints; PAINTS.clear(); }
    if (b.badges !== undefined) { S.badges = !!b.badges; PAINTS.clear(); }
    save(); return view();
  }
  // what the page may see: never the token
  const view = () => ({ paints: S.paints !== false, badges: S.badges !== false, hasToken: !!S.token, days: S.days, max: S.max, blockEdgy: S.blockEdgy, rewardId: S.rewardId,
    active: S.active.map((a) => ({ emoteId: a.emoteId, name: a.name, by: a.by, animated: !!a.animated, addedAt: a.addedAt, expiresAt: a.expiresAt, daysLeft: Math.max(0, Math.ceil((a.expiresAt - now()) / DAY)) })).sort((x, y) => x.expiresAt - y.expiresAt) });

  // ---------------------------------------------------------------------------------------------------------- name paints
  // A 7TV "paint" is the colour, gradient, picture and glow a 7TV user has on their name. The chat overlay and the mod dock ask for the paint of every chatter
  // (cached for half an hour) and draw it the way 7TV's own extension does: the layers are CSS backgrounds clipped to the text, the shadows are drop shadows.
  const PAINTS = new Map(), PAINT_TTL = 30 * 60000, NO_PAINT_TTL = 10 * 60000;
  // '#rrggbb' or '#rrggbbaa' -> css rgba(), or null when it is not a colour
  const rgba = (hex) => { const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex || '')); if (!m) return null; const n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (m[2] ? Math.round(parseInt(m[2], 16) / 2.55) / 100 : 1) + ')'; };
  // a number rounded to 3 places for CSS, or d when it is not a number
  const fx = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) / 1000 : d);
  // gradient colour stops as 'colour position%'; a single colour is doubled because a CSS gradient needs two
  function stopsCss(stops) { const out = (stops || []).map((p) => { const c = rgba(p.color && p.color.hex); return c ? c + ' ' + Math.round(fx(p.at, 0) * 10000) / 100 + '%' : ''; }).filter(Boolean); return out.length >= 2 ? out.join(', ') : out.length === 1 ? out[0] + ', ' + out[0] : ''; }
  // only 7TV's own image server is allowed in paint pictures
  const cdnUrl = (u) => (/^https:\/\/cdn\.7tv\.app\/[A-Za-z0-9_\/.\-]+$/.test(String(u || '')) ? String(u) : '');
  /** 7TV paint data -> one CSS string (only values we validated ourselves ever end up in it), or '' for a paint we cannot draw */
  function paintCss(p) {
    const layers = ((p && p.data && p.data.layers) || []).map((l) => {
      const t = l.ty || {}; const op = Number(l.opacity); void op;
      if (t.__typename === 'PaintLayerTypeSingleColor') { const c = rgba(t.color && t.color.hex); return c ? 'linear-gradient(' + c + ', ' + c + ')' : ''; }
      if (t.__typename === 'PaintLayerTypeLinearGradient') { const st = stopsCss(t.stops); return st ? (t.repeating ? 'repeating-' : '') + 'linear-gradient(' + fx(t.angle, 0) + 'deg, ' + st + ')' : ''; }
      if (t.__typename === 'PaintLayerTypeRadialGradient') { const st = stopsCss(t.stops); return st ? (t.repeating ? 'repeating-' : '') + 'radial-gradient(' + (String(t.shape).toUpperCase() === 'CIRCLE' ? 'circle' : 'ellipse') + ', ' + st + ')' : ''; }
      if (t.__typename === 'PaintLayerTypeImage') { const im = (t.images || []).filter((i) => i.mime === 'image/webp' && cdnUrl(i.url)); const pick = im.find((i) => i.scale === 2 && i.frameCount > 1) || im.find((i) => i.scale === 2) || im[0]; return pick ? 'url("' + cdnUrl(pick.url) + '")' : ''; }
      return '';
    }).filter(Boolean);
    if (!layers.length) return '';
    const shadows = ((p.data && p.data.shadows) || []).map((s) => { const c = rgba(s.color && s.color.hex); return c ? 'drop-shadow(' + fx(s.offsetX, 0) + 'px ' + fx(s.offsetY, 0) + 'px ' + Math.max(0, fx(s.blur, 0)) + 'px ' + c + ')' : ''; }).filter(Boolean);
    return 'background-image:' + layers.join(', ') + ';background-size:100% 100%;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent' + (shadows.length ? ';filter:' + shadows.join(' ') : '');
  }
  // the 7TV v4 query for a Twitch user's active paint and badge
  const PAINT_QUERY = 'query($id: String!) { users { userByConnection(platform: TWITCH, platformId: $id) { style { activeBadge { name description images { url mime scale frameCount } } activePaint { id name data { layers { opacity ty { __typename ... on PaintLayerTypeSingleColor { color { hex } } ... on PaintLayerTypeLinearGradient { angle repeating stops { at color { hex } } } ... on PaintLayerTypeRadialGradient { repeating shape stops { at color { hex } } } ... on PaintLayerTypeImage { images { url mime scale frameCount } } } } shadows { color { hex } offsetX offsetY blur } } } } } } }';
  /** the paint of a Twitch user: { name, style } or null (no 7TV account, no paint, or paints switched off) */
  function paintFor(twitchId) {
    const id = String(twitchId || ''); if ((!S.paints && !S.badges) || !/^\d{1,12}$/.test(id)) return Promise.resolve(null);
    // answers are cached; hit.ttl is shortened below for 'no paint' (10 min) and errors (1 min), so a failing lookup is not repeated every message
    const hit = PAINTS.get(id); if (hit && now() - hit.t < hit.ttl) return hit.p;
    const p = (async () => {
      try {
        const r = await doFetch(GQL4, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: PAINT_QUERY, variables: { id } }) }); const j = r.ok ? await r.json() : null;
        const style = j && j.data && j.data.users && j.data.users.userByConnection && j.data.users.userByConnection.style, paint = style && style.activePaint, bd = style && style.activeBadge;
        const css = S.paints && paint ? paintCss(paint) : '', im = S.badges && bd ? (bd.images || []).filter((i) => i.mime === 'image/webp' && cdnUrl(i.url)) : [], pick = im.find((i) => i.scale === 2) || im[0];
        const badge = pick ? { provider: '7TV', title: String(bd.description || bd.name || '7TV badge').slice(0, 80), url: cdnUrl(pick.url), bg: '' } : null;
        if (!css && !badge) { hit0.ttl = NO_PAINT_TTL; return null; } return { name: css ? String(paint.name || '').slice(0, 60) : '', style: css, badge };
      } catch (e) { hit0.ttl = 60000; return null; }
    })();
    const hit0 = { t: now(), ttl: PAINT_TTL, p }; PAINTS.set(id, hit0); if (PAINTS.size > 2000) PAINTS.delete(PAINTS.keys().next().value); return p;
  }

  return { paintFor, paintCss, badgesOn: () => S.badges !== false, paintsOn: () => S.paints !== false, add, addById, search, mySet, removeFromSet, expireDue, removeNow, test, configure, view, parseEmoteId, isBttv, lookup, days: () => S.days };
};
module.exports.parseEmoteId = parseEmoteId;
