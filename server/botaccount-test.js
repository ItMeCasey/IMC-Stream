// With a bot account connected, every chat message (replies, announcements, timers) is sent by the BOT, never by the streamer. Run: node botaccount-test.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert');
const createBot = require('./bot.js');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-botacct-'));
const calls = []; let announceOk = false;
const state = { stream: { live: true, startedAt: new Date().toISOString(), game: 'x', title: 'x', viewers: 1 }, totals: {}, recent: { followers: [], subscribers: [] }, latest: {}, session: {}, allTime: {} };
const mk = () => createBot({ DATA, log: () => {}, get state() { return state; }, gapMs: 0, maxPer30s: 1e9, me: () => ({ id: '1', login: 'itmecasey' }),
  helix: async (m, p, b) => { calls.push(['STREAMER', m, p, b]); return { ok: true, json: {} }; },
  fetch: async (url, o) => { const p = url.replace(/^.*\/helix/, ''); calls.push(['BOT', o.method, p, JSON.parse(o.body)]); const ok = !(p.startsWith('/chat/announcements') && !announceOk); return { ok, status: ok ? 200 : 403, json: async () => (ok ? {} : { message: 'not a moderator' }) }; },
  clientId: () => 'cid', ID_URL: () => 'x', HELIX: () => '/helix' });
(async () => {
  // no bot account yet: the streamer's own account sends
  let bot = mk(); assert.strictEqual(bot.hasAccount(), false);
  bot.say('hello'); await bot._flush(); assert.deepStrictEqual(calls.map((c) => [c[0], c[2], c[3].sender_id]), [['STREAMER', '/chat/messages', '1']]);
  // a bot account exists
  fs.writeFileSync(path.join(DATA, 'bot-account.json'), JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600e3, user_id: '77', login: 'casey_bot' }));
  calls.length = 0; bot = mk(); assert.strictEqual(bot.hasAccount(), true);
  bot.say('a reply', 'msg1'); await bot._flush();
  assert.deepStrictEqual(calls.map((c) => [c[0], c[2], c[3].sender_id, c[3].reply_parent_message_id]), [['BOT', '/chat/messages', '77', 'msg1']], 'replies come from the bot');
  // announcement, bot is a mod: the bot sends it
  calls.length = 0; announceOk = true; bot.say('big news', undefined, 'purple'); await bot._flush();
  assert.deepStrictEqual(calls.map((c) => [c[0], c[2]]), [['BOT', '/chat/announcements?broadcaster_id=1&moderator_id=77']]); assert.strictEqual(calls[0][3].color, 'purple');
  // announcement, bot is NOT a mod: falls back to a plain message from the BOT, never from the streamer
  calls.length = 0; announceOk = false; bot.say('big news 2', undefined, 'blue'); await bot._flush();
  assert.deepStrictEqual(calls.map((c) => [c[0], c[2].split('?')[0], c[3].sender_id]), [['BOT', '/chat/announcements', undefined], ['BOT', '/chat/messages', '77']], 'plain message from the bot');
  assert.ok(calls.every((c) => c[0] === 'BOT'), 'the streamer account is never used while a bot account is connected');
  console.log('bot account test passed'); process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
