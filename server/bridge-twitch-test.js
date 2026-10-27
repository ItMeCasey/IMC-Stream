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
  handler = () => ({ ok: false, status: 404, json: {} }); assert.deepEqual(await B.schedule(), { segments: [] }, 'no schedule is an empty list');
  console.log('bridge-twitch test passed');
})().catch((e) => { console.error(e); process.exit(1); });
