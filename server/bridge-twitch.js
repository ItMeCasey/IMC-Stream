'use strict';
/**
 * What IMC-Bot may ask about Twitch (through the bridge, on this PC only): the ban list, whether one person follows or subscribes,
 * and the stream schedule. It reuses this app's own Twitch login (the scopes it already has), keeps short caches so the bot
 * cannot use up Twitch's rate limits, and never changes anything on Twitch (bans go through the normal /api/mod routes).
 * Run: node bridge-twitch-test.js
 */
module.exports = function createBridgeTwitch(ctx) {
  const now = ctx.now || Date.now, must = ctx.must;
  const me = () => { const t = ctx.tokens(); if (!t) throw new Error('Not connected to Twitch'); return t.user_id; };
  let bansCache = null; const users = new Map();

  /** everyone banned or timed out right now: [{ uid, login, name, reason, createdAt, expiresAt, moderator }] (cached 20 seconds) */
  async function bans() {
    const id = me();
    if (bansCache && now() - bansCache.at < 20000) return bansCache.out;
    const list = []; let after = '';
    for (let n = 0; n < 50; n++) {   // up to 5000 entries
      const r = must(await ctx.helix('GET', '/moderation/banned?broadcaster_id=' + id + '&first=100' + (after ? '&after=' + encodeURIComponent(after) : '')), 'Ban list');
      for (const b of (r.json && r.json.data) || []) list.push({ uid: String(b.user_id), login: b.user_login, name: b.user_name, reason: b.reason || '', createdAt: b.created_at || '', expiresAt: b.expires_at || '', moderator: b.moderator_login || '' });
      after = r.json && r.json.pagination && r.json.pagination.cursor; if (!after) break;
    }
    bansCache = { at: now(), out: { at: now(), bans: list } };
    return bansCache.out;
  }

  /** one person: { uid, following, sub: null | { tier: 1|2|3, gift } } (cached a minute) */
  async function user(uid) {
    uid = String(uid || ''); if (!/^\d{1,20}$/.test(uid)) throw new Error('A Twitch user id is only digits');
    const id = me(), hit = users.get(uid); if (hit && now() - hit.at < 60000) return hit.out;
    const f = await ctx.helix('GET', '/channels/followers?broadcaster_id=' + id + '&user_id=' + uid + '&first=1');
    must(f, 'Follow check');
    const s = await ctx.helix('GET', '/subscriptions?broadcaster_id=' + id + '&user_id=' + uid);
    if (!s.ok && s.status !== 404) must(s, 'Subscription check');   // 404 means "not subscribed"
    const d = s.ok && s.json && s.json.data && s.json.data[0];
    const out = { uid, following: !!((f.json && f.json.data) || []).length, sub: d ? { tier: Math.max(1, Math.round(Number(d.tier) / 1000)) || 1, gift: !!d.is_gift } : null };
    users.set(uid, { at: now(), out }); if (users.size > 500) users.delete(users.keys().next().value);
    return out;
  }

  /** the next streams: [{ start, end, title, category, canceled }] */
  async function schedule() {
    const id = me(), r = await ctx.helix('GET', '/schedule?broadcaster_id=' + id + '&first=7');
    if (r.status === 404) return { segments: [] };   // no schedule set up
    must(r, 'Schedule');
    const segs = ((r.json && r.json.data && r.json.data.segments) || []).map((x) => ({ start: x.start_time, end: x.end_time || '', title: x.title || '', category: (x.category && x.category.name) || '', canceled: !!x.canceled_until }));
    return { segments: segs };
  }
  return { bans, user, schedule };
};
