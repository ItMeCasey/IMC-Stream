'use strict';
// The Discord bot against a fake Discord: nothing leaves this PC. Run: node discord-test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), createDiscord = require('./discord');

const G = 'G1', BOT = 'B1'; let nid = 100; const posts = [], created = [], callbacks = [], registered = [];
const roles = [{ id: G, name: '@everyone' }], chans = [{ id: 'c-old', type: 0, name: 'general', parent_id: null }];
const fake = async (url, opt) => {
  opt = opt || {}; const m = opt.method || 'GET', u = url.replace('https://discord.com/api/v10', ''), body = opt.body ? JSON.parse(opt.body) : null, ok = (j, st) => ({ ok: true, status: st || 200, json: async () => j });
  if (url.includes('/interactions/')) { callbacks.push({ url, body }); return ok(null, 204); }
  if (opt.headers.Authorization !== 'Bot good-token') return { ok: false, status: 401, json: async () => ({}) };
  if (u === '/users/@me') return ok({ id: BOT, username: 'ItMeCaseyBot' });
  if (u === '/users/@me/guilds') return ok([{ id: G, name: 'My Server' }]);
  if (u === '/guilds/G1/roles' && m === 'GET') return ok(roles.slice());
  if (u === '/guilds/G1/channels' && m === 'GET') return ok(chans.slice());
  if (u === '/guilds/G1/roles' && m === 'POST') { const r = Object.assign({ id: 'r' + ++nid }, body); roles.push(r); created.push(['role', body]); return ok(r); }
  if (u === '/guilds/G1/channels' && m === 'POST') { const c = Object.assign({ id: 'c' + ++nid }, body); chans.push(c); created.push(['channel', body]); return ok(c); }
  if (/^\/channels\/[^/]+\/messages$/.test(u) && m === 'POST') { posts.push({ ch: u.split('/')[2], body }); return ok({ id: 'm' + ++nid }); }
  if (/^\/applications\/B1\/guilds\/G1\/commands$/.test(u) && m === 'PUT') { registered.push(body); return ok(body); }
  return { ok: false, status: 404, json: async () => ({ message: 'unknown ' + u }) };
};
const stream = { live: false, title: 'Tetris night', game: 'Tetris' };
const bot = { exportCommands: () => ({ custom: [['!discord', 'Everyone', 'Join the Discord']], groups: { Games: [['!gamble <amount>', 'Everyone', 'Bet coins']], 'Mods & streamer': [['!addcom <name>', 'Mods', 'Add a command']] } }) };
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icm-dc-')), 'discord.json');
class FakeWS { constructor(url) { FakeWS.last = this; this.url = url; this.sent = []; } send(x) { this.sent.push(JSON.parse(x)); } close() { this.closed = true; if (this.onclose) this.onclose(); } }
const D = createDiscord({ file, fetch: fake, WebSocket: FakeWS, sleep: async () => {}, channel: () => 'ItMeCasey', website: () => 'https://itmecasey.pages.dev',
  data: { commands: () => bot.exportCommands(), top: () => [{ name: 'Ann', pts: 900 }, { name: 'Bob', pts: 400 }], stream: () => stream, games: () => [{ name: 'Gamble', how: '!gamble <amount>' }], tts: () => 'Redeem the reward. `[airhorn]`' } });

(async () => {
  assert.equal(D.view().hasToken, false); await assert.rejects(D.connect(), /Paste the bot token/);
  D.configure({ token: 'Bot bad-token' }); await assert.rejects(D.connect(), /did not accept that token/); D.configure({ token: 'Bot good-token' });
  const c = await D.connect(); assert.deepEqual(c, { bot: { id: BOT, name: 'ItMeCaseyBot' }, guilds: [{ id: G, name: 'My Server' }] });
  const v = D.view(); assert.equal(JSON.stringify(v).includes('good-token'), false, 'the token is never sent to the page'); assert.match(v.invite, /client_id=B1&scope=bot%20applications\.commands&permissions=\d{10,}/, 'an invite link with the permissions it needs');
  const p = await D.plan(G); assert.ok(p.todo.length >= 20 && p.todo.some((x) => x.kind === 'role' && x.name === 'Mods') && p.todo.some((x) => x.kind === 'text' && x.name === 'go-live') && p.todo.some((x) => x.kind === 'voice' && x.name === 'Lounge'));
  assert.ok(p.todo.some((x) => x.name === 'general' && x.in === 'COMMUNITY'), 'a channel with that name outside the category is not the same channel');
  const r = await D.setup(G); assert.ok(r.count >= 21 && r.added.includes('role Mods') && r.added.includes('#welcome') && r.added.includes('voice Lounge'), JSON.stringify(r.added));
  const mods = created.find((x) => x[0] === 'role' && x[1].name === 'Mods')[1]; assert.ok(BigInt(mods.permissions) > 0n && mods.hoist, 'the Mods role has the moderator permissions'); assert.equal(created.filter((x) => x[0] === 'role').length, 4);
  const golive = created.find((x) => x[0] === 'channel' && x[1].name === 'go-live')[1], VIEW = 1n << 10n, SEND = 1n << 11n; const ev = golive.permission_overwrites.find((o) => o.id === G);
  assert.ok((BigInt(ev.deny) & SEND) && (BigInt(ev.allow) & VIEW), 'read-only: everyone can see but not post'); assert.ok(golive.permission_overwrites.some((o) => o.id === BOT && o.type === 1 && (BigInt(o.allow) & SEND)), 'the bot itself can post');
  const modchat = created.find((x) => x[0] === 'channel' && x[1].name === 'mod-chat')[1]; assert.ok((BigInt(modchat.permission_overwrites.find((o) => o.id === G).deny) & VIEW), 'the MODS category is private');
  assert.equal(posts.length, 3, 'a welcome, the rules and a how-to message'); assert.match(JSON.stringify(posts[0].body), /Welcome to the ItMeCasey server[\s\S]*twitch\.tv\/ItMeCasey[\s\S]*itmecasey\.pages\.dev/); assert.match(JSON.stringify(posts[1].body), /Be kind/);
  const before = created.length; const again = await D.setup(G); assert.equal(again.count, 0, 'nothing is added twice'); assert.equal(created.length, before); assert.equal(posts.length, 3, 'and nothing is posted twice');
  assert.ok(D.view().channels.golive && D.view().guildId === G);
  // go-live
  posts.length = 0; assert.equal(await D.announceLive({ title: 'Tetris night', game: 'Tetris' }), true); assert.equal(posts[0].ch, D.view().channels.golive); assert.match(posts[0].body.content, /ItMeCasey is live!/); assert.match(JSON.stringify(posts[0].body.embeds), /Tetris night[\s\S]*Playing:[\s\S]*Tetris[\s\S]*twitch\.tv\/ItMeCasey/); assert.deepEqual(posts[0].body.allowed_mentions.parse, []);
  D.configure({ ping: 'here' }); await D.announceLive({}); assert.ok(posts[1].body.content.startsWith('@here ') && posts[1].body.allowed_mentions.parse[0] === 'everyone'); D.configure({ ping: '123456789012345678' }); await D.announceLive({}); assert.ok(posts[2].body.content.startsWith('<@&123456789012345678> ') && posts[2].body.allowed_mentions.roles[0] === '123456789012345678'); D.configure({ ping: 'rubbish' }); assert.equal(D.view().ping, '');
  D.configure({ announce: false }); assert.equal(await D.announceLive({}), false, 'switched off'); D.configure({ announce: true });
  // slash commands: the answers
  const text = (a) => JSON.stringify(a);
  const a1 = D.answer('commands'); assert.match(text(a1), /!discord[\s\S]*!gamble/); assert.ok(!/addcom/.test(text(a1)), 'viewers do not see the mod commands'); assert.match(text(a1), /itmecasey\.pages\.dev\/commands\.html/);
  assert.match(text(D.answer('games')), /Gamble/); assert.match(text(D.answer('tts')), /airhorn/); assert.match(text(D.answer('top')), /1\. \*\*Ann\*\* 900/); assert.match(text(D.answer('live')), /offline/); stream.live = true; assert.match(text(D.answer('live')), /The stream is live![\s\S]*Tetris night/); assert.equal(D.answer('website').content, 'https://itmecasey.pages.dev'); assert.match(D.answer('nope').content, /do not know/);
  await D.registerCommands(); assert.deepEqual(registered[0].map((x) => x.name), ['commands', 'games', 'tts', 'top', 'live', 'website']);
  // the gateway
  assert.equal(D.startGateway(), true); const ws = FakeWS.last; assert.match(ws.url, /gateway\.discord\.gg/);
  ws.onmessage({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }) }); const ident = ws.sent.find((x) => x.op === 2); assert.equal(ident.d.token, 'good-token'); assert.equal(ident.d.intents, 0, 'no privileged intents');
  ws.onmessage({ data: JSON.stringify({ op: 0, t: 'READY', s: 1, d: {} }) }); assert.equal(D.view().gateway, 'on');
  ws.onmessage({ data: JSON.stringify({ op: 0, t: 'INTERACTION_CREATE', s: 2, d: { id: 'i1', token: 'tok', type: 2, data: { name: 'top' } } }) }); await new Promise((r) => setTimeout(r, 20));
  assert.match(callbacks[0].url, /interactions\/i1\/tok\/callback/); assert.equal(callbacks[0].body.type, 4); assert.match(JSON.stringify(callbacks[0].body.data), /Ann/);
  D.stopGateway(); assert.equal(D.view().gateway, 'off'); assert.ok(ws.closed); const notThere = createDiscord({ file: path.join(path.dirname(file), 'x.json'), fetch: fake, WebSocket: FakeWS }); assert.equal(notThere.startGateway(), false, 'no token, no gateway');
  await D.test(); assert.match(posts[posts.length - 1].body.content, /The bot is working/);
  console.log('discord test passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
