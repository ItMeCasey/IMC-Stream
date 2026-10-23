'use strict';
/**
 * A Discord bot that runs inside the app (so it works while the app is running):
 *  - sets up the streamer's server: roles and channels in the app's style, with a welcome and a rules message (it only ever adds what is missing),
 *  - posts a "went live" message when the stream starts,
 *  - answers slash commands (/commands /games /tts /top /live /website) from the same lists as the viewers' website.
 * It needs a bot the streamer makes at discord.com/developers (the token stays in data/discord.json on this PC and is never sent to the page).
 * Talks to Discord's REST API and its gateway (a WebSocket) directly: no libraries.
 */
const fs = require('node:fs');
const path = require('node:path');

const API = 'https://discord.com/api/v10', GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const P = (n) => 1n << BigInt(n);   // permission bits
const VIEW = P(10), SEND = P(11), EMBED = P(14), HISTORY = P(16), CONNECT = P(20), SPEAK = P(21), REACT = P(6);
const MOD_PERMS = P(1) | P(13) | P(40) | P(7) | P(22);   // kick, manage messages, time out, view audit log, mute (voice)
const BOT_PERMS = P(28) | P(4) | VIEW | SEND | EMBED | HISTORY | MOD_PERMS;   // manage roles and channels, post, and the permissions it hands to the Mods role (a bot can only give what it has)
const COLOR = { aqua: 0x4FBBBC, heat: 0xF39120, rust: 0xEC4624, cream: 0xE2DAC2 };

// the layout of the server: [category, [ [name, type, kind] ]]  (type 0 text, 2 voice; kind: 'readonly' = only the bot and mods post)
const LAYOUT = [
  ['INFO', [['welcome', 0, 'readonly'], ['rules', 0, 'readonly'], ['announcements', 0, 'readonly'], ['go-live', 0, 'readonly']]],
  ['COMMUNITY', [['general', 0, ''], ['clips', 0, ''], ['game-chat', 0, ''], ['bot-commands', 0, '']]],
  ['VOICE', [['Lounge', 2, ''], ['Gaming 1', 2, ''], ['Gaming 2', 2, '']]],
  ['MODS', [['mod-chat', 0, 'private'], ['mod-log', 0, 'private']]],
];
const ROLES = [['Mods', COLOR.aqua, true, MOD_PERMS], ['Tier 3 Sub', COLOR.rust, true, 0n], ['Tier 2 Sub', COLOR.heat, true, 0n], ['Tier 1 Sub', COLOR.cream, true, 0n]];
const TOPICS = { welcome: 'Start here', rules: 'The rules of the server', announcements: 'News from the stream', 'go-live': 'Posted by the bot when the stream starts', general: 'Chat about anything', clips: 'Share your best clips', 'game-chat': 'Talk about the games', 'bot-commands': 'Try the bot here: /commands /games /tts /top', 'mod-chat': 'Mods only', 'mod-log': 'Mods only' };
const COMMANDS = [['commands', 'The chat commands of the stream'], ['games', 'The games you can play in chat'], ['tts', 'How to get your message read out loud on stream'], ['top', 'The points leaderboard'], ['live', 'Is the stream live right now?'], ['website', 'The stream website']].map(([name, description]) => ({ name, description, type: 1 }));

module.exports = function createDiscord(ctx) {
  const log = ctx.log || (() => {}), doFetch = ctx.fetch || ((...a) => fetch(...a)), FILE = ctx.file, WS = ctx.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null), sleep = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let S = { token: '', appId: '', guildId: '', channels: {}, announce: true, ping: '', commands: true, lastLive: 0 }, bot = null, gw = null;
  try { S = Object.assign(S, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* first run */ }
  const save = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(S, null, 2)); } catch (e) { log('discord save failed:', e.message); } };

  async function api(method, p, body, retried) {
    const r = await doFetch(API + p, { method, headers: { Authorization: 'Bot ' + S.token, 'Content-Type': 'application/json', 'User-Agent': 'IMC-Stream (https://github.com/Drakma/IMC-Stream, 1)' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 429 && !retried) { const j = await r.json().catch(() => ({})); await sleep(Math.min(10000, Math.ceil((j.retry_after || 1) * 1000))); return api(method, p, body, true); }
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error(({ 401: 'Discord did not accept that token', 403: 'The bot is missing a permission for that (' + ((j && j.message) || '403') + ')', 404: 'Discord could not find that (' + p + ')' })[r.status] || (j && j.message) || 'Discord answered HTTP ' + r.status); e.status = r.status; throw e; }
    return j;
  }
  const embed = (title, description, color, extra) => Object.assign({ title, description, color: color || COLOR.heat }, extra || {});
  const links = () => ({ twitch: ctx.channel && ctx.channel() ? 'https://twitch.tv/' + ctx.channel() : '', website: (ctx.website && ctx.website()) || '' });

  /** check the token: who the bot is and the servers it is in */
  async function connect() {
    if (!S.token) throw new Error('Paste the bot token first');
    bot = await api('GET', '/users/@me'); const guilds = await api('GET', '/users/@me/guilds');
    if (!S.appId) { S.appId = bot.id; save(); }
    return { bot: { id: bot.id, name: bot.username }, guilds: guilds.map((g) => ({ id: g.id, name: g.name })) };
  }

  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  /** what is in the server and what the layout would add */
  async function plan(guildId) {
    const gid = guildId || S.guildId; if (!gid) throw new Error('Choose a server first');
    const [roles, chans] = await Promise.all([api('GET', '/guilds/' + gid + '/roles'), api('GET', '/guilds/' + gid + '/channels')]), todo = [];
    for (const [name] of ROLES) if (!roles.some((r) => same(r.name, name))) todo.push({ kind: 'role', name });
    for (const [cat, list] of LAYOUT) {
      const c = chans.find((x) => x.type === 4 && same(x.name, cat)); if (!c) todo.push({ kind: 'category', name: cat });
      for (const [name, type] of list) if (!chans.some((x) => x.type === type && same(x.name, name) && c && x.parent_id === c.id)) todo.push({ kind: type === 2 ? 'voice' : 'text', name, in: cat });
    }
    return { roles: roles.length, channels: chans.length, todo };
  }

  /** add what is missing (never changes or removes anything that is there) and say hello in the new channels */
  async function setup(guildId) {
    const gid = guildId || S.guildId; if (!gid) throw new Error('Choose a server first'); S.guildId = gid; save();
    if (!bot) await connect();
    const roles = await api('GET', '/guilds/' + gid + '/roles'), chans = await api('GET', '/guilds/' + gid + '/channels'), out = [], byName = {};
    const everyone = roles.find((r) => r.name === '@everyone') || { id: gid }, made = [];
    for (const [name, color, hoist, perms] of ROLES) {
      let r = roles.find((x) => same(x.name, name));
      if (!r) { r = await api('POST', '/guilds/' + gid + '/roles', { name, color, hoist, mentionable: false, permissions: perms.toString() }); out.push('role ' + name); }
      byName[name] = r;
    }
    const mods = byName.Mods;
    const overwrites = (kind) => {
      if (kind === 'readonly') return [{ id: everyone.id, type: 0, allow: (VIEW | HISTORY | REACT).toString(), deny: SEND.toString() }, { id: bot.id, type: 1, allow: (VIEW | SEND | EMBED).toString(), deny: '0' }, { id: mods.id, type: 0, allow: SEND.toString(), deny: '0' }];
      if (kind === 'private') return [{ id: everyone.id, type: 0, allow: '0', deny: VIEW.toString() }, { id: mods.id, type: 0, allow: (VIEW | SEND | HISTORY | CONNECT | SPEAK).toString(), deny: '0' }, { id: bot.id, type: 1, allow: (VIEW | SEND | EMBED).toString(), deny: '0' }];
      return [];
    };
    let pos = 0;
    for (const [cat, list] of LAYOUT) {
      let c = chans.find((x) => x.type === 4 && same(x.name, cat));
      if (!c) { c = await api('POST', '/guilds/' + gid + '/channels', { name: cat, type: 4, position: pos }); out.push('category ' + cat); }
      pos++;
      for (const [name, type, kind] of list) {
        let ch = chans.find((x) => x.type === type && same(x.name, name) && x.parent_id === c.id);
        if (!ch) {
          ch = await api('POST', '/guilds/' + gid + '/channels', Object.assign({ name, type, parent_id: c.id, permission_overwrites: overwrites(kind) }, type === 0 && TOPICS[name] ? { topic: TOPICS[name] } : {}));
          out.push((type === 2 ? 'voice ' : '#') + name); made.push(name);
        }
        byName[name] = ch;
      }
    }
    S.channels = Object.assign(S.channels || {}, { welcome: byName.welcome.id, rules: byName.rules.id, announcements: byName.announcements.id, golive: byName['go-live'].id, botcommands: byName['bot-commands'].id }); save();
    if (made.includes('welcome')) await post(byName.welcome.id, welcomeMessage());
    if (made.includes('rules')) await post(byName.rules.id, rulesMessage());
    if (made.includes('bot-commands')) await post(byName['bot-commands'].id, { embeds: [embed('Try the bot here', 'Type `/commands`, `/games`, `/tts`, `/top` or `/live` in this channel.', COLOR.aqua)] });
    return { added: out, count: out.length };
  }
  function welcomeMessage() {
    const L = links(), name = (ctx.channel && ctx.channel()) || 'the stream';
    return { embeds: [embed('Welcome to the ' + name + ' server', 'Glad you are here! Say hi in <#' + ((S.channels || {}).general || 'general') + '>.' + (L.twitch ? '\n\n**Watch live:** ' + L.twitch : '') + (L.website ? '\n**Commands, games and text-to-speech:** ' + L.website : '') + '\n\nType `/commands` in the bot-commands channel to see what the bot can do.', COLOR.heat)] };
  }
  function rulesMessage() {
    return { embeds: [embed('Rules', ['**1. Be kind.** No harassment, hate or bullying.', '**2. No spam** or self-promotion without asking a mod.', '**3. Keep it safe for work.** Nothing sexual, graphic or illegal.', '**4. No spoilers** without a warning.', '**5. Listen to the mods.** If you are unsure, ask.'].join('\n'), COLOR.rust)] };
  }
  async function post(channelId, message) { return api('POST', '/channels/' + channelId + '/messages', message); }

  /** the stream just started: tell the server */
  async function announceLive(info) {
    if (!S.token || !S.announce || !(S.channels || {}).golive) return false;
    const L = links(), t = info || {}; S.lastLive = Date.now(); save();
    const ping = S.ping === 'everyone' ? '@everyone ' : S.ping === 'here' ? '@here ' : /^\d{5,25}$/.test(S.ping || '') ? '<@&' + S.ping + '> ' : '';
    const parse = S.ping === 'everyone' || S.ping === 'here' ? ['everyone'] : [];
    await post(S.channels.golive, { content: ping + (ctx.channel && ctx.channel() ? ctx.channel() : 'The stream') + ' is live!', allowed_mentions: { parse, roles: /^\d{5,25}$/.test(S.ping || '') ? [S.ping] : [] },
      embeds: [embed(String(t.title || 'Live now').slice(0, 250), (t.game ? '**Playing:** ' + t.game + '\n' : '') + (L.twitch ? '**Watch:** ' + L.twitch : ''), COLOR.rust, L.twitch ? { url: L.twitch } : {})] });
    return true;
  }

  /** a stream recap goes to the announcements channel (read-only for viewers, so only the bot posts there) */
  async function postRecap(title, text) {
    const id = (S.channels || {}).announcements; if (!S.token || !id) return false;
    await post(id, { embeds: [embed(String(title).slice(0, 250), String(text).slice(0, 3900), COLOR.aqua)], allowed_mentions: { parse: [] } }); return true;
  }

  // ------------------------------------------------------------------ slash commands
  const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
  function answer(name) {
    const L = links(), d = ctx.data || {};
    if (name === 'commands') { const ex = d.commands(); const rows = []; for (const r of ex.custom) rows.push('`' + r[0] + '` ' + r[2]); for (const g of Object.keys(ex.groups)) if (!/^Mods/.test(g)) for (const r of ex.groups[g]) rows.push('`' + r[0] + '` ' + r[2]); return { embeds: [embed('Chat commands', cut(rows.join('\n'), 4000) + (L.website ? '\n\nAll of them: ' + L.website + '/commands.html' : ''), COLOR.aqua)] }; }
    if (name === 'games') { const g = d.games(); return { embeds: [embed('Games', cut(g.map((x) => '**' + x.name + '**: `' + x.how + '`').join('\n') || 'No games are on right now.', 4000) + (L.website ? '\n\nHow they work: ' + L.website + '/games.html' : ''), COLOR.heat)] }; }
    if (name === 'tts') { const t = d.tts(); return { embeds: [embed('Text-to-speech', t + (L.website ? '\n\nAll the sounds: ' + L.website + '/tts.html' : ''), COLOR.rust)] }; }
    if (name === 'top') { const top = d.top(); return { embeds: [embed('Points leaderboard', top.length ? top.map((p, i) => (i + 1) + '. **' + p.name + '** ' + p.pts).join('\n') : 'Nobody has points yet.', COLOR.cream)] }; }
    if (name === 'live') { const s = d.stream(); return { embeds: [embed(s.live ? 'The stream is live!' : 'The stream is offline', s.live ? (s.title || '') + (s.game ? '\n**Playing:** ' + s.game : '') + (L.twitch ? '\n' + L.twitch : '') : (L.twitch ? 'Follow to get notified: ' + L.twitch : 'Not live right now.'), s.live ? COLOR.rust : COLOR.cream)] }; }
    if (name === 'website') return { content: L.website || 'The website is not published yet.' };
    return { content: 'I do not know that command.' };
  }
  async function onInteraction(i) {
    if (!i || i.type !== 2 || !i.data) return;
    let res; try { res = answer(i.data.name); } catch (e) { res = { content: 'Something went wrong.' }; log('discord command failed:', e.message); }
    await doFetch(API + '/interactions/' + i.id + '/' + i.token + '/callback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 4, data: Object.assign({ flags: 0 }, res) }) }).catch((e) => log('discord reply failed:', e.message));
  }
  async function registerCommands() { if (!S.guildId || !S.appId) throw new Error('Choose a server first'); await api('PUT', '/applications/' + S.appId + '/guilds/' + S.guildId + '/commands', COMMANDS); }

  // ------------------------------------------------------------------ the gateway (a WebSocket): it only exists to receive slash commands
  let hb = null, seq = null, stopped = true, tries = 0, status = 'off';
  function startGateway() {
    if (!S.token || !S.commands || !WS) return false; stopped = false; open(); return true;
  }
  function open() {
    if (stopped) return; status = 'connecting'; const ws = new WS(GATEWAY); gw = ws;
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString('utf8')); } catch (e) { return; }
      if (d.s != null) seq = d.s;
      if (d.op === 10) { const every = d.d.heartbeat_interval; clearInterval(hb); hb = setInterval(() => { try { ws.send(JSON.stringify({ op: 1, d: seq })); } catch (e) { /* closed */ } }, every); if (hb.unref) hb.unref(); ws.send(JSON.stringify({ op: 2, d: { token: S.token, intents: 0, properties: { os: 'windows', browser: 'itmecasey', device: 'itmecasey' } } })); }
      else if (d.op === 0 && d.t === 'READY') { status = 'on'; tries = 0; }
      else if (d.op === 0 && d.t === 'INTERACTION_CREATE') onInteraction(d.d);
      else if (d.op === 7 || d.op === 9) { try { ws.close(); } catch (e) { /* gone */ } }
    };
    ws.onclose = () => { clearInterval(hb); status = 'off'; if (!stopped) { const wait = Math.min(60000, 2000 * 2 ** Math.min(tries++, 5)); const t = setTimeout(open, wait); if (t.unref) t.unref(); } };
    ws.onerror = () => { /* onclose follows */ };
  }
  function stopGateway() { stopped = true; clearInterval(hb); try { gw && gw.close(); } catch (e) { /* gone */ } status = 'off'; }

  function configure(b) {
    b = b || {};
    if (typeof b.token === 'string' && b.token.trim()) { S.token = b.token.trim().replace(/^Bot\s+/i, '').slice(0, 200); bot = null; }
    if (b.clearToken) { S.token = ''; bot = null; stopGateway(); }
    if (b.appId !== undefined) S.appId = String(b.appId).replace(/\D/g, '').slice(0, 25);
    if (b.guildId !== undefined) S.guildId = String(b.guildId).replace(/\D/g, '').slice(0, 25);
    if (b.announce !== undefined) S.announce = !!b.announce; if (b.commands !== undefined) S.commands = !!b.commands;
    if (b.ping !== undefined) S.ping = ['', 'everyone', 'here'].includes(b.ping) ? b.ping : /^\d{5,25}$/.test(String(b.ping)) ? String(b.ping) : '';
    save(); return view();
  }
  const inviteUrl = () => { const id = S.appId || (bot && bot.id); return id ? 'https://discord.com/oauth2/authorize?client_id=' + id + '&scope=' + encodeURIComponent('bot applications.commands') + '&permissions=' + BOT_PERMS.toString() : ''; };
  const view = () => ({ invite: inviteUrl(), hasToken: !!S.token, appId: S.appId, guildId: S.guildId, announce: S.announce, commands: S.commands, ping: S.ping, channels: S.channels || {}, gateway: status, lastLive: S.lastLive || 0,
    layout: LAYOUT.map(([cat, list]) => ({ category: cat, channels: list.map(([n, t]) => (t === 2 ? '🔊 ' : '# ') + n) })), roles: ROLES.map((r) => r[0]), slash: COMMANDS.map((c) => '/' + c.name) });
  /** a test post in the bot-commands (or go-live) channel */
  async function test() { const id = (S.channels || {}).botcommands || (S.channels || {}).golive; if (!id) throw new Error('Set up the server first'); await post(id, { content: 'The bot is working. Try `/commands`.' }); return { ok: true }; }
  return { connect, plan, setup, announceLive, postRecap, registerCommands, startGateway, stopGateway, configure, view, test, answer, onInteraction, layout: LAYOUT };
};
