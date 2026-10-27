'use strict';
// The Twitch questions IMC-Bot may ask, against a pretend Twitch. Run: node bridge-twitch-test.js
const assert = require('assert');
const createBridgeTwitch = require('./bridge-twitch.js');

const must = (r, what) => { if (!r.ok) throw new Error(what + ': ' + ((r.json && r.json.message) || 'HTTP ' + r.status)); return r; };
(async () => {
  let t = 1000; const calls = []; let tokens = { user_id: '42' }, handler = () => ({ ok: true, status: 200, json: {} });
  const B = createBridgeTwitch({ now: () => t, must, tokens: () => tokens, helix: async (m, p) => { calls.push(p); return handler(p); } });

  // ban list: pages are followed, the answer is kept 20 seconds
  handler = (p) => (p.includes('after=PAGE2') ? { ok: true, status: 200, json: { data: [{ user_id: 3, user_login: 'cat', user_name: 'Cat', reason: '', created_at: 'c', expires_at: '', moderator_login: 'mod' }], pagination: {} } }
    : { ok: true, status: 200, json: { data: [{ user_id: 1, user_login: 'ann', user_name: 'Ann', reason: 'spam', created_at: 'a', expires_at: '2026-10-30T00:00:00Z', moderator_login: 'mod' }, { user_id: 2, user_login: 'bob', user_name: 'Bob', created_at: 'b' }], pagination: { cursor: 'PAGE2' } } });
  let r = await B.bans(); assert.deepEqual(r.bans.map((b) => b.uid), ['1', '2', '3'], 'both pages, ids as text'); assert.deepEqual([r.bans[0].reason, r.bans[0].expiresAt, r.bans[1].expiresAt], ['spam', '2026-10-30T00:00:00Z', ''], 'timeouts have an end, bans do not');
  assert.ok(calls[0].startsWith('/moderation/banned?broadcaster_id=42&first=100')); const n = calls.length; await B.bans(); assert.equal(calls.length, n, 'cached'); t += 21000; await B.bans(); assert.ok(calls.length > n, 'refreshed after 20 s');
  handler = () => ({ ok: false, status: 403, json: { message: 'missing scope' } }); t += 21000; await assert.rejects(B.bans(), /Ban list: missing scope/);
  tokens = null; await assert.rejects(B.bans(), /Not connected/); tokens = { user_id: '42' };

  // one person
  const answers = { follow: { ok: true, status: 200, json: { data: [{ user_id: '7' }] } }, sub: { ok: true, status: 200, json: { data: [{ tier: '2000', is_gift: true }] } } };
  handler = (p) => (p.startsWith('/channels/followers') ? answers.follow : answers.sub);
  assert.deepEqual(await B.user('7'), { uid: '7', following: true, sub: { tier: 2, gift: true } });
  answers.follow = { ok: true, status: 200, json: { data: [] } }; answers.sub = { ok: false, status: 404, json: { message: 'not subscribed' } };
  assert.deepEqual(await B.user('8'), { uid: '8', following: false, sub: null }, '404 means not subscribed');
  const before = calls.length; await B.user('8'); assert.equal(calls.length, before, 'cached a minute');
  await assert.rejects(B.user('abc'), /only digits/); await assert.rejects(B.user(''), /only digits/);
  answers.sub = { ok: false, status: 500, json: { message: 'boom' } }; await assert.rejects(B.user('9'), /Subscription check: boom/);

  // schedule
  handler = () => ({ ok: true, status: 200, json: { data: { segments: [{ start_time: 's1', end_time: 'e1', title: 'Chill', category: { name: 'Tetris' }, canceled_until: null }, { start_time: 's2', title: '', category: null, canceled_until: 'x' }] } } });
  assert.deepEqual((await B.schedule()).segments, [{ start: 's1', end: 'e1', title: 'Chill', category: 'Tetris', canceled: false }, { start: 's2', end: '', title: '', category: '', canceled: true }]);
  handler = () => ({ ok: false, status: 404, json: {} }); assert.deepEqual(await B.schedule(), { segments: [] }, 'no schedule is an empty list');
  console.log('bridge-twitch test passed');
})().catch((e) => { console.error(e); process.exit(1); });
