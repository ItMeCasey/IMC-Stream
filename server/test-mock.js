// Integration test against a fake Twitch (ID + Helix + EventSub websocket). Run: node test-mock.js
const http = require('node:http'), crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process'), assert = require('node:assert');
const MOCK = 9911, APP = 9912;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-mock-'));
const helixCalls = [];
let stripeKeyOk = false; const now = () => Math.floor(Date.now() / 1000);
let stripeData = [{ id: 'cs_old', created: now() - 3600, payment_status: 'paid', payment_link: 'plink_1', amount_total: 500, currency: 'usd', custom_fields: [] }];
const subs = []; let wsSock = null, polls = 0, followerTotal = 123;

const frame = (txt) => { const b = Buffer.from(txt); const h = b.length < 126 ? Buffer.from([0x81, b.length]) : Buffer.from([0x81, 126, b.length >> 8, b.length & 255]); return Buffer.concat([h, b]); };
const msg = (type, payload, extra = {}) => JSON.stringify({ metadata: Object.assign({ message_id: crypto.randomUUID(), message_type: type, message_timestamp: new Date().toISOString() }, extra), payload });
const send = (sock, type, payload, extra) => sock.write(frame(msg(type, payload, extra)));

const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const u = req.url, j = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u === '/id/device') return j({ device_code: 'DC', user_code: 'ABCDEFGH', verification_uri: 'https://www.twitch.tv/activate?public=true', expires_in: 600, interval: 1 });
    if (u === '/id/token') {
      const p = new URLSearchParams(body);
      if (p.get('grant_type') === 'refresh_token') return j({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 14400 });
      return ++polls < 2 ? j({ status: 400, message: 'authorization_pending' }, 400) : j({ access_token: 'AT', refresh_token: 'RT', expires_in: 14400, scope: (p.get('scopes') || '').split(' ') });
    }
    if (u === '/id/validate') return j({ user_id: '777', login: 'itmecasey', expires_in: 14000 });
    if (u === '/helix/eventsub/subscriptions') { subs.push(JSON.parse(body)); return j({ data: [{ id: 'x' }] }, 202); }
    if (u.startsWith('/bttv/cached/emotes/global')) return j([{ id: 'b1', code: 'OMEGALUL' }, { id: 'b0', code: 'SoSnowy' }]);
    if (u.startsWith('/bttv/cached/users/twitch/777')) return j({ channelEmotes: [{ id: 'b2', code: 'CaseyHype' }], sharedEmotes: [] });
    if (u.startsWith('/ffz/set/global')) return j({ default_sets: [3], sets: { 3: { emoticons: [{ id: 1, name: 'ZrehplaR', urls: { '1': '//cdn.frankerfacez.com/emote/1/1', '2': '//cdn.frankerfacez.com/emote/1/2' } }] } } });
    if (u.startsWith('/ffz/room/id/777')) return j({ sets: { 9: { emoticons: [{ id: 2, name: 'CaseyFFZ', urls: { '1': '//cdn.frankerfacez.com/emote/2/1' } }] } } });
    if (u.startsWith('/7tv/emote-sets/global')) return j({ emotes: [{ id: 's1', name: 'EZ', flags: 0, data: { host: { url: '//cdn.7tv.app/emote/s1' } } }] });
    if (u.startsWith('/7tv/users/twitch/777')) return j({ emote_set: { emotes: [{ id: 's2', name: 'Wiggle', flags: 0, data: { host: { url: '//cdn.7tv.app/emote/s2' } } }, { id: 's3', name: 'Rainbow', flags: 1, data: { host: { url: '//cdn.7tv.app/emote/s3' } } }] } });
    if (u.startsWith('/helix/polls') || u.startsWith('/helix/predictions')) {
      const kind = u.startsWith('/helix/polls') ? 'poll' : 'prediction';
      if (req.method === 'GET') return j({ data: [kind === 'poll'
        ? { id: 'poll1', title: 'Next game?', status: 'ACTIVE', duration: 60, started_at: new Date().toISOString(), choices: [{ id: 'c1', title: 'Doom', votes: 3 }, { id: 'c2', title: 'Tetris', votes: 1 }] }
        : { id: 'pred1', title: 'Win?', status: 'ACTIVE', prediction_window: 120, created_at: new Date().toISOString(), outcomes: [{ id: 'o1', title: 'Yes', users: 2, channel_points: 500 }, { id: 'o2', title: 'No', users: 1, channel_points: 100 }] }] });
      helixCalls.push([req.method, u, body]);
      return j({ data: [{ id: kind + '-new' }] });
    }
    if (u.startsWith('/helix/channel_points/custom_rewards')) {
      if (req.method === 'GET') return j({ data: [{ id: 'rw1', title: 'Hydrate!', cost: 200, is_enabled: true, is_user_input_required: true }] });
      if (req.method === 'PATCH') { helixCalls.push(['PATCH', u, body]); return j({ data: [{ id: 'red77' }] }); }
      if (req.method === 'DELETE') { helixCalls.push(['DELETE', u, body]); res.writeHead(204); return res.end(); }
      helixCalls.push(['POST', u, body]); return j({ data: [{ id: 'rw2', title: JSON.parse(body).title }] });
    }
    if (u.startsWith('/helix/clips')) { helixCalls.push(['POST', u, body]); return j({ data: [{ id: 'ClipXYZ', edit_url: 'https://clips.twitch.tv/ClipXYZ/edit' }] }, 202); }
    if (u.startsWith('/helix/chat/badges')) return j({ data: [{ set_id: 'moderator', versions: [{ id: '1', image_url_2x: 'https://badge/mod2x' }] }] });
    if (u.startsWith('/helix/chat/settings')) { if (req.method === 'PATCH') { helixCalls.push(['PATCH', u, body]); return j({ data: [] }); } return j({ data: [{ slow_mode: true, slow_mode_wait_time: 30, follower_mode: false, subscriber_mode: false, emote_mode: true, unique_chat_mode: false }] }); }
    if (u.startsWith('/helix/moderation/') || u.startsWith('/helix/chat/messages') || u.startsWith('/helix/chat/announcements') || u.startsWith('/helix/users?')) {
      helixCalls.push([req.method, u, body]);
      if (u.startsWith('/helix/users?')) return j({ data: [{ id: '555', login: 'spammer' }] });
      return j({ data: [] }, 200);
    }
    if (u.startsWith('/stripe/checkout/sessions')) { stripeKeyOk = req.headers.authorization === 'Bearer rk_test_mock'; return j({ data: stripeData.slice().reverse() }); }
    if (u.startsWith('/helix/channels/commercial')) { helixCalls.push(['POST', u, body]); return j({ data: [JSON.parse(body).length === 180 ? { length: 0, message: 'You must be streaming live to run commercials.', retry_after: 0 } : { length: JSON.parse(body).length, message: '', retry_after: 480 }] }); }
    if (u.startsWith('/helix/channels/ads/schedule/snooze')) { helixCalls.push(['POST', u, body]); return j({ data: [{ snooze_count: 2, snooze_refresh_at: new Date(Date.now() + 3600e3).toISOString(), next_ad_at: new Date(Date.now() + 1200e3).toISOString() }] }); }
    if (u.startsWith('/helix/channels/ads')) return j({ data: [{ next_ad_at: Math.floor(Date.now() / 1000) + 754, duration: 90, snooze_count: 3 }] });
    if (u.startsWith('/helix/streams')) return j({ data: [{ viewer_count: 77, title: 'Live from the mock', game_name: 'Tetris', started_at: new Date(Date.now() - 3600000).toISOString() }] });
    if (u.startsWith('/helix/bits/leaderboard')) return j({ data: [{ user_name: 'BitBoss', rank: 1, score: 9001 }, { user_name: 'Second', rank: 2, score: 500 }] });
    if (u.startsWith('/helix/channels?')) {
      if (req.method === 'PATCH') { helixCalls.push(['PATCH', u, body]); return j({}, 204); }
      return j({ data: [{ broadcaster_name: 'ItMeCasey', title: 'Chan title', game_name: 'Tetris', game_id: '55', broadcaster_language: 'en' }] });
    }
    if (u.startsWith('/helix/games?id=55')) return j({ data: [{ id: '55', name: 'Tetris', box_art_url: 'https://static-cdn.jtvnw.net/ttv-boxart/55-{width}x{height}.jpg' }] });
    if (u.startsWith('/helix/search/categories')) return j({ data: [{ id: '999', name: 'Doom', box_art_url: 'https://static-cdn.jtvnw.net/ttv-boxart/999-52x72.jpg' }, { id: '998', name: 'Doom Eternal', box_art_url: 'https://static-cdn.jtvnw.net/ttv-boxart/998-52x72.jpg' }] });
    if (u.startsWith('/helix/channels/followers')) return j({ total: followerTotal, data: [] });
    if (u.startsWith('/helix/subscriptions')) return j({ total: 11, points: 14, data: [] });
    j({ error: 'nope' }, 404);
  });
});
mock.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  wsSock = sock; sock.on('error', () => {}); sock.on('data', () => {});
  send(sock, 'session_welcome', { session: { id: 'SESS1', keepalive_timeout_seconds: 30 } });
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const api = (p, o) => fetch('http://127.0.0.1:' + APP + p, o).then(r => r.json());
const label = (n) => fs.readFileSync(path.join(data, 'labels', n + '.txt'), 'utf8');

(async () => {
  await new Promise(r => mock.listen(MOCK, '127.0.0.1', r));
  const app = spawn(process.execPath, ['server.js'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {
    ICM_DATA: data, ICM_BTTV_URL: 'http://127.0.0.1:' + MOCK + '/bttv', ICM_FFZ_URL: 'http://127.0.0.1:' + MOCK + '/ffz', ICM_7TV_URL: 'http://127.0.0.1:' + MOCK + '/7tv', ICM_STRIPE_URL: 'http://127.0.0.1:' + MOCK + '/stripe', ICM_STRIPE_KEY: 'rk_test_mock', ICM_STRIPE_POLL_MS: '700', ICM_PORT: APP, ICM_CLIENT_ID: 'testclient', ICM_EVENTSUB_URL: 'ws://127.0.0.1:' + MOCK + '/ws',
    ICM_HELIX_URL: 'http://127.0.0.1:' + MOCK + '/helix', ICM_ID_URL: 'http://127.0.0.1:' + MOCK + '/id' }) });
  let out = ''; app.stdout.on('data', d => out += d); app.stderr.on('data', d => out += d);
  try {
    await sleep(1200);
    const st = await api('/api/auth/start', { method: 'POST' });
    assert.strictEqual(st.user_code, 'ABCDEFGH');
    await sleep(3500);                                  // device poll (interval 1s, pending once)
    let s = await api('/api/status');
    assert.strictEqual(s.auth.status, 'ok', 'auth: ' + JSON.stringify(s.auth));
    await sleep(800);
    s = await api('/api/status');
    assert.strictEqual(s.eventsub, 'connected', 'eventsub: ' + s.eventsub + '\n' + out);
    const types = subs.map(x => x.type);
    assert.ok(types.includes('channel.follow') && types.includes('channel.raid') && types.includes('channel.cheer'), types.join());
    assert.strictEqual(subs[0].transport.session_id, 'SESS1');
    for (const t of ['channel.chat.message', 'channel.poll.progress', 'channel.prediction.lock', 'channel.goal.end', 'channel.hype_train.progress', 'channel.ad_break.begin', 'channel.update', 'stream.online', 'channel.chat.message_delete', 'channel.chat.clear_user_messages', 'channel.chat.clear']) assert.ok(types.includes(t), 'missing subscription ' + t);
    assert.deepStrictEqual(s.missingScopes, [], 'scopes');
    assert.deepStrictEqual(subs.find(x => x.type === 'channel.follow').condition, { broadcaster_user_id: '777', moderator_user_id: '777' });
    // SSE listener
    const got = []; const ctl = new AbortController();
    fetch('http://127.0.0.1:' + APP + '/events', { signal: ctl.signal }).then(async r => { const rd = r.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; got.push(Buffer.from(value).toString()); } }).catch(() => {});
    await sleep(300);
    followerTotal = 124;
    send(wsSock, 'notification', { subscription: { type: 'channel.follow' }, event: { user_name: 'LiveFollower' } }, { subscription_type: 'channel.follow' });
    await sleep(500);
    assert.ok(got.join('').includes('LiveFollower'), 'alert not pushed over SSE');
    assert.strictEqual(label('latest_follower'), 'LiveFollower');
    send(wsSock, 'session_keepalive', {});
    await sleep(4800);                                  // totals refresh (debounced 4s)
    assert.strictEqual(label('total_follower_count'), '124');
    assert.strictEqual(label('total_subscriber_count'), '10');
    // Helix pollers filled stream / leaderboard / ad labels
    assert.strictEqual(label('stream_viewers'), '77');
    assert.strictEqual(label('stream_status'), 'LIVE');
    assert.ok(/^1:0\d:\d\d$/.test(label('stream_uptime')), 'uptime ' + label('stream_uptime'));
    assert.strictEqual(label('top_cheerer_week'), 'BitBoss - 9001');
    assert.strictEqual(label('bits_leaderboard_all'), '1. BitBoss - 9001\n2. Second - 500');
    assert.ok(/^12:\d\d$/.test(label('next_ad_in')), 'next_ad_in ' + label('next_ad_in'));
    assert.strictEqual(label('ad_snoozes_left'), '3');
    assert.strictEqual(label('channel_name'), 'ItMeCasey');
    const note = (type, event) => send(wsSock, 'notification', { subscription: { type }, event }, { subscription_type: type });
    note('channel.chat.message', { chatter_user_name: 'Zed', chatter_user_login: 'zed', message: { text: 'hello from chat' } });
    note('channel.poll.progress', { title: 'P', choices: [{ title: 'A', votes: 2 }, { title: 'B', votes: 5 }] });
    await sleep(600);
    assert.strictEqual(label('latest_chat_message'), 'Zed: hello from chat');
    assert.strictEqual(label('poll_leader'), 'B');
    // Stripe tips: history is baselined silently, new paid sessions become alerts
    assert.strictEqual(stripeKeyOk, true, 'stripe auth header');
    assert.strictEqual(label('latest_tip'), '', 'old payment must not replay');
    stripeData.push({ id: 'cs_unpaid', created: now() + 1, payment_status: 'unpaid', payment_link: 'plink_1', amount_total: 999, currency: 'usd', custom_fields: [] });
    stripeData.push({ id: 'cs_new', created: now() + 2, payment_status: 'paid', payment_link: 'plink_1', amount_total: 1250, currency: 'usd',
      custom_fields: [{ key: 'yourname', label: { custom: 'Your name' }, type: 'text', text: { value: 'Sam' } }, { key: 'message', label: { custom: 'Message' }, type: 'text', text: { value: 'Great stream!' } }] });
    await sleep(1800);
    assert.strictEqual(label('latest_tip'), 'Sam - $12.50');
    assert.strictEqual(label('session_tip_total'), '12.50');
    assert.strictEqual(label('session_top_tipper'), 'Sam - 12.5');
    assert.ok(got.join('').includes('Great stream!'), 'tip alert not pushed over SSE');
    await sleep(1500);
    assert.strictEqual(label('session_tip_total'), '12.50', 'duplicate poll must not re-alert');
    // third-party emotes, badges, chat feed and moderation
    const em = (await api('/api/emotes')).emotes;
    assert.strictEqual(em.OMEGALUL.p, 'BTTV'); assert.strictEqual(em.OMEGALUL.u, 'https://cdn.betterttv.net/emote/b1/2x.webp');
    assert.strictEqual(em.SoSnowy.z, 1, 'bttv zero-width');
    assert.strictEqual(em.CaseyHype.p, 'BTTV'); assert.strictEqual(em.CaseyFFZ.u, 'https://cdn.frankerfacez.com/emote/2/1');
    assert.strictEqual(em.ZrehplaR.p, 'FFZ'); assert.strictEqual(em.EZ.u, 'https://cdn.7tv.app/emote/s1/2x.webp');
    assert.strictEqual(em.Wiggle.p, '7TV'); assert.strictEqual(em.Rainbow.z, 1, '7tv zero-width');
    assert.strictEqual((await api('/api/badges'))['moderator/1'], 'https://badge/mod2x');
    const chatEvt = { message_id: 'm1', chatter_user_id: '555', chatter_user_login: 'spammer', chatter_user_name: 'Spammer', color: '#FF0000', badges: [{ set_id: 'moderator', id: '1' }],
      message: { text: 'hi Kappa Wiggle', fragments: [{ type: 'text', text: 'hi ' }, { type: 'emote', text: 'Kappa', emote: { id: '25' } }, { type: 'text', text: ' Wiggle' }] }, message_type: 'text' };
    const before = got.length;
    note('channel.chat.message', chatEvt);
    await sleep(400);
    const stream = got.slice(before).join('');
    assert.ok(stream.includes('event: chat') && stream.includes('"id":"25"'), 'chat event with emote fragment over SSE');
    assert.ok((await api('/api/chat/recent')).length >= 1);
    // Twitch inline GIFs arrive as a "gif" fragment; only https addresses are passed on
    const b6 = got.length;
    note('channel.chat.message', { message_id: 'g1', chatter_user_id: '321', chatter_user_login: 'viewer', chatter_user_name: 'Viewer', badges: [], message_type: 'text',
      message: { text: 'look at this', fragments: [{ type: 'text', text: 'look at this ' }, { type: 'gif', text: '', gif: { gif_id: 'abc123', url: 'https://media.tenor.test/abc123.gif' } }, { type: 'gif', text: '', gif: { gif_id: 'bad', url: 'javascript:alert(1)' } }] } });
    await sleep(400);
    const gifFeed = got.slice(b6).join('');
    assert.ok(gifFeed.includes('"gif":{"id":"abc123","url":"https://media.tenor.test/abc123.gif"}'), 'gif fragment forwarded to the dock and overlay');
    assert.ok(!gifFeed.includes('javascript:'), 'non-https gif addresses are dropped');
    assert.deepStrictEqual(await api('/api/chat/settings'), { slow: 30, followers: 0, subs: false, emote: true, unique: false });
    const mod = (kind, body) => api('/api/mod/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (const r of [await mod('delete', { messageId: 'm1' }), await mod('timeout', { userId: '555', seconds: 600 }), await mod('ban', { login: 'spammer', reason: 'spam' }),
      await mod('unban', { userId: '555' }), await mod('clear', {}), await mod('settings', { slow: 60, emote: false })]) assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual((await api('/api/chat/send', { method: 'POST', body: JSON.stringify({ message: 'hello chat' }) })).ok, true);
    const find = (m, frag) => helixCalls.find((c) => c[0] === m && c[1].includes(frag));
    assert.ok(find('DELETE', '/helix/moderation/chat?broadcaster_id=777&moderator_id=777&message_id=m1'), 'delete call');
    const bans = helixCalls.filter((c) => c[0] === 'POST' && c[1].includes('/helix/moderation/bans?broadcaster_id=777&moderator_id=777'));
    assert.deepStrictEqual(JSON.parse(bans[0][2]).data, { user_id: '555', duration: 600, reason: '' });
    assert.deepStrictEqual(JSON.parse(bans[1][2]).data, { user_id: '555', reason: 'spam' }, 'ban by login resolved through /users');
    assert.ok(find('DELETE', '/helix/moderation/bans?broadcaster_id=777&moderator_id=777&user_id=555'), 'unban call');
    assert.ok(helixCalls.some((c) => c[0] === 'DELETE' && c[1].endsWith('/helix/moderation/chat?broadcaster_id=777&moderator_id=777')), 'clear chat call');
    assert.deepStrictEqual(JSON.parse(helixCalls.find((c) => c[0] === 'PATCH')[2]), { slow_mode: true, slow_mode_wait_time: 60, emote_mode: false });
    // AutoMod review: a held message appears, Allow/Deny call Twitch and clear it, Twitch's own update clears it too
    assert.ok(subs.some((x) => x.type === 'automod.message.hold' && x.version === '2' && x.condition.moderator_user_id === '777'), 'subscribed to AutoMod holds');
    note('automod.message.hold', { message_id: 'h1', user_id: '901', user_login: 'rudeguy', user_name: 'RudeGuy', message: { text: 'something rude' }, held_at: new Date().toISOString(), reason: 'automod', automod: { category: 'aggression', level: 3 } });
    note('automod.message.hold', { message_id: 'h2', user_id: '902', user_login: 'other', user_name: 'Other', message: { text: 'blocked word here' }, held_at: new Date().toISOString(), reason: 'blocked_term' });
    note('automod.message.hold', { message_id: 'h3', user_id: '903', user_login: 'third', user_name: 'Third', message: { text: 'third' }, held_at: new Date().toISOString(), reason: 'automod', automod: { category: 'swearing', level: 1 } });
    await sleep(300);
    let held = await api('/api/automod'); assert.deepStrictEqual(held.map((h) => [h.id, h.name, h.why]), [['h1', 'RudeGuy', 'aggression (level 3)'], ['h2', 'Other', 'blocked term'], ['h3', 'Third', 'swearing (level 1)']]);
    assert.strictEqual((await mod('automod', { messageId: 'h1', allow: true })).ok, true); assert.strictEqual((await mod('automod', { messageId: 'h2', allow: false })).ok, true);
    const am = helixCalls.filter((c) => c[1].startsWith('/helix/moderation/automod/message')).map((c) => JSON.parse(c[2]));
    assert.deepStrictEqual(am, [{ user_id: '777', msg_id: 'h1', action: 'ALLOW' }, { user_id: '777', msg_id: 'h2', action: 'DENY' }]);
    note('automod.message.update', { message_id: 'h3', status: 'Approved' }); await sleep(250);
    assert.deepStrictEqual(await api('/api/automod'), [], 'allowed, denied and externally-resolved messages are all cleared');
    assert.deepStrictEqual(JSON.parse(find('POST', '/helix/chat/messages')[2]), { broadcaster_id: '777', sender_id: '777', message: 'hello chat' });
    // the bot answers a chat command through Helix (as the logged-in broadcaster)
    note('channel.chat.message', { message_id: 'm9', chatter_user_id: '321', chatter_user_login: 'viewer', chatter_user_name: 'Viewer', badges: [], message: { text: '!lurk', fragments: [{ type: 'text', text: '!lurk' }] }, message_type: 'text' });
    await sleep(1800);
    const botMsg = helixCalls.filter((c) => c[0] === 'POST' && c[1].startsWith('/helix/chat/messages')).map((c) => JSON.parse(c[2])).find((b) => /Viewer is now lurking/.test(b.message));
    assert.ok(botMsg, 'bot reply sent through Helix');
    assert.deepStrictEqual([botMsg.broadcaster_id, botMsg.sender_id, botMsg.reply_parent_message_id], ['777', '777', 'm9']);
    // overlay feed: a poll/prediction already running at startup is picked up from Helix, and live EventSub updates stream out
    const feed = got.join('');
    assert.ok(feed.includes('event: polls') && feed.includes('"title":"Next game?"') && feed.includes('"status":"OPEN"') && feed.includes('"title":"Win?"'), 'polls event with startup snapshot');
    const b4 = got.length;
    note('channel.poll.progress', { id: 'poll1', title: 'Next game?', started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 30000).toISOString(), choices: [{ id: 'c1', title: 'Doom', votes: 8 }, { id: 'c2', title: 'Tetris', votes: 2 }] });
    note('channel.prediction.end', { id: 'pred1', title: 'Win?', status: 'resolved', winning_outcome_id: 'o2', ended_at: new Date().toISOString(), outcomes: [{ id: 'o1', title: 'Yes', users: 2, channel_points: 500 }, { id: 'o2', title: 'No', users: 1, channel_points: 100 }] });
    await sleep(500);
    const live = got.slice(b4).join('');
    assert.ok(live.includes('event: polls') && live.includes('"votes":8') && live.includes('"status":"RESOLVED"') && live.includes('"winner":"o2"'), 'live poll/prediction state pushed to overlays');
    // dashboard "Test" runs a scripted demo through the same feed
    const b5 = got.length;
    assert.strictEqual((await api('/api/test', { method: 'POST', body: JSON.stringify({ type: 'prediction' }) })).ok, true);
    await sleep(1500);
    assert.ok(got.slice(b5).join('').includes('"id":"demo"'), 'demo prediction broadcast');
    // ad controls
    const ad = (p, b) => api('/api/ads/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
    const av = await api('/api/ads'); assert.deepStrictEqual([av.snoozes, av.running, av.lengths.length], [3, false, 6]);
    assert.strictEqual((await ad('settings', { warnSeconds: 900, warnMsg: 'Ads in {seconds}s, hang tight!', afterOn: true, afterMsg: 'Thanks for watching ads', startOn: true, startMsg: 'Rolling a {duration}s ad. !sub to skip them!', startColor: 'orange', warnColor: 'blue' })).warnSeconds, 900);
    await sleep(2500);
        assert.strictEqual((await ad('run', { length: 60, say: 'AD STARTING' })).ok, true);
    assert.deepStrictEqual(JSON.parse(helixCalls.filter((c) => c[1].startsWith('/helix/channels/commercial')).pop()[2]), { broadcaster_id: '777', length: 60 });
    assert.strictEqual((await api('/api/ads')).running, true);
    await sleep(1500);
    const annCall = helixCalls.find((c) => c[0] === 'POST' && c[1].startsWith('/helix/chat/announcements'));
    assert.ok(annCall, 'ad start posts a highlighted announcement');
    assert.ok(annCall[1].includes('broadcaster_id=777') && annCall[1].includes('moderator_id=777'));
    assert.ok(helixCalls.filter((c) => c[1].startsWith('/helix/chat/announcements')).some((c) => JSON.parse(c[2]).message === 'Rolling a 60s ad. !sub to skip them!' && JSON.parse(c[2]).color === 'orange'), 'ad start announcement text + colour');
    assert.ok(helixCalls.filter((c) => c[1].startsWith('/helix/chat/announcements')).some((c) => /^Ads in \d+s, hang tight!$/.test(JSON.parse(c[2]).message) && JSON.parse(c[2]).color === 'blue'), 'heads-up posted as a blue announcement');
    assert.match((await ad('run', { length: 180 })).error, /must be streaming live/);
    assert.strictEqual(JSON.parse(helixCalls.filter((c) => c[1].startsWith('/helix/channels/commercial')).pop()[2]).length, 180);
    assert.strictEqual((await ad('run', { length: 45 })).length, 30, 'invalid lengths fall back to 30s');
    const sn = await ad('snooze'); assert.deepStrictEqual([sn.ok, sn.snoozes], [true, 2]);
    assert.ok(helixCalls.some((c) => c[1].startsWith('/helix/channels/ads/schedule/snooze?broadcaster_id=777')), 'snooze call');
    await sleep(1500);
    assert.ok(helixCalls.some((c) => c[0] === 'POST' && c[1].startsWith('/helix/chat/messages') && /AD STARTING/.test(c[2])), 'optional "tell chat" message sent');
    // stream title + category
    const ch = (p, b) => api('/api/channel/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const ci = await api('/api/channel');
    assert.deepStrictEqual([ci.title, ci.gameId, ci.gameName, ci.art], ['Chan title', '55', 'Tetris', 'https://static-cdn.jtvnw.net/ttv-boxart/55-144x192.jpg']);
    const cats = (await api('/api/categories?q=doo')).results;
    assert.deepStrictEqual(cats.map((c) => [c.id, c.name, c.art]), [['999', 'Doom', 'https://static-cdn.jtvnw.net/ttv-boxart/999-144x192.jpg'], ['998', 'Doom Eternal', 'https://static-cdn.jtvnw.net/ttv-boxart/998-144x192.jpg']]);
    assert.deepStrictEqual((await api('/api/categories?q=')).results, []);
    assert.strictEqual((await ch('update', { title: 'Speedrun time', gameId: '999', gameName: 'Doom', art: cats[0].art })).ok, true);
    const patch = helixCalls.filter((c) => c[0] === 'PATCH' && c[1].startsWith('/helix/channels?broadcaster_id=777')).pop();
    assert.deepStrictEqual(JSON.parse(patch[2]), { title: 'Speedrun time', game_id: '999' });
    await sleep(600);
    assert.strictEqual(label('stream_title'), 'Speedrun time'); assert.strictEqual(label('stream_game'), 'Doom');
    assert.deepStrictEqual((await api('/api/channel')).recents.map((c) => c.name), ['Doom']);
    assert.match((await ch('update', { title: '   ' })).error, /cannot be empty/);
    assert.match((await ch('update', {})).error, /Nothing to change/);
    assert.strictEqual((await ch('update', { gameId: '0' })).ok, true);
    assert.strictEqual(JSON.parse(helixCalls.filter((c) => c[0] === 'PATCH' && c[1].startsWith('/helix/channels?')).pop()[2]).game_id, '0');
    assert.strictEqual((await ch('preset/save', { name: 'Doom night', title: 'Doom Eternal blind', gameId: '998', gameName: 'Doom Eternal', art: 'a.jpg' })).ok, true);
    const presets = (await api('/api/channel')).presets; assert.deepStrictEqual(presets.map((p) => [p.name, p.title, p.gameId]), [['Doom night', 'Doom Eternal blind', '998']]);
    assert.strictEqual((await ch('preset/delete', { id: presets[0].id })).ok, true);
    // polls + predictions management
    const pa = (p, b) => api('/api/polls/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const snap = await api('/api/polls');
    assert.strictEqual(snap.poll.title, 'Next game?'); assert.strictEqual(snap.prediction.outcomes[0].channel_points, 500);
    assert.strictEqual((await pa('poll/create', { title: 'Next game?', choices: ['Doom', 'Tetris'], duration: 5, points: true, pointsPerVote: 50, say: 'POLL TIME' })).id, 'poll-new');
    let call = helixCalls.filter((c) => c[0] === 'POST' && c[1].startsWith('/helix/polls')).pop();
    assert.deepStrictEqual(JSON.parse(call[2]), { broadcaster_id: '777', title: 'Next game?', choices: [{ title: 'Doom' }, { title: 'Tetris' }], duration: 15, channel_points_voting_enabled: true, channel_points_per_vote: 50 });   // 5s clamps up to 15s
    assert.match((await pa('poll/create', { title: 'x', choices: ['only one'] })).error, /between 2 and 5/);
    assert.match((await pa('poll/create', { title: '', choices: ['a', 'b'] })).error, /needs a question/);
    assert.strictEqual((await pa('poll/end', { id: 'poll1' })).ok, true);
    assert.deepStrictEqual(JSON.parse(helixCalls.filter((c) => c[0] === 'PATCH' && c[1].startsWith('/helix/polls')).pop()[2]), { broadcaster_id: '777', id: 'poll1', status: 'TERMINATED' });
    assert.strictEqual((await pa('poll/end', { id: 'poll1', archive: true })).ok, true);
    assert.strictEqual(JSON.parse(helixCalls.filter((c) => c[0] === 'PATCH' && c[1].startsWith('/helix/polls')).pop()[2]).status, 'ARCHIVED');
    assert.strictEqual((await pa('prediction/create', { title: 'Win?', outcomes: 'Yes\nNo', window: 9999 })).id, 'prediction-new');
    call = helixCalls.filter((c) => c[0] === 'POST' && c[1].startsWith('/helix/predictions')).pop();
    assert.deepStrictEqual(JSON.parse(call[2]), { broadcaster_id: '777', title: 'Win?', outcomes: [{ title: 'Yes' }, { title: 'No' }], prediction_window: 1800 });
    assert.strictEqual((await pa('prediction/lock', { id: 'pred1' })).ok, true);
    assert.strictEqual((await pa('prediction/resolve', { id: 'pred1', outcomeId: 'o1' })).ok, true);
    assert.deepStrictEqual(JSON.parse(helixCalls.filter((c) => c[0] === 'PATCH' && c[1].startsWith('/helix/predictions')).pop()[2]), { broadcaster_id: '777', id: 'pred1', status: 'RESOLVED', winning_outcome_id: 'o1' });
    assert.match((await pa('prediction/resolve', { id: 'pred1' })).error, /winning outcome/);
    assert.strictEqual((await pa('prediction/cancel', { id: 'pred1' })).ok, true);
    assert.strictEqual(JSON.parse(helixCalls.filter((c) => c[0] === 'PATCH' && c[1].startsWith('/helix/predictions')).pop()[2]).status, 'CANCELED');
    assert.strictEqual((await pa('preset/save', { kind: 'poll', title: 'Snack?', options: ['Pizza', 'Tacos'], seconds: 90 })).ok, true);
    const withPreset = await api('/api/polls'); assert.deepStrictEqual(withPreset.presets.polls.map((x) => [x.title, x.options, x.seconds]), [['Snack?', ['Pizza', 'Tacos'], 90]]);
    assert.strictEqual((await pa('preset/delete', { id: withPreset.presets.polls[0].id })).ok, true);
    await sleep(1800);
    assert.ok(helixCalls.some((c) => c[0] === 'POST' && c[1].startsWith('/helix/chat/messages') && /POLL TIME/.test(c[2])), 'optional chat announcement sent');
    // channel point reward hooks: a redemption runs chat + status actions through the real Helix calls
    const hk = (p, b) => api('/api/hooks/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    assert.deepStrictEqual((await api('/api/hooks/rewards')).rewards.map((r) => r.title), ['Hydrate!']);
    assert.ok((await hk('reward/update', { id: 'rw1', enabled: false })).ok, 'reward disabled');
    assert.ok(helixCalls.some((c) => c[0] === 'PATCH' && c[1].includes('custom_rewards?broadcaster_id=777&id=rw1') && JSON.parse(c[2]).is_enabled === false), 'disable sent to Twitch');
    assert.ok((await hk('reward/delete', { id: 'rw1' })).ok, 'reward deleted'); assert.ok(helixCalls.some((c) => c[0] === 'DELETE' && c[1].includes('id=rw1')));
    const hook = await hk('save', { name: 'Hydrate', match: { rewardId: 'rw1' }, actions: [{ type: 'chat', text: '{name} drinks water! "{input}"', announce: 'blue' }, { type: 'status', status: 'FULFILLED' }] });
    assert.ok(hook.id, JSON.stringify(hook));
    note('channel.channel_points_custom_reward_redemption.add', { id: 'red77', user_id: '321', user_login: 'viewer', user_name: 'Viewer', user_input: 'glug glug', reward: { id: 'rw1', title: 'Hydrate!', cost: 200 }, status: 'unfulfilled' });
    await sleep(2200);
    const annHook = helixCalls.filter((c) => c[1].startsWith('/helix/chat/announcements')).map((c) => JSON.parse(c[2])).find((x) => x.message === 'Viewer drinks water! "glug glug"');
    assert.ok(annHook && annHook.color === 'blue', 'hook posted its chat message as an announcement');
    const stat = helixCalls.find((c) => c[0] === 'PATCH' && c[1].startsWith('/helix/channel_points/custom_rewards/redemptions?id=red77&broadcaster_id=777&reward_id=rw1'));
    assert.ok(stat && JSON.parse(stat[2]).status === 'FULFILLED', 'redemption marked fulfilled');
    assert.strictEqual((await api('/api/hooks')).runs[0].results.every((r) => r.ok), true);
    assert.strictEqual((await hk('reward/create', { title: 'New reward', cost: 50 })).title, 'New reward');
    await hk('delete', { id: hook.id });
    // alert controls + history/replay, and a spoken alert made by the real Windows voice
    const ac = (a) => api('/api/alerts/ctl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: a }) });
    let b7 = got.length;
    for (const a of ['pause', 'mute', 'skip', 'clear', 'unmute', 'resume']) assert.strictEqual((await ac(a)).ok, true);
    await sleep(400);
    const ctlFeed = got.slice(b7).join(''); assert.ok(ctlFeed.includes('event: alertctl') && ctlFeed.includes('"action":"pause","paused":true,"muted":false') && ctlFeed.includes('"action":"mute","paused":true,"muted":true') && ctlFeed.includes('"action":"skip"') && ctlFeed.includes('"action":"resume","paused":false,"muted":false'), 'alert controls reach the overlay');
    assert.match((await ac('dance')).error, /unknown alert action/);
    const hist = await api('/api/alerts/history'); assert.ok(hist.length > 0 && hist[0].id > 0);
    b7 = got.length; assert.strictEqual((await api('/api/alerts/replay', { method: 'POST', body: JSON.stringify({ id: hist[0].id }) })).ok, true); await sleep(300);
    assert.ok(got.slice(b7).join('').includes('"replay":true'), 'replay re-sends the alert'); assert.match((await api('/api/alerts/replay', { method: 'POST', body: JSON.stringify({ id: 99999 }) })).error, /no longer in the history/);
    if (process.platform === 'win32') {
      await api('/api/tts/settings', { method: 'POST', body: JSON.stringify({ voice: '' }) });   // Windows voice: its clip is attached to the alert
      const rules = (await api('/api/alerts')).rules, bitsRule = rules.find((r) => r.event === 'bits');
      await api('/api/alerts/save', { method: 'POST', body: JSON.stringify(Object.assign({}, bitsRule, { tts: { on: true, text: '{name} says {message}', voice: '' } })) });
      b7 = got.length; await api('/api/test', { method: 'POST', body: JSON.stringify({ type: 'bits' }) });
      let spoken = null; for (let i = 0; i < 40 && !spoken; i++) { await sleep(250); const mm = /"tts":\{"url":"(\/tts\/[a-f0-9]{40}\.wav)","volume":(\d+)\}/.exec(got.slice(b7).join('')); if (mm) spoken = mm; }
      assert.ok(spoken, 'bits alert arrived with a spoken clip'); const wav = await fetch('http://127.0.0.1:' + APP + spoken[1]); assert.strictEqual(wav.headers.get('content-type'), 'audio/wav'); assert.strictEqual(Buffer.from(await wav.arrayBuffer()).slice(0, 4).toString(), 'RIFF');
      if ((await api('/api/tts')).kokoro.installed) {   // realistic voice: the banner goes out first, the voice follows as its own event
        await api('/api/alerts/save', { method: 'POST', body: JSON.stringify(Object.assign({}, bitsRule, { tts: { on: true, text: '{name} says {message}', voice: 'af_heart' } })) });
        b7 = got.length; await api('/api/test', { method: 'POST', body: JSON.stringify({ type: 'bits' }) });
        let feed = '', order = null; for (let i = 0; i < 80 && !order; i++) { await sleep(250); feed = got.slice(b7).join(''); const a = feed.indexOf('"tag":"500 BITS"'), v = feed.indexOf('event: tts'); if (a >= 0 && v >= 0) order = [a, v]; }
        assert.ok(order, 'Kokoro voice arrived as a separate tts event'); assert.ok(order[0] < order[1], 'banner first, voice second'); assert.ok(!/"tag":"500 BITS"[^\n]*"tts":\{/.test(feed), 'kokoro clip is not attached to the alert');
        await api('/api/alerts/save', { method: 'POST', body: JSON.stringify(Object.assign({}, bitsRule, { tts: { on: true, text: '{name} says {message}', voice: '' } })) });
      }
      b7 = got.length; await api('/api/test', { method: 'POST', body: JSON.stringify({ type: 'follow' }) }); await sleep(500);
      assert.ok(!got.slice(b7).join('').includes('"tts":{'), 'no voice for alerts without a message');
      b7 = got.length; const said = await api('/api/tts/say', { method: 'POST', body: JSON.stringify({ text: 'Testing one two three' }) }); assert.match(said.url, /^\/tts\//); await sleep(300);
      assert.ok(got.slice(b7).join('').includes('event: tts'), 'dashboard "speak" is sent to the overlay');
      assert.strictEqual((await api('/api/tts/skip', { method: 'POST', body: '{}' })).ok, true);
      assert.match((await api('/api/tts/say', { method: 'POST', body: JSON.stringify({ text: '   ' }) })).error, /Nothing to say/);
      assert.ok((await api('/api/tts')).voices.length > 0);
    }
    // clips + the commands page for viewers
    const clip = await api('/api/channel/clip', { method: 'POST', body: '{}' }); assert.strictEqual(clip.url, 'https://clips.twitch.tv/ClipXYZ');
    assert.ok(helixCalls.some((c) => c[0] === 'POST' && c[1] === '/helix/clips?broadcaster_id=777'), 'clip request');
    const mdPage = await fetch('http://127.0.0.1:' + APP + '/api/commands/export?format=md'); assert.match(await mdPage.text(), /^# itmecasey chat commands/);
    const htmlPage = await fetch('http://127.0.0.1:' + APP + '/api/commands/export?format=html&download=1'); assert.match(htmlPage.headers.get('content-disposition'), /attachment; filename="chat-commands\.html"/); assert.match(await htmlPage.text(), /<table>/);
    // delete / clear events reach docks and the backlog
    const before2 = got.length;
    note('channel.chat.message_delete', { target_message_id: 'm1' });
    note('channel.chat.clear_user_messages', { target_user_id: '555' });
    await sleep(400);
    const s2 = got.slice(before2).join('');
    assert.ok(s2.includes('event: chatmod') && s2.includes('"type":"delete"') && s2.includes('"type":"clearUser"'), 'chatmod events');
    assert.ok(!(await api('/api/chat/recent')).some((m) => m.id === 'm1'), 'deleted messages leave the backlog');
    // duplicate message id is ignored
    const dup = msg('notification', { subscription: { type: 'channel.follow' }, event: { user_name: 'Dup' } });
    wsSock.write(frame(dup)); wsSock.write(frame(dup)); await sleep(300);
    assert.strictEqual(label('session_follower_count'), '2');
    ctl.abort();
    console.log('mock integration test passed');
  } catch (e) { console.error('FAILED:', e.message, '\n--- server output ---\n' + out); process.exitCode = 1; }
  app.kill(); mock.close(); setTimeout(() => process.exit(), 200);
})();
