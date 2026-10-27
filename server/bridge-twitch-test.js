'use strict';
// The Twitch questions IMC-Bot may ask, against a pretend Twitch. Run: node bridge-twitch-test.js
const assert = require('assert');
const createBridgeTwitch = require('./bridge-twitch.js');

const must = (r, what) => { if (!r.ok) throw new Error(what + ': ' + ((r.json && r.json.message) || 'HTTP ' + r.status)); return r; };
(async () => {
  let t = 1000; const calls = []; let tokens = { user_id: '42' }, handler = () => ({ ok: true, status: 200, json: {} });
  const B = createBridgeTwitch({ now: () => t, must, tokens: () => tokens, helix: async (m, p) => { calls.push(p); return handler(p); } });

  // schedule
  handler = () => ({ ok: true, status: 200, json: { data: { segments: [{ start_time: 's1', end_time: 'e1', title: 'Chill', category: { name: 'Tetris' }, canceled_until: null }, { start_time: 's2', title: '', category: null, canceled_until: 'x' }] } } });
  assert.deepEqual((await B.schedule()).segments, [{ start: 's1', end: 'e1', title: 'Chill', category: 'Tetris', canceled: false }, { start: 's2', end: '', title: '', category: '', canceled: true }]);
  t += 61000; handler = () => ({ ok: false, status: 404, json: {} }); assert.deepEqual(await B.schedule(), { segments: [] }, 'no schedule is an empty list');
  // the schedule is cached for a minute
  calls.length = 0; handler = () => ({ ok: true, status: 200, json: { data: { segments: [{ start_time: 'c1', title: 'Cached' }] } } }); t += 61000;
  const first = await B.schedule(); await B.schedule(); await B.schedule(); assert.equal(calls.length, 1, 'three asks, one request to Twitch'); t += 61000; await B.schedule(); assert.equal(calls.length, 2, 'asked again after a minute'); assert.equal(first.segments[0].title, 'Cached');
  // profile pictures: one request for the ids not known yet, cached, bad ids dropped
  calls.length = 0; handler = (p) => ({ ok: true, status: 200, json: { data: [{ id: '1', profile_image_url: 'https://cdn/a.png' }, { id: '2', profile_image_url: 'http://insecure/b.png' }] } });
  assert.deepEqual(await B.avatars(['1', '2', '3', 'x', '', '1']), { 1: 'https://cdn/a.png' }, 'only https pictures, only known users'); assert.equal(calls.length, 1); assert.equal(calls[0], '/users?id=1&id=2&id=3');
  assert.deepEqual(await B.avatars(['1', '3']), { 1: 'https://cdn/a.png' }); assert.equal(calls.length, 1, 'all cached, no new request');
  t += 7 * 3600000; await B.avatars(['1']); assert.equal(calls.length, 2, 'refreshed after six hours');
  handler = () => ({ ok: false, status: 500, json: { message: 'boom' } }); await assert.rejects(B.avatars(['9']), /Profile pictures: boom/); assert.deepEqual(await B.avatars([]), {});
  tokens = null; await assert.rejects(B.avatars(['1']), /Not connected/);
  console.log('bridge-twitch test passed');
})().catch((e) => { console.error(e); process.exit(1); });
