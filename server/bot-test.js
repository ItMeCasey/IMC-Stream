// Drives the chat bot with simulated chat. Run: node bot-test.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert');
const createBot = require('./bot.js');

let T = Date.parse('2026-10-21T20:00:00Z'), R = 0.5;
let tipUrl = '', duelMs = 0; const duelCalls = []; const sent = [], modCalls = [], helixCalls = [], channelCalls = [];
const state = { stream: { live: true, startedAt: new Date(T - 3 * 3600e3).toISOString(), game: 'Tetris', title: 'Retro night', viewers: 12 }, totals: { followers: 100, subs: 5 }, recent: { followers: ['Fay', 'Gus'], subscribers: ['Hal'] }, ads: { nextAt: 0, running: false } };
const clipState = { calls: 0, fail: false };
const adCalls = [], customFires = [], mediaCalls = [], cdCalls = [], ttsCalls = [], alertCalls = [];
const ttsCfg = { on: true, command: { on: false, level: 'subscriber', cost: 0, userCd: 60 } };
const mediaState = { status: 'playing', title: 'Midnight City', artist: 'M83', album: 'Hurry Up', link: 'https://open.spotify.com/track/abc', volume: 40 };
const mediaCfg = { requests: false, requestLevel: 'everyone' };
let wordsIntro = 6000;
const bot = createBot({
  DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'icm-bot-')), log: (...a) => { if (process.env.V) console.log(...a); },
  get state() { return state; }, get wordsIntroMs() { return wordsIntro; }, now: () => T, rng: () => R, gapMs: 0, maxPer30s: 1e9, broadcast: (ev, d) => overlayEvents.push(d),
  me: () => ({ id: '1', login: 'itmecasey' }),
  send: async (text, replyTo, announce) => { sent.push({ text, replyTo, announce }); },
  mod: async (kind, body) => { modCalls.push([kind, body]); },
  searchCategories: async (q) => (/^doo/i.test(q) ? [{ id: '123', name: 'Doom' }, { id: '124', name: 'Doom Eternal' }] : q === 'zzz' ? [{ id: '5', name: 'Alpha' }, { id: '6', name: 'Beta' }] : /^gamma/.test(q) ? [{ id: '5', name: 'Alpha' }, { id: '6', name: 'Beta' }] : []),
  labelValue: (k) => ({ latest_follower: 'Ann', recent_followers: 'A\nB', session_bits: '650' })[k] ?? null,
  labelList: () => [{ name: 'latest_follower', desc: 'Newest follower' }, { name: 'session_bits', desc: 'Bits this stream' }],
  fireCustom: (key, vars, num) => customFires.push([key, vars, num]),
  createClip: async () => { clipState.calls++; if (clipState.fail) throw new Error('boom'); return { id: 'ClipID', url: 'https://clips.twitch.tv/ClipID' }; },
  tts: { cfg: () => ttsCfg, say: async (text, o) => { if (/blockedword/.test(text)) throw new Error('blocked'); if (/boom/.test(text)) throw new Error('engine failed'); ttsCalls.push(['say', text, o.by]); }, ctl: (a) => ttsCalls.push(['ctl', a]) },
  alertControl: (a) => alertCalls.push(a),
  countdown: { command: (a) => { cdCalls.push(a); return 'timer: ' + (a.join(' ') || 'status'); } },
  media: { view: () => mediaState, cfg: () => mediaCfg, control: async (a, x) => { if (a === 'next' && mediaCalls.fail) throw new Error('No media player is open'); mediaCalls.push([a, x]); },
    search: async (q) => (q === 'nothing' ? [] : [{ uri: 'spotify:track:found1', name: 'Found Song', artist: 'Band' }]), queue: async (u) => { mediaCalls.push(['queue', u]); } },
  runAd: async (len) => { if (len === 180 && adCalls.fail) throw new Error('Run ad: You must be live'); adCalls.push(['run', len]); },
  snoozeAd: async () => { adCalls.push(['snooze']); return { snoozes: 2, nextAt: T + 7 * 60000 }; },
  setChannel: async (o) => { channelCalls.push(o); if (o.title) state.stream.title = o.title; if (o.gameName) state.stream.game = o.gameName; },
  resolveUser: async (login) => 'id-' + login,
  tipLink: () => tipUrl,
  duel: (m) => { duelCalls.push(m); return duelMs; },
  subathon: { command: (a) => 'SUB:' + a.join(' '), rules: () => 'RULES' },
  emoteNames: () => ({ Kappa: 1, PogChamp: 1 }),
  helix: async (m, p, b) => {
    helixCalls.push([m, p, b]);
    if (p.startsWith('/channels/followers')) return { ok: true, json: { data: [{ followed_at: new Date(T - 400 * 86400e3).toISOString() }] } };
    if (p.startsWith('/users?')) return { ok: true, json: { data: [{ display_name: 'Zed', created_at: new Date(T - 800 * 86400e3).toISOString() }] } };
    if (p.startsWith('/channels?broadcaster_id=id-')) return { ok: true, json: { data: [{ broadcaster_name: 'CoolStreamer', game_name: 'Doom' }] } };
    return { ok: true, json: {} };
  },
  fetch: async (url) => ({ text: async () => 'fetched:' + url.split('/').pop() }),
  lookup: async () => [{ address: '93.184.216.34' }],   // pretend every name is a public address
  clientId: () => 'cid', ID_URL: () => 'x', HELIX: () => 'y',
});

const overlayEvents = [];
let n = 0;
const msg = (name, text, badges = []) => ({ message_id: 'm' + ++n, chatter_user_id: 'id-' + name.toLowerCase(), chatter_user_login: name.toLowerCase(), chatter_user_name: name,
  badges: badges.map((b) => ({ set_id: b, id: '1' })), message: { text, fragments: [{ type: 'text', text }] } });
const say = async (name, text, badges) => { const before = sent.length; await bot.onMessage(msg(name, text, badges)); await bot._flush(); return sent.slice(before).map((x) => x.text); };
const one = async (...a) => { const r = await say(...a); assert.strictEqual(r.length, 1, 'expected one reply to "' + a[1] + '", got ' + JSON.stringify(r)); return r[0]; };
const MOD = ['moderator'], SUB = ['subscriber'];

(async () => {
  // basics + cooldowns + replies thread to the triggering message
  assert.strictEqual(await one('Bob', '!lurk'), 'Bob is now lurking. Thanks for hanging out!');
  assert.strictEqual(sent[sent.length - 1].replyTo, 'm' + n);
  assert.deepStrictEqual(await say('Bob', '!lurk'), [], 'per-user cooldown');
  T += 20000;
  assert.strictEqual(await one('Bob', '!hug @Zed'), 'Bob gives Zed a big hug!');
  assert.deepStrictEqual(await say('Bob', 'just chatting'), []);
  assert.deepStrictEqual(await say('Bob', '!nosuchcommand'), []);

  // command management from chat (mods only), flags, variables
  assert.deepStrictEqual(await say('Bob', '!addcom hello hi'), [], 'non-mods cannot add');
  assert.match(await one('Mia', '!addcom hello Hello $(touser)! count=$(count) first=$(1) rnd=$(random 7 7) pick=$(pick x|x) deaths=$(counter deaths+)', MOD), /added !hello/);
  assert.strictEqual(await one('Bob', '!hello Sam extra'), 'Hello Sam! count=1 first=Sam rnd=7 pick=x deaths=1');
  T += 20000;
  assert.strictEqual(await one('Bob', '!hello'), 'Hello Bob! count=2 first= rnd=7 pick=x deaths=2');
  assert.match(await one('Mia', '!addcom -ul=moderator -cd=0 secret mod only', MOD), /added !secret/);
  assert.deepStrictEqual(await say('Bob', '!secret'), [], 'level restriction');
  assert.strictEqual(await one('Mia', '!secret', MOD), 'mod only');
  assert.match(await one('Mia', '!addcom hello again', MOD), /already exists/);
  assert.match(await one('Mia', '!addcom uptime x', MOD), /already exists/, 'built-in names are reserved');
  assert.match(await one('Mia', '!editcom hello Edited $(user)', MOD), /updated/);
  T += 20000; assert.strictEqual(await one('Bob', '!hello'), 'Edited Bob');
  assert.match(await one('Mia', '!delcom secret', MOD), /deleted/);
  assert.match(await one('Bob', '!commands'), /^Commands: !lurk, !hug, !socials, !hello/);
  assert.match(await one('Bob', '!uptime'), /^Live for 3h \d+m\.$/);
  assert.match(await one('Bob', '!followage'), /Bob has been following for 1y/);
  assert.match(await one('Bob', '!accountage Zed'), /Zed's account is 2y/);
  assert.strictEqual(await one('Bob', '!game'), 'Current game: Tetris');
  assert.deepStrictEqual(await say('Bob', '!game Doom'), [], 'only mods set the game');
  assert.strictEqual(await one('Mia', '!game Doom', MOD), 'Game changed to Doom.');
  assert.deepStrictEqual(channelCalls.pop(), { gameId: '123', gameName: 'Doom', art: undefined });
  assert.strictEqual(await one('Mia', '!setgame doo', MOD), 'Game changed to Doom.', 'prefix match picks the first result');
  channelCalls.length = 0;
  assert.match(await one('Mia', '!game gamma', MOD), /Not sure which you meant: Alpha, Beta/, 'ambiguous names list suggestions');
  assert.strictEqual(channelCalls.length, 0);
  assert.strictEqual(await one('Mia', '!game nothingmatches', MOD), 'No category found for "nothingmatches".');
  assert.strictEqual(await one('Mia', '!gamesearch zzz', MOD), 'Categories: Alpha | Beta');
  T += 10000; assert.strictEqual(await one('Bob', '!title'), 'Title: Retro night');
  T += 10000; assert.deepStrictEqual(await say('Bob', '!title hacked'), [], 'only mods set the title');
  assert.strictEqual(await one('Mia', '!title Speedrun attempt #3 | !socials', MOD), 'Title updated.');
  assert.deepStrictEqual(channelCalls.pop(), { title: 'Speedrun attempt #3 | !socials' });
  T += 10000; assert.strictEqual(await one('Bob', '!title'), 'Title: Speedrun attempt #3 | !socials');
  assert.match(await one('Mia', '!so CoolStreamer', MOD), /Go check out CoolStreamer - last playing Doom! https:\/\/twitch.tv\/coolstreamer/);
  assert.match(await one('Mia', '!addquote never gonna', MOD), /Added quote #1/);
  assert.match(await one('Bob', '!quote 1'), /^#1: never gonna \(2026-10-21\)$/);
  assert.strictEqual(await one('Mia', '!counter wins set 4', MOD), 'wins: 4');

  // ads
  assert.strictEqual(await one('Bob', '!nextad'), 'No ad break is scheduled.');
  state.ads.nextAt = T + 754000; T += 15000;
  assert.strictEqual(await one('Bob', '!nextad'), 'Next ad break in 12m 19s.');
  assert.deepStrictEqual(await say('Bob', '!ad 60'), [], 'only mods run ads');
  assert.strictEqual(await one('Mia', '!ad 55', MOD), 'Running a 60s ad break.', 'length snaps to an allowed value');
  assert.strictEqual(await one('Mia', '!ad', MOD), 'Running a 30s ad break.');
  adCalls.fail = true; assert.match(await one('Mia', '!ad 999', MOD), /Could not run the ad \(You must be live\)/); adCalls.fail = false;
  assert.match(await one('Mia', '!snooze', MOD), /Ad snoozed - next one in about 7 min\. Snoozes left: 2\./);
  assert.deepStrictEqual(adCalls.filter((c) => c[0] === 'run').map((c) => c[1]), [60, 30]);
  state.ads.running = true; T += 15000; assert.strictEqual(await one('Bob', '!nextad'), 'An ad break is running right now.'); state.ads.running = false;

  // urlfetch + time variables
  assert.strictEqual(await bot.expand('$(urlfetch https://x.test/answer)', { user: { id: 'a', name: 'A' }, args: [] }), 'fetched:answer');
  for (const bad of ['http://127.0.0.1:8420/api/diagnostics', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/']) assert.strictEqual(await bot.expand('$(urlfetch ' + bad + ')', { user: { id: 'a', name: 'A' }, args: [] }), '(fetch failed)', 'urlfetch never reaches ' + bad);

  // points: awarded per minute to recent chatters (x2 for subs), only while live
  bot.awardPoints();
  assert.strictEqual(bot.db().points['id-bob'].pts, 5);
  await say('Sue', 'hi there', SUB); bot.awardPoints();
  assert.strictEqual(bot.db().points['id-sue'].pts, 10);
  state.stream.live = false; bot.awardPoints(); assert.strictEqual(bot.db().points['id-sue'].pts, 10, 'no points while offline'); state.stream.live = true;
  assert.match(await one('Bob', '!points'), /Bob, you have 10 points \(rank #\d\)/);
  bot.db().points['id-bob'].pts = 100;

  // games (deterministic rng)
  T += 60000; R = 0.1;
  assert.match(await one('Bob', '!gamble 40'), /Bob won 40 points! You now have 140/);
  T += 60000; R = 0.9;
  assert.match(await one('Bob', '!gamble all'), /Bob lost 140 points\. You now have 0/);
  T += 10000; assert.match(await one('Bob', '!gamble 5'), /you only have 0 points/);
  bot.db().points['id-bob'].pts = 100; T += 60000; R = 0;
  assert.match(await one('Bob', '!slots 10'), /\[ 🍒 \| 🍒 \| 🍒 \] Bob wins 50! Balance: 150/);
  bot.db().points['id-bob'].pts = 100; bot.db().points['id-sue'].pts = 100;
  assert.match(await one('Bob', '!duel sue 30'), /sue, Bob challenges you to a duel for 30 points/);
  R = 0.3;
  assert.match(await one('Sue', '!accept'), /Bob wins the duel and takes 30 points from Sue/);
  assert.strictEqual(bot.db().points['id-bob'].pts, 130); assert.strictEqual(bot.db().points['id-sue'].pts, 70);
  // the pixel duel overlay: told who fights and who wins; with it on, the chat result waits until the fight is over
  assert.deepStrictEqual(duelCalls[0], { a: 'Bob', b: 'Sue', winner: 'a', amount: 30, currency: 'points' });
  duelMs = 60; bot.db().points['id-bob'].pts = 100; bot.db().points['id-sue'].pts = 100; T += 60000; assert.match(await one('Bob', '!duel sue 20'), /challenges you/); R = 0.7;
  { const before = sent.length; await bot.onMessage(msg('Sue', '!accept')); await bot._flush(); assert.strictEqual(sent.length, before, 'no spoiler while the fight plays'); await new Promise((r) => setTimeout(r, 120)); await bot._flush(); assert.match(sent[sent.length - 1].text, /Sue wins the duel and takes 20 points from Bob/); }
  assert.deepStrictEqual([duelCalls[1].winner, duelCalls[1].b], ['b', 'Sue']); assert.strictEqual(bot.db().points['id-sue'].pts, 120, 'points move straight away');
  duelMs = 0; bot.db().points['id-bob'].pts = 130; bot.db().points['id-sue'].pts = 70;
  assert.match(await one('Bob', '!give Sue 30'), /Bob gave 30 points to Sue\. \(Bob: 100, Sue: 100\)/);
  T += 10000; assert.match(await one('Bob', '!give bob 5'), /cannot give points to yourself/);
  T += 10000; assert.match(await one('Bob', '!give @Sue 99999'), /Bob, you only have 100 points/);
  T += 10000; assert.match(await one('Bob', '!give Sue'), /Usage: !give <user> <amount\|all>/);
  T += 10000; assert.match(await one('Bob', '!pay @Sue 10'), /Bob gave 10 points to Sue\. \(Bob: 90, Sue: 110\)/, '!pay and !send are aliases');
  T += 10000; assert.match(await one('Bob', '!send Sue all'), /Bob gave 90 points to Sue\. \(Bob: 0, Sue: 200\)/, '"all" gives the whole balance');
  T += 10000; assert.match(await one('Bob', '!give Sue 1'), /Bob, you only have 0 points/);
  bot.db().points['id-bob'].pts = 100; bot.db().points['id-sue'].pts = 100;
  assert.match(await one('Bob', '!top'), /^Top points: 1\. Bob \(100\) 2\. Sue \(100\)/);
  R = 0; assert.match(await one('Mia', '!trivia', MOD), /TRIVIA .*capital of Australia/);
  assert.strictEqual(await one('Sue', 'Canberra'), 'Sue got it! +100 points.');
  assert.strictEqual(bot.db().points['id-sue'].pts, 200);
  R = 0.5;
  assert.match(await one('Mia', '!raffle open', MOD), /RAFFLE OPEN/);
  await say('Bob', '!enter'); await say('Sue', '!enter');
  R = 0.99; assert.match(await one('Mia', '!draw', MOD), /winner is @Sue! \(2 entries\)/);
  assert.match(await one('Bob', '!8ball will I win'), /^🎱 /);
  R = 0.5; assert.match(await one('Bob', '!roll 2d6'), /Bob rolled \d \+ \d = \d+ \(d6\)/);

  // ---- currency: daily streaks, event bonuses, shop, admin tools
  const api = (a, b) => bot.api(a, b);
  const DAY = 86400000; T = Date.parse('2026-10-22T10:00:00Z');
  assert.match(await one('Dana', '!daily'), /Dana claimed 100 points \(day 1 streak\)! Balance: 100/);
  T += 3000; assert.match(await one('Dana', '!daily'), /already claimed/);
  T += DAY; assert.match(await one('Dana', '!daily'), /claimed 125 points \(day 2 streak\)! Balance: 225/);
  T += 3 * DAY; assert.match(await one('Dana', '!daily'), /claimed 100 points \(day 1 streak\)/, 'missing a day resets the streak');
  assert.strictEqual(bot.db().points['id-dana'].pts, 325);

  await api('settings', { enabled: true, prefix: '!', currency: 'points', bonuses: { follow: { on: true, amount: 50 }, giftsub: { on: true, amount: 10 }, bits: { on: true, amount: 7 }, raid: { on: true, amount: 100, perViewer: 5 } } });
  await bot.onEvent('follow', { name: 'Newbie', uid: 'id-newbie' }); await bot.onEvent('follow', { name: 'Newbie', uid: 'id-newbie' });
  assert.strictEqual(bot.db().points['id-newbie'].pts, 50, 'follow bonus is paid once per person');
  await bot.onEvent('giftsub', { name: 'Newbie', uid: 'id-newbie', total: 3 }); assert.strictEqual(bot.db().points['id-newbie'].pts, 80);
  await bot.onEvent('bits', { name: 'Newbie', uid: 'id-newbie', amount: 250 }); assert.strictEqual(bot.db().points['id-newbie'].pts, 94, '2 x 100 bits x 7');
  await bot.onEvent('raid', { name: 'Raider', uid: 'id-raider', viewers: 10 }); assert.strictEqual(bot.db().points['id-raider'].pts, 150);
  await bot.onEvent('sub', { name: 'Newbie', uid: 'id-newbie' }); assert.strictEqual(bot.db().points['id-newbie'].pts, 94, 'disabled bonuses pay nothing');
  await bot.onEvent('follow', { name: 'NoId' }); await bot._flush();

  await api('shop/save', { name: 'Hydrate', cost: 100, response: '$(user) says drink water! $(item) x$(1)', alertKey: 'Glug!', description: 'sip' });
  const outfit = await api('shop/save', { name: 'Pick my outfit', cost: 50, approval: true, stock: 1 });
  assert.strictEqual((await api('shop/save', { name: 'hydrate', cost: 5 }).catch((e) => e.message)), 'There is already an item called hydrate'.replace('hydrate', 'hydrate'));
  assert.strictEqual(await one('Bob', '!shop'), 'Shop: 1) Hydrate (100) 2) Pick my outfit (50) - redeem with !redeem <name or number>');
  assert.match(await one('Zero', '!redeem hydrate'), /Hydrate costs 100 points and you have 0/);
  const danaBefore = bot.db().points['id-dana'].pts;
  assert.strictEqual(await one('Dana', '!redeem hydrate sip sip'), 'Dana says drink water! Hydrate xsip');
  assert.strictEqual(bot.db().points['id-dana'].pts, danaBefore - 100);
  assert.deepStrictEqual(customFires.pop(), ['glug', { name: 'Dana', message: 'sip sip', amount: 100 }, 100]);   // fires your custom alert
  T += 3000;
  assert.match(await one('Dana', '!buy 2 blue shirt'), /Pick my outfit is waiting for approval \(#1\)/);
  assert.strictEqual(bot.db().shop[1].stock, 0);
  T += 3000; assert.strictEqual(await one('Dana', '!redeem 2'), 'Pick my outfit is out of stock.');
  assert.strictEqual(bot.view().pending.length, 1);
  assert.match(await one('Mia', '!deny 1', MOD), /Denied #1 and refunded Dana/);
  assert.strictEqual(bot.db().shop[1].stock, 1); assert.strictEqual(bot.db().points['id-dana'].pts, danaBefore - 100);
  T += 3000; await one('Dana', '!redeem pick my outfit red hat');
  assert.deepStrictEqual(await say('Mia', '!approve 2', MOD), ['Dana redeemed Pick my outfit!', 'Approved #2.']);
  assert.strictEqual(bot.db().pending.length, 0);
  assert.deepStrictEqual(await say('Dana', '!approve 9'), [], 'non-mods cannot approve');
  T += 10000; assert.match(await one('Bob', '!shop'), /^Shop:/);
  await assert.rejects(api('shop/save', { name: '', cost: 5 }), /needs a name/);
  assert.match((await api('viewers', { q: 'dan' }))[0].name, /Dana/);

  assert.match(await one('Mia', '!addpoints Dana 500', MOD), /Dana now has \d+ points/);
  assert.match(await one('Mia', '!removepoints Dana 999999', MOD), /Dana now has 0 points/, 'balances never go negative');
  assert.match(await one('Mia', '!setpoints Dana 1000', MOD), /Dana now has 1,000 points/);
  assert.deepStrictEqual(await say('Dana', '!addpoints Dana 5'), [], 'non-mods cannot add points');
  assert.match(await one('Mia', '!bonus 25', MOD), /Gave 25 points to \d+ active viewers?!/);
  assert.strictEqual(bot.db().points['id-dana'].pts, 1025);
  assert.match(await one('Bob', '!watchtime Sue'), /Sue has been active in chat for/);
  const L = bot.labels(); assert.match(L.currency_top.value, /^1\. Dana - 1,025/); assert.strictEqual(L.currency_richest_viewer.value, 'Dana - 1,025'); assert.strictEqual(L.latest_shop_redemption.value, 'Dana - Pick my outfit');
  const led = bot.view().ledger; assert.ok(led.some((x) => x.reason === 'shop: Hydrate' && x.delta === -100) && led.some((x) => x.reason === 'daily (day 1)' || /daily/.test(x.reason)) && led.some((x) => /bonus/.test(x.reason)));
  await api('settings', { enabled: true, prefix: '!', currency: 'coins' });
  assert.match(await one('Dana', '!coins'), /Dana, you have 1,025 coins/, 'the command named after your currency shows the balance');
  await api('settings', { enabled: true, prefix: '!', currency: 'points' });

  // ---- command builder: {variables}, tracked stats, custom variables, multi-line modes
  R = 0; state.stream.live = true;
  await api('var/save', { name: 'mood', type: 'list', items: 'happy\nsleepy' });
  await api('var/save', { name: 'discord', type: 'text', value: 'discord.gg/x' });
  await api('command/save', { name: 'info', response: 'Hi {name}! {points} pts #{rank} | {touser} | {1} | {args} | {latest_follower} | {recent_followers} | {session_bits} | {channel} | {game} | {math 2+3*4} | {random 5 5} | {pick x|x} | {var.mood} {var.discord} | {counter.hits+} {counter.hits} | {nope} | $(user) | {randomfollower} {randomsub} {quote}' });
  T += 60000;
  const info = await one('Bob', '!info Sam extra');
  assert.match(info, new RegExp('^Hi Bob! \\d+ pts #\\d+ \\| Sam \\| Sam \\| Sam extra \\| Ann \\| A, B \\| 650 \\| itmecasey \\| ' + state.stream.game.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\| 14 \\| 5 \\| x \\| happy discord.gg/x \\| 1 1 \\| \\{nope\\} \\| Bob \\| Fay Hal never gonna$'), info);
  await api('command/save', { name: 'who', response: 'pal: {randomname}' }); T += 60000;
  const who = await one('Bob', '!who'); assert.match(who, /^pal: [A-Za-z]+$/); assert.notStrictEqual(who, 'pal: Bob', '{randomname} never picks the person who typed it');

  // multi-line responses: all / random / rotate; required arguments; live-only
  await api('command/save', { name: 'multi', response: 'one\ntwo', mode: 'all' }); T += 60000;
  assert.deepStrictEqual(await say('Bob', '!multi'), ['one', 'two']);
  await api('command/save', { name: 'rnd', response: 'a\nb\nc', mode: 'random' }); R = 0.99; T += 60000;
  assert.deepStrictEqual(await say('Bob', '!rnd'), ['c']); R = 0;
  await api('command/save', { name: 'rot', response: 'x\ny', mode: 'rotate', cd: 0, userCd: 0 });
  assert.deepStrictEqual([await one('Bob', '!rot'), await one('Bob', '!rot'), await one('Bob', '!rot')], ['x', 'y', 'x']);
  await api('command/save', { name: 'greet', response: 'Hello {1}!', needArgs: 1, usage: 'Usage: !greet <name>', cd: 0, userCd: 0 });
  assert.strictEqual(await one('Bob', '!greet'), 'Usage: !greet <name>'); assert.strictEqual(await one('Bob', '!greet Zed'), 'Hello Zed!');
  await api('command/save', { name: 'liveonly', response: 'we are live', liveOnly: true, cd: 0, userCd: 0 });
  state.stream.live = false; assert.deepStrictEqual(await say('Bob', '!liveonly'), [], 'live-only commands stay silent offline'); state.stream.live = true;
  assert.strictEqual(await one('Bob', '!liveonly'), 'we are live');

  // preview trace + catalog for the builder palette
  const tr = await api('command/test', { response: 'Hi {name} {nope} {latest_follower}\nline two {var.mood}', args: 'x', user: 'Preview' });
  assert.deepStrictEqual([tr.text, tr.unknown], ['Hi Preview {nope} Ann\nline two happy', ['{nope}']]);
  assert.deepStrictEqual(tr.used.map((x) => [x.token, x.value]), [['{name}', 'Preview'], ['{latest_follower}', 'Ann'], ['{var.mood}', 'happy']]);
  const cat = await api('variables'), flat = Object.fromEntries(cat.flatMap((g) => g.items.map((i) => [i.token, i])));
  assert.ok(cat.some((g) => /Tracked stats/.test(g.group)) && flat['{latest_follower}'].value === 'Ann' && flat['{session_bits}'].desc === 'Bits this stream');
  assert.ok(flat['{var.mood}'] && flat['{var.discord}'].value === 'discord.gg/x' && flat['{counter.hits}'].value === 1 && flat['{randomname}'] && flat['{math 5*3+1}']);

  // managing variables from chat (mods) and the dashboard
  assert.deepStrictEqual(await say('Bob', '!setvar color blue'), [], 'non-mods cannot set variables');
  assert.match(await one('Mia', '!setvar color deep blue', MOD), /Variable \{var\.color\} set/);
  assert.match(await one('Mia', '!listadd mood grumpy', MOD), /Added to \{var\.mood\} \(3 items\)/);
  assert.strictEqual(await bot.expand('{var.color} / {var.nothing}', { user: { id: 'a', name: 'A' }, args: [] }), 'deep blue / {var.nothing}', 'unknown {names} stay as typed');
  assert.strictEqual(await bot.expand('$(var.nothing)|$(nothing)', { user: { id: 'a', name: 'A' }, args: [] }), '|', 'unknown $(names) become empty (old behaviour)');
  await api('counter/set', { name: 'hits', value: 41 }); assert.strictEqual(await bot.expand('{counter.hits+}', { user: { id: 'a', name: 'A' }, args: [] }), '42');
  await api('var/delete', { name: 'color' }); await api('counter/delete', { name: 'hits' });
  assert.ok(!bot.db().vars.color && bot.db().counters.hits === undefined);
  await assert.rejects(api('var/save', { name: '!!!', value: 'x' }), /needs a name/);

  // ---- !clip
  T += 200000; state.stream.live = true;
  assert.match(await one('Bob', '!clip'), /^Clip created! https:\/\/clips\.twitch\.tv\/ClipID/);
  T += 5000; assert.deepStrictEqual(await say('Sue', '!clip'), [], 'global cooldown');
  T += 200000; state.stream.live = false; assert.match(await one('Bob', '!clip'), /stream is offline/); state.stream.live = true;
  await api('settings', { enabled: true, prefix: '!', currency: 'points', clip: { on: true, level: 'subscriber' } });
  T += 200000; assert.match(await one('Bob', '!clip'), /Clips are for subscribers and above/);
  clipState.fail = true; T += 200000; assert.strictEqual(await one('Sue', '!clip', SUB), 'Could not create a clip (boom).'); clipState.fail = false;
  await api('settings', { enabled: true, prefix: '!', currency: 'points', clip: { on: false, level: 'everyone' } });
  T += 200000; assert.deepStrictEqual(await say('Bob', '!clip'), [], 'off = silent'); assert.strictEqual(clipState.calls, 2);
  await api('settings', { enabled: true, prefix: '!', currency: 'points', clip: { on: true, level: 'everyone' } });

  // ---- commands page for viewers
  await api('command/save', { name: 'discord', response: 'Join us at discord.gg/{channel}', desc: 'Our Discord server link', level: 'everyone' });
  await api('command/save', { name: 'secret', response: 'shh', hidden: true });
  ttsCfg.command = { on: true, level: 'subscriber', cost: 25, userCd: 60 };
  const ex = bot.exportCommands();
  assert.ok(ex.html.startsWith('<!doctype html>') && ex.html.includes('CHAT COMMANDS') && ex.html.includes('Our Discord server link') && ex.html.includes('!discord'), 'html page lists custom commands with their description');
  assert.ok(!ex.html.includes('!secret') && !ex.md.includes('!secret'), 'hidden commands are left out');
  assert.match(ex.md, /\*\*!lurk\*\* \(Everyone\): … is now lurking\. Thanks for hanging out!/, 'variables are shown as … when there is no description');
  assert.match(ex.md, /\*\*!tts <message>\*\* \(Subscribers\): Have your message read out loud on stream \(costs 25 points\)/);
  assert.ok(ex.groups['Mods & streamer'].length >= 25 && ex.groups['Mods & streamer'].every((r) => r[1] === 'Mods'), 'the mod commands are listed too'); for (const c of ['!addcom', '!permit <user>', '!words', '!wheel', '!ad <30-180>', '!approve', '!bonus']) assert.ok(ex.groups['Mods & streamer'].some((r) => r[0].startsWith(c)), c); assert.ok(/Mods & streamer/.test(ex.md) && ex.html.includes('Mods &amp; streamer') && ex.text.includes('addcom'), 'in the page, the markdown and the text'); assert.ok(ex.count >= 50);
  assert.match(ex.md, /\*\*!clip\*\* \(Everyone\)/); assert.match(ex.md, /\*\*!shop \/ !redeem <item>\*\* \(Everyone\): Spend points on rewards: .*Hydrate \(100\)/); assert.match(ex.md, /## Games/);
  assert.ok(ex.text.split('\n').includes('!discord - Our Discord server link') && ex.count > 15);
  ttsCfg.command.on = false; assert.ok(!bot.exportCommands().md.includes('!tts <message>'), 'features that are off are not advertised');
  await api('command/delete', { id: bot.db().commands.find((c) => c.name === 'discord').id }); await api('command/delete', { id: bot.db().commands.find((c) => c.name === 'secret').id });

  // ---- text-to-speech chat command + alert controls
  T += 60000;
  assert.strictEqual(await one('Sue', '!tts hello there', SUB), 'Text-to-speech is off right now.');
  ttsCfg.command = { on: true, level: 'subscriber', cost: 50, userCd: 60 };
  T += 5000;
  assert.match(await one('Bob', '!tts hello'), /Text-to-speech is for subscribers and above/);
  bot.db().points['id-sue'] = { name: 'Sue', pts: 120, mins: 0 };
  T += 5000;
  assert.match(await one('Sue', '!tts', SUB), /^Usage: !tts <what you want read out> \(costs 50 points\)$/);
  T += 5000;
  assert.deepStrictEqual(await say('Sue', '!tts hello there', SUB), []); assert.deepStrictEqual(ttsCalls.pop(), ['say', 'hello there', 'Sue']); assert.strictEqual(bot.db().points['id-sue'].pts, 70, 'costs currency');
  T += 10000; assert.match(await one('Sue', '!tts again', SUB), /please wait a bit/); assert.strictEqual(bot.db().points['id-sue'].pts, 70, 'no charge while on cooldown');
  T += 120000; assert.match(await one('Sue', '!tts this is a blockedword', SUB), /that message is not allowed/); assert.strictEqual(bot.db().points['id-sue'].pts, 70, 'a blocked message is refunded');
  T += 120000; assert.match(await one('Sue', '!tts boom', SUB), /Could not read that out \(engine failed\)/); assert.strictEqual(bot.db().points['id-sue'].pts, 70);
  T += 120000; bot.db().points['id-sue'].pts = 10; assert.match(await one('Sue', '!tts cheap', SUB), /costs 50 points and you have 10/);
  T += 5000;
  assert.deepStrictEqual(await say('Mia', '!tts mods are free', MOD), []); assert.deepStrictEqual(ttsCalls.pop(), ['say', 'mods are free', 'Mia']);
  T += 5000;
  assert.strictEqual(await one('Mia', '!ttsskip', MOD), 'Skipped the speech.'); assert.deepStrictEqual(ttsCalls.pop(), ['ctl', 'skip']);
  // ---- !commands and !tts can be edited: what they say, the other names they answer to
  state.site = { lastUrl: 'https://itmecasey.pages.dev' };
  await api('builtin/save', { commands: { reply: 'Everything is at {website} ({prefix}help) - {list}', aliases: '!cmds, help' }, tts: { usage: 'Say what you want: {prefix}tts <message>{cost}', queued: '{user}, it is queued!', blocked: '{user}, nope.', aliases: 'say' } });
  T += 20000; assert.match(await one('Bob', '!commands'), /^Everything is at https:\/\/itmecasey\.pages\.dev \(!help\) - .*!points/); T += 20000; assert.match(await one('Bob', '!cmds'), /^Everything is at https:\/\/itmecasey\.pages\.dev/, 'another name does the same'); T += 20000; assert.match(await one('Bob', '!help'), /^Everything is at/);
  await assert.rejects(api('builtin/save', { commands: { aliases: 'points' } }), /!points is already used/); await assert.rejects(api('builtin/save', { tts: { aliases: 'a1 a2 a3 a4 a5 a6' } }), /At most 5/);
  assert.deepStrictEqual(bot.view().builtinEdits.commands.aliases, ['cmds', 'help'], 'a failed save changes nothing'); assert.ok(bot.exportCommands().md.includes('!tts <message> (!say)'), 'the other name is on the commands page');
  assert.strictEqual(await one('Sue', '!say', SUB), 'Say what you want: !tts <message> (costs 50 points)'); bot.db().points['id-sue'].pts = 200; T += 120000;
  assert.strictEqual(await one('Sue', '!say hello again', SUB), 'Sue, it is queued!'); assert.deepStrictEqual(ttsCalls.pop(), ['say', 'hello again', 'Sue']);
  T += 120000; assert.strictEqual(await one('Sue', '!tts this is a blockedword', SUB), 'Sue, nope.');
  await api('builtin/save', { commands: { reply: '', aliases: '', cd: 0 }, tts: { usage: '', queued: '', blocked: '', aliases: '' } }); T += 20000; assert.match(await one('Bob', '!commands'), /^Commands: !/, 'an empty reply falls back to the default'); assert.deepStrictEqual(bot.view().builtinEdits.commands.aliases, []);
  ttsCfg.command.on = false;
  assert.deepStrictEqual(await say('Bob', '!alerts pause'), [], 'only mods control alerts');
  for (const [cmd, want] of [['pause', /paused/], ['resume', /resumed/], ['skip', /Skipped the current alert/], ['clear', /Cleared/], ['mute', /muted/], ['unmute', /back on/]]) { T += 5000; assert.match(await one('Mia', '!alerts ' + cmd, MOD), want); }
  assert.deepStrictEqual(alertCalls, ['pause', 'resume', 'skip', 'clear', 'mute', 'unmute']);
  T += 5000; assert.match(await one('Mia', '!alerts dance', MOD), /Usage: !alerts pause\|resume/);

  // ---- countdown timer chat commands
  T += 60000;
  assert.deepStrictEqual(await say('Bob', '!countdown 10'), [], 'only mods control the timer');
  assert.strictEqual(await one('Mia', '!countdown 10', MOD), 'timer: 10'); T += 5000;
  assert.strictEqual(await one('Mia', '!countdown +5', MOD), 'timer: +5'); T += 5000;
  assert.strictEqual(await one('Bob', '!timeleft'), 'timer: status');
  assert.deepStrictEqual(cdCalls, [['10'], ['+5'], []]);

  // ---- music: !song, mod controls, song requests
  T += 60000;
  assert.strictEqual(await one('Bob', '!song'), 'Now playing: Midnight City by M83 (Hurry Up) https://open.spotify.com/track/abc');
  mediaState.status = 'paused'; T += 20000; assert.match(await one('Bob', '!song'), /^Paused: Midnight City/); mediaState.status = 'playing';
  mediaState.title = ''; mediaState.status = 'none'; T += 20000; assert.strictEqual(await one('Bob', '!song'), 'Nothing is playing right now.'); mediaState.title = 'Midnight City'; mediaState.status = 'playing';
  assert.deepStrictEqual(await say('Bob', '!skip'), [], 'only mods control the music');
  assert.strictEqual(await one('Mia', '!skip', MOD), 'Skipped.'); T += 10000;
  assert.strictEqual(await one('Mia', '!pause', MOD), 'Music paused.'); T += 10000;
  assert.strictEqual(await one('Mia', '!play', MOD), 'Music playing.'); T += 10000;
  assert.strictEqual(await one('Mia', '!previous', MOD), 'Going back a track.'); T += 10000;
  mediaCalls.fail = true; assert.match(await one('Mia', '!skip', MOD), /Could not skip \(No media player is open\)/); mediaCalls.fail = false; T += 10000;
  assert.strictEqual(await one('Mia', '!volume', MOD), 'Volume: 40%'); T += 10000;
  assert.strictEqual(await one('Mia', '!volume 65', MOD), 'Volume set to 65%.'); T += 10000;
  assert.match(await one('Mia', '!volume 500', MOD), /Usage: !volume <0-100>/);
  assert.deepStrictEqual(mediaCalls.map((c) => c[0] + (c[1] != null ? ':' + c[1] : '')), ['next', 'pause', 'play', 'previous', 'volume:65']);
  assert.strictEqual(await one('Bob', '!sr some song'), 'Song requests are off right now.');
  mediaCfg.requests = true; mediaCfg.requestLevel = 'subscriber'; T += 60000;
  assert.match(await one('Bob', '!sr some song'), /Song requests are for subscribers and above/);
  T += 60000; assert.strictEqual(await one('Sue', '!sr found it', SUB), 'Queued: Found Song by Band (requested by Sue).'); assert.deepStrictEqual(mediaCalls.pop(), ['queue', 'spotify:track:found1']);
  T += 60000; assert.match(await one('Sue', '!songrequest https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x', SUB), /Queued: your song/); assert.deepStrictEqual(mediaCalls.pop(), ['queue', 'spotify:track:4uLU6hMCjMI75M1A2tKUQC']);
  T += 60000; assert.strictEqual(await one('Sue', '!sr nothing', SUB), 'No songs found for "nothing".');
  T += 60000; assert.deepStrictEqual(await say('Sue', '!sr', SUB), ['Usage: !sr <song name or Spotify link>']);
  mediaCfg.requests = false;

  // ---- announcements (highlighted chat messages)
  await api('command/save', { name: 'rules', response: 'Be kind to each other!\nNo spoilers please.', announce: 'green', cd: 0, userCd: 0 });
  const bAnn = sent.length; assert.deepStrictEqual(await say('Bob', '!rules'), ['Be kind to each other!', 'No spoilers please.']);
  assert.deepStrictEqual(sent.slice(bAnn).map((m) => [m.announce, m.replyTo]), [['green', undefined], ['green', undefined]], 'announcements are not replies');
  await api('command/save', { name: 'plain', response: 'regular', announce: 'bogus', cd: 0, userCd: 0 });
  await say('Bob', '!plain'); assert.strictEqual(sent[sent.length - 1].announce, '', 'unknown styles fall back to a normal message');
  assert.match(await bot.api('command/save', { name: 'plain', id: bot.db().commands.find((c) => c.name === 'plain').id, response: 'regular', announce: 'blue' }).then((c) => c.announce), /blue/);
  assert.deepStrictEqual(await say('Bob', '!announce hello'), [], 'only mods can announce');
  let nb = sent.length; await say('Mia', '!announce orange Server restarts in 5 minutes', MOD);
  assert.deepStrictEqual([sent[nb].text, sent[nb].announce], ['Server restarts in 5 minutes', 'orange']);
  nb = sent.length; await say('Mia', '!announce Plain default colour', MOD); assert.deepStrictEqual([sent[nb].text, sent[nb].announce], ['Plain default colour', 'primary']);
  nb = sent.length; assert.match(await one('Mia', '!announce', MOD), /Usage: !announce \[primary\|blue\|green\|orange\|purple\] <message>/);
  await api('timer/save', { name: 'Ann timer', message: 'Join the Discord!', minutes: 1, minLines: 0, enabled: true, onlyLive: false, announce: 'purple' });
  await bot.tick(); T += 61000; nb = sent.length; await bot.tick(); await bot._flush();
  assert.ok(sent.slice(nb).some((m) => m.text === 'Join the Discord!' && m.announce === 'purple'), 'timers can post announcements');
  await api('timer/delete', { id: bot.db().timers.find((x) => x.name === 'Ann timer').id });
  await api('events', { raid: { on: true, msg: 'Welcome raiders from {name}!', announce: 'blue' } });
  nb = sent.length; await bot.onEvent('raid', { name: 'Zed', viewers: 3 }); await bot._flush();
  assert.deepStrictEqual([sent[nb].text, sent[nb].announce], ['Welcome raiders from Zed!', 'blue']);
  await api('events', { raid: { on: false, msg: 'x' } });
  assert.strictEqual((await api('say', { message: 'Hello from the dashboard', announce: 'primary' })).ok, true); await bot._flush();
  assert.deepStrictEqual([sent[sent.length - 1].text, sent[sent.length - 1].announce], ['Hello from the dashboard', 'primary']);

  // spam filters
  const F = JSON.parse(JSON.stringify(bot.db().filters));
  F.links.on = true; F.caps.on = true; F.blacklist.on = true; F.blacklist.words = ['badword', '/free\\s+v-?bucks/']; F.emotes.on = true; F.emotes.max = 2; F.repeat.on = true;
  await api('filters', F);
  modCalls.length = 0;
  assert.deepStrictEqual(await say('Troll', 'check out cool-site.com now'), ['Troll, please ask before posting links.']);
  assert.deepStrictEqual(modCalls.pop(), ['timeout', { userId: 'id-troll', seconds: 10, reason: 'Bot: links' }]);
  await say('Troll', 'again www.spam.net');
  assert.strictEqual(modCalls.pop()[1].seconds, 20, 'escalating timeout');
  await say('Troll', 'https://clips.twitch.tv/abc');            // whitelisted domain
  assert.strictEqual(modCalls.length, 0);
  await say('Troll', 'visit cool.com', SUB); assert.strictEqual(modCalls.length, 0, 'subscribers are exempt from the link filter');
  await say('Mia', '!permit Pat', MOD); await say('Pat', 'my site pat.com'); assert.strictEqual(modCalls.length, 0, 'permitted user may post a link');
  await say('Troll', 'THIS IS A VERY LOUD MESSAGE HERE'); assert.deepStrictEqual(modCalls.pop(), ['delete', { messageId: 'm' + n }]);
  await say('Troll', 'you are a BadWord'); assert.strictEqual(modCalls.pop()[0], 'timeout');
  await say('Troll', 'free v-bucks here'); assert.strictEqual(modCalls.pop()[0], 'timeout');
  await say('Troll', 'Kappa PogChamp Kappa'); assert.strictEqual(modCalls.pop()[0], 'delete');
  await say('Troll', 'aaaaaaaaaaaaaaaaaaaaaaaa'); assert.strictEqual(modCalls.pop()[0], 'delete');
  await say('Troll', 'normal sentence here'); assert.strictEqual(modCalls.length, 0);
  assert.strictEqual(sent.some((m) => m.text.includes('please ask before posting links')), true, 'filter warning message sent');

  // timers + event messages
  await api('timer/save', { name: 'Hydrate', message: 'Drink water! ($(game))', minutes: 1, minLines: 0, enabled: true, onlyLive: true });
  bot.tick(); T += 61000;
  let before = sent.length; await bot.tick(); await bot._flush();
  assert.strictEqual(sent.slice(before)[0].text, 'Drink water! (Doom)');
  state.stream.live = false; T += 61000; before = sent.length; await bot.tick(); await bot._flush(); assert.strictEqual(sent.length, before, 'onlyLive timers stay quiet offline');
  state.stream.live = true;
  before = sent.length; await bot.onEvent('follow', { name: 'Ann' }); await bot._flush(); assert.strictEqual(sent.length, before, 'event messages are off by default');
  await api('events', { follow: { on: true, msg: 'Thanks for the follow, $(user)!' }, raid: { on: true, msg: 'Raid from $(user) with $(viewers)!' } });
  before = sent.length; await bot.onEvent('follow', { name: 'Ann' }); await bot.onEvent('raid', { name: 'Zed', viewers: 9 }); await bot._flush();
  assert.deepStrictEqual(sent.slice(before).map((x) => x.text), ['Thanks for the follow, Ann!', 'Raid from Zed with 9!']);

  // the bot ignores its own echoed messages, but not a real command typed by the broadcaster
  const last = sent[sent.length - 1].text;
  before = sent.length; await bot.onMessage(Object.assign(msg('ItMeCasey', last), { chatter_user_id: '1' })); await bot._flush(); assert.strictEqual(sent.length, before);
  assert.strictEqual(await one('ItMeCasey', '!lurk', ['broadcaster']), 'ItMeCasey is now lurking. Thanks for hanging out!');   // broadcaster bypasses cooldowns

  // dashboard API validation
  await assert.rejects(api('command/save', { name: 'trivia', response: 'x' }), /built-in/);
  await assert.rejects(api('command/save', { name: 'ok', response: '' }), /empty/);
  const c = await api('command/save', { name: '!Discord', aliases: '!dc, disc', response: 'discord.gg/x', level: 'subscriber' });
  assert.deepStrictEqual([c.name, c.aliases, c.level], ['discord', ['dc', 'disc'], 'subscriber']);
  T += 60000; assert.deepStrictEqual(await say('Bob', '!dc'), [], 'subscriber-only');
  assert.strictEqual(await one('Sue', '!dc', SUB), 'discord.gg/x');
  assert.strictEqual((await api('command/test', { response: 'Hi $(user) $(1)', args: 'there' })).text, 'Hi TestViewer there');
  // tips
  T += 60000; assert.strictEqual(await one('Bob', '!tip'), 'Tips are not set up yet.'); tipUrl = 'https://tips.example.workers.dev/'; T += 60000;
  assert.match(await one('Bob', '!tip'), /leave a tip here: https:\/\/tips\.example\.workers\.dev\//); T += 60000; assert.strictEqual(await one('Sue', '!paypal'), 'PayPal: https://tips.example.workers.dev/');
  // subathon commands: everyone sees time and rules, only mods change it
  T += 30000; assert.strictEqual(await one('Bob', '!subathon'), 'SUB:'); T += 30000; assert.strictEqual(await one('Bob', '!subathon rules'), 'SUB:rules'); T += 30000;
  assert.strictEqual(await one('Bob', '!subathon start 6h'), 'Only mods can change the subathon timer.'); T += 30000; assert.strictEqual(await one('Mia', '!subathon start 6h', MOD), 'SUB:start 6h'); T += 30000; assert.strictEqual(await one('Bob', '!subrules'), 'RULES');
  // names typed with a leading @ (clients and add-ons add it) or a trailing comma work everywhere
  bot.db().points['id-bob'].pts = 100; bot.db().points['id-sue'].pts = 100; T += 60000;
  assert.match(await one('Bob', '!duel @Sue, 10'), /sue, Bob challenges you to a duel for 10 points/); R = 0.3; assert.match(await one('Sue', '!accept'), /Bob wins the duel/); bot.db().points['id-bob'].pts = 100; bot.db().points['id-sue'].pts = 100;
  T += 60000; assert.match(await one('Bob', '!give @@Sue, 5'), /Bob gave 5 points to Sue/); T += 60000; assert.match(await one('Bob', '!points @Sue'), /Sue has 105/); assert.match(await one('Mia', '!addpoints @sue 5', MOD), /Sue|sue/i);
  assert.strictEqual((await api('viewers', { q: '@su' })).length >= 1, true); await api('points/adjust', { name: '@Sue', amount: 1, mode: 'remove' });
  bot.db().points['id-bob'].pts = 100; bot.db().points['id-sue'].pts = 100;
  // duelling the bot: under the points line, once a day, it always accepts, and it never pays more than the cap
  { const D0 = Date.UTC(2027, 5, 10, 18, 0, 0); T = D0; const bp = (n, v) => { bot.db().points['id-' + n] = Object.assign(bot.db().points['id-' + n] || { name: n[0].toUpperCase() + n.slice(1), mins: 0 }, { pts: v }); };
    bp('bob', 200); R = 0.3; const calls0 = duelCalls.length;
    assert.match(await one('Bob', '!duel bot 50'), /Bob beat the bot and wins 50 points!/); assert.strictEqual(bot.db().points['id-bob'].pts, 250);
    assert.deepStrictEqual([duelCalls[calls0].a, duelCalls[calls0].b, duelCalls[calls0].winner, duelCalls[calls0].amount], ['Bob', 'ChatBot', 'a', 50], 'the overlay is told: Bob vs the bot');
    T += 20000; assert.match(await one('Bob', '!duel @bot 50'), /already dueled the bot today/); assert.strictEqual(bot.db().points['id-bob'].pts, 250, 'second try changes nothing');
    T = D0 + 86400000; R = 0.9; assert.match(await one('Bob', '!duel bot 80'), /The bot beat Bob and takes 80 points/); assert.strictEqual(bot.db().points['id-bob'].pts, 170, 'a new day, a new duel');
    bp('rich', 1500); T += 60000; assert.match(await one('Rich', '!duel bot 10'), /only duels chatters under 1,000 points/);
    bp('pat', 40); T += 60000; R = 0.3; assert.match(await one('Pat', '!duel bot 500'), /Pat beat the bot and wins 40 points!/); assert.strictEqual(bot.db().points['id-pat'].pts, 80, 'the stake can never be more than they own');
    bp('zed', 0); T += 60000; R = 0.9; assert.match(await one('Zed', '!duel bot'), /lost to the bot, but it was on the house/); assert.strictEqual(bot.db().points['id-zed'].pts, 0, 'broke chatters cannot lose anything');
    bp('amy', 0); T += 60000; R = 0.1; assert.match(await one('Amy', '!duel bot'), /Amy beat the bot \(on the house\) and wins 50 points!/); assert.strictEqual(bot.db().points['id-amy'].pts, 50);
    await api('games/settings', { botDuel: { on: true, below: 1000, house: 50, maxWin: 30 } }); bp('lou', 900); T += 60000; R = 0.1; assert.match(await one('Lou', '!duel bot 400'), /wins 30 points/); assert.strictEqual(bot.db().points['id-lou'].pts, 930, 'the bot pays at most its cap');
    await api('games/settings', { botDuel: { on: false, below: 1000, house: 50, maxWin: 1000 } }); bp('ann', 10); T += 60000; assert.match(await one('Ann', '!duel bot 5'), /not taking duels/); await api('games/settings', { botDuel: { on: true, below: 1000, house: 50, maxWin: 1000 } }); }
  bot.db().points['id-bob'].pts = 100; bot.db().points['id-sue'].pts = 100; T += 60000;
  // games you build + switching built-in games off
  await assert.rejects(bot.api('game/save', { name: 'x', command: 'gamble', outcomes: [{ weight: 1, payout: 1 }] }), /already used/); await assert.rejects(bot.api('game/save', { name: 'x', command: 'fish', outcomes: [] }), /at least one/);
  const fish = await api('game/save', { name: 'Go Fishing', command: '!Fish', cost: 10, cooldown: 0, outcomes: [{ weight: 1, payout: 0, text: '{user} caught old boots. {net} {currency}' }, { weight: 1, payout: 40, text: '{user} reeled in a big one! {net} {currency}, balance {balance}' }] });
  assert.strictEqual(fish.command, 'fish'); assert.deepStrictEqual([fish.odds.rows, fish.odds.ev, fish.odds.rtp], [[50, 50], 20, 200]);
  bot.db().points['id-bob'].pts = 100; T += 60000; R = 0.1; assert.strictEqual(await one('Bob', '!fish'), 'Bob caught old boots. -10 points'); assert.strictEqual(bot.db().points['id-bob'].pts, 90);
  R = 0.9; assert.strictEqual(await one('Bob', '!fish'), 'Bob reeled in a big one! +30 points, balance 120'); assert.strictEqual(bot.db().points['id-bob'].pts, 120);
  bot.db().points['id-bob'].pts = 5; assert.match(await one('Bob', '!fish'), /costs 10 points and you have 5/); assert.strictEqual(bot.db().points['id-bob'].pts, 5, 'nothing charged when broke');
  assert.deepStrictEqual([bot.view().games.custom[0].plays, bot.view().games.custom[0].paidIn, bot.view().games.custom[0].paidOut], [2, 20, 40], 'stats are kept');
  assert.ok((await api('game/try', { name: 'T', outcomes: [{ weight: 1, payout: 5, text: 'won {payout}' }] })).text === 'won 5', 'try it charges nothing');
  await api('games/toggle', { id: 'flip', on: false }); T += 60000; assert.deepStrictEqual(await say('Bob', '!flip'), [], 'a game that is off does not answer'); await api('games/toggle', { id: 'flip', on: true }); T += 60000; assert.strictEqual((await say('Bob', '!flip')).length, 1);
  await api('games/settings', { gambleWin: 60, maxBet: 50 }); assert.deepStrictEqual([bot.db().games.gambleWin, bot.db().games.maxBet], [0.6, 50]); await api('games/settings', { gambleWin: 45, maxBet: 0 });
  await api('game/delete', { id: fish.id }); assert.deepStrictEqual(await say('Bob', '!fish'), []);
  // chat extras: welcome first-timers, regulars, raid shout-out
  T += 60000; assert.deepStrictEqual(await say('Newbie', 'hi all'), [], 'off by default');
  await api('extras', { welcome: { on: true, msg: 'Welcome $(user)!', onlyLive: true }, raidShout: { on: true }, regulars: { on: true, minutes: 0, messages: 3 } });
  assert.deepStrictEqual(await say('Newbie', 'hi again'), [], 'already known, so not welcomed');
  assert.strictEqual(await one('Fresh', 'hello'), 'Welcome Fresh!'); assert.deepStrictEqual(await say('Fresh', 'hello 2'), [], 'only once');
  state.stream.live = false; assert.deepStrictEqual(await say('Ghost', 'hello'), [], 'not while offline (onlyLive)'); state.stream.live = true;
  assert.deepStrictEqual(await say('Nightbot', 'beep'), [], 'other bots are not welcomed');
  await api('command/save', { name: 'subonly', response: 'hello sub', level: 'subscriber', cd: 0, userCd: 0 });
  assert.deepStrictEqual(await say('Regular1', '!subonly'), ['Welcome Regular1!'], 'welcomed, but the command stays subscriber-only');
  await say('Regular1', 'a'); await say('Regular1', 'b');
  assert.strictEqual(await one('Regular1', '!subonly'), 'hello sub', 'after 3 messages they count as a regular');
  const sentBefore = sent.length; await bot.onEvent('raid', { name: 'CoolStreamer', viewers: 10, uid: 'id-coolstreamer' }); await new Promise((r) => setTimeout(r, 50)); await bot._flush();
  assert.ok(sent.slice(sentBefore).some((x) => /Go check out CoolStreamer/.test(x.text)), 'raid triggers a shout-out');
  assert.ok(helixCalls.some((c) => /shoutouts\?from_broadcaster_id=1&to_broadcaster_id=id-coolstreamer/.test(c[1])), 'and the Twitch shoutout');
  assert.strictEqual(bot.view().settings.extras.regulars.messages, 3);
  // spin the wheel: viewers cannot start it, mods and the streamer can
  const spins = () => overlayEvents.filter((e) => e.type === 'wheel:spin');
  for (const [who, b] of [['Viewer', []], ['Sub', SUB], ['Mod', MOD], ['ItMeCasey', ['broadcaster']]]) await say(who, 'hi', b);   // first messages (welcome replies) out of the way
  assert.deepStrictEqual(await say('Viewer', '!wheel a, b, c'), [], 'a viewer cannot start the wheel'); assert.deepStrictEqual(await say('Sub', '!spin x | y', SUB), [], 'nor a subscriber'); assert.equal(spins().length, 0);
  assert.deepStrictEqual(await say('Mod', '!wheel pizza, tacos | sushi', MOD), []); assert.deepStrictEqual(spins()[0].options, ['pizza', 'tacos', 'sushi']);
  assert.strictEqual(await one('Mod', '!wheel', MOD), 'The wheel is already spinning.');
  assert.strictEqual(await one('Mod', '!wheel stop', MOD), 'Wheel stopped.'); assert.equal(overlayEvents[overlayEvents.length - 1].type, 'stop');
  await api('wheel/save', { title: 'Next game', options: ['Doom', 'Quake', 'Duke'] }); assert.deepStrictEqual(await say('ItMeCasey', '!wheel', ['broadcaster']), []);
  assert.equal(spins()[1].title, 'Next game'); assert.deepStrictEqual(spins()[1].options, ['Doom', 'Quake', 'Duke']); await api('wheel/stop');
  assert.strictEqual(await one('Mod', '!wheel only', MOD), 'The wheel needs at least 2 options.');
  await assert.rejects(api('wheel/spin', { options: ['solo'] }), /at least 2/);

  // word rush: only mods and the streamer start it; the page can start, skip and stop it; settings are kept
  const wordsEv = () => overlayEvents.filter((e) => e.type === 'state');
  assert.deepStrictEqual(await say('Viewer', '!words'), [], 'a viewer cannot start words'); assert.deepStrictEqual(await say('Sub', '!words 3', SUB), [], 'nor a subscriber'); assert.equal(wordsEv().length, 0);
  const wsay = await say('Mod', '!words 2', MOD); assert(wsay.some((m) => /WORD RUSH/.test(m)) && wsay.some((m) => /2 rounds/.test(m)), wsay.join('|')); assert.equal(wordsEv().pop().s.phase, 'intro');
  assert.strictEqual(await one('Mod', '!words', MOD), 'Word Rush is already running.');
  assert.strictEqual(await one('Mod', '!words skip', MOD), 'There is no round running.');
  // a word typed in chat while a round runs earns points, and the round's points are paid out when it ends
  assert.strictEqual(await one('Mod', '!words stop', MOD), 'Word Rush stopped.'); assert.equal(wordsEv().pop().s.phase, 'idle'); wordsIntro = 20; await api('words/start', { silent: true, rounds: 1 }); await new Promise((r) => setTimeout(r, 120));
  const rs = (await api('words/state')); assert.equal(rs.phase, 'round'); const ans = require('./words')({}).answersFor(rs.letters.toLowerCase()), pick = ans.find((w) => w.length === 4) || ans[0];
  const bal = () => (bot.db().points['id-viewer'] || { pts: 0 }).pts, b0 = bal();
  assert.deepStrictEqual(await say('Viewer', pick), [], 'a word is not a command and gets no reply'); assert.equal((await api('words/state')).found, 1, 'the word counted'); assert.deepStrictEqual(await say('Mod', pick, MOD), [], 'the second finder gets nothing');
  assert.equal((await api('words/state')).recent[0].name, 'Viewer'); await api('words/skip'); assert.equal(bal() - b0, pick.length * 2, 'the points are paid out after the round'); await api('words/stop');
  const wst = await api('words/stats'); const me = wst.top.find((p) => p.name === 'Viewer'); assert(me && me.pts === pick.length * 2 && me.words === 1 && me.best === 1, 'all-time points and best round are kept per chatter'); assert.equal(wst.record.round, 0, 'a failed round sets no record');
  assert.match(await one('Mod', '!wordtop', MOD), /Word Rush all-time: 1\. Viewer \d+/); assert.match(await one('Viewer', '!wordtop'), /Word Rush all-time/, 'everyone can look at the board');
  assert.strictEqual(await one('Mod', '!words stop', MOD), 'Word Rush is not running.');
  assert.equal((await api('words/settings', { rounds: 500, seconds: 5, letters: 7, mvp: -3, beat: 5 })).rounds, 99); assert.deepStrictEqual(bot.view().settings.games.words, { rounds: 99, seconds: 30, letters: 7, perLetter: 2, pangram: 25, mvp: 0, beat: 10 });
  await api('words/settings', { rounds: 0, seconds: 90, letters: 6, mvp: 25, beat: 50 }); assert.equal((await api('words/start', { silent: true })).ok, true); await assert.rejects(api('words/start', {}), /already running/); assert.equal((await api('words/state')).phase, 'intro'); await api('words/stop');

  await api('settings', { enabled: false, prefix: '!', currency: 'coins' });
  assert.deepStrictEqual(await say('Bob', '!lurk'), [], 'bot disabled');
  assert.strictEqual(bot.view().settings.currency, 'coins');
  console.log('bot test passed (' + sent.length + ' simulated replies)');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message, '\n', e.stack.split('\n').slice(1, 4).join('\n')); process.exit(1); });
