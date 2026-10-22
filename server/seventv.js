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

const GQL = 'https://7tv.io/v3/gql', REST = 'https://7tv.io/v3';
const FLAG_PRIVATE = 1, FLAG_SEXUAL = 1 << 16, FLAG_EPILEPSY = 1 << 17, FLAG_EDGY = 1 << 18, FLAG_TWITCH_DISALLOWED = 1 << 24;   // 7TV's emote flag bits (zero width is 256 and is fine)
const DAY = 86400000;

/** the id of the emote in a 7TV link (a 7tv.app/emotes/<id> page or a cdn.7tv.app/emote/<id> image), or '' */
function parseEmoteId(text) {
  const m = String(text || '').match(/(?:7tv\.app\/emotes|cdn\.7tv\.app\/emote)\/([0-9A-Za-z]{24,26})\b/i);
  return m ? m[1] : '';
}
const isBttv = (text) => /betterttv\.com\/emotes\//i.test(String(text || ''));

module.exports = function createSevenTV(ctx) {
  const now = ctx.now || Date.now, log = ctx.log || (() => {}), doFetch = ctx.fetch || ((...a) => fetch(...a)), FILE = ctx.file;
  let S = { token: '', days: 30, max: 20, blockEdgy: true, rewardId: '', active: [] };
  try { S = Object.assign(S, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* first run */ }
  const save = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(S, null, 2)); } catch (e) { log('7tv save failed:', e.message); } };
  const num = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : d; };

  async function rest(p) {
    const r = await doFetch(REST + p, { headers: { Accept: 'application/json' } });
    if (!r.ok) { const e = new Error(r.status === 404 ? 'not found' : '7TV answered HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
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
    if (e.lifecycle !== 3) throw new Error('that emote is not live on 7TV yet');
    if (!e.listed) throw new Error('that emote is not listed on 7TV');
    const f = Number(e.flags) || 0;
    if (f & FLAG_PRIVATE) throw new Error('that emote is private');
    if (f & (FLAG_SEXUAL | FLAG_EPILEPSY | FLAG_TWITCH_DISALLOWED)) throw new Error('that emote is not allowed on Twitch');
    if (S.blockEdgy && (f & FLAG_EDGY)) throw new Error('that emote is marked as edgy or disturbing');
    return { id: e.id, name: String(e.name || 'emote'), animated: !!e.animated, owner: e.owner && (e.owner.display_name || e.owner.username) || '' };
  }

  /** the streamer's own 7TV emote set (the one 7TV shows on their Twitch channel) */
  async function channelSet() {
    const tid = ctx.twitchId && ctx.twitchId(); if (!tid) throw new Error('not connected to Twitch');
    let u; try { u = await rest('/users/twitch/' + tid); } catch (x) { throw new Error(x.status === 404 ? 'your Twitch channel has no 7TV account yet (log in at 7tv.app once)' : 'could not read your 7TV channel (' + x.message + ')'); }
    if (!u.emote_set_id) throw new Error('your 7TV channel has no active emote set');
    const set = u.emote_set || {}; return { id: u.emote_set_id, name: set.name || '', capacity: set.capacity || 0, emotes: (set.emotes || []).map((x) => ({ id: x.id, name: x.name })) };
  }

  const freeName = (name, taken) => {
    let n = String(name).replace(/[^-_A-Za-z():0-9]/g, '').slice(0, 90) || 'emote', k = 1, out = n;
    while (taken.has(out.toLowerCase())) out = n + (++k); return out;
  };

  /** add the emote behind a link to the channel's set for S.days days. Throws an Error with a viewer-friendly reason. */
  async function add({ url, by }) {
    if (!S.token) throw new Error('the 7TV login is not set up yet');
    if (isBttv(url)) throw new Error('only 7TV emote links work (BetterTTV has no way to add emotes automatically)');
    const id = parseEmoteId(url); if (!id) throw new Error('paste a 7TV emote link, like https://7tv.app/emotes/...');
    await expireDue().catch(() => {});
    if (S.active.length >= S.max) throw new Error('there are already ' + S.max + ' borrowed emotes: try again when one expires');
    if (S.active.some((a) => a.emoteId === id)) throw new Error('that emote is already added');
    const emote = await lookup(id), set = await channelSet();
    if (set.emotes.some((x) => x.id === id)) throw new Error('that emote is already in the channel');
    if (set.capacity && set.emotes.length >= set.capacity) throw new Error('the 7TV emote set is full');
    const name = freeName(emote.name, new Set(set.emotes.map((x) => String(x.name).toLowerCase())));
    await gql('mutation($set: ObjectID!, $id: ObjectID!, $name: String) { emoteSet(id: $set) { emotes(id: $id, action: ADD, name: $name) { id name } } }', { set: set.id, id, name }, true);
    const rec = { emoteId: id, name, setId: set.id, by: String(by || ''), addedAt: now(), expiresAt: now() + S.days * DAY, animated: emote.animated };
    S.active.push(rec); save(); log('7tv: added ' + name + ' for ' + by);
    return { name, id, days: S.days, expiresAt: rec.expiresAt, animated: emote.animated };
  }

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

  function configure(b) {
    b = b || {};
    if (typeof b.token === 'string' && b.token.trim()) S.token = b.token.trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').slice(0, 4000);
    if (b.clearToken) S.token = '';
    if (b.days !== undefined) S.days = num(b.days, 30, 1, 365); if (b.max !== undefined) S.max = num(b.max, 20, 1, 200); if (b.blockEdgy !== undefined) S.blockEdgy = !!b.blockEdgy;
    if (b.rewardId !== undefined) S.rewardId = String(b.rewardId).slice(0, 80);
    save(); return view();
  }
  const view = () => ({ hasToken: !!S.token, days: S.days, max: S.max, blockEdgy: S.blockEdgy, rewardId: S.rewardId,
    active: S.active.map((a) => ({ emoteId: a.emoteId, name: a.name, by: a.by, animated: !!a.animated, addedAt: a.addedAt, expiresAt: a.expiresAt, daysLeft: Math.max(0, Math.ceil((a.expiresAt - now()) / DAY)) })).sort((x, y) => x.expiresAt - y.expiresAt) });

  return { add, expireDue, removeNow, test, configure, view, parseEmoteId, isBttv, lookup, days: () => S.days };
};
module.exports.parseEmoteId = parseEmoteId;
