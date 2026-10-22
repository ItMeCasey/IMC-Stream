'use strict';
/**
 * Third-party chat badges: the BetterTTV badges (developer, emote contributor, subscriber...) and the FrankerFaceZ badges (developer, bot, supporter, subwoofer),
 * to show next to chatters' names in the stream chat overlay and the mod dock together with the Twitch badges and the 7TV badge.
 * Both services publish their badge lists openly (BTTV by Twitch user id, FFZ by Twitch login); the lists are kept for a day. Only badge pictures from the
 * services' own image servers are ever passed on.
 */
const BTTV_URL = 'https://api.betterttv.net/3/cached/badges', FFZ_URL = 'https://api.frankerfacez.com/v1/badges', DAY = 86400000;
const okBttv = (u) => /^https:\/\/cdn\.betterttv\.net\/[A-Za-z0-9_\/.\-]+$/.test(String(u || ''));
const okFfz = (u) => /^https:\/\/cdn\.frankerfacez\.com\/badge\/\d+\/[124]$/.test(String(u || ''));

module.exports = function createExtraBadges(ctx) {
  const now = ctx.now || Date.now, log = ctx.log || (() => {}), doFetch = ctx.fetch || ((...a) => fetch(...a));
  let bttv = new Map(), ffzDefs = new Map(), ffz = new Map(), loadedAt = 0, loading = null;

  async function getJson(url) { const r = await doFetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
  async function load() {
    const [b, f] = await Promise.allSettled([getJson(BTTV_URL), getJson(FFZ_URL)]);
    if (b.status === 'fulfilled' && Array.isArray(b.value)) {
      const m = new Map();
      for (const x of b.value) { const uid = String(x.providerId || ''), u = x.badge && x.badge.svg; if (uid && okBttv(u)) { if (!m.has(uid)) m.set(uid, []); m.get(uid).push({ provider: 'BetterTTV', title: String((x.badge && x.badge.description) || 'BetterTTV badge').slice(0, 80), url: u, bg: '' }); } }
      bttv = m;
    } else log('BTTV badges not loaded:', b.reason && b.reason.message);
    if (f.status === 'fulfilled' && f.value && Array.isArray(f.value.badges)) {
      const defs = new Map(), users = new Map();
      for (const x of f.value.badges) { const u = x.urls && x.urls['2'] || x.image; if (okFfz(u)) defs.set(String(x.id), { provider: 'FrankerFaceZ', title: String(x.title || x.name || 'FrankerFaceZ badge').slice(0, 80), url: u, bg: /^#[0-9a-f]{3,8}$/i.test(String(x.color || '')) ? x.color : '' }); }
      for (const [id, names] of Object.entries(f.value.users || {})) if (defs.has(id) && Array.isArray(names)) for (const n of names) { const k = String(n).toLowerCase(); if (!users.has(k)) users.set(k, []); users.get(k).push(id); }
      ffzDefs = defs; ffz = users;
    } else log('FFZ badges not loaded:', f.reason && f.reason.message);
    loadedAt = now();
  }
  /** make sure the lists are loaded (and at most a day old); everybody waits for the same download */
  const ensure = () => { if (loadedAt && now() - loadedAt < DAY) return Promise.resolve(); if (!loading) loading = load().catch((e) => log('badge lists failed:', e.message)).finally(() => { loading = null; if (!loadedAt) loadedAt = now() - DAY + 5 * 60000; }); return loading; };   // a failed download is retried in 5 minutes
  /** the extra badges of a chatter: [{ provider, title, url, bg }] */
  async function forUser({ uid, login }) {
    await ensure(); const out = [];
    for (const b of bttv.get(String(uid || '')) || []) out.push(b);
    for (const id of ffz.get(String(login || '').toLowerCase()) || []) out.push(ffzDefs.get(id));
    return out;
  }
  return { forUser, ensure, size: () => ({ bttv: bttv.size, ffz: ffz.size }) };
};
