'use strict';
/**
 * What IMC-Bot may ask about Twitch (through the bridge, on this PC only): the stream schedule and chatters' profile pictures.
 * It reuses this app's own Twitch login and changes nothing on Twitch.
 * Run: node bridge-twitch-test.js
 */
module.exports = function createBridgeTwitch(ctx) {
  const must = ctx.must, now = ctx.now || Date.now;
  const me = () => { const t = ctx.tokens(); if (!t) throw new Error('Not connected to Twitch'); return t.user_id; };
  /** the next streams: [{ start, end, title, category, canceled }] */
  async function schedule() {
    const id = me(), r = await ctx.helix('GET', '/schedule?broadcaster_id=' + id + '&first=7');
    if (r.status === 404) return { segments: [] };   // no schedule set up
    must(r, 'Schedule');
    const segs = ((r.json && r.json.data && r.json.data.segments) || []).map((x) => ({ start: x.start_time, end: x.end_time || '', title: x.title || '', category: (x.category && x.category.name) || '', canceled: !!x.canceled_until }));
    return { segments: segs };
  }
  const pics = new Map();   // user id -> { at, url }
  /** profile pictures for chatters: { "123": "https://..." } (an unknown or failed id is left out; kept six hours; at most 50 ids) */
  async function avatars(ids) {
    me(); const want = [...new Set((ids || []).map((x) => String(x).trim()).filter((x) => /^\d{1,20}$/.test(x)))].slice(0, 50), t = now(), out = {};
    const need = want.filter((id) => { const c = pics.get(id); if (c && t - c.at < 6 * 3600000) { if (c.url) out[id] = c.url; return false; } return true; });
    if (need.length) {
      const r = await ctx.helix('GET', '/users?' + need.map((id) => 'id=' + id).join('&')); must(r, 'Profile pictures');
      for (const u of (r.json && r.json.data) || []) { pics.set(String(u.id), { at: t, url: /^https:\/\//.test(u.profile_image_url || '') ? u.profile_image_url : '' }); }
      for (const id of need) { const c = pics.get(id); if (c && c.url) out[id] = c.url; else if (!c) pics.set(id, { at: t, url: '' }); }
      if (pics.size > 2000) for (const k of [...pics.keys()].slice(0, 500)) pics.delete(k);
    }
    return out;
  }
  return { schedule, avatars };
};
