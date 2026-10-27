'use strict';
/**
 * Chat bot for IMC-Stream (Nightbot-style): custom commands with $(variables), timers,
 * spam filters, loyalty points + chat games, quotes, counters, event messages.
 * Reads chat from the server's EventSub feed and replies through Helix (as you, or as an optional bot account).
 */
const fs = require('node:fs');
const path = require('node:path');

// permission levels, lowest to highest; a chatter's rank (0-4) is an index into this list.
const LEVELS = ['everyone', 'subscriber', 'vip', 'moderator', 'broadcaster'];
const ANN_COLORS = ['primary', 'blue', 'green', 'orange', 'purple'];   // Twitch highlighted chat announcements
const annColor = (v) => (ANN_COLORS.includes(v) ? v : '');
// names the built-in !commands use, so custom commands cannot take them.
const BUILTIN = ['commands', 'addcom', 'editcom', 'delcom', 'uptime', 'game', 'title', 'followage', 'accountage', 'so', 'permit', 'quote', 'daily',
  'shop', 'redeem', 'buy', 'send', 'pay', 'setvar', 'listadd', 'announce', 'song', 'skip', 'pause', 'play', 'previous', 'volume', 'sr', 'songrequest',
  'countdown', 'timeleft', 'tts', 'ttsskip', 'alerts', 'clip', 'tip', 'paypal', 'subathon', 'subrules', 'brb', 'back', 'watchtime', 'addpoints',
  'removepoints', 'setpoints', 'bonus', 'approve', 'deny', 'addquote', 'delquote', 'nextad', 'ad', 'snooze', 'setgame', 'settitle', 'gamesearch',
  'counter', 'points', 'gamble', 'slots', 'duel', 'accept', 'give', 'top', 'leaderboard', 'trivia', 'raffle', 'enter', 'draw', '8ball', 'roll', 'flip', 'words', 'wordtop', 'wheel', 'recap'];

// starter trivia questions: [question, accepted answers separated by |].
const TRIVIA = [
  ['What is the capital of Australia?', 'canberra'], ['How many sides does a hexagon have?', '6|six'], ['What planet is known as the Red Planet?', 'mars'],
  ['What is the chemical symbol for gold?', 'au'], ['In what year did the original Super Mario Bros. release in Japan?', '1985'],
  ['What is the largest ocean on Earth?', 'pacific|pacific ocean'], ['How many players are on a soccer team on the field?', '11|eleven'],
  ['What color do you get mixing blue and yellow?', 'green'], ['What is the hardest natural substance?', 'diamond'],
  ['Which gas do plants absorb from the air?', 'carbon dioxide|co2'], ['What is the smallest prime number?', '2|two'],
  ['What game features a plumber rescuing Princess Peach?', 'super mario bros|mario|super mario'], ['How many bits are in a byte?', '8|eight'],
  ['What is the capital of Japan?', 'tokyo'], ['Which planet has the most prominent rings?', 'saturn'], ['What is H2O commonly called?', 'water'],
  ['How many strings does a standard guitar have?', '6|six'], ['What is the fastest land animal?', 'cheetah'], ['Who painted the Mona Lisa?', 'leonardo da vinci|da vinci|leonardo'],
  ['What is the largest planet in our solar system?', 'jupiter'], ['In Minecraft, what mob explodes near players?', 'creeper'], ['What is 12 times 12?', '144'],
  ['What console did Nintendo release in 2017?', 'switch|nintendo switch'], ['What is the main ingredient in guacamole?', 'avocado'],
  ['How many continents are there?', '7|seven'],
].map(([q, a]) => ({ q, a }));

// !8ball answers.
const EIGHT_BALL = ['It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.', 'Outlook good.', 'Signs point to yes.', 'Reply hazy, try again.',
  'Ask again later.', 'Cannot predict now.', "Don't count on it.", 'My reply is no.', 'Outlook not so good.', 'Very doubtful.'];
// !slots symbols.
const REELS = ['🍒', '🍋', '🔔', '⭐', '7️⃣'];

// factory settings for everything the bot saves; merge() fills gaps in an older bot.json from these.
const defaults = () => ({
  enabled: true, prefix: '!', currency: 'points', pointsPerMin: 5, subMultiplier: 2, awardOffline: false,
  commands: [
    { id: 'lurk', name: 'lurk', aliases: [], mode: 'all', response: '$(user) is now lurking. Thanks for hanging out!', level: 'everyone', cd: 5, userCd: 15, enabled: true, uses: 0 },
    { id: 'hug', name: 'hug', aliases: [], response: '$(user) gives $(touser) a big hug!', level: 'everyone', cd: 5, userCd: 10, enabled: true, uses: 0 },
    { id: 'socials', name: 'socials', aliases: [], response: 'Find me at twitch.tv/$(channel)  (edit this command on the bot page to add your links)', level: 'everyone', cd: 15, userCd: 30, enabled: true, uses: 0 },
  ],
  timers: [{ id: 'follow', name: 'Follow reminder', message: 'Enjoying the stream? Hit the follow button so you never miss it!', minutes: 20, minLines: 5, enabled: false, onlyLive: true }],
  filters: {
    links: { on: false, action: 'timeout', timeout: 10, exempt: 'subscriber', whitelist: ['twitch.tv'], message: '$(user), please ask before posting links.' },
    caps: { on: false, action: 'delete', timeout: 10, exempt: 'vip', percent: 70, minLen: 15, message: '$(user), easy on the caps!' },
    symbols: { on: false, action: 'delete', timeout: 10, exempt: 'vip', percent: 50, minLen: 10, message: '$(user), too many symbols.' },
    emotes: { on: false, action: 'delete', timeout: 10, exempt: 'vip', max: 12, message: '$(user), too many emotes.' },
    repeat: { on: false, action: 'delete', timeout: 10, exempt: 'vip', chars: 20, words: 6, message: '$(user), please do not spam.' },
    length: { on: false, action: 'delete', timeout: 10, exempt: 'vip', max: 400, message: '$(user), that message is too long.' },
    blacklist: { on: false, action: 'timeout', timeout: 60, exempt: 'moderator', words: [], message: '' },
  },
  quotes: [], quoteSeq: 0, counters: {}, vars: {}, points: {},
  events: {
    follow: { on: false, msg: 'Thanks for the follow, $(user)!' }, sub: { on: false, msg: '$(user) just subscribed! Welcome to the crew!' },
    resub: { on: false, msg: '$(user) resubscribed for $(months) months! Thank you!' }, giftsub: { on: false, msg: '$(user) gifted $(total) sub(s)! Thank you so much!' },
    bits: { on: false, msg: 'Thanks for the $(amount) bits, $(user)!' }, raid: { on: false, msg: 'Welcome raiders from $(user)! Thanks for bringing $(viewers) viewers!' },
  },
  clip: { on: true, level: 'everyone' },
  extras: { welcome: { on: false, msg: 'Welcome to the stream, $(user)! Glad you are here.', announce: '', onlyLive: true }, raidShout: { on: false }, regulars: { on: false, minutes: 300, messages: 200 } },
  games: { gambleWin: 0.45, maxBet: 0, triviaReward: 100, triviaSeconds: 30, duelSeconds: 60, duelAnim: true, off: [], botDuel: { on: true, below: 1000, house: 50, maxWin: 1000 },
    bits: { boss: 100, royale: 100, race: 100, dance: 1000 },
    words: { rounds: 0, seconds: 90, letters: 5, perLetter: 2, pangram: 25, mvp: 25, beat: 50 },
    wheel: { title: 'Spin the wheel', options: ['Yes', 'No', 'Ask again'], pct: [34, 33, 33] },
    dance: { seconds: 120, strobe: true },   // a cheer of at least this many bits with the word boss / arena / race in it starts that game (0 = off)
    race: { count: 5, seconds: 90, title: 'Who wins the race?', names: [] },
    arena: { boss: { baseHp: 200, hpPerChatter: 40, seconds: 120, hitCd: 3, pool: 40, lastHit: 100, consolation: 10 }, royale: { fee: 50, lobby: 60, max: 8 }, teams: { fee: 50, lobby: 60, maxPerTeam: 20 } } },
  builtinEdits: {   // what the built-in !commands and !tts say, and what else they answer to (edited on the bot page)
    commands: { reply: 'Commands: {list}', aliases: [], cd: 15 },
    tts: { usage: 'Usage: {prefix}tts <what you want read out>{cost}', off: 'Text-to-speech is off right now.', level: 'Text-to-speech is for {level}s and above.', wait: '{user}, please wait a bit before using {prefix}tts again.', poor: '{user}, {prefix}tts costs {price} {currency} and you have {balance}.', blocked: '{user}, that message is not allowed.', failed: 'Could not read that out ({error}).', queued: '', aliases: [] },
  },
  wordRush: { players: {}, record: { round: 0, by: '', at: 0 } },   // all-time Word Rush points per chatter, and the most rounds chat ever beat in one game
  botDuelDay: {},
  customGames: [],
  bonuses: { follow: { on: false, amount: 50 }, sub: { on: false, amount: 500 }, resub: { on: false, amount: 300 }, giftsub: { on: false, amount: 300 },
    bits: { on: false, amount: 10 }, raid: { on: false, amount: 100, perViewer: 5 } },
  daily: { on: true, amount: 100, streakBonus: 25, maxStreak: 10 },
  shop: [], pending: [], pendingSeq: 0, ledger: [], claimedFollow: {}, lastRedeem: '',
  trivia: TRIVIA,
});

// overlay saved data on the defaults key by key, so settings added in a newer version appear with their default value; arrays and plain values come from the save as is.
const merge = (def, saved) => {
  if (Array.isArray(def) || typeof def !== 'object' || def === null) return saved === undefined ? def : saved;
  const out = {};
  for (const k of new Set([...Object.keys(def), ...Object.keys(saved || {})])) out[k] = k in def ? merge(def[k], saved ? saved[k] : undefined) : saved[k];
  return out;
};

// ctx supplies the Twitch/Helix calls, server state and overlay broadcast; tests replace now, rng, fetch and the gap between messages.
module.exports = function createBot(ctx) {
  const FILE = path.join(ctx.DATA, 'bot.json');
  const ACCT_FILE = path.join(ctx.DATA, 'bot-account.json');
  const now = () => (ctx.now ? ctx.now() : Date.now());
  const rng = ctx.rng || Math.random;
  const fetchFn = ctx.fetch || fetch;
  const log = ctx.log || (() => {});
  let db;
  try { db = merge(defaults(), JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { db = defaults(); }
  let saveT;
  // tell the server something changed and write bot.json after a short delay (batches bursts of changes).
  const save = () => { if (ctx.changed) ctx.changed(); clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8'); } catch (e) { log('bot save failed', e.message); } }, 400); };
  // collapse whitespace so a chat message is always a single line, cut to n characters.
  const oneLine = (t, n = 450) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);

  // ------------------------------------------------------------------ sending (rate limited)
  let botTok = null, botAuth = { status: 'none', message: '' }, botDevice = null;
  try { botTok = JSON.parse(fs.readFileSync(ACCT_FILE, 'utf8')); botAuth = { status: 'ok', message: 'Bot account: ' + botTok.login }; } catch (e) { /* no bot account */ }
  // queue = messages waiting to go out; recentSent remembers what we said so we can ignore our own echo.
  const queue = [], recentSent = new Map();
  // sentTimes = send times in the last 30s, used to stay under Twitch's chat rate limit.
  let pumping = false, sentTimes = [];
  const gap = ctx.gapMs == null ? 1200 : ctx.gapMs;

  // Helix call as the bot account; refreshes its token first when it has under 5 minutes left.
  async function botFetch(method, url, body) {
    if (botTok.expires_at - now() < 300000) await botRefresh();
    const r = await fetchFn(ctx.HELIX() + url, { method, headers: { 'Client-Id': ctx.clientId(), Authorization: 'Bearer ' + botTok.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
  }
  // send one chat message (or announcement) right now; the queue in say()/pump() calls this.
  async function rawSend(text, replyTo, announce) {
    const me = ctx.me(); if (!me) throw new Error('not logged in');
    if (ctx.send) return ctx.send(text, replyTo, announce);
    if (announce) {   // highlighted "Announcement" in chat (needs the moderator:manage:announcements permission)
      const body = { message: text, color: announce }, q = '/chat/announcements?broadcaster_id=' + me.id + '&moderator_id=';
      if (botTok) {   // with a bot account, EVERYTHING is said by the bot
        const r = await botFetch('POST', q + botTok.user_id, body); if (r.ok) return;
        if (!rawSend.warned) { rawSend.warned = true; log('The bot account is not a moderator, so it sends this as a normal message instead of a highlighted announcement. Make ' + botTok.login + ' a mod to get announcements.'); }
        return rawSend(text, undefined, '');   // still the bot, just not highlighted: never silently switch to your own account
      }
      const r = await ctx.helix('POST', q + me.id, body);
      if (!r.ok) throw new Error((r.json && r.json.message) || 'HTTP ' + r.status);
      return;
    }
    if (botTok) {
      const r = await botFetch('POST', '/chat/messages', { broadcaster_id: me.id, sender_id: botTok.user_id, message: text, reply_parent_message_id: replyTo || undefined });
      if (!r.ok) throw new Error((r.json && r.json.message) || 'HTTP ' + r.status);
      return;
    }
    const r = await ctx.helix('POST', '/chat/messages', { broadcaster_id: me.id, sender_id: me.id, message: text, reply_parent_message_id: replyTo || undefined });
    if (!r.ok) throw new Error((r.json && r.json.message) || 'HTTP ' + r.status);
  }
  // queue a message for chat. Replies are dropped for announcements, which cannot be replies.
  function say(text, replyTo, announce) {
    text = oneLine(text, 480); if (!text) return;
    queue.push({ text, replyTo: announce ? undefined : replyTo, announce: annColor(announce) }); pump();
  }
  // send queued messages one by one with a small gap, and wait whenever the 30 second limit is reached.
  async function pump() {
    if (pumping) return; pumping = true;
    while (queue.length) {
      const t = Date.now(); sentTimes = sentTimes.filter((x) => t - x < 30000);
      if (sentTimes.length >= (ctx.maxPer30s || 18)) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      const m = queue.shift();
      recentSent.set(m.text, t);
      try { await rawSend(m.text, m.replyTo, m.announce); sentTimes.push(Date.now()); } catch (e) { log('bot send failed:', e.message); }
      if (gap) await new Promise((r) => setTimeout(r, gap));
    }
    pumping = false;
  }
  // true when this chat line is the bot repeating its own message, so it does not react to itself. Old entries are cleaned out here.
  const isOwnEcho = (u, text) => {
    const t = recentSent.get(oneLine(text, 480));
    for (const [k, v] of recentSent) if (now() - v > 15000) recentSent.delete(k);
    const me = ctx.me();
    return !!t && now() - t < 15000 && (botTok ? u.id === botTok.user_id : me && u.id === me.id);
  };

  // ------------------------------------------------------------------ bot account (optional second login)
  // POST to Twitch's login service (form encoded).
  async function idPost(endpoint, body) {
    const r = await fetchFn(ctx.ID_URL() + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  }
  // swap the bot's refresh token for a new access token and save it.
  async function botRefresh() {
    const r = await idPost('/token', { client_id: ctx.clientId(), grant_type: 'refresh_token', refresh_token: botTok.refresh_token });
    if (!r.ok) { botAuth = { status: 'error', message: 'Bot login expired - connect it again' }; throw new Error('bot refresh failed'); }
    botTok = Object.assign({}, botTok, { access_token: r.json.access_token, refresh_token: r.json.refresh_token || botTok.refresh_token, expires_at: now() + (r.json.expires_in || 14400) * 1000 });
    fs.writeFileSync(ACCT_FILE, JSON.stringify(botTok, null, 2));
  }
  // begin the device-code login for the bot account, then poll in the background until the code is entered or it expires.
  async function accountStart() {
    if (!ctx.clientId()) throw new Error('Put your Twitch Client ID in server/config.json first');
    const scopes = 'user:write:chat user:bot moderator:manage:announcements';
    const r = await idPost('/device', { client_id: ctx.clientId(), scopes });
    if (!r.ok) throw new Error('Twitch refused: ' + (r.json.message || ''));
    const d = r.json; botDevice = { user_code: d.user_code, verification_uri: d.verification_uri, expires: now() + d.expires_in * 1000 };
    botAuth = { status: 'pending', message: 'Log in AS THE BOT ACCOUNT, then enter the code' };
    (async () => {
      while (botDevice && now() < botDevice.expires) {
        await new Promise((res) => setTimeout(res, (d.interval || 5) * 1000));
        const t = await idPost('/token', { client_id: ctx.clientId(), scopes, device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
        if (t.ok) {
          const v = await fetchFn(ctx.ID_URL() + '/validate', { headers: { Authorization: 'OAuth ' + t.json.access_token } }).then((x) => x.json()).catch(() => ({}));
          botTok = { access_token: t.json.access_token, refresh_token: t.json.refresh_token, expires_at: now() + (t.json.expires_in || 14400) * 1000, user_id: v.user_id, login: v.login };
          fs.writeFileSync(ACCT_FILE, JSON.stringify(botTok, null, 2));
          botAuth = { status: 'ok', message: 'Bot account: ' + v.login }; botDevice = null; return;
        }
        if (!/authorization_pending|slow_down/i.test(t.json.message || '')) { botAuth = { status: 'error', message: 'Bot login failed: ' + (t.json.message || '') }; botDevice = null; return; }
      }
      botAuth = { status: 'error', message: 'Code expired' }; botDevice = null;
    })();
    return botDevice;
  }
  // forget the bot account; chat goes back to being sent as you.
  function accountLogout() { botTok = null; botDevice = null; try { fs.unlinkSync(ACCT_FILE); } catch (e) { /* none */ } botAuth = { status: 'none', message: '' }; }

  // ------------------------------------------------------------------ helpers
  // other bots that should not get the welcome message.
  const KNOWN_BOTS = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'sery_bot', 'commanderroot'];
  // chat rank from badges: 4 broadcaster, 3 mod, 2 VIP, 1 subscriber (or founder), 0 everyone.
  const rankOf = (e) => {
    const ids = new Set((e.badges || []).map((b) => b.set_id));
    const me = ctx.me();
    if (ids.has('broadcaster') || (me && e.chatter_user_id === me.id)) return 4;
    if (ids.has('moderator')) return 3;
    if (ids.has('vip')) return 2;
    if (ids.has('subscriber') || ids.has('founder')) return 1;
    return 0;
  };
  // level name -> rank number (unknown names count as everyone).
  const rankName = (n) => Math.max(0, LEVELS.indexOf(n));
  // 1,234 style numbers.
  const fmtNum = (n) => Number(n).toLocaleString('en-US');
  const bare = (s) => String(s || '').trim().replace(/^@+/, '').replace(/[,.:;!?]+$/, '');   // clients and add-ons put @ in front (and autocomplete a comma after)
  // bare + lowercase, for comparing names.
  const strip = (s) => bare(s).toLowerCase();
  // milliseconds -> short text such as '2d 3h' or '1y 2mo 5d'.
  const ago = (ms) => {
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    const y = Math.floor(d / 365), mo = Math.floor((d % 365) / 30), dd = (d % 365) % 30;
    const parts = y ? [y + 'y', mo + 'mo', dd + 'd'] : mo ? [mo + 'mo', dd + 'd'] : d ? [d + 'd', h + 'h'] : [h ? h + 'h' : '', m + 'm'];
    return parts.filter(Boolean).join(' ') || '0m';
  };
  // a viewer's points record, created on first use; keeps the display name up to date.
  const pt = (id, name) => { const p = db.points[id] || (db.points[id] = { name: name || id, pts: 0, mins: 0 }); if (name) p.name = name; return p; };
  // name of the currency.
  const cur = () => db.currency || 'points';
  /** Every balance change goes through here so the dashboard ledger can show where currency came from and went. */
  function addPts(id, name, delta, reason, opts = {}) {
    const p = pt(id, name), before = p.pts;
    p.pts = Math.max(0, Math.floor(p.pts + delta));
    const real = p.pts - before;
    if (opts.log !== false && real !== 0) { db.ledger.push({ t: now(), id, name: p.name, delta: real, reason }); if (db.ledger.length > 300) db.ledger.splice(0, db.ledger.length - 300); }
    save(); return p;
  }

  // chat activity tracking (points, $(chatter), timer line counts)
  const active = new Map();   // uid -> {name, ts, sub}
  let lineCount = 0;
  const chatters = [];

  // ------------------------------------------------------------------ template variables
  // Both {name} and $(name) work. {unknown} stays as typed; $(unknown) becomes empty.
  async function expand(tpl, c) {
    c = c || {}; tpl = String(tpl || '');
    const re = /\$\(([^)]*)\)|\{([^{}\n]{1,200})\}/g; let out = '', i = 0, m;
    while ((m = re.exec(tpl))) {
      out += tpl.slice(i, m.index); i = re.lastIndex;
      const braces = m[2] != null, inner = (braces ? m[2] : m[1]).trim();
      let v = await lookup(inner, c);
      if (v == null) { if (c.trace) c.trace.unknown.push(m[0]); v = braces ? m[0] : ''; }
      else if (c.trace) c.trace.used.push({ token: m[0], value: String(v) });
      out += v;
    }
    return oneLine(out + tpl.slice(i));
  }
  // random item from a list.
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  // minutes -> '2h 5m'.
  const hm = (m) => (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm';
  // leaderboard position of a viewer by points (1 = top).
  const rankOfPts = (id) => { const p = db.points[id]; return p ? Object.values(db.points).filter((x) => x.pts > p.pts).length + 1 : 0; };
  // value for one variable name; null means unknown (the caller decides what to show). Returns a string.
  async function lookup(inner, c) {
    const sp = inner.search(/\s/), k0 = sp < 0 ? inner : inner.slice(0, sp), arg = sp < 0 ? '' : inner.slice(sp + 1).trim(), rest = arg ? arg.split(/\s+/) : [];
    const k = k0.toLowerCase(), s = ctx.state, args = c.args || [], me = c.user;
    if (/^[1-9]$/.test(k)) return args[+k - 1] || '';
    if (c.vars && c.vars[k] != null && k !== 'user') return String(c.vars[k]);   // event values ({amount}, {viewers}...) beat same-named stream stats
    const dot = /^(counter|var|list)\.([a-z0-9_]+)([+\-]|=-?\d+)?$/i.exec(inner);
    if (dot || k === 'counter') {
      const kind = dot ? dot[1].toLowerCase() : 'counter';
      if (kind === 'counter') {
        const mm = dot ? [null, dot[2], dot[3]] : /^([a-z0-9_]+)([+\-]|=-?\d+)?$/i.exec(rest[0] || ''); if (!mm) return null;
        const n = mm[1].toLowerCase(); let v = db.counters[n] || 0;
        if (mm[2] === '+') v++; else if (mm[2] === '-') v--; else if (mm[2]) v = parseInt(mm[2].slice(1), 10);
        if (mm[2]) { db.counters[n] = v; save(); }
        return String(v);
      }
      const v = db.vars[dot[2].toLowerCase()]; if (!v) return null;
      return v.type === 'list' ? (v.items.length ? pick(v.items) : '') : String(v.value || '');
    }
    switch (k) {
      case 'name': case 'user': case 'sender': case 'displayname': return me ? me.name : '';
      case 'username': return me ? me.login || String(me.name).toLowerCase() : '';
      case 'touser': return args[0] ? bare(args[0]) : (me ? me.name : '');
      case 'query': case 'args': return args.join(' ');
      case 'count': return String(c.uses || 0);
      case 'prefix': return db.prefix;
      case 'channel': { const m = ctx.me(); return m ? m.login : ''; }
      case 'game': return s.stream.game || '';
      case 'title': return s.stream.title || '';
      case 'viewers': return String(s.stream.live ? s.stream.viewers : 0);
      case 'followers': return String(s.totals.followers == null ? '' : s.totals.followers);
      case 'subs': return String(s.totals.subs == null ? '' : s.totals.subs);
      case 'uptime': return s.stream.live && s.stream.startedAt ? ago(now() - Date.parse(s.stream.startedAt)) : 'offline';
      case 'points': return me ? fmtNum(pt(me.id, me.name).pts) : '0';
      case 'rank': return me ? String(rankOfPts(me.id) || '') : '';
      case 'watchtime': return me ? hm(pt(me.id, me.name).mins || 0) : '';
      case 'streak': return me ? String(pt(me.id, me.name).streak || 0) : '0';
      case 'currency': return cur();
      case 'random': { const [lo0, hi0] = rest.map(Number); const lo = Number.isFinite(lo0) ? lo0 : 1, hi = Number.isFinite(hi0) ? hi0 : 100; return String(lo + Math.floor(rng() * (Math.max(hi, lo) - lo + 1))); }
      case 'pick': { const o = arg.split('|').map((x) => x.trim()).filter(Boolean); return o.length ? pick(o) : ''; }
      case 'randomname': case 'randomviewer': case 'chatter': { const o = chatters.filter((x) => !me || x !== me.name); return o.length ? pick(o) : (me ? me.name : ''); }
      case 'randomfollower': { const o = s.recent ? s.recent.followers : []; return o && o.length ? pick(o) : ''; }
      case 'randomsub': { const o = s.recent ? s.recent.subscribers : []; return o && o.length ? pick(o) : ''; }
      case 'quote': { if (!db.quotes.length) return ''; const q = rest[0] ? db.quotes.find((x) => x.n === parseInt(rest[0], 10)) : pick(db.quotes); return q ? q.text : ''; }
      case 'math': { const ex = arg.replace(/,/g, '.'); if (!/^[\d+\-*/().%\s]{1,80}$/.test(ex)) return null; try { const r = Function('"use strict"; return (' + ex + ')')(); return Number.isFinite(r) ? String(Math.round(r * 10000) / 10000) : null; } catch (e) { return null; } }
      case 'time': case 'date': {
        try { const o = { timeZone: rest[0] || undefined }; return k === 'time' ? new Date(now()).toLocaleTimeString('en-US', Object.assign(o, { hour: 'numeric', minute: '2-digit' })) : new Date(now()).toLocaleDateString('en-US', Object.assign(o, { month: 'short', day: 'numeric', year: 'numeric' })); }
        catch (e) { return null; }
      }
      case 'urlfetch': {
        const url = rest[0] || ''; if (!/^https?:\/\//i.test(url)) return null;
        try {
          const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 5000);
          const r = await fetchFn(url, { signal: ac.signal, headers: { 'User-Agent': 'IMC-Stream-Bot' } }); clearTimeout(t);
          return oneLine(await r.text(), 300);
        } catch (e) { return '(fetch failed)'; }
      }
      default: {   // anything the server tracks: every label file (latest_follower, session_bits, goal_progress, next_ad_in ...)
        const lv = ctx.labelValue ? ctx.labelValue(k0.toLowerCase()) : null;
        return lv == null ? null : String(lv).split('\n').filter(Boolean).join(', ');
      }
    }
  }
  /** Everything the command builder can offer: [{group, items:[{token, desc, value?}]}] */
  function catalog() {
    const it = (token, desc, value) => ({ token, desc, value });
    const sample = ctx.state;
    const groups = [
      { group: 'Viewer (who typed the command)', items: [it('{name}', 'Their display name'), it('{username}', 'Their login name'), it('{touser}', 'First word after the command with @ removed, otherwise their name'),
        it('{randomname}', 'A random recent chatter (not them)'), it('{points}', 'Their currency balance'), it('{rank}', 'Their rank on the currency leaderboard'), it('{watchtime}', 'How long they have been active in chat'),
        it('{streak}', 'Their !daily streak'), it('{currency}', 'Your currency name')] },
      { group: 'Command', items: [it('{args}', 'Everything typed after the command'), it('{1}', 'First word after the command ({2}, {3}... also work)'), it('{count}', 'How many times this command has been used'), it('{prefix}', 'Command prefix')] },
      { group: 'Stream', items: [it('{channel}', 'Your channel name', ctx.me() ? ctx.me().login : ''), it('{game}', 'Current category', sample.stream.game), it('{title}', 'Current title', sample.stream.title),
        it('{viewers}', 'Current viewers'), it('{uptime}', 'Time live'), it('{followers}', 'Total followers', sample.totals.followers), it('{subs}', 'Total subscribers', sample.totals.subs)] },
      { group: 'Random, math, time', items: [it('{random 1 100}', 'Random whole number'), it('{pick a|b|c}', 'Random choice from your list'), it('{randomfollower}', 'A random recent follower'), it('{randomsub}', 'A random recent subscriber'),
        it('{quote}', 'A random saved quote'), it('{math 5*3+1}', 'Do the math'), it('{time}', 'Current time'), it('{date}', 'Current date'), it('{urlfetch https://...}', 'Text fetched from a web address')] },
      { group: 'Counters (like death counts)', items: [it('{counter.deaths+}', 'Add 1 and show it (any name works)'), it('{counter.deaths}', 'Show it without changing it'), it('{counter.deaths-}', 'Subtract 1'), it('{counter.deaths=0}', 'Set it')]
        .concat(Object.keys(db.counters).map((n) => it('{counter.' + n + '}', 'Counter "' + n + '"', db.counters[n]))) },
      { group: 'Your variables', items: Object.entries(db.vars).map(([n, v]) => it('{var.' + n + '}', v.type === 'list' ? 'Random pick from your "' + n + '" list (' + v.items.length + ' items)' : 'Text variable "' + n + '"', v.type === 'list' ? v.items[0] : v.value)) },
      { group: 'Tracked stats (everything on the dashboard)', items: (ctx.labelList ? ctx.labelList() : []).map((l) => it('{' + l.name + '}', l.desc, ctx.labelValue ? String(ctx.labelValue(l.name) || '').split('\n').filter(Boolean).join(', ') : '')) },
    ];
    return groups;
  }

  // ------------------------------------------------------------------ spam / moderation filters
  // offenses = recent rule breaks per chatter and filter; permits = temporary link permits from !permit.
  const offenses = new Map(), permits = new Map();
  const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|tv|gg|io|co|ly|me|xyz|ru|cn|info|us|uk|de|fr|jp|app|dev|link|shop|site)\b(?:\/\S*)?/gi;
  const hostOf = (s) => String(s).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  // does this message break the given filter? Only filters that are switched on are checked.
  function violated(f, name, e, text, u) {
    const fl = db.filters[name]; if (!fl || !fl.on) return false;
    switch (name) {
      case 'links': {
        if ((permits.get(u.login) || 0) > now()) return false;
        const hits = text.match(URL_RE) || [];
        return hits.some((h) => !(fl.whitelist || []).some((w) => { w = hostOf(w); const hh = hostOf(h); return hh === w || hh.endsWith('.' + w); }));
      }
      case 'caps': { const L = text.replace(/[^a-z]/gi, ''); return L.length >= fl.minLen && L.replace(/[^A-Z]/g, '').length / L.length * 100 >= fl.percent; }
      case 'symbols': { const t = text.replace(/\s/g, ''); const sym = t.replace(/[a-z0-9]/gi, ''); return t.length >= fl.minLen && sym.length / t.length * 100 >= fl.percent; }
      case 'emotes': {
        let n = (e.message.fragments || []).filter((x) => x.type === 'emote').length;
        const names = ctx.emoteNames ? ctx.emoteNames() : {}; n += text.split(/\s+/).filter((w) => names[w]).length;
        return n > fl.max;
      }
      case 'repeat': {
        if (new RegExp('(.)\\1{' + Math.max(2, fl.chars - 1) + ',}').test(text)) return true;
        const w = text.toLowerCase().split(/\s+/).filter(Boolean), cnt = {}; for (const x of w) cnt[x] = (cnt[x] || 0) + 1;
        return Object.values(cnt).some((v) => v >= fl.words) && w.length >= fl.words;
      }
      case 'length': return text.length > fl.max;
      case 'blacklist': {
        const low = text.toLowerCase();
        return (fl.words || []).some((w) => { w = String(w).trim(); if (!w) return false; const rx = /^\/(.+)\/([a-z]*)$/.exec(w); if (rx) { try { return new RegExp(rx[1], rx[2] || 'i').test(text); } catch (x) { return false; } } return low.includes(w.toLowerCase()); });
      }
      default: return false;
    }
  }
  // run the filters in order and punish the first one broken. Repeat offenses within 10 minutes double the timeout (max 1 day). Returns true if the message was dealt with, so no command runs.
  async function runFilters(u, e, text) {
    for (const name of Object.keys(db.filters)) {
      const f = db.filters[name];
      if (!f.on || u.rank >= rankName(f.exempt || 'vip')) continue;
      if (!violated(f, name, e, text, u)) continue;
      const key = u.id + ':' + name, o = offenses.get(key), t = now(), n = o && t - o.ts < 600000 ? o.n + 1 : 1;
      offenses.set(key, { n, ts: t });
      try {
        if (f.action === 'ban') await ctx.mod('ban', { userId: u.id, reason: 'Bot: ' + name });
        else if (f.action === 'timeout') await ctx.mod('timeout', { userId: u.id, seconds: Math.min(86400, (f.timeout || 10) * Math.pow(2, n - 1)), reason: 'Bot: ' + name });
        else await ctx.mod('delete', { messageId: u.msgId });
      } catch (err) { log('bot filter action failed:', err.message); }
      if (f.message) say(await expand(f.message, { user: u, args: [] }));
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ commands
  // cooldown records: last use per command, and per command and chatter.
  const cdGlobal = new Map(), cdUser = new Map();
  // custom command by name or alias; switched-off commands are ignored.
  const findCommand = (name) => db.commands.find((c) => c.enabled && (c.name === name || (c.aliases || []).includes(name)));
  // extra names the built-in !commands / !tts answer to -> the built-in they belong to.
  const aliasMap = () => { const m = {}; for (const k of ['commands', 'tts']) for (const a of (db.builtinEdits[k] && db.builtinEdits[k].aliases) || []) m[a] = k; return m; };
  // true if a custom command cannot use this name.
  const reserved = (n) => BUILTIN.includes(n) || !!aliasMap()[n];
  // pull -ul= -cd= -usercd= -alias= options out of !addcom arguments.
  function parseFlags(args) {
    const flags = {}; const rest = [];
    for (const a of args) { const m = /^-(ul|cd|usercd|alias)=(.+)$/i.exec(a); if (m) flags[m[1].toLowerCase()] = m[2]; else rest.push(a); }
    return { flags, rest };
  }
  // run a command in order: custom games, built-ins, then custom commands. A missing permission or cooldown means silently doing nothing.
  async function runCommand(name, args, u, e) {
    const sendTo = e.message_id; name = aliasMap()[name] || name;   // !cmds and the like answer as !commands
    const gid = GAME_OF[name]; if (gid && (db.games.off || []).includes(gid)) return;   // that game is switched off
    const CG = db.customGames.find((g) => g.enabled && g.command === name);
    if (CG && !builtins[name]) {
      if (!cooled('game:' + CG.id, u, 0, CG.cooldown || 0)) return;
      try { await playCustom(CG, u, (t) => say(t, sendTo)); } catch (err) { log('custom game error', name, err.message); }
      return;
    }
    const B = builtins[name];
    if (B) {
      if (u.rank < (B.level || 0)) return;
      if (!cooled(name, u, B.cd || 0, B.userCd || 0)) return;
      try { await B.run({ args, u, e, reply: (t) => say(t, sendTo) }); } catch (err) { log('bot command error', name, err.message); say(u.name + ', something went wrong.', sendTo); }
      return;
    }
    const c = findCommand(name); if (!c) return;
    if (u.rank < rankName(c.level)) return;
    if (c.liveOnly && !ctx.state.stream.live) return;
    if (c.needArgs && args.length < c.needArgs) return say(c.usage || 'Usage: ' + db.prefix + c.name + ' ' + Array.from({ length: c.needArgs }, (_, i) => '<' + (i ? 'arg' + (i + 1) : 'name') + '>').join(' '), sendTo);
    if (!cooled(c.id, u, c.cd || 0, c.userCd || 0)) return;
    c.uses = (c.uses || 0) + 1;
    const lines = String(c.response).split('\n').map((x) => x.trim()).filter(Boolean);
    const chosen = c.mode === 'random' ? [pick(lines)] : c.mode === 'rotate' ? [lines[(c.rot || 0) % lines.length]] : lines;
    if (c.mode === 'rotate') c.rot = (c.rot || 0) + 1;
    save();
    for (const line of chosen) { const t = await expand(line, { user: u, args, uses: c.uses }); if (t) say(t, sendTo, c.announce); }
  }
  // true if the command may run now (and starts the cooldown). Mods and the streamer skip cooldowns.
  function cooled(id, u, cd, userCd) {
    if (u.rank >= 3) return true;
    const t = now(), g = cdGlobal.get(id) || 0, k = id + ':' + u.id, ug = cdUser.get(k) || 0;
    if (t - g < cd * 1000 || t - ug < userCd * 1000) return false;
    cdGlobal.set(id, t); cdUser.set(k, t); return true;
  }

  // ---- games you build yourself: pay a cost, roll weighted outcomes, win points
  const GAMES = [
    { id: 'gamble', name: 'Gamble', cmd: 'gamble', how: '!gamble <amount|all>', desc: 'Bet points on a coin flip (win chance is yours to set).' },
    { id: 'slots', name: 'Slots', cmd: 'slots', how: '!slots <amount>', desc: 'Three reels: pairs pay 1.5x, three of a kind 6x, triple 7s 10x.' },
    { id: 'duel', name: 'Duel', cmd: 'duel', how: '!duel <user> <amount>, then !accept  (or !duel bot)', desc: 'Two chatters fight for points, with the pixel duel overlay. Chatters under the points line can also duel the bot once a day.' },
    { id: 'trivia', name: 'Trivia', cmd: 'trivia', how: '!trivia (mods start it)', desc: 'A question from your list; first right answer wins points.' },
    { id: 'raffle', name: 'Raffle', cmd: 'raffle', how: '!raffle (mods), !enter, !draw', desc: 'Mods open a raffle, viewers enter, mods draw a winner.' },
    { id: '8ball', name: 'Magic 8-ball', cmd: '8ball', how: '!8ball <question>', desc: 'Ask a yes/no question, get a mystical answer.' },
    { id: 'roll', name: 'Dice', cmd: 'roll', how: '!roll [NdM]', desc: 'Roll dice, for example !roll 2d6.' },
    { id: 'words', name: 'Word Rush', cmd: 'words', how: '!words (mods)', desc: 'Streamer and mods only. A full-screen pixel word game: chat makes words from the letters on screen. Points are paid out after every round.' },
    { id: 'wheel', name: 'Spin the wheel', cmd: 'wheel', how: '!wheel (mods) or !wheel pizza, tacos, sushi', desc: 'Streamer and mods only. A pixel wheel spins on the overlay and picks one option at random from your list.' },
    { id: 'dance', name: 'Dance Party', cmd: 'dance', how: '!dance (mods), or a 1000-bit cheer with "dance"', desc: 'Two minutes of lights, lasers, strobes and pixel dancers (named after chatters) dancing to the current song.' },
    { id: 'race', name: 'Horse race', cmd: 'race', how: '!race (mods)', desc: 'Horses run across the overlay. A Twitch prediction takes channel-point bets, then the winner is picked and the prediction pays out.' },
    { id: 'boss', name: 'Boss raid', cmd: 'boss', how: '!boss (mods) then everyone !hit', desc: 'A pixel monster appears; chat attacks it. Subs and bits hit harder. Damage decides the prize share.' },
    { id: 'royale', name: 'Arena royale', cmd: 'arena', how: '!arena (mods) then !join', desc: 'Up to 8 chatters pay an entry fee and brawl; last one standing takes the pot.' },
    { id: 'teams', name: 'Team battle', cmd: 'teams', how: '!teams (mods) then !red or !blue', desc: 'Two teams fight; the smaller team hits harder so it stays fair. Winners split the pot.' },
    { id: 'flip', name: 'Coin flip', cmd: 'flip', how: '!flip', desc: 'Heads or tails.' },
  ];
  // command words -> the game they belong to, for the on/off switch.
  const GAME_OF = { words: 'words', wheel: 'wheel', spin: 'wheel', dance: 'dance', race: 'race', hit: 'boss', boss: 'boss', arena: 'royale', join: 'royale', teams: 'teams', red: 'teams', blue: 'teams', gamble: 'gamble', slots: 'slots', duel: 'duel', accept: 'duel', trivia: 'trivia', raffle: 'raffle', enter: 'raffle', draw: 'raffle', '8ball': '8ball', roll: 'roll', flip: 'flip' };
  // pick an outcome by weight from r (0 to 1).
  const rollOutcome = (G, r) => { const total = G.outcomes.reduce((a, o) => a + o.weight, 0); let x = r * total; for (const o of G.outcomes) { if ((x -= o.weight) < 0) return o; } return G.outcomes[G.outcomes.length - 1]; };
  // play a streamer-made game: check the cost, roll an outcome, settle the net result and answer.
  async function playCustom(G, u, reply) {
    const p = pt(u.id, u.name), cost = G.cost || 0;
    if (p.pts < cost) return reply(u.name + ', ' + db.prefix + G.command + ' costs ' + fmtNum(cost) + ' ' + cur() + ' and you have ' + fmtNum(p.pts) + '.');
    const o = rollOutcome(G, rng()), net = o.payout - cost;
    if (net) addPts(u.id, u.name, net, 'game: ' + G.name);
    G.plays = (G.plays || 0) + 1; G.paidIn = (G.paidIn || 0) + cost; G.paidOut = (G.paidOut || 0) + o.payout; save();
    const fill = (t) => String(t).replace(/\{user\}/g, u.name).replace(/\{payout\}/g, fmtNum(o.payout)).replace(/\{cost\}/g, fmtNum(cost)).replace(/\{net\}/g, (net >= 0 ? '+' : '') + fmtNum(net)).replace(/\{balance\}/g, fmtNum(pt(u.id).pts)).replace(/\{currency\}/g, cur());
    const t = await expand(fill(o.text || '{user}: {net} {currency}'), { user: u, args: [] }); if (t) reply(t);
  }
  // validate a game from the dashboard builder; its command may not clash with any other command or game.
  function cleanGame(b, id) {
    const taken = new Set(Object.keys(builtins).concat(BUILTIN, db.commands.flatMap((c) => [c.name].concat(c.aliases || [])), Object.keys(GAME_OF), db.customGames.filter((g) => g.id !== id).map((g) => g.command)));
    const name = oneLine(b.name, 30); if (!name) throw new Error('Give the game a name');
    const command = String(b.command || '').toLowerCase().replace(/^!/, '').replace(/[^a-z0-9_]/g, '').slice(0, 20); if (!command) throw new Error('Pick the chat command, for example fish (viewers type !fish)');
    if (taken.has(command)) throw new Error('!' + command + ' is already used by another command or game');
    const outcomes = (Array.isArray(b.outcomes) ? b.outcomes : []).slice(0, 12).map((o) => ({ weight: num(o.weight, 1, 1, 1000), payout: Math.floor(num(o.payout, 0, 0, 1e7)), text: oneLine(o.text, 200) })).filter((o) => o);
    if (!outcomes.length) throw new Error('Add at least one outcome');
    return { name, command, desc: oneLine(b.desc, 120), cost: Math.floor(num(b.cost, 0, 0, 1e7)), cooldown: Math.floor(num(b.cooldown, 30, 0, 3600)), enabled: b.enabled !== false, outcomes };
  }
  // chance of winning and the average return, shown in the builder.
  const gameOdds = (G) => { const total = G.outcomes.reduce((a, o) => a + o.weight, 0), ev = G.outcomes.reduce((a, o) => a + o.weight / total * o.payout, 0); return { total, rows: G.outcomes.map((o) => Math.round(o.weight / total * 1000) / 10), ev, rtp: G.cost ? Math.round(ev / G.cost * 1000) / 10 : null }; };

  // ---- duel the chat bot: chatters under the points line can always do it once a day, the bot always accepts and never pays out more than the cap
  // the bot's name for chat texts.
  const botDisplay = () => (botTok && botTok.login) || 'ChatBot';
  // is the duel target the bot itself?
  const isBotName = (t) => !!t && (['bot', 'chatbot', 'thebot', 'chat-bot'].includes(t) || (botTok && t === String(botTok.login).toLowerCase()));
  // today's date as text, to limit bot duels to one a day.
  const dayKey = () => { const d = new Date(now()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  // a duel against the chat bot, limited by points, a daily limit and an on/off switch.
  function botDuel(u, amt, reply) {
    const B = db.games.botDuel || {}, p = pt(u.id, u.name);
    if (B.on === false) return reply('The bot is not taking duels right now.');
    if (p.pts >= (B.below || 1000)) return reply(u.name + ', the bot only duels chatters under ' + fmtNum(B.below || 1000) + ' ' + cur() + '. Challenge a viewer instead!');
    if (db.botDuelDay[u.id] === dayKey()) return reply(u.name + ', you already dueled the bot today. It will take you on again tomorrow!');
    // stake: what they chose (never more than they own); broke chatters fight on the house, so they can still win something
    const house = p.pts <= 0, stake = house ? Math.max(1, B.house || 50) : Math.min(amt > 0 ? amt : Math.min(p.pts, 100), p.pts);
    const win = Math.min(stake, B.maxWin || 1000), aWins = rng() < 0.5;
    db.botDuelDay[u.id] = dayKey();
    if (aWins) addPts(u.id, u.name, win, 'bot duel win'); else if (!house) addPts(u.id, u.name, -stake, 'bot duel loss');
    const msg = aWins ? u.name + ' beat the bot' + (house ? ' (on the house)' : '') + ' and wins ' + fmtNum(win) + ' ' + cur() + '!' : (house ? u.name + ' lost to the bot, but it was on the house. Try again tomorrow!' : 'The bot beat ' + u.name + ' and takes ' + fmtNum(stake) + ' ' + cur() + '. Try again tomorrow!');
    const wait = db.games.duelAnim !== false && ctx.duel ? ctx.duel({ a: u.name, b: botDisplay(), winner: aWins ? 'a' : 'b', amount: aWins ? win : stake, currency: cur() }) : 0;
    save(); if (wait > 0) setTimeout(() => reply(msg), wait); else reply(msg);
  }

  // ---- group games on the pixel overlay (boss raid, arena royale, team battle)
  const arena = require('./arena')({
    rng, now, cfg: () => db.games.arena, currency: cur, prefix: () => db.prefix, say: (t) => say(t),
    broadcast: (ev, d) => (ctx.broadcast ? ctx.broadcast(ev, d) : 0),
    addPts: (id, name, d, why) => addPts(id, name, d, why), getPts: (id, name) => pt(id, name).pts,
    activeCount: () => { const t = now(); return [...active.values()].filter((a) => t - a.ts < 15 * 60000).length; },
  });
  const race = require('./race')({
    rng, now, cfg: () => db.games.race, broadcast: (ev, d) => (ctx.broadcast ? ctx.broadcast(ev, d) : 0), say: (t) => say(t),
    predict: ctx.predict || { create: async () => { throw new Error('Not connected to Twitch'); }, lock: async () => {}, resolve: async () => {}, cancel: async () => {} },
  });
  // ---- Dance Party: a timed full-screen party on the dance overlay (lights, lasers, strobes, pixel dancers named after recent chatters)
  let danceTimer = null, danceOn = false;
  // start the Dance Party on the overlay (does nothing if one is running), then end it by timer.
  function danceStart(u, silent) {
    if (danceOn) return 'A dance party is already going.';
    const D = db.games.dance, secs = Math.max(20, Math.min(600, Math.floor(Number(D.seconds) || 120))), t = now();
    const names = [...active.values()].filter((a) => t - a.ts < 20 * 60000 && a.name && a.name.toLowerCase() !== String(u.name || '').toLowerCase()).sort((a, b) => b.ts - a.ts).map((a) => a.name).slice(0, 23);
    danceOn = true; ctx.broadcast && ctx.broadcast('dance', { type: 'start', names, by: u.name || '', seconds: secs, strobe: D.strobe !== false });
    if (!silent) say('💃 DANCE PARTY! ' + (u.name ? 'Thanks ' + u.name + '! ' : '') + 'Lights, lasers and dancers to the music for ' + (secs >= 60 ? Math.round(secs / 60) + ' minutes' : secs + ' seconds') + '. (Flashing lights on stream)');
    danceTimer = setTimeout(() => { danceOn = false; if (!silent) say('The dance party is over. Thanks for dancing!'); }, secs * 1000); if (danceTimer.unref) danceTimer.unref();
    return '';
  }
  // end the party early.
  function danceStop() { clearTimeout(danceTimer); danceOn = false; ctx.broadcast && ctx.broadcast('dance', { type: 'stop' }); }
  // ---- Spin the wheel: only the streamer and mods can start it (commands need the moderator level; the page is the streamer's own)
  const wheel = require('./wheel')({ broadcast: (ev, d) => (ctx.broadcast ? ctx.broadcast(ev, d) : 0), say: (t) => say(t) });
  // !wheel / !spin from chat: 'stop' cancels, typed options spin that list, no options spin the saved wheel.
  function wheelCmd(args, reply) {
    const text = args.join(' ').trim(), W = db.games.wheel;
    if (text.toLowerCase() === 'stop') { const r = wheel.cancel(); return reply(r.error || 'Wheel stopped.'); }
    const r = text ? wheel.spin({ title: '', options: text }) : wheel.spin({ title: W.title, options: W.options, pct: W.pct });
    if (r.error) reply(r.error);
  }
  // ---- Word Rush: a full-screen word game for chat; only the streamer and mods start it, points are paid out after every round
  // Word Rush scores kept in the saved data.
  const wordStats = {
    player: (id, name, x) => { const P = db.wordRush.players[id] || (db.wordRush.players[id] = { name, pts: 0, words: 0, best: 0 }); P.name = name; P.pts += x.pts; P.words += x.words; P.best = Math.max(P.best, x.round); save(); },
    record: (round, by) => { const R = db.wordRush.record; if (round <= R.round) return false; db.wordRush.record = { round, by, at: now() }; save(); return true; },
    get: () => ({ record: db.wordRush.record, top: Object.values(db.wordRush.players).sort((a, b) => b.pts - a.pts || b.best - a.best).slice(0, 10).map((p) => ({ name: p.name, pts: p.pts, words: p.words, best: p.best })) }),
  };
  const words = require('./words')({ rng, now, stats: wordStats, introMs: () => ctx.wordsIntroMs || 6000, cfg: () => db.games.words, currency: () => cur(), broadcast: (ev, d) => (ctx.broadcast ? ctx.broadcast(ev, d) : 0), say: (t) => say(t),
    award: (id, name, n, why) => addPts(id, name, n, why) });
  // !words: 'stop', 'skip', or start (a number sets the rounds).
  function wordsCmd(args, u, reply) {
    const a = String(args[0] || '').toLowerCase();
    if (a === 'stop') { const r = words.stop(); return reply(r.error || 'Word Rush stopped.'); }
    if (a === 'skip') { const r = words.skip(); return r.error ? reply(r.error) : undefined; }
    const r = words.start({ by: u && u.name, rounds: /^\d+$/.test(a) ? Number(a) : undefined }); if (r.error) reply(r.error);
  }
  // adapt an arena function to the built-in command shape; whatever it returns is the reply.
  const arenaCmd = (fn) => ({ run: ({ args, u, reply }) => { const r = fn(args, u); if (r) reply(r); } });

  // chat games state
  const duels = new Map();
  // at most one raffle and one trivia question at a time.
  let raffle = null, trivia = null;
  // bet amount ('all' allowed) capped at the max bet; answers the chatter and returns 0 when it is unusable.
  const validBet = (u, arg, reply) => {
    const p = pt(u.id, u.name); let amt = /^all$/i.test(arg || '') ? p.pts : parseInt(arg, 10);
    if (!Number.isFinite(amt) || amt <= 0) { reply(u.name + ', usage: bet an amount or "all" (you have ' + fmtNum(p.pts) + ' ' + cur() + ').'); return 0; }
    if (db.games.maxBet && amt > db.games.maxBet) amt = db.games.maxBet;
    if (amt > p.pts) { reply(u.name + ', you only have ' + fmtNum(p.pts) + ' ' + cur() + '.'); return 0; }
    return amt;
  };
  // first argument as a clean name.
  const targetOf = (args) => strip(args[0]);

  // wording of !tts when it has not been edited.
  const DEFAULT_TTS_EDITS = { usage: 'Usage: {prefix}tts <what you want read out>{cost}', off: 'Text-to-speech is off right now.', level: 'Text-to-speech is for {level}s and above.', wait: '{user}, please wait a bit before using {prefix}tts again.', poor: '{user}, {prefix}tts costs {price} {currency} and you have {balance}.', blocked: '{user}, that message is not allowed.', failed: 'Could not read that out ({error}).' };
  // every built-in !command: { level (minimum rank), cd / userCd (cooldowns in seconds), run({ args, u, e, reply }) }.
  const builtins = {
    commands: { cd: 15, run: async ({ u, reply }) => {
      const list = db.commands.filter((c) => c.enabled && !c.hidden && u.rank >= rankName(c.level)).map((c) => db.prefix + c.name);
      const all = list.concat(['points', 'daily', 'shop', 'give', 'gamble', 'slots', 'duel', 'top', 'quote', 'uptime', 'followage'].map((x) => db.prefix + x)).join(', ');
      reply(await expand(db.builtinEdits.commands.reply || 'Commands: {list}', { user: u, args: [], vars: { list: all, prefix: db.prefix, website: (ctx.state.site && ctx.state.site.lastUrl) || '' } }));
    } },
    addcom: { level: 3, run: ({ args, reply, u }) => {
      const { flags, rest } = parseFlags(args); const name = strip((rest.shift() || '').replace(new RegExp('^' + db.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '')).replace(/[^a-z0-9_]/g, '');
      if (!name || !rest.length) return reply('Usage: ' + db.prefix + 'addcom <name> [-ul=everyone|subscriber|vip|moderator] [-cd=seconds] <response>');
      if (reserved(name) || findCommand(name)) return reply(db.prefix + name + ' already exists. Use ' + db.prefix + 'editcom.');
      db.commands.push({ id: name + '-' + Math.random().toString(36).slice(2, 5), name, aliases: [], response: rest.join(' '), level: LEVELS.includes(flags.ul) ? flags.ul : 'everyone', cd: +flags.cd || 5, userCd: +flags.usercd || 10, enabled: true, uses: 0 });
      save(); reply(u.name + ', added ' + db.prefix + name + '.');
    } },
    editcom: { level: 3, run: ({ args, reply, u }) => {
      const { flags, rest } = parseFlags(args); const name = strip((rest.shift() || '').replace(db.prefix, ''));
      const c = db.commands.find((x) => x.name === name); if (!c) return reply('No custom command ' + db.prefix + name + '.');
      if (rest.length) c.response = rest.join(' '); if (LEVELS.includes(flags.ul)) c.level = flags.ul; if (flags.cd) c.cd = +flags.cd;
      save(); reply(u.name + ', updated ' + db.prefix + name + '.');
    } },
    delcom: { level: 3, run: ({ args, reply, u }) => {
      const name = strip((args[0] || '').replace(db.prefix, '')); const n = db.commands.length;
      db.commands = db.commands.filter((c) => c.name !== name); save();
      reply(n === db.commands.length ? 'No custom command ' + db.prefix + name + '.' : u.name + ', deleted ' + db.prefix + name + '.');
    } },
    uptime: { cd: 10, run: ({ reply }) => { const s = ctx.state.stream; reply(s.live && s.startedAt ? 'Live for ' + ago(now() - Date.parse(s.startedAt)) + '.' : 'The stream is offline.'); } },
    game: { cd: 5, run: async ({ args, u, reply }) => {
      if (!args.length) return reply('Current game: ' + (ctx.state.stream.game || 'unknown'));
      if (u.rank < 3) return;
      const q = args.join(' '), cats = await ctx.searchCategories(q);
      if (!cats.length) return reply('No category found for "' + q + '".');
      const low = q.toLowerCase(), exact = cats.find((c) => c.name.toLowerCase() === low), pick = exact || cats[0];
      if (!exact && !pick.name.toLowerCase().startsWith(low) && !pick.name.toLowerCase().includes(low)) return reply('Not sure which you meant: ' + cats.slice(0, 4).map((c) => c.name).join(', ') + '. Use the exact name.');
      try { await ctx.setChannel({ gameId: pick.id, gameName: pick.name, art: pick.art }); reply('Game changed to ' + pick.name + '.'); }
      catch (err) { reply('Could not change the game (' + err.message + ').'); }
    } },
    gamesearch: { level: 3, cd: 3, run: async ({ args, reply }) => {
      if (!args.length) return reply('Usage: ' + db.prefix + 'gamesearch <name>');
      const cats = await ctx.searchCategories(args.join(' ')); reply(cats.length ? 'Categories: ' + cats.slice(0, 5).map((c) => c.name).join(' | ') : 'No category found.');
    } },
    title: { cd: 5, run: async ({ args, u, reply }) => {
      if (!args.length) return reply('Title: ' + (ctx.state.stream.title || 'unknown'));
      if (u.rank < 3) return;
      try { await ctx.setChannel({ title: args.join(' ') }); reply('Title updated.'); } catch (err) { reply('Could not change the title (' + err.message + ').'); }
    } },
    nextad: { cd: 10, run: ({ reply }) => {
      const a = ctx.state.ads || {};
      if (a.running) return reply('An ad break is running right now.');
      const left = a.nextAt ? Math.round((a.nextAt - now()) / 1000) : 0;
      reply(left > 0 ? 'Next ad break in ' + Math.floor(left / 60) + 'm ' + (left % 60) + 's.' : 'No ad break is scheduled.');
    } },
    ad: { level: 3, cd: 10, run: async ({ args, reply }) => {
      const want = parseInt(args[0], 10) || 30, len = [30, 60, 90, 120, 150, 180].reduce((p, c) => (Math.abs(c - want) < Math.abs(p - want) ? c : p), 30);
      try { await ctx.runAd(len); reply('Running a ' + len + 's ad break.'); } catch (err) { reply('Could not run the ad (' + err.message.replace(/^Run ad: /, '') + ').'); }
    } },
    snooze: { level: 3, cd: 10, run: async ({ reply }) => {
      try { const r = await ctx.snoozeAd(); const left = r.nextAt ? Math.max(0, Math.round((r.nextAt - now()) / 60000)) : 0; reply('Ad snoozed' + (left ? ' - next one in about ' + left + ' min' : '') + '. Snoozes left: ' + (r.snoozes == null ? '?' : r.snoozes) + '.'); }
      catch (err) { reply('Could not snooze (' + err.message.replace(/^Snooze ad: /, '') + ').'); }
    } },
    followage: { cd: 10, userCd: 20, run: async ({ args, u, e, reply }) => {
      const who = args[0] ? { login: strip(args[0]) } : { id: u.id, name: u.name };
      const id = who.id || await ctx.resolveUser(who.login);
      const r = await ctx.helix('GET', '/channels/followers?broadcaster_id=' + ctx.me().id + '&user_id=' + id);
      const d = r.ok && r.json.data && r.json.data[0];
      reply(d ? (who.name || who.login) + ' has been following for ' + ago(now() - Date.parse(d.followed_at)) + '.' : (who.name || who.login) + ' is not following.');
    } },
    accountage: { cd: 10, userCd: 20, run: async ({ args, u, reply }) => {
      const q = args[0] ? 'login=' + encodeURIComponent(strip(args[0])) : 'id=' + u.id;
      const r = await ctx.helix('GET', '/users?' + q); const d = r.ok && r.json.data && r.json.data[0];
      reply(d ? d.display_name + "'s account is " + ago(now() - Date.parse(d.created_at)) + ' old.' : 'User not found.');
    } },
    so: { level: 3, run: async ({ args, reply }) => {
      const login = targetOf(args); if (!login) return reply('Usage: ' + db.prefix + 'so <channel>');
      const id = await ctx.resolveUser(login); const ch = await ctx.helix('GET', '/channels?broadcaster_id=' + id);
      const d = ch.ok && ch.json.data && ch.json.data[0];
      reply('Go check out ' + ((d && d.broadcaster_name) || login) + (d && d.game_name ? ' - last playing ' + d.game_name : '') + '! https://twitch.tv/' + login);
      const me = ctx.me(); ctx.helix('POST', '/chat/shoutouts?from_broadcaster_id=' + me.id + '&to_broadcaster_id=' + id + '&moderator_id=' + me.id).catch(() => {});
    } },
    permit: { level: 3, run: ({ args, reply }) => { const t = targetOf(args); if (!t) return reply('Usage: ' + db.prefix + 'permit <user>'); permits.set(t, now() + 60000); reply(t + ' may post a link for the next 60 seconds.'); } },
    quote: { cd: 5, run: ({ args, reply }) => {
      if (!db.quotes.length) return reply('No quotes yet. Mods can add one with ' + db.prefix + 'addquote <text>.');
      const q = args[0] ? db.quotes.find((x) => x.n === parseInt(args[0], 10)) : db.quotes[Math.floor(rng() * db.quotes.length)];
      reply(q ? '#' + q.n + ': ' + q.text + ' (' + q.date + ')' : 'No quote with that number.');
    } },
    addquote: { level: 3, run: ({ args, reply, u }) => {
      if (!args.length) return reply('Usage: ' + db.prefix + 'addquote <text>');
      const q = { n: ++db.quoteSeq, text: args.join(' '), by: u.name, date: new Date(now()).toISOString().slice(0, 10) }; db.quotes.push(q); save(); reply('Added quote #' + q.n + '.');
    } },
    delquote: { level: 3, run: ({ args, reply }) => { const n = parseInt(args[0], 10); const l = db.quotes.length; db.quotes = db.quotes.filter((q) => q.n !== n); save(); reply(l === db.quotes.length ? 'No quote #' + n + '.' : 'Deleted quote #' + n + '.'); } },
    counter: { level: 3, run: ({ args, reply }) => {
      const n = strip(args[0]).replace(/[^a-z0-9_]/g, ''), op = args[1] || ''; if (!n) return reply('Usage: ' + db.prefix + 'counter <name> [+|-|set N|reset]');
      let v = db.counters[n] || 0; if (op === '+') v++; else if (op === '-') v--; else if (op === 'set') v = parseInt(args[2], 10) || 0; else if (op === 'reset') v = 0;
      db.counters[n] = v; save(); reply(n + ': ' + v);
    } },

    clip: { cd: 20, userCd: 60, run: async ({ u, reply }) => {
      if (!db.clip.on) return;
      if (u.rank < rankName(db.clip.level)) return reply('Clips are for ' + db.clip.level + 's and above.');
      if (!ctx.state.stream.live) return reply('The stream is offline, so there is nothing to clip.');
      try { const c = await ctx.createClip(); reply('Clip created! ' + c.url + ' (it can take a few seconds to finish processing)'); }
      catch (err) { reply('Could not create a clip (' + err.message + ').'); }
    } },
    tts: { cd: 1, run: async ({ args, u, reply }) => {
      const c = ctx.tts.cfg(), cmd = c.command || {}, E = db.builtinEdits.tts, price = fmtNum(cmd.cost || 0);
      const say2 = async (key, vars) => { const t = E[key]; if (t) reply(await expand(t, { user: u, args: [], vars: Object.assign({ prefix: db.prefix, cost: cmd.cost ? ' (costs ' + price + ' ' + cur() + ')' : '', price, currency: cur(), level: cmd.level }, vars || {}) })); };
      if (!c.on || !cmd.on) return say2('off');
      if (u.rank < rankName(cmd.level)) return say2('level');
      const text = args.join(' ').trim(); if (!text) return say2('usage');
      const k = 'ttsuse:' + u.id, t = now();
      if (u.rank < 3 && t - (cdUser.get(k) || 0) < (cmd.userCd || 0) * 1000) return say2('wait');
      if (cmd.cost && u.rank < 3) { if (pt(u.id, u.name).pts < cmd.cost) return say2('poor', { balance: fmtNum(pt(u.id).pts) }); addPts(u.id, u.name, -cmd.cost, 'tts'); }
      try { await ctx.tts.say(text, { by: u.name }); cdUser.set(k, t); await say2('queued'); }
      catch (err) { if (cmd.cost && u.rank < 3) addPts(u.id, u.name, cmd.cost, 'tts refund'); await say2(err.message === 'blocked' ? 'blocked' : 'failed', { error: err.message }); }
    } },
    subathon: { cd: 3, run: ({ args, u, reply }) => {
      const a = (args[0] || '').toLowerCase(), viewerSafe = !a || ['rules', 'rule', '?', 'info'].includes(a);
      if (!viewerSafe && u.rank < 3) return reply('Only mods can change the subathon timer.');
      reply(ctx.subathon.command(args));
    } },
    subrules: { cd: 15, run: ({ reply }) => reply(ctx.subathon.rules()) },
    tip: { cd: 30, run: ({ reply }) => { const l = ctx.tipLink && ctx.tipLink(); reply(l ? 'Thank you for thinking of the stream! You can leave a tip here: ' + l : 'Tips are not set up yet.'); } },
    paypal: { cd: 30, run: ({ reply }) => { const l = ctx.tipLink && ctx.tipLink(); reply(l ? 'PayPal: ' + l : 'Tips are not set up yet.'); } },
    brb: { level: 3, cd: 3, run: async ({ reply }) => { const ok = await ctx.sceneFire('brb'); if (ok === false) reply('No scene is set for !brb (Auto scenes on the Control Board page).'); } },
    back: { level: 3, cd: 3, run: async ({ reply }) => { const ok = await ctx.sceneFire('back'); if (ok === false) reply('No scene is set for !back (Auto scenes on the Control Board page).'); } },
    ttsskip: { level: 3, cd: 1, run: ({ reply }) => { ctx.tts.ctl('skip'); reply('Skipped the speech.'); } },
    alerts: { level: 3, cd: 1, run: ({ args, reply }) => {
      const a = (args[0] || '').toLowerCase();
      if (!['pause', 'resume', 'skip', 'clear', 'mute', 'unmute'].includes(a)) return reply('Usage: ' + db.prefix + 'alerts pause|resume|skip|clear|mute|unmute');
      ctx.alertControl(a); reply({ pause: 'Alerts paused (they queue up).', resume: 'Alerts resumed.', skip: 'Skipped the current alert.', clear: 'Cleared the waiting alerts.', mute: 'Alert sounds muted.', unmute: 'Alert sounds back on.' }[a]);
    } },
    countdown: { level: 3, cd: 1, run: ({ args, reply }) => reply(ctx.countdown.command(args)) },
    timeleft: { cd: 10, run: ({ reply }) => reply(ctx.countdown.command([])) },
    song: { cd: 8, run: ({ reply }) => {
      const v = ctx.media ? ctx.media.view() : null;
      if (!v || v.status === 'none' || !v.title) return reply('Nothing is playing right now.');
      reply((v.status === 'paused' ? 'Paused: ' : 'Now playing: ') + v.title + (v.artist ? ' by ' + v.artist : '') + (v.album ? ' (' + v.album + ')' : '') + (v.link ? ' ' + v.link : ''));
    } },
    skip: { level: 3, cd: 3, run: async ({ reply }) => { try { await ctx.media.control('next'); reply('Skipped.'); } catch (err) { reply('Could not skip (' + err.message + ').'); } } },
    previous: { level: 3, cd: 3, run: async ({ reply }) => { try { await ctx.media.control('previous'); reply('Going back a track.'); } catch (err) { reply('Could not go back (' + err.message + ').'); } } },
    pause: { level: 3, cd: 3, run: async ({ reply }) => { try { await ctx.media.control('pause'); reply('Music paused.'); } catch (err) { reply('Could not pause (' + err.message + ').'); } } },
    play: { level: 3, cd: 3, run: async ({ reply }) => { try { await ctx.media.control('play'); reply('Music playing.'); } catch (err) { reply('Could not play (' + err.message + ').'); } } },
    volume: { level: 3, cd: 3, run: async ({ args, reply }) => {
      const v = ctx.media.view(); if (args[0] === undefined) return reply('Volume: ' + (v.volume == null ? 'unknown' : v.volume + '%'));
      const n = parseInt(args[0], 10); if (!(n >= 0 && n <= 100)) return reply('Usage: ' + db.prefix + 'volume <0-100>');
      try { await ctx.media.control('volume', n); reply('Volume set to ' + n + '%.'); } catch (err) { reply('Could not change the volume (' + err.message + ').'); }
    } },
    sr: { userCd: 30, cd: 3, run: async ({ args, u, reply }) => {
      const cfg = ctx.media.cfg(); if (!cfg.requests) return reply('Song requests are off right now.');
      if (u.rank < rankName(cfg.requestLevel)) return reply('Song requests are for ' + cfg.requestLevel + 's and above.');
      const q = args.join(' ').trim(); if (!q) return reply('Usage: ' + db.prefix + 'sr <song name or Spotify link>');
      try {
        const link = /(?:open\.spotify\.com\/track\/|spotify:track:)([A-Za-z0-9]+)/.exec(q);
        let uri, label;
        if (link) { uri = 'spotify:track:' + link[1]; label = 'your song'; }
        else { const r = await ctx.media.search(q); if (!r.length) return reply('No songs found for "' + q + '".'); uri = r[0].uri; label = r[0].name + ' by ' + r[0].artist; }
        await ctx.media.queue(uri); reply('Queued: ' + label + ' (requested by ' + u.name + ').');
      } catch (err) { reply('Could not queue that (' + err.message + ').'); }
    } },
    announce: { level: 3, cd: 2, run: ({ args, reply }) => {
      const col = ANN_COLORS.includes((args[0] || '').toLowerCase()) ? args.shift().toLowerCase() : 'primary';
      if (!args.length) return reply('Usage: ' + db.prefix + 'announce [' + ANN_COLORS.join('|') + '] <message>');
      say(args.join(' '), undefined, col);
    } },
    setvar: { level: 3, run: ({ args, reply }) => {
      const n = strip(args[0]).replace(/[^a-z0-9_]/g, ''), v = args.slice(1).join(' '); if (!n || !v) return reply('Usage: ' + db.prefix + 'setvar <name> <text>  - then use {var.' + (n || 'name') + '} in a command');
      db.vars[n] = { type: 'text', value: v.slice(0, 300), items: [] }; save(); reply('Variable {var.' + n + '} set.');
    } },
    listadd: { level: 3, run: ({ args, reply }) => {
      const n = strip(args[0]).replace(/[^a-z0-9_]/g, ''), v = args.slice(1).join(' '); if (!n || !v) return reply('Usage: ' + db.prefix + 'listadd <name> <item>  - {var.name} then picks a random item');
      const cur0 = db.vars[n] && db.vars[n].type === 'list' ? db.vars[n] : (db.vars[n] = { type: 'list', value: '', items: [] }); cur0.items.push(v.slice(0, 200)); save(); reply('Added to {var.' + n + '} (' + cur0.items.length + ' items).');
    } },
    // ---- currency: daily, shop, admin tools
    daily: { cd: 2, run: ({ u, reply }) => {
      const D = db.daily; if (!D.on) return;
      const p = pt(u.id, u.name), day = new Date(now()).toISOString().slice(0, 10), yday = new Date(now() - 86400000).toISOString().slice(0, 10);
      if (p.lastDaily === day) return reply(u.name + ', you already claimed your daily ' + cur() + '. Come back tomorrow!');
      p.streak = p.lastDaily === yday ? (p.streak || 0) + 1 : 1; p.lastDaily = day;
      const amt = D.amount + D.streakBonus * Math.min(p.streak - 1, D.maxStreak);
      addPts(u.id, u.name, amt, 'daily (day ' + p.streak + ')');
      reply(u.name + ' claimed ' + fmtNum(amt) + ' ' + cur() + ' (day ' + p.streak + ' streak)! Balance: ' + fmtNum(p.pts));
    } },
    watchtime: { cd: 5, userCd: 10, run: ({ args, u, reply }) => {
      const who = args[0] ? Object.values(db.points).find((x) => x.name.toLowerCase() === strip(args[0])) : pt(u.id, u.name);
      if (!who) return reply(args[0] + ' has no recorded time yet.');
      const m = who.mins || 0; reply(who.name + ' has been active in chat for ' + (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm while live.');
    } },
    shop: { cd: 8, run: ({ reply }) => {
      const items = db.shop.filter((i) => i.enabled);
      reply(items.length ? 'Shop: ' + items.map((i, n) => (n + 1) + ') ' + i.name + ' (' + fmtNum(i.cost) + ')').join('  ') + ' - redeem with ' + db.prefix + 'redeem <name or number>' : 'The shop is empty.');
    } },
    redeem: { userCd: 2, run: async ({ args, u, reply }) => {
      const items = db.shop.filter((i) => i.enabled); if (!args.length) return reply('Usage: ' + db.prefix + 'redeem <item name or number> [message]. See ' + db.prefix + 'shop.');
      let item, text = '';
      if (/^\d+$/.test(args[0]) && items[+args[0] - 1]) { item = items[+args[0] - 1]; text = args.slice(1).join(' '); }
      else {
        const joined = args.join(' ').toLowerCase();
        item = items.filter((i) => joined === i.name.toLowerCase() || joined.startsWith(i.name.toLowerCase() + ' ')).sort((a, b) => b.name.length - a.name.length)[0];
        if (item) text = args.join(' ').slice(item.name.length).trim();
      }
      if (!item) return reply('No shop item called "' + args.join(' ') + '". See ' + db.prefix + 'shop.');
      const t = now(), gk = 'shop:' + item.id, uk = gk + ':' + u.id;
      if (item.stock != null && item.stock <= 0) return reply(item.name + ' is out of stock.');
      if (t - (cdGlobal.get(gk) || 0) < (item.cd || 0) * 1000 || t - (cdUser.get(uk) || 0) < (item.userCd || 0) * 1000) return reply(item.name + ' is on cooldown.');
      const p = pt(u.id, u.name); if (p.pts < item.cost) return reply(u.name + ', ' + item.name + ' costs ' + fmtNum(item.cost) + ' ' + cur() + ' and you have ' + fmtNum(p.pts) + '.');
      cdGlobal.set(gk, t); cdUser.set(uk, t);
      addPts(u.id, u.name, -item.cost, 'shop: ' + item.name); item.uses = (item.uses || 0) + 1; if (item.stock != null) item.stock--;
      const entry = { n: 0, uid: u.id, name: u.name, itemId: item.id, itemName: item.name, cost: item.cost, text, ts: t };
      db.lastRedeem = u.name + ' - ' + item.name;
      if (item.approval) { entry.n = ++db.pendingSeq; db.pending.push(entry); save(); return reply(u.name + ', ' + item.name + ' is waiting for approval (#' + entry.n + '). Your ' + cur() + ' are refunded if it is denied.'); }
      save(); await fulfill(entry);
    } },
    approve: { level: 3, run: async ({ args, reply }) => {
      const e = db.pending.find((x) => x.n === parseInt(args[0], 10)); if (!e) return reply('No pending redemption #' + (args[0] || '?') + '.');
      db.pending = db.pending.filter((x) => x !== e); save(); await fulfill(e); reply('Approved #' + e.n + '.');
    } },
    deny: { level: 3, run: ({ args, reply }) => {
      const e = db.pending.find((x) => x.n === parseInt(args[0], 10)); if (!e) return reply('No pending redemption #' + (args[0] || '?') + '.');
      refund(e); reply('Denied #' + e.n + ' and refunded ' + e.name + '.');
    } },
    addpoints: { level: 3, run: async ({ args, reply }) => adjust(args, reply, 'add') },
    removepoints: { level: 3, run: async ({ args, reply }) => adjust(args, reply, 'remove') },
    setpoints: { level: 3, run: async ({ args, reply }) => adjust(args, reply, 'set') },
    bonus: { level: 3, run: ({ args, reply }) => {
      const n = parseInt(args[0], 10); if (!(n > 0)) return reply('Usage: ' + db.prefix + 'bonus <amount> - gives everyone who chatted in the last 10 minutes.');
      let count = 0; for (const [id, a] of active) if (now() - a.ts <= 10 * 60000) { addPts(id, a.name, n, 'bonus'); count++; }
      reply('Gave ' + fmtNum(n) + ' ' + cur() + ' to ' + count + ' active viewer' + (count === 1 ? '' : 's') + '!');
    } },

    // ---- points + games
    points: { cd: 3, run: async ({ args, u, reply }) => {
      if (args[0]) { const l = strip(args[0]); const p = Object.values(db.points).find((x) => x.name.toLowerCase() === l); return reply(p ? p.name + ' has ' + fmtNum(p.pts) + ' ' + cur() + '.' : args[0] + ' has no ' + cur() + ' yet.'); }
      const p = pt(u.id, u.name); const rank = Object.values(db.points).filter((x) => x.pts > p.pts).length + 1;
      reply(u.name + ', you have ' + fmtNum(p.pts) + ' ' + cur() + ' (rank #' + rank + ').');
    } },
    gamble: { userCd: 8, run: ({ args, u, reply }) => {
      const amt = validBet(u, args[0], reply); if (!amt) return;
      const p = pt(u.id, u.name), win = rng() < db.games.gambleWin;
      addPts(u.id, u.name, win ? amt : -amt, 'gamble ' + (win ? 'win' : 'loss'));
      reply(u.name + (win ? ' won ' : ' lost ') + fmtNum(amt) + ' ' + cur() + (win ? '!' : '.') + ' You now have ' + fmtNum(p.pts) + '.');
    } },
    slots: { userCd: 8, run: ({ args, u, reply }) => {
      const amt = validBet(u, args[0], reply); if (!amt) return;
      const r = [0, 0, 0].map(() => REELS[Math.floor(rng() * REELS.length)]), p = pt(u.id, u.name);
      const same = new Set(r).size; let mult = 0; if (same === 1) mult = r[0] === '7️⃣' ? 10 : 6; else if (same === 2) mult = 1.5;
      const net = Math.floor(amt * mult) - amt; addPts(u.id, u.name, net, 'slots');
      reply('[ ' + r.join(' | ') + ' ] ' + u.name + (net > 0 ? ' wins ' + fmtNum(net) + '!' : net === 0 ? ' breaks even.' : ' loses ' + fmtNum(-net) + '.') + ' Balance: ' + fmtNum(p.pts));
    } },
    race: { level: 3, run: async ({ args, reply }) => {
      const a = (args[0] || '').toLowerCase(), r = a === 'cancel' ? await race.cancel() : a === 'now' ? await race.run(args.slice(1).join(' ')) : await race.start({});
      if (r && r.error) reply(r.error);
    } },
    words: { level: 3, run: ({ args, u, reply }) => wordsCmd(args, u, reply) },
    recap: { level: 3, cd: 30, run: async ({ reply }) => { if (!ctx.recap || !ctx.recap.chatOn()) return; try { reply('Chat recap: ' + await ctx.recap.catchUp()); } catch (e) { reply(e.message.slice(0, 200)); } } },
    wordtop: { level: 0, run: ({ reply }) => { const st = wordStats.get(); reply(st.top.length ? 'Word Rush all-time: ' + st.top.slice(0, 5).map((p, i) => (i + 1) + '. ' + p.name + ' ' + p.pts).join(', ') + (st.record.round ? ' | Record: chat beat ' + st.record.round + ' rounds (' + (st.record.by || 'nobody') + ' won)' : '') : 'Nobody has scored in Word Rush yet.'); } },
    wheel: { level: 3, run: ({ args, reply }) => wheelCmd(args, reply) },
    spin: { level: 3, run: ({ args, reply }) => wheelCmd(args, reply) },
    dance: { level: 3, run: ({ args, u, reply }) => { if (args[0] === 'stop') { danceStop(); return reply('Party stopped.'); } const r = danceStart(u); if (r) reply(r); } },
    hit: arenaCmd((a, u) => arena.boss.hit(u)),
    boss: { level: 3, run: ({ args, u, reply }) => { const r = args[0] === 'status' ? arena.boss.status() : args[0] === 'stop' ? (arena.stop(), 'Stopped.') : arena.boss.start(u, args.join(' ')); if (r) reply(r); } },
    arena: { level: 3, run: ({ args, reply }) => { const r = args[0] === 'stop' ? (arena.stop(), 'Stopped.') : arena.royale.open(); if (r) reply(r); } },
    join: arenaCmd((a, u) => arena.royale.join(u)),
    teams: { level: 3, run: ({ args, reply }) => { const r = args[0] === 'stop' ? (arena.stop(), 'Stopped.') : arena.teams.open(); if (r) reply(r); } },
    red: arenaCmd((a, u) => arena.teams.join(u, 'red')),
    blue: arenaCmd((a, u) => arena.teams.join(u, 'blue')),
    duel: { userCd: 10, run: ({ args, u, reply }) => {
      const t = targetOf(args), amt = parseInt(args[1], 10);
      if (isBotName(t)) return botDuel(u, amt, reply);
      if (!t || !(amt > 0)) return reply('Usage: ' + db.prefix + 'duel <user> <amount>');
      if (t === u.login) return reply(u.name + ' cannot duel themselves.');
      if (pt(u.id, u.name).pts < amt) return reply(u.name + ', you only have ' + fmtNum(pt(u.id).pts) + ' ' + cur() + '.');
      duels.set(t, { from: u, amt, ts: now() });
      reply(t + ', ' + u.name + ' challenges you to a duel for ' + fmtNum(amt) + ' ' + cur() + '! Type ' + db.prefix + 'accept within ' + db.games.duelSeconds + 's.');
    } },
    accept: { run: ({ u, reply }) => {
      const d = duels.get(u.login); if (!d || now() - d.ts > db.games.duelSeconds * 1000) return;
      duels.delete(u.login);
      const a = pt(d.from.id, d.from.name), b = pt(u.id, u.name);
      if (a.pts < d.amt || b.pts < d.amt) return reply('Duel cancelled: someone does not have enough ' + cur() + '.');
      const aWins = rng() < 0.5, w = aWins ? a : b, l = aWins ? b : a;
      addPts(aWins ? d.from.id : u.id, w.name, d.amt, 'duel win'); addPts(aWins ? u.id : d.from.id, l.name, -d.amt, 'duel loss');
      const msg = w.name + ' wins the duel and takes ' + fmtNum(d.amt) + ' ' + cur() + ' from ' + l.name + '!';
      // the pixel duel overlay plays first (the result is already decided, it is only shown); the chat result waits until it ends so nobody is spoiled
      const wait = db.games.duelAnim !== false && ctx.duel ? ctx.duel({ a: d.from.name, b: u.name, winner: aWins ? 'a' : 'b', amount: d.amt, currency: cur() }) : 0;
      if (wait > 0) setTimeout(() => reply(msg), wait); else reply(msg);
    } },
    give: { userCd: 5, run: async ({ args, u, reply }) => {
      const t = targetOf(args), name = bare(args[0]);
      const a = pt(u.id, u.name), amt = /^all$/i.test(args[1] || '') ? a.pts : parseInt(args[1], 10);
      if (!t || !(amt > 0)) return reply('Usage: ' + db.prefix + 'give <user> <amount|all>  (you have ' + fmtNum(a.pts) + ' ' + cur() + ')');
      if (t === u.login) return reply('You cannot give ' + cur() + ' to yourself.');
      if (a.pts < amt) return reply(u.name + ', you only have ' + fmtNum(a.pts) + ' ' + cur() + '.');
      let tid = Object.keys(db.points).find((k) => db.points[k].name.toLowerCase() === t);
      if (!tid) { try { tid = await ctx.resolveUser(t); } catch (err) { return reply('No Twitch user called ' + name + '.'); } }
      if (tid === u.id) return reply('You cannot give ' + cur() + ' to yourself.');
      addPts(u.id, u.name, -amt, 'gave to ' + name); const r = addPts(tid, name, amt, 'gift from ' + u.name);
      reply(u.name + ' gave ' + fmtNum(amt) + ' ' + cur() + ' to ' + r.name + '. (' + u.name + ': ' + fmtNum(a.pts) + ', ' + r.name + ': ' + fmtNum(r.pts) + ')');
    } },
    top: { cd: 10, run: ({ reply }) => {
      const t = Object.values(db.points).sort((a, b) => b.pts - a.pts).slice(0, 5);
      reply(t.length ? 'Top ' + cur() + ': ' + t.map((p, i) => (i + 1) + '. ' + p.name + ' (' + fmtNum(p.pts) + ')').join('  ') : 'Nobody has any ' + cur() + ' yet.');
    } },
    trivia: { level: 3, run: ({ args, reply }) => {
      if (args[0] === 'stop') { if (trivia) { clearTimeout(trivia.t); trivia = null; reply('Trivia stopped.'); } return; }
      if (trivia) return reply('A trivia question is already running!');
      const q = db.trivia[Math.floor(rng() * db.trivia.length)];
      trivia = { q, answers: q.a.split('|').map((x) => x.trim().toLowerCase()), t: setTimeout(() => { if (trivia) { const a = trivia.q.a.split('|')[0]; trivia = null; say('Time is up! The answer was: ' + a); } }, db.games.triviaSeconds * 1000) };
      if (trivia.t.unref) trivia.t.unref();
      reply('TRIVIA (' + db.games.triviaSeconds + 's, ' + db.games.triviaReward + ' ' + cur() + '): ' + q.q);
    } },
    raffle: { run: ({ args, u, reply }) => {
      const sub = (args[0] || '').toLowerCase();
      if (u.rank < 3 || !sub) return reply(raffle ? 'A raffle is open! Type ' + db.prefix + 'enter to join (' + raffle.entrants.size + ' entered).' : 'No raffle is running.');
      if (sub === 'open') { raffle = { entrants: new Map() }; return reply('RAFFLE OPEN! Type ' + db.prefix + 'enter to join.'); }
      if (sub === 'cancel' || sub === 'close') { raffle = null; return reply('Raffle closed.'); }
      if (sub === 'draw') return draw(reply);
    } },
    enter: { run: ({ u, reply }) => { if (!raffle) return; if (raffle.entrants.has(u.id)) return; raffle.entrants.set(u.id, u.name); if (raffle.entrants.size % 5 === 0) reply(raffle.entrants.size + ' people have entered the raffle!'); } },
    draw: { level: 3, run: ({ reply }) => draw(reply) },
    '8ball': { userCd: 5, run: ({ args, u, reply }) => { if (!args.length) return reply(u.name + ', ask a question first!'); reply('🎱 ' + EIGHT_BALL[Math.floor(rng() * EIGHT_BALL.length)]); } },
    roll: { userCd: 3, run: ({ args, u, reply }) => {
      const m = /^(\d{1,2})?d(\d{1,4})$/i.exec(args[0] || 'd6') || [null, '1', args[0] && /^\d+$/.test(args[0]) ? args[0] : '6']; const n = +(m[1] || 1), s = Math.max(2, +m[2] || 6);
      const rolls = Array.from({ length: Math.min(n, 20) }, () => 1 + Math.floor(rng() * s)); reply(u.name + ' rolled ' + (rolls.length > 1 ? rolls.join(' + ') + ' = ' + rolls.reduce((a, b) => a + b, 0) : rolls[0]) + ' (d' + s + ')');
    } },
    flip: { userCd: 3, run: ({ u, reply }) => reply(u.name + ' flipped ' + (rng() < 0.5 ? 'HEADS' : 'TAILS') + '.') },
  };
  // !addpoints / !removepoints / !setpoints for mods; looks the viewer up on Twitch if not seen yet.
  async function adjust(args, reply, mode) {
    const name = strip(args[0]), n = parseInt(args[1], 10);
    if (!name || !(Number.isFinite(n)) || (mode !== 'set' && n <= 0) || n < 0) return reply('Usage: ' + db.prefix + mode + 'points <user> <amount>');
    let id = Object.keys(db.points).find((k) => db.points[k].name.toLowerCase() === name);
    if (!id) { try { id = await ctx.resolveUser(name); } catch (e) { return reply('No such user: ' + args[0]); } }
    const p = pt(id, bare(args[0])), delta = mode === 'add' ? n : mode === 'remove' ? -n : n - p.pts;
    addPts(id, p.name, delta, mode + ' by mod'); reply(p.name + ' now has ' + fmtNum(p.pts) + ' ' + cur() + '.');
  }
  // complete a shop purchase: announce it and fire its alert.
  async function fulfill(entry) {
    const item = db.shop.find((i) => i.id === entry.itemId), vars = { item: entry.itemName, cost: entry.cost, text: entry.text };
    say(await expand((item && item.response) || '$(user) redeemed $(item)!', { user: { id: entry.uid, name: entry.name }, args: entry.text ? entry.text.split(/\s+/) : [], vars }));
    if (item && item.alertKey && ctx.fireCustom) ctx.fireCustom(item.alertKey, { name: entry.name, message: entry.text || entry.itemName, amount: entry.cost }, entry.cost);
  }
  // give the cost back, restock the item and remove the pending request.
  function refund(entry) {
    addPts(entry.uid, entry.name, entry.cost, 'refund: ' + entry.itemName);
    const item = db.shop.find((i) => i.id === entry.itemId); if (item && item.stock != null) item.stock++;
    db.pending = db.pending.filter((x) => x.n !== entry.n); save();
  }
  // aliases: other names for the same built-ins.
  builtins.songrequest = builtins.sr;
  builtins.buy = builtins.redeem; builtins.send = builtins.give; builtins.pay = builtins.give;
  builtins.commands.cd = db.builtinEdits.commands.cd == null ? 15 : db.builtinEdits.commands.cd; builtins.leaderboard = builtins.top; builtins.setgame = builtins.game; builtins.settitle = builtins.title;
  // pick a random raffle winner and close the raffle.
  function draw(reply) {
    if (!raffle || !raffle.entrants.size) return reply('Nobody has entered the raffle.');
    const ids = [...raffle.entrants.keys()], id = ids[Math.floor(rng() * ids.length)], name = raffle.entrants.get(id);
    reply('🎉 The raffle winner is @' + name + '! (' + ids.length + ' entries)'); raffle = null;
  }

  // ------------------------------------------------------------------ incoming chat
  // every chat line comes through here: tracking, filters, trivia / Word Rush answers, then commands.
  async function onMessage(e) {
    if (!db.enabled || !ctx.me()) return;
    const text = oneLine(e.message && e.message.text, 500);
    const u = { id: e.chatter_user_id, login: String(e.chatter_user_login || '').toLowerCase(), name: e.chatter_user_name || e.chatter_user_login, rank: rankOf(e), msgId: e.message_id };
    if (isOwnEcho(u, text)) return;
    lineCount++; const existed = !!db.points[u.id], P = pt(u.id, u.name); P.msgs = (P.msgs || 0) + 1;
    const RG = db.extras.regulars; if (RG.on && u.rank < 1 && ((RG.minutes && P.mins >= RG.minutes) || (RG.messages && P.msgs >= RG.messages))) u.rank = 1;   // regulars count as subscribers for commands/filters
    active.set(u.id, { name: u.name, ts: now(), sub: u.rank >= 1 });
    if (!chatters.includes(u.name)) { chatters.push(u.name); if (chatters.length > 50) chatters.shift(); }
    if (await runFilters(u, e, text)) return;
    const WL = db.extras.welcome;
    if (!existed && WL.on && u.rank < 4 && (!WL.onlyLive || ctx.state.stream.live) && !KNOWN_BOTS.includes(u.login)) say(await expand(WL.msg, { user: u, args: [], vars: {} }), undefined, WL.announce);
    if (trivia && trivia.answers.includes(text.toLowerCase())) {   // trivia answer
      clearTimeout(trivia.t); trivia = null; addPts(u.id, u.name, db.games.triviaReward, 'trivia');
      say(u.name + ' got it! +' + db.games.triviaReward + ' ' + cur() + '.', e.message_id); return;
    }
    if (words.active() && words.guess(u, text)) return;   // a word on the Word Rush board
    if (!text.startsWith(db.prefix)) return;
    const [cmd, ...args] = text.slice(db.prefix.length).trim().split(/\s+/);
    if (cmd) {
      const c = cmd.toLowerCase(), alias = cur().toLowerCase().replace(/[^a-z0-9_]/g, '');
      await runCommand(alias && c === alias && !builtins[c] && !findCommand(c) ? 'points' : c, args, u, e);
    }
  }
  /** Run "!command args" as if `user` typed it (used by reward hooks). rank: 0 viewer .. 4 broadcaster. */
  async function execute(text, user, rank) {
    const t = String(text || '').trim(), body = t.startsWith(db.prefix) ? t.slice(db.prefix.length) : t.replace(/^!/, '');
    const [cmd, ...args] = body.trim().split(/\s+/); if (!cmd) return false;
    const u = { id: user.id || '', login: String(user.login || user.name || '').toLowerCase(), name: user.name, rank: rank == null ? 4 : rank, msgId: '' };
    await runCommand(cmd.toLowerCase(), args, u, { message_id: '' }); return true;
  }
  // expand variables for reward hooks and events (a user and extra values supplied by the caller).
  const expandFor = (text, user, vars, args) => expand(text, { user, args: args || [], vars: vars || {} });
  // stream event (follow, sub, bits, raid...): may start a bits game, pay a currency bonus and post the event message.
  async function onEvent(event, vars) {
    if (event === 'bits' && db.enabled && vars.message && Number(vars.amount) > 0) {   // bits can also start the group games
      const B = db.games.bits || {}, m = String(vars.message).toLowerCase();
      for (const [g, cmd] of [['dance', 'dance'], ['boss', 'boss'], ['royale', 'arena'], ['race', 'race']]) {
        if (B[g] > 0 && Number(vars.amount) >= B[g] && new RegExp('\\b' + cmd + '\\b').test(m) && !(db.games.off || []).includes(g)) { execute('!' + cmd, { id: vars.uid || '', name: vars.name || 'Someone' }, 4).catch(() => {}); break; }
      }
    }
    try { arena.onEvent(event, vars); } catch (e) { log('arena event error', e.message); }
    if (event === 'raid' && db.enabled && db.extras.raidShout.on && vars.name) execute('!so ' + vars.name, { id: '', name: 'broadcaster' }, 4).catch(() => {});
    const B = db.bonuses[event];
    if (db.enabled && B && B.on && vars.uid) {
      let amt = 0, why = event;
      if (event === 'follow') { if (!db.claimedFollow[vars.uid]) { db.claimedFollow[vars.uid] = 1; amt = B.amount; } }
      else if (event === 'giftsub') amt = B.amount * (Number(vars.total) || 1);
      else if (event === 'bits') amt = Math.floor((Number(vars.amount) || 0) / 100) * B.amount;
      else if (event === 'raid') amt = B.amount + (B.perViewer || 0) * (Number(vars.viewers) || 0);
      else amt = B.amount;
      if (amt > 0) addPts(vars.uid, vars.name, amt, why + ' bonus');
    }
    const ev = db.events[event === 'giftsub' || event === 'sub' || event === 'resub' || event === 'bits' || event === 'raid' || event === 'follow' ? event : ''];
    if (!db.enabled || !ev || !ev.on) return;
    say(await expand(ev.msg, { user: { id: '', name: vars.name || '' }, args: [], vars }), undefined, ev.announce);
  }

  // ------------------------------------------------------------------ timers + points ticker
  // when each timer last fired and the chat line count then, so a timer needs both time and enough chat.
  const timerLast = new Map();
  let linesAtFire = new Map(), ticker = null;
  // every 15s: post timers that are due. The first sighting of a timer only starts its clock.
  function tick() {
    const t = now(), live = ctx.state.stream.live, jobs = [];
    for (const tm of db.timers) {
      if (!tm.enabled || (tm.onlyLive && !live)) continue;
      if (!timerLast.has(tm.id)) { timerLast.set(tm.id, t); linesAtFire.set(tm.id, lineCount); continue; }
      if (t - timerLast.get(tm.id) >= tm.minutes * 60000 && lineCount - (linesAtFire.get(tm.id) || 0) >= (tm.minLines || 0)) {
        timerLast.set(tm.id, t); linesAtFire.set(tm.id, lineCount);
        jobs.push(expand(tm.message, { user: { id: '', name: '' }, args: [] }).then((txt) => say(txt, undefined, tm.announce)));
      }
    }
    return Promise.all(jobs);
  }
  // every minute: pay watch-time currency to chatters active in the last 10 minutes (subscribers get the multiplier); only while live unless offline earning is on.
  function awardPoints() {
    const t = now(); if (!db.enabled || (!ctx.state.stream.live && !db.awardOffline)) return;
    for (const [id, a] of active) {
      if (t - a.ts > 10 * 60000) { active.delete(id); continue; }
      const p = pt(id, a.name); addPts(id, a.name, Math.round(db.pointsPerMin * (a.sub ? db.subMultiplier : 1)), 'watch', { log: false }); p.mins++;
    }
    save();
  }
  // start the timer and currency loops once; unref so they never keep the process alive.
  function start() {
    if (ticker) return;
    ticker = [setInterval(tick, 15000), setInterval(awardPoints, 60000)]; ticker.forEach((x) => x.unref && x.unref());
  }

  // ------------------------------------------------------------------ dashboard API
  // currency label files for overlays.
  function labels() {
    const all = Object.values(db.points), top = all.slice().sort((a, b) => b.pts - a.pts);
    return {
      currency_name: { value: cur(), desc: 'Name of your chat currency' },
      currency_top: { value: top.slice(0, 5).map((p, i) => (i + 1) + '. ' + p.name + ' - ' + fmtNum(p.pts)).join('\n'), desc: 'Top 5 viewers by currency' },
      currency_richest_viewer: { value: top[0] ? top[0].name + ' - ' + fmtNum(top[0].pts) : '', desc: 'Viewer with the most currency' },
      currency_in_circulation: { value: fmtNum(all.reduce((a, p) => a + p.pts, 0)), desc: 'Total currency held by all viewers' },
      latest_shop_redemption: { value: db.lastRedeem, desc: 'Latest shop redemption (viewer - item)' },
    };
  }
  /** a page for viewers listing what the bot can do: {html, md, text} */
  function exportCommands() {
    const P = db.prefix, lvl = { everyone: 'Everyone', subscriber: 'Subscribers', vip: 'VIPs', moderator: 'Mods', broadcaster: 'Streamer' };
    const strip = (t) => String(t || '').replace(/\$\([^)]*\)|\{[^{}\n]*\}/g, '…').replace(/\s*…\s*/g, ' … ').replace(/\s+/g, ' ').trim();
    const custom = db.commands.filter((c) => c.enabled && !c.hidden).map((c) => [P + c.name + ((c.aliases || []).length ? ' (' + c.aliases.map((a) => P + a).join(', ') + ')' : ''), lvl[c.level] || 'Everyone', c.desc || strip(String(c.response).split('\n')[0])]);
    const cs = cur(), builtin = [];
    const add = (cond, group, name, who, desc) => { if (cond) builtin.push([group, P + name, who, desc]); };
    add(true, 'Info', 'uptime', 'Everyone', 'How long the stream has been live');
    add(true, 'Info', 'game / !title', 'Everyone', 'The current category and title');
    add(true, 'Info', 'followage [user]', 'Everyone', 'How long someone has followed');
    add(true, 'Info', 'accountage [user]', 'Everyone', 'How old a Twitch account is');
    add(true, 'Info', 'quote [number]', 'Everyone', 'A saved quote');
    add(true, 'Info', 'nextad', 'Everyone', 'When the next ad break is');
    add(!!ctx.countdown, 'Info', 'timeleft', 'Everyone', 'Time left on the stream timer');
    add(!!ctx.media, 'Music', 'song', 'Everyone', 'The song that is playing');
    add(!!(ctx.media && ctx.media.cfg().requests), 'Music', 'sr <song or link>', lvl[ctx.media && ctx.media.cfg().requestLevel] || 'Everyone', 'Request a song (Spotify)');
    add(db.clip.on, 'Info', 'clip', lvl[db.clip.level], 'Make a clip of what just happened');
    add(true, cs, 'points [user]', 'Everyone', 'See your ' + cs + ' and your rank');
    add(db.daily.on, cs, 'daily', 'Everyone', 'Claim your daily ' + cs + ' (streaks give more)');
    add(true, cs, 'give <user> <amount>', 'Everyone', 'Send ' + cs + ' to another chatter');
    add(true, cs, 'top', 'Everyone', 'The ' + cs + ' leaderboard');
    add(true, cs, 'watchtime', 'Everyone', 'How long you have been active in chat');
    add(db.shop.some((i) => i.enabled), cs, 'shop / !redeem <item>', 'Everyone', 'Spend ' + cs + ' on rewards: ' + db.shop.filter((i) => i.enabled).map((i) => i.name + ' (' + i.cost + ')').join(', '));
    add(!!(ctx.tts && ctx.tts.cfg().command && ctx.tts.cfg().command.on), cs, 'tts <message>' + (db.builtinEdits.tts.aliases.length ? ' (' + db.builtinEdits.tts.aliases.map((a) => P + a).join(', ') + ')' : ''), lvl[ctx.tts && ctx.tts.cfg().command.level] || 'Everyone', 'Have your message read out loud on stream' + (ctx.tts && ctx.tts.cfg().command.cost ? ' (costs ' + ctx.tts.cfg().command.cost + ' ' + cs + ')' : ''));
    const off = db.games.off || [], gOn = (id) => !off.includes(id);
    add(gOn('gamble'), 'Games', 'gamble <amount|all>', 'Everyone', 'Bet your ' + cs);
    add(gOn('slots'), 'Games', 'slots <amount>', 'Everyone', 'Spin the slot machine');
    add(true, 'Games', 'duel <user> <amount>  then  !accept', 'Everyone', 'Challenge someone for ' + cs);
    add(true, 'Games', 'roll [NdM] / !flip / !8ball <question>', 'Everyone', 'Dice, coin and the magic 8-ball');
    add(gOn('raffle'), 'Games', 'enter', 'Everyone', 'Join a raffle when one is open');
    add(gOn('boss'), 'Games', 'hit', 'Everyone', 'Attack the boss while a boss raid is on');
    add(gOn('royale'), 'Games', 'join', 'Everyone', 'Join the arena when it is open');
    add(gOn('teams'), 'Games', 'red / !blue', 'Everyone', 'Pick a side in a team battle');
    add(gOn('words'), 'Games', 'wordtop', 'Everyone', 'The all-time Word Rush leaderboard');
    // everything the mods and the streamer can type (the ones that need the moderator level)
    const mods = [
      ['addcom <name> <text>', 'Add a command (add -ul=subscriber or -cd=30 to set who can use it and the wait)'], ['editcom <name> <text>', 'Change a command'], ['delcom <name>', 'Delete a command'],
      ['title <new title>', 'Change the stream title (also !settitle)'], ['game <category>', 'Change the category (also !setgame); !gamesearch <name> lists categories without changing anything'],
      ['so <user>', 'Give a streamer a shoutout'], ['announce [color] <message>', 'Post a highlighted announcement in chat (blue, green, orange, purple)'], ['permit <user>', 'Let one person post a link for the next 60 seconds'],
      ['addquote <text>', 'Save a quote'], ['delquote <number>', 'Remove a quote'], ['counter <name> [+ | - | set N | reset]', 'Show or change a counter'], ['setvar <name> <text>', 'Set a variable'], ['listadd <name> <item>', 'Add an item to a list variable'],
      ['brb / !back', 'Switch to the Be Right Back scene, and back'], ['ad <30-180>', 'Run an ad break (seconds)'], ['snooze', 'Push the next ad back'],
      ['alerts pause|resume|skip|clear|mute|unmute', 'Control the stream alerts'], ['countdown <10 | +5 | -30s | pause | resume | reset | hide | show>', 'Control the countdown timer'],
      ['skip / !previous / !pause / !play', 'Control the music'], ['volume <0-100>', 'Set the music volume'],
      ['approve <number> / !deny <number>', 'Approve or deny a shop redemption (deny refunds it)'], ['addpoints <user> <amount> / !removepoints / !setpoints', 'Give, take or set someone\'s ' + cs], ['bonus <amount>', 'Give everyone who chatted in the last 10 minutes some ' + cs],
    ];
    if (ctx.tts && ctx.tts.cfg().on) mods.push(['ttsskip', 'Skip the text-to-speech message that is playing']);
    if (gOn('trivia')) mods.push(['trivia [stop]', 'Start a trivia question (the first right answer wins)']);
    if (gOn('raffle')) mods.push(['raffle open | cancel | draw', 'Open a raffle (viewers type !enter), close it, or draw the winner (!draw works too)']);
    if (gOn('words')) mods.push(['words [number | skip | stop]', 'Start Word Rush (a number sets the rounds), end the round, or stop the game']);
    if (ctx.recap && ctx.recap.chatOn()) mods.push(['recap', 'A one-line summary of what chat has been talking about (made by Claude, at most once every 5 minutes)']);
    if (gOn('wheel')) mods.push(['wheel [options | stop]', 'Spin the wheel: your saved list, or options typed here like !wheel pizza, tacos, sushi (also !spin)']);
    if (gOn('dance')) mods.push(['dance [stop]', 'Start the Dance Party']);
    if (gOn('race')) mods.push(['race [now | cancel]', 'Open a horse race (a prediction); now runs it, cancel refunds']);
    if (gOn('boss')) mods.push(['boss [name | status | stop]', 'Summon the boss (optionally with a name), check on it, or stop it']);
    if (gOn('royale')) mods.push(['arena [stop]', 'Open the arena royale, or stop it']);
    if (gOn('teams')) mods.push(['teams [stop]', 'Open a team battle, or stop it']);
    const channel = (ctx.me() && ctx.me().login) || 'the stream', groups = {};
    for (const x of builtin) (groups[x[0]] = groups[x[0]] || []).push(x.slice(1));
    groups['Mods & streamer'] = mods.map((r) => [P + r[0], 'Mods', r[1]]);
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const table = (rows) => '<table>' + rows.map((r) => '<tr><td class="c">' + esc(r[0]) + '</td><td class="w">' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>').join('') + '</table>';
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(channel) + ' chat commands</title><style>' +
      ':root{--iron:#222A2A;--aqua:#4FBBBC;--heat:#F39120;--cream:#E2DAC2;--rust:#EC4624}*{box-sizing:border-box}body{margin:0;background:#222A2A;color:#E2DAC2;font-family:"Bahnschrift","Segoe UI",sans-serif}' +
      'header{padding:26px 22px 18px;background:#1A2020;border-bottom:6px solid;border-image:linear-gradient(90deg,#4FBBBC 0 30%,#F39120 30% 55%,#EC4624 55% 75%,#B13A22 75% 90%,#E2DAC2 90%) 1}h1{margin:0;font-size:30px;letter-spacing:5px;text-transform:uppercase}header p{margin:6px 0 0;color:#4FBBBC;letter-spacing:3px}' +
      'main{max-width:820px;margin:0 auto;padding:10px 22px 50px}h2{color:#F39120;letter-spacing:4px;text-transform:uppercase;font-size:15px;margin:28px 0 8px}table{width:100%;border-collapse:collapse}td{padding:8px 10px 8px 0;border-bottom:1px solid #2f3938;vertical-align:top}' +
      '.c{color:#4FBBBC;font-weight:700;white-space:nowrap}.w{color:#9aa39f;font-size:13px;white-space:nowrap}</style></head><body><header><h1>' + esc(channel) + '</h1><p>CHAT COMMANDS</p></header><main>' +
      (custom.length ? '<h2>Fun &amp; info</h2>' + table(custom) : '') + Object.keys(groups).map((g) => '<h2>' + esc(g) + '</h2>' + table(groups[g])).join('') + '</main></body></html>';
    const md = ['# ' + channel + ' chat commands', ''].concat(custom.length ? ['## Fun & info', '', ...custom.map((r) => '**' + r[0] + '** (' + r[1] + '): ' + r[2]), ''] : [],
      ...Object.keys(groups).map((g) => ['## ' + g, '', ...groups[g].map((r) => '**' + r[0] + '** (' + r[1] + '): ' + r[2]), ''].join('\n'))).join('\n');
    const text = custom.concat(...Object.keys(groups).map((g) => groups[g])).map((r) => r[0] + ' - ' + r[2]).join('\n');
    return { html, md, text, count: custom.length + builtin.length + mods.length, custom, groups };
  }
  // everything the bot page needs.
  const view = () => ({
    settings: { clip: db.clip, enabled: db.enabled, prefix: db.prefix, currency: db.currency, pointsPerMin: db.pointsPerMin, subMultiplier: db.subMultiplier, awardOffline: db.awardOffline, games: db.games, extras: db.extras },
    builtinEdits: db.builtinEdits, commands: db.commands, vars: db.vars, timers: db.timers, filters: db.filters, events: db.events, quotes: db.quotes, counters: db.counters,
    bonuses: db.bonuses, daily: db.daily, shop: db.shop, pending: db.pending, ledger: db.ledger.slice(-40).reverse(),
    totals: { viewers: Object.keys(db.points).length, circulation: Object.values(db.points).reduce((a, p) => a + p.pts, 0) },
    top: Object.entries(db.points).map(([id, p]) => ({ id, name: p.name, pts: p.pts })).sort((a, b) => b.pts - a.pts).slice(0, 15),
    builtin: BUILTIN, levels: LEVELS,
    account: { auth: botAuth, device: botDevice && { user_code: botDevice.user_code, verification_uri: botDevice.verification_uri }, login: botTok && botTok.login },
    triviaCount: db.trivia.length,
    race: race.view(),
    games: { builtin: GAMES.map((g) => Object.assign({ on: !(db.games.off || []).includes(g.id) }, g)), custom: db.customGames.map((g) => Object.assign({}, g, { odds: gameOdds(g) })), settings: db.games, currency: cur(), prefix: db.prefix },
  });
  // number clamp with a fallback for junk input.
  const num = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  // dashboard requests for commands, games, timers, filters, shop, currency and the bot account.
  async function api(action, b) {
    switch (action) {
      case 'settings': {
        db.enabled = b.enabled !== false; db.prefix = oneLine(b.prefix || '!', 3).replace(/\s/g, '') || '!'; db.currency = oneLine(b.currency || 'points', 20) || 'points';
        db.pointsPerMin = num(b.pointsPerMin, 5, 0, 1000); db.subMultiplier = num(b.subMultiplier, 2, 1, 20); db.awardOffline = !!b.awardOffline;
        if (b.bonuses) for (const k of Object.keys(db.bonuses)) if (b.bonuses[k]) { const x = b.bonuses[k], t = db.bonuses[k]; t.on = !!x.on; t.amount = num(x.amount, t.amount, 0, 1e7); if ('perViewer' in t) t.perViewer = num(x.perViewer, t.perViewer, 0, 1e6); }
        if (b.clip) db.clip = { on: !!b.clip.on, level: ['everyone', 'subscriber', 'vip', 'moderator'].includes(b.clip.level) ? b.clip.level : 'everyone' };
        if (b.daily) db.daily = { on: !!b.daily.on, amount: num(b.daily.amount, 100, 0, 1e7), streakBonus: num(b.daily.streakBonus, 25, 0, 1e6), maxStreak: num(b.daily.maxStreak, 10, 0, 365) };
        if (b.games) db.games = { words: db.games.words, wheel: db.games.wheel, dance: db.games.dance, bits: db.games.bits, race: db.games.race, arena: db.games.arena, botDuel: db.games.botDuel,
          off: db.games.off || [], duelAnim: b.games.duelAnim !== false,
          gambleWin: num(b.games.gambleWin, 0.45, 0.05, 0.95), maxBet: num(b.games.maxBet, 0, 0, 1e9),
          triviaReward: num(b.games.triviaReward, 100, 0, 1e6), triviaSeconds: num(b.games.triviaSeconds, 30, 5, 300),
          duelSeconds: num(b.games.duelSeconds, 60, 10, 600) };
        save(); return view().settings;
      }
      case 'extras': {
        const x = b || {}, E = db.extras, ann = ANN_COLORS.includes(x.welcome && x.welcome.announce) ? x.welcome.announce : '';
        if (x.welcome) E.welcome = { on: !!x.welcome.on, msg: oneLine(x.welcome.msg, 300) || E.welcome.msg, announce: ann, onlyLive: x.welcome.onlyLive !== false };
        if (x.raidShout) E.raidShout = { on: !!x.raidShout.on };
        if (x.regulars) E.regulars = { on: !!x.regulars.on, minutes: num(x.regulars.minutes, 300, 0, 1e6), messages: num(x.regulars.messages, 200, 0, 1e6) };
        save(); return E;
      }
      case 'command/save': {
        const name = String(b.name || '').toLowerCase().replace(/^!/, '').replace(/[^a-z0-9_]/g, '').slice(0, 30);
        if (!name) throw new Error('Command needs a name (letters/numbers)');
        if (reserved(name)) throw new Error('!' + name + ' is a built-in command');
        if (!oneLine(b.response)) throw new Error('Response cannot be empty');
        let c = b.id && db.commands.find((x) => x.id === b.id);
        if (db.commands.some((x) => x.name === name && x !== c)) throw new Error('!' + name + ' already exists');
        if (!c) { c = { id: name + '-' + Math.random().toString(36).slice(2, 5), uses: 0 }; db.commands.push(c); }
        Object.assign(c, { name, aliases: String(b.aliases || '').toLowerCase().split(/[\s,]+/).map((x) => x.replace(/^!/, '').replace(/[^a-z0-9_]/g, '')).filter((x) => x && !reserved(x)),
          response: String(b.response).slice(0, 1500), mode: ['all', 'random', 'rotate'].includes(b.mode) ? b.mode : 'all',
          usage: oneLine(b.usage, 200), needArgs: num(b.needArgs, 0, 0, 9), liveOnly: !!b.liveOnly,
          announce: annColor(b.announce), desc: oneLine(b.desc, 140),
          level: LEVELS.includes(b.level) ? b.level : 'everyone', cd: num(b.cd, 5, 0, 3600), userCd: num(b.userCd, 10, 0, 3600), enabled: b.enabled !== false, hidden: !!b.hidden });
        save(); return c;
      }
      case 'games/settings': {
        const x = b || {}, G = db.games;
        if (x.gambleWin !== undefined) G.gambleWin = num(x.gambleWin / 100, 0.45, 0.05, 0.95); if (x.maxBet !== undefined) G.maxBet = num(x.maxBet, 0, 0, 1e9);
        if (x.triviaReward !== undefined) G.triviaReward = num(x.triviaReward, 100, 0, 1e6); if (x.triviaSeconds !== undefined) G.triviaSeconds = num(x.triviaSeconds, 30, 5, 600);
        if (x.botDuel) { const y = x.botDuel; G.botDuel = { on: y.on !== false, below: num(y.below, 1000, 1, 1e9), house: num(y.house, 50, 0, 1e6), maxWin: num(y.maxWin, 1000, 1, 1e9) }; }
        if (x.duelSeconds !== undefined) G.duelSeconds = num(x.duelSeconds, 60, 10, 600); if (x.duelAnim !== undefined) G.duelAnim = !!x.duelAnim;
        save(); return G;
      }
      case 'games/arena': {
        const x = b || {}, A = db.games.arena, o = (k, f) => { const y = x[k] || {}; for (const [n, lo, hi] of f) if (y[n] !== undefined) A[k][n] = Math.floor(num(y[n], A[k][n], lo, hi)); };
        o('boss', [['baseHp', 10, 1e6], ['hpPerChatter', 0, 1e5], ['seconds', 15, 3600], ['hitCd', 1, 60], ['pool', 0, 1e5], ['lastHit', 0, 1e6], ['consolation', 0, 1e5]]);
        o('royale', [['fee', 0, 1e6], ['lobby', 10, 600], ['max', 2, 8]]); o('teams', [['fee', 0, 1e6], ['lobby', 10, 600], ['maxPerTeam', 1, 50]]);
        save(); return A;
      }
      case 'games/test': {   // preview a group game on the overlay (mods use it from the Chat Games page)
        const k = b.game; if (k === 'boss') return { text: arena.boss.start({ name: 'Test' }, '') || 'Boss started' };
        if (k === 'royale') return { text: arena.royale.open() || 'Arena open' }; if (k === 'teams') return { text: arena.teams.open() || 'Teams open' };
        arena.stop(); return { text: 'Stopped' };
      }
      case 'race/start': return race.start({ names: String(b.names || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean), count: b.count, seconds: b.seconds });
      case 'race/run': return race.run(b.winner);
      case 'race/cancel': return race.cancel();
      case 'race/settings': { const R = db.games.race, x = b || {};
        if (x.count !== undefined) R.count = Math.floor(num(x.count, 5, 2, 10));
        if (x.seconds !== undefined) R.seconds = Math.floor(num(x.seconds, 90, 30, 1800));
        if (x.title !== undefined) R.title = oneLine(x.title, 45) || 'Who wins the race?';
        if (x.names !== undefined) R.names = String(x.names).split(/[\n,]/).map((n) => oneLine(n, 25)).filter(Boolean).slice(0, 40);
        save(); return R; }
      case 'race/demo': {   // overlay preview without touching Twitch
        const hs = ['Thunder Biscuit', 'Neon Gallop', 'Sir Hoofs-a-Lot', 'Disco Stu', 'Mane Event'], times = hs.map((_, i) => 11 + i * 0.6), w = Math.floor(rng() * 5); times[w] = 11;
        ctx.broadcast('arena', { type: 'race:open', horses: hs, seconds: 4 });
        setTimeout(() => ctx.broadcast('arena', { type: 'race:go', horses: hs, times, seeds: hs.map(() => Math.floor(rng() * 1e9)), winner: w, ms: 17500 }), 4000); return { ok: true };
      }
      case 'games/bits': { const B = db.games.bits, x = b || {}; for (const k of ['boss', 'royale', 'race', 'dance']) if (x[k] !== undefined) B[k] = Math.floor(num(x[k], 100, 0, 1e6)); save(); return B; }
      case 'games/dance': { const x = b || {}, D = db.games.dance; if (x.seconds !== undefined) D.seconds = Math.floor(num(x.seconds, 120, 20, 600)); if (x.strobe !== undefined) D.strobe = !!x.strobe; save(); return D; }
      case 'games/dancetest': { if (b && b.stop) { danceStop(); return { text: 'Stopped' }; } return { text: danceStart({ name: 'TestViewer' }, true) || 'Party started (silent test)' }; }
      case 'builtin/save': {   // the replies, other names and wait of the built-in !commands and !tts
        const x = b || {}, E = db.builtinEdits, line = (v, d) => oneLine(v, 300) || d;
        const taken = new Set(BUILTIN.concat(Object.keys(GAME_OF), Object.keys(builtins), db.commands.flatMap((c) => [c.name].concat(c.aliases || [])), db.customGames.map((g) => g.command)));
        const cleanAliases = (key, list) => {
          const out = []; for (const raw of (Array.isArray(list) ? list : String(list || '').split(/[\s,]+/))) {
            const a = String(raw).toLowerCase().replace(/^[!\W]+/, '').replace(/[^a-z0-9_]/g, '').slice(0, 20); if (!a || out.includes(a)) continue;
            if (taken.has(a) && !((E[key].aliases || []).includes(a))) throw new Error('!' + a + ' is already used by another command');
            out.push(a);
          }
          if (out.length > 5) throw new Error('At most 5 other names'); return out;
        };
        if (x.commands) { const c = x.commands; if (c.reply !== undefined) E.commands.reply = line(c.reply, 'Commands: {list}'); if (c.aliases !== undefined) E.commands.aliases = cleanAliases('commands', c.aliases); if (c.cd !== undefined) E.commands.cd = num(c.cd, 15, 0, 3600); }
        if (x.tts) { const t = x.tts; for (const k of ['usage', 'off', 'level', 'wait', 'poor', 'blocked', 'failed']) if (t[k] !== undefined) E.tts[k] = line(t[k], DEFAULT_TTS_EDITS[k]); if (t.queued !== undefined) E.tts.queued = oneLine(t.queued, 300); if (t.aliases !== undefined) E.tts.aliases = cleanAliases('tts', t.aliases); }
        builtins.commands.cd = E.commands.cd; save(); return E;
      }
      case 'words/settings': {
        const x = b || {}, C = db.games.words, n = (v, d, lo, hi) => Math.floor(num(v, d, lo, hi));
        if (x.rounds !== undefined) C.rounds = n(x.rounds, 0, 0, 99); if (x.beat !== undefined) C.beat = n(x.beat, 50, 10, 100); if (x.seconds !== undefined) C.seconds = n(x.seconds, 90, 30, 300); if (x.letters !== undefined) C.letters = n(x.letters, 5, 4, 7);
        if (x.perLetter !== undefined) C.perLetter = n(x.perLetter, 2, 0, 1000); if (x.pangram !== undefined) C.pangram = n(x.pangram, 25, 0, 10000); if (x.mvp !== undefined) C.mvp = n(x.mvp, 25, 0, 10000);
        save(); return C;
      }
      case 'words/start': { const r = words.start({ by: 'the streamer', rounds: b && b.rounds, silent: !!(b && b.silent) }); if (r.error) throw new Error(r.error); return r; }
      case 'words/stop': { const r = words.stop(); if (r.error) throw new Error(r.error); return r; }
      case 'words/skip': { const r = words.skip(); if (r.error) throw new Error(r.error); return r; }
      case 'words/state': return words.state();
      case 'words/stats': return wordStats.get();
      case 'words/resetstats': db.wordRush = { players: {}, record: { round: 0, by: '', at: 0 } }; save(); return wordStats.get();
      case 'wheel/save': { const W = db.games.wheel, x = b || {}; if (x.title !== undefined) W.title = oneLine(x.title, 40); if (x.options !== undefined) { const e = wheel.entries(x.options, x.pct); W.options = e.map((o) => o.text); W.pct = wheel.shares(e).map((f) => Math.round(f * 1000) / 10); } save(); return W; }
      case 'wheel/spin': {   // from the Chat Games page (the streamer): the saved list, or the one sent along; silent = no chat message
        const W = db.games.wheel, x = b || {}; const r = wheel.spin({ title: x.title !== undefined ? x.title : W.title, options: x.options !== undefined ? x.options : W.options, pct: x.options !== undefined ? x.pct : W.pct, silent: !!x.silent });
        if (r.error) throw new Error(r.error); return r;
      }
      case 'wheel/stop': { const r = wheel.cancel(); if (r.error) throw new Error(r.error); return r; }
      case 'games/toggle': {
        if (!GAMES.some((g) => g.id === b.id)) throw new Error('Unknown game'); const off = new Set(db.games.off || []); if (b.on) off.delete(b.id); else off.add(b.id);
        db.games.off = [...off]; save(); return { ok: true, off: db.games.off };
      }
      case 'game/save': {
        const c = cleanGame(b, b.id); let g = b.id && db.customGames.find((x) => x.id === b.id);
        if (!g) { if (db.customGames.length >= 30) throw new Error('That is plenty of games (30)'); g = { id: 'g-' + Math.random().toString(36).slice(2, 7), plays: 0, paidIn: 0, paidOut: 0 }; db.customGames.push(g); }
        Object.assign(g, c); save(); return Object.assign({}, g, { odds: gameOdds(g) });
      }
      case 'game/delete': db.customGames = db.customGames.filter((g) => g.id !== b.id); save(); return { ok: true };
      case 'game/try': {   // a pretend play for the builder: shows what chat would say, charges nothing
        const c = cleanGame(Object.assign({}, b, { command: b.command || 'try' + Math.random().toString(36).slice(2, 6) }), b.id), o = rollOutcome(c, rng()), net = o.payout - c.cost;
        return { text: String(o.text || '{user}: {net} {currency}').replace(/\{user\}/g, 'TestViewer').replace(/\{payout\}/g, fmtNum(o.payout)).replace(/\{cost\}/g, fmtNum(c.cost)).replace(/\{net\}/g, (net >= 0 ? '+' : '') + fmtNum(net)).replace(/\{balance\}/g, '1,000').replace(/\{currency\}/g, cur()), odds: gameOdds(c) };
      }
      case 'command/delete': db.commands = db.commands.filter((c) => c.id !== b.id); save(); return { ok: true };
      case 'command/test': {
        const trace = { used: [], unknown: [] }, user = { id: 'test', login: 'testviewer', name: oneLine(b.user, 30) || 'TestViewer', rank: 0 };
        const lines = String(b.response || '').split('\n').map((x) => x.trim()).filter(Boolean), out = [];
        for (const line of lines) out.push(await expand(line, { user, args: String(b.args || 'friend').split(/\s+/), uses: 7, trace }));
        return { text: out.join('\n'), lines: out, used: trace.used, unknown: [...new Set(trace.unknown)] };
      }
      case 'variables': return catalog();
      case 'var/save': {
        const name = String(b.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30); if (!name) throw new Error('Variable needs a name (letters/numbers)');
        if (b.type === 'list') { const items = (Array.isArray(b.items) ? b.items : String(b.items || '').split('\n')).map((x) => oneLine(x, 200)).filter(Boolean); db.vars[name] = { type: 'list', value: '', items }; }
        else db.vars[name] = { type: 'text', value: String(b.value || '').slice(0, 300), items: [] };
        save(); return db.vars[name];
      }
      case 'var/delete': delete db.vars[String(b.name || '').toLowerCase()]; save(); return { ok: true };
      case 'counter/set': { const n = String(b.name || '').toLowerCase().replace(/[^a-z0-9_]/g, ''); if (!n) throw new Error('Counter needs a name'); db.counters[n] = Math.floor(Number(b.value) || 0); save(); return { ok: true }; }
      case 'counter/add': { const n = String(b.name || '').toLowerCase().replace(/[^a-z0-9_]/g, ''); if (!n) throw new Error('Counter needs a name'); db.counters[n] = (db.counters[n] || 0) + Math.floor(Number(b.delta) || 0); save(); return { ok: true, value: db.counters[n] }; }
      case 'counter/delete': delete db.counters[String(b.name || '').toLowerCase()]; save(); return { ok: true };
      case 'timer/save': {
        if (!oneLine(b.message)) throw new Error('Message cannot be empty');
        let t = b.id && db.timers.find((x) => x.id === b.id); if (!t) { t = { id: 't-' + Math.random().toString(36).slice(2, 6) }; db.timers.push(t); }
        Object.assign(t, { name: oneLine(b.name, 40) || 'Timer', message: String(b.message).slice(0, 450), minutes: num(b.minutes, 15, 1, 1440), minLines: num(b.minLines, 3, 0, 1000), enabled: !!b.enabled, onlyLive: b.onlyLive !== false, announce: annColor(b.announce) });
        timerLast.delete(t.id); save(); return t;
      }
      case 'timer/delete': db.timers = db.timers.filter((t) => t.id !== b.id); save(); return { ok: true };
      // save each filter from the dashboard, keeping every number inside sensible limits.
      case 'filters': {
        for (const name of Object.keys(db.filters)) {
          const n = b[name]; if (!n) continue; const f = db.filters[name];
          f.on = !!n.on; f.action = ['delete', 'timeout', 'ban'].includes(n.action) ? n.action : 'delete'; f.timeout = num(n.timeout, 10, 1, 1209600);
          f.exempt = LEVELS.includes(n.exempt) ? n.exempt : 'vip'; f.message = String(n.message || '').slice(0, 200);
          for (const k of ['percent', 'minLen', 'max', 'chars', 'words']) if (k in f && n[k] != null) f[k] = num(n[k], f[k], 1, 100000);
          if (name === 'links') f.whitelist = (Array.isArray(n.whitelist) ? n.whitelist : String(n.whitelist || '').split(/[\s,]+/)).map((x) => x.trim()).filter(Boolean);
          if (name === 'blacklist') f.words = (Array.isArray(n.words) ? n.words : String(n.words || '').split('\n')).map((x) => x.trim()).filter(Boolean);
        }
        save(); return db.filters;
      }
      case 'events': for (const k of Object.keys(db.events)) if (b[k]) { db.events[k].on = !!b[k].on; db.events[k].msg = String(b[k].msg || '').slice(0, 300); db.events[k].announce = annColor(b[k].announce); } save(); return db.events;
      case 'quote/delete': db.quotes = db.quotes.filter((q) => q.n !== Number(b.n)); save(); return { ok: true };
      case 'points/set': {
        const p = Object.entries(db.points).find(([id, x]) => id === b.id || x.name.toLowerCase() === strip(b.name));
        if (!p) throw new Error('No such viewer yet'); addPts(p[0], p[1].name, Math.max(0, Math.floor(Number(b.pts) || 0)) - p[1].pts, 'set by you'); return { ok: true };
      }
      case 'shop/save': {
        const name = oneLine(b.name, 40); if (!name) throw new Error('Item needs a name');
        if (!(Number(b.cost) >= 0)) throw new Error('Cost must be a number');
        let it = b.id && db.shop.find((x) => x.id === b.id);
        if (db.shop.some((x) => x.name.toLowerCase() === name.toLowerCase() && x !== it)) throw new Error('There is already an item called ' + name);
        if (!it) { it = { id: 'i-' + Math.random().toString(36).slice(2, 6), uses: 0 }; db.shop.push(it); }
        Object.assign(it, { name, cost: Math.floor(num(b.cost, 100, 0, 1e9)), description: oneLine(b.description, 120), response: String(b.response || '$(user) redeemed $(item)!').slice(0, 400),
          alertKey: String(b.alertKey || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30), approval: !!b.approval, enabled: b.enabled !== false,
          cd: num(b.cd, 0, 0, 86400), userCd: num(b.userCd, 0, 0, 86400), stock: b.stock === '' || b.stock == null ? null : Math.floor(num(b.stock, 0, 0, 1e6)) });
        save(); return it;
      }
      case 'shop/delete': db.shop = db.shop.filter((x) => x.id !== b.id); save(); return { ok: true };
      case 'shop/approve': { const e = db.pending.find((x) => x.n === Number(b.n)); if (!e) throw new Error('No such pending redemption'); db.pending = db.pending.filter((x) => x !== e); save(); await fulfill(e); return { ok: true }; }
      case 'shop/refund': { const e = db.pending.find((x) => x.n === Number(b.n)); if (!e) throw new Error('No such pending redemption'); refund(e); return { ok: true }; }
      case 'points/adjust': {
        const q = strip(b.name); let id = b.id || Object.keys(db.points).find((k) => db.points[k].name.toLowerCase() === q);
        if (!id && q) id = await ctx.resolveUser(q);
        if (!id) throw new Error('Viewer not found'); const p = pt(id, b.name || undefined), n = Math.floor(Number(b.amount));
        if (!Number.isFinite(n)) throw new Error('Amount must be a number');
        addPts(id, p.name, b.mode === 'set' ? n - p.pts : b.mode === 'remove' ? -Math.abs(n) : Math.abs(n), b.mode + ' by you'); return { ok: true, pts: p.pts };
      }
      // give currency to everyone chatting in the last 10 minutes.
      case 'points/bonus': {
        const n = Math.floor(num(b.amount, 0, 0, 1e7)); if (!n) throw new Error('Enter an amount'); let c = 0;
        for (const [id, a] of active) if (now() - a.ts <= 10 * 60000) { addPts(id, a.name, n, 'bonus (dashboard)'); c++; }
        return { ok: true, count: c };
      }
      case 'viewers': {
        const q = strip(b.q); return Object.entries(db.points).filter(([, p]) => !q || p.name.toLowerCase().includes(q)).map(([id, p]) => ({ id, name: p.name, pts: p.pts, mins: p.mins || 0, streak: p.streak || 0 })).sort((a, c) => c.pts - a.pts).slice(0, 60);
      }
      case 'say': { if (!ctx.me()) throw new Error('Not connected to Twitch'); say(String(b.message || '').slice(0, 450), undefined, b.announce); return { ok: true }; }
      case 'account/start': return accountStart();
      case 'account/logout': accountLogout(); return { ok: true };
      default: throw new Error('unknown bot action');
    }
  }

  return { exportCommands, execute, expandFor, ANN_COLORS, labels, onMessage, onEvent, api, view, start, tick, awardPoints, say, expand, db: () => db, hasAccount: () => !!botTok, _flush: async () => { while (queue.length || pumping) await new Promise((r) => setTimeout(r, 5)); } };
};
