'use strict';
/**
 * What IMC-Bot may ask about Twitch (through the bridge, on this PC only): the stream schedule.
 * It reuses this app's own Twitch login and changes nothing on Twitch.
 * Run: node bridge-twitch-test.js
 */
module.exports = function createBridgeTwitch(ctx) {
  const must = ctx.must;
  const me = () => { const t = ctx.tokens(); if (!t) throw new Error('Not connected to Twitch'); return t.user_id; };
  /** the next streams: [{ start, end, title, category, canceled }] */
  async function schedule() {
    const id = me(), r = await ctx.helix('GET', '/schedule?broadcaster_id=' + id + '&first=7');
    if (r.status === 404) return { segments: [] };   // no schedule set up
    must(r, 'Schedule');
    const segs = ((r.json && r.json.data && r.json.data.segments) || []).map((x) => ({ start: x.start_time, end: x.end_time || '', title: x.title || '', category: (x.category && x.category.name) || '', canceled: !!x.canceled_until }));
    return { segments: segs };
  }
  return { schedule };
};
