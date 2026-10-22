#!/usr/bin/env node
'use strict';
/**
 * ItMeCasey local stream server (no dependencies, needs Node 22+).
 *  - Logs into Twitch with the Device Code flow and listens to EventSub over WebSocket
 *  - Pushes alerts to overlays (Server-Sent Events at /events)
 *  - Writes Stream Labels-style text files to ../data/labels/
 *  - Serves a control dashboard at http://localhost:8420/
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = process.env.ICM_ROOT ? path.resolve(process.env.ICM_ROOT) : path.resolve(__dirname, '..');   // the folder with overlays/ assets/ sounds/ (the app's resources when installed)
const DATA = process.env.ICM_DATA ? path.resolve(process.env.ICM_DATA) : path.join(ROOT, 'data');
const LABELS = path.join(DATA, 'labels');
const CUSTOM = path.join(DATA, 'custom');   // your uploaded sounds, images and videos live here (the install folder is read-only)
const APP_VERSION = process.env.ICM_VERSION || (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'package.json'), 'utf8')).version; } catch (e) { return 'dev'; } })();
const STARTED_AT = Date.now();
const TOKENS_FILE = path.join(DATA, 'tokens.json');
const STATE_FILE = path.join(DATA, 'state.json');
const EVENTS_LOG = path.join(DATA, 'events.jsonl');
const EVENTSUB_URL = process.env.ICM_EVENTSUB_URL || 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
const HELIX = process.env.ICM_HELIX_URL || 'https://api.twitch.tv/helix';
const ID_URL = process.env.ICM_ID_URL || 'https://id.twitch.tv/oauth2';
const BTTV_URL = process.env.ICM_BTTV_URL || 'https://api.betterttv.net/3';
const FFZ_URL = process.env.ICM_FFZ_URL || 'https://api.frankerfacez.com/v1';
const SEVENTV_URL = process.env.ICM_7TV_URL || 'https://7tv.io/v3';
const STRIPE_URL = process.env.ICM_STRIPE_URL || 'https://api.stripe.com/v1';
const SCOPES = [
  'moderator:read:followers', 'channel:read:subscriptions', 'bits:read', 'channel:read:redemptions', 'channel:read:hype_train',
  'channel:read:goals', 'channel:read:polls', 'channel:read:predictions', 'user:read:chat', 'channel:read:ads', 'channel:read:charity',
  'channel:edit:commercial', 'channel:manage:ads', 'channel:manage:redemptions', 'channel:manage:polls', 'channel:manage:predictions', 'clips:edit',
  'channel:bot', 'channel:manage:broadcast', 'moderator:manage:shoutouts', 'moderator:manage:announcements',
  'moderator:manage:automod', 'user:write:chat', 'moderator:manage:chat_messages', 'moderator:manage:banned_users', 'moderator:manage:chat_settings', 'moderator:read:chat_settings',
];

// ------------------------------------------------------------------ config
const DEFAULTS = { clientId: '', port: 8420, resetSessionOnStreamOnline: true, recentCount: 5,
  stripe: { apiKey: '', paymentLinkId: '', pollSeconds: 20 },
  ignoreChatters: ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot'] };
function loadConfig() {
  let c = {};
  try { c.clientId = JSON.parse(fs.readFileSync(path.join(__dirname, 'default-client.json'), 'utf8')).clientId || ''; } catch (e) { /* none built in */ }   // the app's own Twitch app: users just log in
  try { c = Object.assign(c, JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'))); } catch (e) { /* use defaults */ }
  try { c = Object.assign(c, JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8'))); } catch (e) { /* settings made in the app win */ }
  if (!c.clientId) { try { c.clientId = JSON.parse(fs.readFileSync(path.join(__dirname, 'default-client.json'), 'utf8')).clientId || ''; } catch (e) { /* none built in */ } }   // an empty clientId in config.json must not hide the built-in one
  if (process.env.ICM_PORT) c.port = +process.env.ICM_PORT;
  if (process.env.ICM_CLIENT_ID) c.clientId = process.env.ICM_CLIENT_ID;
  c.stripe = Object.assign({}, DEFAULTS.stripe, c.stripe);
  if (process.env.ICM_STRIPE_KEY) c.stripe.apiKey = process.env.ICM_STRIPE_KEY;
  return Object.assign({}, DEFAULTS, c);
}
let CFG = loadConfig();

fs.mkdirSync(LABELS, { recursive: true });
const logRing = [];   // last log lines, for the health page / support
const log = (...a) => {
  console.log(new Date().toLocaleTimeString(), ...a);
  const text = a.map((x) => (x instanceof Error ? x.message : typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  logRing.push({ t: Date.now(), text: text.slice(0, 300), bad: /fail|error|could not|refused|expired|unauthor/i.test(text) && !/(^|[^0-9])0 failed/.test(text) }); if (logRing.length > 200) logRing.shift();
};

// ------------------------------------------------------------------ state + labels
const freshSession = () => ({
  startedAt: new Date().toISOString(),
  followers: 0, subs: 0, resubs: 0, giftSubs: 0, gifters: {},
  bits: 0, cheers: 0, cheerers: {},
  raids: 0, raiders: 0,
  redemptions: 0, pointsSpent: 0,
  tipTotal: 0, tippers: {},
  chatMessages: 0, chatters: {},
  peakViewers: 0,
});
const defaultState = () => ({
  totals: { followers: null, subs: null, subPoints: null },
  session: freshSession(),
  allTime: { bits: 0, cheerers: {}, gifters: {}, giftSubs: 0, raids: 0, raiders: 0, biggestRaid: '' },
  latest: { follower: '', subscriber: '', resub: '', gifter: '', giftRecipient: '', cheer: '', raider: '', raidViewers: '',
    redeem: '', redeemUser: '', redeemReward: '', tip: '', chatter: '', chatMessage: '', charityDonor: '' },
  recent: { followers: [], subscribers: [], cheers: [], raiders: [], redemptions: [], chat: [] },
  stream: { live: false, title: '', game: '', viewers: 0, startedAt: '' },
  hype: { active: false, level: 0, total: 0, progress: 0, goal: 0, top: '', lastLevel: 0 },
  goal: { description: '', current: null, target: null, type: '', achieved: false },
  poll: { id: '', status: '', title: '', choices: [], startedAt: 0, endsAt: 0, endedAt: 0 },
  prediction: { id: '', status: '', title: '', outcomes: [], winner: '', winnerId: '', startedAt: 0, locksAt: 0, endedAt: 0 },
  ads: { nextAt: 0, lastAt: 0, lastDuration: 0, snoozes: null, snoozeRefreshAt: 0, prerollFree: 0, running: false, endsAt: 0 },
  adSettings: { warnSeconds: 0, warnMsg: 'Ad break in {seconds} seconds. Thanks for sticking around!', afterOn: false, afterMsg: 'Ads are over - thanks for sticking with us!',
    startOn: false, startMsg: 'Twitch is rolling a quick ad break. To avoid ad-breaks like this, you can !sub, !prime, or use Twitch Turbo!', startColor: 'primary', warnColor: '', afterColor: '' },
  charity: { name: '', current: null, target: null, currency: '' },
  channel: { name: '' },
  leaderboard: {},   // period -> [{name, score}]
  stripe: { since: 0, seen: [] },
  pollPresets: [], predictionPresets: [], recentCategories: [], streamPresets: [],
  access: { lan: false, salt: '', hash: '' },
  modules: { links: [], hidden: [] },
  panels: [],
  updates: { enabled: true },
  setup: { done: false },
  paypal: { me: '', currency: 'USD', suggest: [5, 10, 20], note: '', since: 0, seen: [], recent: [] },
  overlayCfg: { alerts: { position: 'top', volume: 100 }, explosion: { goal: true, raid: false, hype: false, sub: false, giftsub: false, bits: false, count: 70, seconds: 6, style: 'burst' }, events: { align: 'bottom', grow: 'up', max: 6, mode: 'list', speed: 80, include: { follow: true, sub: true, bits: true, raid: true, tip: true, redeem: false, hype: true, goal: true, custom: false } } },
  home: { pages: [{ id: 'p1', name: 'Home', widgets: [{ id: 'w0', mod: 'golive', size: 's' }, { id: 'w1', mod: 'status', size: 's' }, { id: 'w2', mod: 'ads', size: 's' }, { id: 'w3', mod: 'music', size: 's' }, { id: 'w4', mod: 'scenes', size: 'm' }, { id: 'w5', mod: 'buttons', size: 'm' }, { id: 'w7', mod: 'chat', size: 'l' }, { id: 'w8', mod: 'recent', size: 'm' }] }] },
  ttsCfg: { on: true, voice: '', rate: 0, pitch: 0, volume: 80, maxChars: 200, blockWords: [], command: { on: false, level: 'subscriber', cost: 0, userCd: 60 } },
  countdown: { mode: 'idle', endsAt: 0, remainingMs: 300000, durationMs: 300000, visible: true, label: 'WE GO LIVE IN', doneMessage: "LET'S GO!", doneScene: '', doneChat: '', lastAdd: null,
    subathon: { on: false, perSub: 300, perGiftSub: 300, perBits100: 60, perFollow: 30, perRaidViewer: 1, maxMinutes: 720 } },
  subathon: { mode: 'idle', endsAt: 0, remainingMs: 12 * 3600e3, durationMs: 12 * 3600e3, visible: true, label: 'SUBATHON', doneMessage: 'SUBATHON COMPLETE!', doneScene: '', doneChat: '', lastAdd: null,
    subathon: { on: true, perSub: 600, perGiftSub: 600, perBits100: 300, perFollow: 60, perRaidViewer: 30, maxMinutes: 0 } },
  mediaCfg: { provider: 'windows', app: 'auto', spotifyClientId: '', requests: false, requestLevel: 'everyone' },
  autoScenes: { enabled: false, raidSeconds: 30, map: { online: '', offline: '', raid: '', raidEnd: '', adStart: '', adEnd: '', hypeStart: '', hypeEnd: '', brb: '', back: '' } },
  board: [],
  rewardHooks: [], obsCfg: { host: '127.0.0.1', port: 4455, password: '' },
  alertRules: [], alertsSeeded: false,
  customGoals: [],   // user-made goals shown as progress bars
});
const mergeDefaults = (def, saved) => {
  if (Array.isArray(def) || typeof def !== 'object' || def === null) return saved === undefined ? def : saved;
  const out = {};
  for (const k of new Set([...Object.keys(def), ...Object.keys(saved || {})])) {
    out[k] = k in def ? mergeDefaults(def[k], saved ? saved[k] : undefined) : saved[k];
  }
  return out;
};
let state = defaultState();
try { state = mergeDefaults(defaultState(), JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (e) { /* first run */ }

const labelCache = {};
const labelDocs = {};
function writeLabel(name, text) {
  text = String(text == null ? '' : text);
  if (labelCache[name] === text) return;
  labelCache[name] = text;
  try { fs.writeFileSync(path.join(LABELS, name + '.txt'), text, 'utf8'); } catch (e) { log('label write failed', name, e.message); }
}
const topN = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
const topLine = (obj) => { const e = topN(obj, 1)[0]; return e ? e[0] + ' - ' + e[1] : ''; };
const topList = (obj, n = 5) => topN(obj, n).map(([k, v], i) => (i + 1) + '. ' + k + ' - ' + v).join('\n');
const hms = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
};
const ms = (sec) => { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
const money = (a) => { if (!a) return ''; const v = a.value / Math.pow(10, a.decimal_places || 0); return v.toFixed(a.decimal_places || 0) + (a.currency ? ' ' + a.currency : ''); };
const num = (v) => (v == null ? '' : v);

// ------------------------------------------------------------------ custom goals (progress bars for OBS)
const GOAL_METRICS = {
  followers_total: ['Total followers', (s) => s.totals.followers || 0],
  followers_session: ['New followers this stream', (s) => s.session.followers],
  subs_total: ['Total subscribers', (s) => s.totals.subs || 0],
  sub_points: ['Sub points', (s) => s.totals.subPoints || 0],
  subs_session: ['New subs this stream (incl. gifts)', (s) => s.session.subs + s.session.resubs + s.session.giftSubs],
  bits_session: ['Bits this stream', (s) => s.session.bits],
  bits_alltime: ['Bits since installing the server', (s) => s.allTime.bits],
  raids_session: ['Raids this stream', (s) => s.session.raids],
  raiders_session: ['Raiding viewers this stream', (s) => s.session.raiders],
  chat_session: ['Chat messages this stream', (s) => s.session.chatMessages],
  chatters_session: ['Unique chatters this stream', (s) => Object.keys(s.session.chatters).length],
  redemptions_session: ['Channel point redemptions this stream', (s) => s.session.redemptions],
  viewers: ['Current viewers', (s) => (s.stream.live ? s.stream.viewers : 0)],
  peak_viewers: ['Peak viewers this stream', (s) => s.session.peakViewers],
  tips_session: ['Tips this stream', (s) => Math.round(s.session.tipTotal * 100) / 100],
  manual: ['Manual (you +/- it)', null],
};
const GOAL_COLORS = ['rainbow', 'aqua', 'heat', 'rust', 'cream'];
const goalValue = (g) => (g.metric === 'manual' ? Number(g.manual) || 0 : GOAL_METRICS[g.metric] ? GOAL_METRICS[g.metric][1](state) : 0);
function goalView(g) {
  const value = goalValue(g), span = Math.max(1e-9, g.target - g.start);
  const pct = Math.max(0, Math.min(100, Math.round(((value - g.start) / span) * 1000) / 10));
  return { id: g.id, title: g.title, metric: g.metric, value, target: g.target, start: g.start, percent: pct, done: value >= g.target,
    color: g.color, style: g.style, celebrate: g.celebrate, money: g.metric === 'tips_session' };
}
const goalViews = () => state.customGoals.map(goalView);
let lastGoalJson = '';
function goalsTick() {
  for (const g of state.customGoals) {
    const v = goalView(g);
    if (v.done && !g.reachedAt) {
      g.reachedAt = Date.now();
      if (g.celebrate) fire('goal', { title: g.title, value: v.value, target: g.target });
    } else if (!v.done && g.reachedAt) g.reachedAt = 0;
  }
  const js = JSON.stringify(goalViews());
  if (js !== lastGoalJson) { lastGoalJson = js; broadcast('goals', JSON.parse(js)); }
}
function saveGoal(b) {
  const metric = GOAL_METRICS[b.metric] ? b.metric : 'manual';
  const target = Number(b.target), start = Number(b.start) || 0;
  if (!(target > 0)) throw new Error('Target must be a number above 0');
  if (start >= target) throw new Error('"Start at" must be lower than the target');
  const title = oneLine(b.title, 60) || 'Goal';
  let g = b.id && state.customGoals.find((x) => x.id === b.id);
  if (!g) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'goal';
    g = { id: slug + '-' + Math.random().toString(36).slice(2, 6), manual: 0, reachedAt: 0 };
    state.customGoals.push(g);
  }
  Object.assign(g, { title, metric, target, start, color: GOAL_COLORS.includes(b.color) ? b.color : 'rainbow',
    style: b.style === 'slim' ? 'slim' : 'bar', celebrate: b.celebrate !== false });
  g.reachedAt = goalValue(g) >= target ? Date.now() : 0;   // creating an already-complete goal doesn't fire an alert
  persist();
  return goalView(g);
}

// ------------------------------------------------------------------ poll / prediction overlay feed
let demoPolls = null, demoTimer = null, lastPollsJson = '';
function pollOverlayView() {
  const d = demoPolls || state, p = d.poll, q = d.prediction;
  return {
    now: Date.now(),
    poll: p && p.status ? { id: p.id, title: p.title, status: p.status, choices: p.choices, startedAt: p.startedAt, endsAt: p.endsAt, endedAt: p.endedAt } : null,
    prediction: q && q.status ? { id: q.id, title: q.title, status: q.status, outcomes: q.outcomes, winner: q.winnerId, startedAt: q.startedAt, locksAt: q.locksAt, endedAt: q.endedAt } : null,
  };
}
function pollsTick() {
  const v = pollOverlayView(), js = JSON.stringify({ p: v.poll, q: v.prediction });
  if (js !== lastPollsJson) { lastPollsJson = js; broadcast('polls', v); }
}
function runDemo(kind) {   // dashboard "Test" buttons: a scripted poll/prediction so you can place the overlay in OBS
  clearInterval(demoTimer);
  const t0 = Date.now(), rnd = (n) => Math.floor(Math.random() * n);
  const demo = { poll: { status: '' }, prediction: { status: '' } };
  demoPolls = demo; let tick = 0;
  demoTimer = setInterval(() => {
    tick++;
    if (kind === 'poll') {
      const ended = tick >= 20, base = demo.poll.choices || [{ id: 'a', title: 'Doom', votes: 3 }, { id: 'b', title: 'Tetris', votes: 5 }, { id: 'c', title: 'Celeste', votes: 2 }];
      base.forEach((c) => { if (!ended) c.votes += rnd(4); });
      demo.poll = { id: 'demo', title: 'What should we play next?', status: ended ? 'COMPLETED' : 'ACTIVE', choices: base, startedAt: t0, endsAt: t0 + 20000, endedAt: ended ? demo.poll.endedAt || Date.now() : 0 };
    } else {
      const outs = (demo.prediction.outcomes || [{ id: 'a', title: 'Yes', users: 4, points: 1500 }, { id: 'b', title: 'No', users: 2, points: 600 }]);
      if (tick < 15) outs.forEach((o) => { o.points += rnd(900); o.users += rnd(2); });
      const st = tick >= 22 ? 'RESOLVED' : tick >= 15 ? 'LOCKED' : 'OPEN';
      demo.prediction = { id: 'demo', title: 'Will I beat this boss?', status: st, outcomes: outs, winner: st === 'RESOLVED' ? 'a' : '', winnerId: st === 'RESOLVED' ? 'a' : '',
        startedAt: t0, locksAt: t0 + 15000, endedAt: st === 'RESOLVED' ? demo.prediction.endedAt || Date.now() : 0 };
    }
    if (tick >= 45) { clearInterval(demoTimer); demoPolls = null; }
    pollsTick();
  }, 1000);
  pollsTick();
}
async function syncPolls() {   // after login/restart: pick up a poll or prediction that is already running
  try {
    const snap = await pollsSnapshot(), p = snap.poll, q = snap.prediction;
    if (p) state.poll = { id: p.id, status: p.status, title: p.title, choices: (p.choices || []).map((c) => ({ id: c.id, title: c.title, votes: c.votes || 0 })),
      startedAt: Date.parse(p.started_at), endsAt: Date.parse(p.started_at) + (p.duration || 0) * 1000, endedAt: p.ended_at ? Date.parse(p.ended_at) : 0 };
    if (q) {
      const outs = (q.outcomes || []).map((o) => ({ id: o.id, title: o.title, users: o.users || 0, points: o.channel_points || 0 })), win = outs.find((o) => o.id === q.winning_outcome_id);
      state.prediction = { id: q.id, status: q.status === 'ACTIVE' ? 'OPEN' : q.status, title: q.title, outcomes: outs, winner: win ? win.title : '', winnerId: win ? win.id : '',
        startedAt: Date.parse(q.created_at), locksAt: Date.parse(q.created_at) + (q.prediction_window || 0) * 1000, endedAt: q.ended_at ? Date.parse(q.ended_at) : 0 };
    }
    persist(true);
  } catch (e) { /* not affiliate / scopes missing: overlays stay idle */ }
}

function renderLabels() {
  const s = state.session, l = state.latest, r = state.recent, A = state.allTime, st = state.stream, h = state.hype,
    g = state.goal, p = state.poll, pr = state.prediction, ad = state.ads, ch = state.charity;
  const out = {};
  const add = (name, value, desc) => { out[name] = value == null ? '' : String(value); labelDocs[name] = desc; };

  // followers
  add('latest_follower', l.follower, 'Newest follower');
  add('recent_followers', r.followers.join('\n'), 'Last 5 followers, newest first');
  add('total_follower_count', num(state.totals.followers), 'Total followers (refreshed from Twitch)');
  add('session_follower_count', s.followers, 'New followers this stream');
  // subs
  add('latest_subscriber', l.subscriber, 'Newest subscriber (new, resub or gift recipient)');
  add('latest_resubscriber', l.resub, 'Newest resub, with months');
  add('latest_gift_subscriber', l.gifter, 'Newest gifter and how many subs they gave');
  add('latest_gift_recipient', l.giftRecipient, 'Newest person to receive a gift sub');
  add('recent_subscribers', r.subscribers.join('\n'), 'Last 5 subscribers, newest first');
  add('total_subscriber_count', num(state.totals.subs), 'Total subscribers (refreshed from Twitch)');
  add('total_subscriber_points', num(state.totals.subPoints), 'Sub points (what Twitch counts toward sub goals)');
  add('session_subscriber_count', s.subs + s.resubs + s.giftSubs, 'New + resub + gifted subs this stream');
  add('session_new_sub_count', s.subs, 'First-time (self-bought) subs this stream');
  add('session_resub_count', s.resubs, 'Resubs this stream');
  add('session_gift_sub_count', s.giftSubs, 'Gifted subs this stream');
  add('session_top_gifter', topLine(s.gifters), 'Top gifter this stream');
  add('session_top_gifters', topList(s.gifters), 'Top 5 gifters this stream');
  add('alltime_top_gifter', topLine(A.gifters), 'Top gifter since you installed the server');
  add('alltime_gift_sub_count', A.giftSubs, 'Gift subs since you installed the server');
  // bits
  add('latest_cheer', l.cheer, 'Newest cheer');
  add('recent_cheers', r.cheers.join('\n'), 'Last 5 cheers, newest first');
  add('session_bits', s.bits, 'Bits this stream');
  add('session_cheer_count', s.cheers, 'Number of cheers this stream');
  add('session_top_cheerer', topLine(s.cheerers), 'Top cheerer this stream');
  add('session_top_cheerers', topList(s.cheerers), 'Top 5 cheerers this stream');
  add('alltime_bits', A.bits, 'Bits since you installed the server');
  add('alltime_top_cheerer', topLine(A.cheerers), 'Top cheerer since you installed the server');
  for (const period of ['day', 'week', 'month', 'year', 'all']) {
    const rows = state.leaderboard[period] || [];
    add('bits_leaderboard_' + period, rows.map((x, i) => (i + 1) + '. ' + x.name + ' - ' + x.score).join('\n'), 'Twitch bits leaderboard (' + period + '), top 5');
    add('top_cheerer_' + period, rows[0] ? rows[0].name + ' - ' + rows[0].score : '', 'Twitch #1 cheerer (' + period + ')');
  }
  // raids
  add('latest_raider', l.raider, 'Newest raider (channel - viewers)');
  add('latest_raid_viewers', l.raidViewers, 'Viewer count of the newest raid');
  add('recent_raiders', r.raiders.join('\n'), 'Last 5 raids, newest first');
  add('session_raid_count', s.raids, 'Raids this stream');
  add('session_raider_viewers', s.raiders, 'Raiding viewers this stream');
  add('alltime_biggest_raid', A.biggestRaid, 'Biggest raid since you installed the server');
  // channel points
  add('latest_redemption', l.redeem, 'Newest redemption (user - reward)');
  add('latest_redemption_user', l.redeemUser, 'Who redeemed last');
  add('latest_redemption_reward', l.redeemReward, 'What was redeemed last');
  add('recent_redemptions', r.redemptions.join('\n'), 'Last 5 redemptions, newest first');
  add('session_redemption_count', s.redemptions, 'Redemptions this stream');
  add('session_channel_points_spent', s.pointsSpent, 'Channel points spent this stream');
  // tips (from /api/event)
  add('latest_tip', l.tip, 'Newest tip (from your webhook)');
  add('session_tip_total', s.tipTotal ? s.tipTotal.toFixed(2) : '0', 'Tips this stream');
  add('session_top_tipper', topLine(s.tippers), 'Top tipper this stream');
  // hype train
  add('hype_train_status', h.active ? 'ACTIVE' : 'IDLE', 'ACTIVE while a hype train is running');
  add('hype_train_level', h.active ? h.level : '', 'Current hype train level');
  add('hype_train_progress', h.active ? h.progress + ' / ' + h.goal : '', 'Progress toward the next level');
  add('hype_train_total', h.active ? h.total : '', 'Total points in the current train');
  add('hype_train_top_contributor', h.top, 'Top contributor of the current/last train');
  add('hype_train_last_level', h.lastLevel || '', 'Level the last train reached');
  // goal
  add('goal_description', g.description, 'Creator goal description');
  add('goal_current', num(g.current), 'Creator goal current amount');
  add('goal_target', num(g.target), 'Creator goal target');
  add('goal_progress', g.target ? g.current + ' / ' + g.target : '', 'Creator goal "current / target"');
  add('goal_percent', g.target ? Math.min(100, Math.floor(g.current / g.target * 100)) + '%' : '', 'Creator goal percent');
  // poll
  const pTotal = p.choices.reduce((a, c) => a + (c.votes || 0), 0);
  const pLead = p.choices.slice().sort((a, b) => b.votes - a.votes)[0];
  add('poll_status', p.status, 'ACTIVE / COMPLETED / ARCHIVED / TERMINATED');
  add('poll_title', p.title, 'Poll question');
  add('poll_choices', p.choices.map((c) => c.title + ' - ' + c.votes).join('\n'), 'Poll choices with votes');
  add('poll_total_votes', p.choices.length ? pTotal : '', 'Total poll votes');
  add('poll_leader', pLead && pTotal ? pLead.title : '', 'Poll leader');
  // prediction
  add('prediction_status', pr.status, 'OPEN / LOCKED / RESOLVED / CANCELED');
  add('prediction_title', pr.title, 'Prediction question');
  add('prediction_outcomes', pr.outcomes.map((o) => o.title + ' - ' + o.points + ' pts (' + o.users + ' users)').join('\n'), 'Prediction outcomes');
  add('prediction_winner', pr.winner, 'Winning outcome');
  // stream
  add('stream_status', st.live ? 'LIVE' : 'OFFLINE', 'LIVE or OFFLINE');
  add('stream_title', st.title, 'Current stream title');
  add('stream_game', st.game, 'Current category/game');
  add('stream_viewers', st.live ? st.viewers : '', 'Current viewer count');
  add('session_peak_viewers', s.peakViewers, 'Peak viewers this stream');
  add('stream_uptime', st.live && st.startedAt ? hms((Date.now() - Date.parse(st.startedAt)) / 1000) : '', 'Time live, H:MM:SS');
  add('stream_started_at', st.startedAt ? new Date(st.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '', 'Time the stream started (local clock)');
  add('channel_name', state.channel.name, 'Your channel display name');
  // chat
  add('latest_chatter', l.chatter, 'Last person to chat');
  add('latest_chat_message', l.chatMessage, 'Last chat message ("name: text")');
  add('recent_chat', r.chat.join('\n'), 'Last 5 chat messages');
  add('session_chat_messages', s.chatMessages, 'Chat messages this stream');
  add('session_unique_chatters', Object.keys(s.chatters).length, 'Unique chatters this stream');
  add('session_top_chatter', topLine(s.chatters), 'Most active chatter this stream');
  add('session_top_chatters', topList(s.chatters), 'Top 5 chatters this stream');
  // ads
  const left = ad.nextAt ? (ad.nextAt - Date.now()) / 1000 : 0;
  add('ad_status', ad.running ? 'AD RUNNING' : ad.nextAt && left > 0 ? 'NEXT AD SCHEDULED' : '', 'Ad break status');
  add('next_ad_in', left > 0 ? ms(left) : '', 'Countdown to the next ad (M:SS)');
  add('next_ad_time', left > 0 ? new Date(ad.nextAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '', 'Clock time of the next ad');
  add('last_ad_duration', ad.lastDuration || '', 'Length of the last ad (seconds)');
  add('ad_snoozes_left', num(ad.snoozes), 'Ad snoozes remaining');
  // charity
  add('latest_charity_donor', l.charityDonor, 'Newest charity donation');
  add('charity_name', ch.name, 'Active charity campaign');
  add('charity_progress', ch.target != null ? ch.current + ' / ' + ch.target + (ch.currency ? ' ' + ch.currency : '') : '', 'Charity "raised / goal"');

  for (const g of state.customGoals) {
    const v = goalView(g), name = 'goal_' + g.id.replace(/-/g, '_');
    add(name, v.value + ' / ' + v.target, 'Custom goal "' + g.title + '": current / target');
    add(name + '_percent', v.percent + '%', 'Custom goal "' + g.title + '": percent');
  }
  { const bl = bot.labels(); for (const k of Object.keys(bl)) add(k, bl[k].value, bl[k].desc); }
  { const ml = media.labels(); for (const k of Object.keys(ml)) add(k, ml[k].value, ml[k].desc); }
  { const cl = countdown.labels(); for (const k of Object.keys(cl)) add(k, cl[k].value, cl[k].desc); }
  { const sl = subathon.labels(); for (const k of Object.keys(sl)) add(k, sl[k].value, sl[k].desc.replace('countdown / subathon timer', 'subathon timer')); }
  goalsTick();
  pollsTick();

  for (const k in out) writeLabel(k, out[k]);
  try {
    const js = JSON.stringify(out, null, 2);
    if (labelCache['all_labels.json'] !== js) { labelCache['all_labels.json'] = js; fs.writeFileSync(path.join(LABELS, 'all_labels.json'), js, 'utf8'); }
  } catch (e) { /* ignore */ }
}
let saveTimer, renderTimer;
function persist(soon) {
  if (soon) { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; renderLabels(); }, 250); }
  else renderLabels();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); } catch (e) { log('state save failed', e.message); }
  }, 500);
}
function resetSession() {
  state.session = freshSession();
  state.stream.live && (state.session.peakViewers = state.stream.viewers);
  persist();
  log('session counters reset');
}
const pushRecent = (arr, v) => { arr.unshift(v); arr.length = Math.min(arr.length, CFG.recentCount); };
const oneLine = (t, n = 140) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);

// ------------------------------------------------------------------ alerts + SSE
const clients = new Set();
const recentAlerts = [];
function sseSend(res, event, data) {
  res.write((event ? 'event: ' + event + '\n' : '') + 'data: ' + JSON.stringify(data) + '\n\n');
}
function broadcast(event, data) { for (const c of clients) { try { sseSend(c, event, data); } catch (e) { clients.delete(c); } } }
let alertSeq = 0;
function emitAlert(a) {
  a.ts = Date.now(); a.id = ++alertSeq;
  recentAlerts.unshift(a); recentAlerts.length = Math.min(recentAlerts.length, 40);
  try { fs.appendFileSync(EVENTS_LOG, JSON.stringify(a) + '\n'); } catch (e) { /* ignore */ }
  broadcast(null, a);
  broadcast('log', a);
  log('ALERT', a.kind, a.tag || '', a.name, a.msg || '');
}
// dashboard alert controls: the overlay holds / skips / mutes; nothing is lost while paused
const alertCtl = { paused: false, muted: false };
function alertControl(action) {
  if (action === 'pause') alertCtl.paused = true; else if (action === 'resume') alertCtl.paused = false;
  else if (action === 'mute') alertCtl.muted = true; else if (action === 'unmute') alertCtl.muted = false;
  else if (action !== 'skip' && action !== 'clear') throw new Error('unknown alert action');
  broadcast('alertctl', Object.assign({ action }, alertCtl)); return Object.assign({ ok: true }, alertCtl);
}
function replayAlert(id) {
  const a = recentAlerts.find((x) => x.id === Number(id)); if (!a) throw new Error('That alert is no longer in the history');
  const copy = Object.assign({}, a); delete copy.id; delete copy.ts; copy.replay = true; emitAlert(copy); return { ok: true };
}
function systemLog(text) { broadcast('log', { kind: 'system', name: text, ts: Date.now() }); }


// ------------------------------------------------------------------ alert rules (editable from the dashboard)
const ALERT_EVENTS = {
  follow:     { label: 'Follow', vars: ['name'], kind: 'follow' },
  sub:        { label: 'New sub', vars: ['name', 'tier'], kind: 'sub' },
  resub:      { label: 'Resub', vars: ['name', 'months', 'tier', 'message'], kind: 'sub', numLabel: 'months' },
  giftsub:    { label: 'Gift subs', vars: ['name', 'total', 'tier'], kind: 'sub', numLabel: 'subs gifted' },
  bits:       { label: 'Bits', vars: ['name', 'amount', 'message'], kind: 'bits', numLabel: 'bits' },
  raid:       { label: 'Raid', vars: ['name', 'viewers'], kind: 'raid', numLabel: 'viewers' },
  redeem:     { label: 'Channel point redemption', vars: ['name', 'reward', 'cost', 'input'], kind: 'follow', numLabel: 'points cost', match: true },
  hype_start: { label: 'Hype train started', vars: ['level'], kind: 'raid' },
  hype_end:   { label: 'Hype train ended', vars: ['level'], kind: 'raid' },
  goal:       { label: 'Goal reached', vars: ['title', 'value', 'target'], kind: 'follow' },
  charity:    { label: 'Charity donation', vars: ['name', 'amount', 'charity'], kind: 'tip', numLabel: 'amount' },
  tip:        { label: 'Tip', vars: ['name', 'amount', 'message'], kind: 'tip', numLabel: 'amount' },
  custom:     { label: 'Custom (you trigger it)', vars: ['name', 'message', 'amount'], kind: 'follow', numLabel: 'amount', key: true },
};
const SAMPLE_VARS = {
  follow: { name: 'RetroRider' }, sub: { name: 'VinylVince', tier: 'Tier 1' },
  resub: { name: 'TealTina', months: 7, tier: 'Tier 1', message: 'Love the stream!' },
  giftsub: { name: 'GenerousGamer', total: 5, tier: 'Tier 1' }, bits: { name: 'BitBaron', amount: 500, message: 'Take my bits!' },
  raid: { name: 'FriendlyStreamer', viewers: 42 }, redeem: { name: 'ChaosChad', reward: 'Hydrate!', cost: 500, input: '' },
  hype_start: { level: 1 }, hype_end: { level: 3 }, goal: { title: 'Road to 500', value: 500, target: 500 },
  charity: { name: 'KindKira', amount: '$10.00', charity: 'Save The Pixels' }, tip: { name: 'GenerousGamer', amount: '$10.00', message: 'Keep up the great work' },
  custom: { name: 'Sam', message: 'Hello!', amount: '' },
};
const C_AQUA = '#4FBBBC', C_HEAT = '#F39120', C_RUST = '#EC4624', C_CREAM = '#E2DAC2';
function defaultRules() {
  const r = (event, name, tag, title, msg, color, sound, extra = {}) => Object.assign({
    id: event + '-' + Math.random().toString(36).slice(2, 6), event, name, enabled: true, min: null, max: null, match: '', key: '',
    tag, title, msg, color, sound, image: '', video: '', volume: 60, seconds: 6, tts: { on: false, text: '{name} says {message}', voice: '' } }, extra);
  return [
    r('follow', 'Follow', 'NEW FOLLOWER', '{name}', 'Thanks for the follow!', C_AQUA, 'alert_follow.wav'),
    r('sub', 'New sub', 'NEW SUB', '{name}', 'Welcome to the crew // {tier}', C_HEAT, 'alert_sub.wav'),
    r('resub', 'Resub', 'RESUB', '{name}', '{months} months // {message}', C_HEAT, 'alert_sub.wav'),
    r('giftsub', 'Single gift sub', 'GIFT SUB', '{name}', '{tier}', C_HEAT, 'alert_sub.wav', { min: 1, max: 1 }),
    r('giftsub', 'Gift sub bomb', '{total} GIFT SUBS', '{name}', '{tier}', C_HEAT, 'alert_sub.wav', { min: 2 }),
    r('bits', 'Bits', '{amount} BITS', '{name}', '{message}', C_HEAT, 'alert_bits.wav'),
    r('raid', 'Raid', 'INCOMING RAID', '{name}', '{viewers} raiders incoming', C_RUST, 'alert_raid.wav'),
    r('redeem', 'Channel points', 'REDEEMED', '{name}', '{reward} // {input}', C_AQUA, 'alert_follow.wav'),
    r('hype_start', 'Hype train start', 'HYPE TRAIN', 'Hype train started!', 'Level {level} - keep it going', C_RUST, 'alert_raid.wav'),
    r('hype_end', 'Hype train end', 'HYPE TRAIN OVER', 'Level {level} reached', 'Thanks everyone!', C_RUST, 'alert_raid.wav'),
    r('goal', 'Goal reached', 'GOAL REACHED', '{title}', '{value} / {target}', C_AQUA, 'alert_follow.wav'),
    r('charity', 'Charity donation', 'CHARITY {amount}', '{name}', '{charity}', C_CREAM, 'alert_tip.wav'),
    r('tip', 'Tip', '{amount} TIP', '{name}', '{message}', C_CREAM, 'alert_tip.wav'),
  ];
}
if (!state.alertsSeeded) { state.alertRules = defaultRules(); state.alertsSeeded = true; }

const tpl = (t, vars) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? '' : String(vars[k])))
  .replace(/(\s*\/\/\s*)+$/, '').replace(/^(\s*\/\/\s*)+/, '').replace(/\s{2,}/g, ' ').trim();
function pickRule(event, num, vars, key) {
  const c = state.alertRules.filter((r) => r.enabled && r.event === event
    && (r.min == null || num >= r.min) && (r.max == null || num <= r.max)
    && (!r.match || String(vars.reward || '').toLowerCase().includes(r.match.toLowerCase()))
    && (event !== 'custom' || r.key === key));
  const spec = (r) => (r.match ? 1e12 : 0) + (r.min || 0) * 1000 - (r.max == null ? 0 : -1);
  c.sort((a, b) => spec(b) - spec(a));
  return c[0] || null;
}
function buildAlert(rule, vars) {
  return { kind: ALERT_EVENTS[rule.event].kind, event: rule.event, ruleId: rule.id, tag: tpl(rule.tag, vars), name: tpl(rule.title, vars), msg: tpl(rule.msg, vars),
    accent: rule.color, sound: rule.sound ? '/sounds/' + rule.sound : '', volume: rule.volume, seconds: rule.seconds, image: rule.image ? '/assets/' + rule.image : '', video: rule.video ? '/video/' + rule.video : '' };
}
/** Fire an alert for an event: the best-matching enabled rule decides what it looks and sounds like (no rule = no alert). */
const EXPLODE_ON = { goal: 'goal', raid: 'raid', hype_start: 'hype', sub: 'sub', resub: 'sub', giftsub: 'giftsub', bits: 'bits' };
function explode(reason, vars, force) {
  const X = state.overlayCfg.explosion; if (!X) return; if (!force && !(reason && X[reason])) return;
  const names = { goal: 'Goal reached!', raid: 'Raid!', hype: 'Hype train!', sub: 'New sub!', giftsub: 'Gift subs!', bits: 'Bits!' };
  broadcast('explosion', { reason, count: X.count, seconds: X.seconds, style: X.style, title: names[reason] || 'Woo!', sub: (vars && (vars.title || vars.name)) || '' });
}
function fire(event, vars, num = 0, key = '') {
  if (!botQuiet && EXPLODE_ON[event]) explode(EXPLODE_ON[event], vars);
  if (!botQuiet) { bot.onEvent(event, vars).catch((err) => log('bot error:', err.message)); countdown.onEvent(event, vars); subathon.onEvent(event, vars); }
  const rule = pickRule(event, num, vars, key);
  if (!rule) return false;
  const alert = buildAlert(rule, vars), T = rule.tts;
  const text = T && T.on && state.ttsCfg.on ? tpl(T.text || '{name} says {message}', vars) : '';
  const needsMsg = text && (T.text || '{name} says {message}').includes('{message}') && !String(vars.message || '').trim();
  if (needsMsg) emitAlert(alert);   // "{name} says {message}" but they wrote no message: stay quiet
  else if (text && tts.engineFor({ voice: T.voice || undefined }) === 'kokoro') {   // realistic voices take a few seconds: show the banner now, speak when the clip is ready
    emitAlert(alert); tts.say(text, { voice: T.voice || undefined, by: alert.name }).catch((e) => log('alert voice skipped:', e.message));
  }
  else if (text) tts.speak(text, { voice: T.voice || undefined }).then((c) => { alert.tts = { url: c.url, volume: c.volume }; emitAlert(alert); }).catch((e) => { log('alert voice skipped:', e.message); emitAlert(alert); });
  else emitAlert(alert);
  return true;
}
const listFiles = (dir, exts, base = dir, depth = 0) => {
  let out = [];
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory() && depth < 2 && f.name !== 'old_synth') out = out.concat(listFiles(path.join(dir, f.name), exts, base, depth + 1));
      else if (f.isFile() && exts.includes(path.extname(f.name).toLowerCase())) out.push(path.relative(base, path.join(dir, f.name)).split(path.sep).join('/'));
    }
  } catch (e) { /* folder missing */ }
  return out.sort();
};
const SOUND_EXT = ['.wav', '.mp3', '.ogg'], IMAGE_EXT = ['.png', '.gif', '.webp', '.jpg', '.jpeg'];
const VIDEO_EXT = ['.mp4', '.webm'];
const alertAssets = () => ({
  sounds: listFiles(path.join(ROOT, 'sounds'), SOUND_EXT).filter((f) => !f.startsWith('custom/')).concat(listFiles(path.join(CUSTOM, 'sounds'), SOUND_EXT).map((x) => 'custom/' + x)),
  images: ['logo.png'].concat(listFiles(path.join(CUSTOM, 'assets'), IMAGE_EXT).map((x) => 'custom/' + x)),
  videos: listFiles(path.join(CUSTOM, 'video'), VIDEO_EXT).map((x) => 'custom/' + x),
});
const safeRel = (v, list) => (v && !String(v).includes('..') && list.includes(v) ? v : '');
function saveAlertRule(b) {
  const ev = ALERT_EVENTS[b.event]; if (!ev) throw new Error('Unknown event');
  const A = alertAssets();
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const min = num(b.min), max = num(b.max);
  if (min != null && max != null && min > max) throw new Error('Minimum is higher than the maximum');
  let r = b.id && state.alertRules.find((x) => x.id === b.id);
  if (!r) { r = { id: b.event + '-' + Math.random().toString(36).slice(2, 6) }; state.alertRules.push(r); }
  Object.assign(r, {
    event: b.event, name: oneLine(b.name, 40) || ev.label, enabled: b.enabled !== false, min, max,
    match: ev.match ? oneLine(b.match, 60) : '', key: ev.key ? String(b.key || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) : '',
    tag: oneLine(b.tag, 60), title: oneLine(b.title, 80), msg: oneLine(b.msg, 140),
    color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : C_AQUA, sound: safeRel(b.sound, A.sounds), image: safeRel(b.image, A.images), video: safeRel(b.video, A.videos),
    volume: Math.min(100, Math.max(0, num(b.volume) == null ? 60 : num(b.volume))), seconds: Math.min(30, Math.max(2, num(b.seconds) || 6)),
    tts: { on: !!(b.tts && b.tts.on), text: oneLine(b.tts && b.tts.text, 200) || '{name} says {message}', voice: String((b.tts && b.tts.voice) || '').slice(0, 100) },
  });
  if (ev.key && !r.key) throw new Error('Custom alerts need a trigger key (letters/numbers, e.g. "lurk")');
  persist();
  return r;
}

const TIERS = { '1000': 'Tier 1', '2000': 'Tier 2', '3000': 'Tier 3' };
const tierOf = (t) => TIERS[t] || '';
const topContributor = (list) => (list && list[0] ? list[0].user_name + ' (' + list[0].total + ')' : '');

// ------------------------------------------------------------------ chat feed for the overlay + mod dock
const chatBuf = [];
function chatIn(e) {
  const m = {
    id: e.message_id, uid: e.chatter_user_id, login: e.chatter_user_login, name: e.chatter_user_name || e.chatter_user_login,
    color: e.color || '', badges: (e.badges || []).map((b) => ({ s: b.set_id, i: b.id })),
    frags: ((e.message && e.message.fragments) || [{ type: 'text', text: (e.message && e.message.text) || '' }]).map((f) => ({
      type: f.type, text: f.text, id: f.emote ? f.emote.id : undefined,
      gif: f.gif && /^https:\/\//.test(String(f.gif.url || '')) ? { id: f.gif.gif_id, url: f.gif.url } : undefined })),   // Twitch's inline GIFs (July 2026)
    text: (e.message && e.message.text) || '', type: e.message_type || 'text', ts: Date.now(),
    reply: e.reply ? { name: e.reply.parent_user_name, text: oneLine(e.reply.parent_message_body, 100) } : null,
  };
  chatBuf.push(m); if (chatBuf.length > 200) chatBuf.shift();
  broadcast('chat', m);
}
function chatMark(match, ev) {
  for (const m of chatBuf) if (match(m)) m.gone = true;
  if (ev.type === 'clear') chatBuf.length = 0;
  broadcast('chatmod', ev);
}

// ------------------------------------------------------------------ BTTV / FFZ / 7TV emotes + Twitch badges
let emotes = {}, emotesUpdated = 0, badges = {};
try { const c = JSON.parse(fs.readFileSync(path.join(DATA, 'emotes.json'), 'utf8')); emotes = c.emotes || {}; emotesUpdated = c.updated || 0; } catch (e) { /* no cache yet */ }
const BTTV_ZERO_WIDTH = new Set(['SoSnowy', 'IceCold', 'SantaHat', 'TopHat', 'ReinDeer', 'CandyCane', 'cvMask', 'cvHazmat']);
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ItMeCasey-OBS-Pack' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const abs = (u) => (u && u.startsWith('//') ? 'https:' + u : u);
async function loadEmotes() {
  let chan = 0;   // 1 while loading your channel's own sets, so the explosion can prefer them
  const map = {}, add = (name, u, p, z) => { if (name && u) map[name] = { u, p, z: z ? 1 : 0, c: chan }; };
  const uid = tokens && tokens.user_id;
  const bttv = (list) => (list || []).forEach((x) => add(x.code, 'https://cdn.betterttv.net/emote/' + x.id + '/2x.webp', 'BTTV', BTTV_ZERO_WIDTH.has(x.code)));
  const ffz = (sets) => Object.values(sets || {}).forEach((set) => (set.emoticons || []).forEach((x) => {
    const u = abs((x.urls && (x.urls['2'] || x.urls['1'] || x.urls['4'])) || ''); add(x.name, u, 'FFZ', x.modifier);
  }));
  const seven = (list) => (list || []).forEach((x) => {
    const host = x.data && x.data.host; if (!host) return;
    add(x.name, abs(host.url) + '/2x.webp', '7TV', (x.flags || 0) & 1);
  });
  const jobs = [
    ['BTTV global', () => getJson(BTTV_URL + '/cached/emotes/global').then(bttv)],
    ['FFZ global', () => getJson(FFZ_URL + '/set/global').then((j) => ffz(Object.fromEntries((j.default_sets || []).map((id) => [id, j.sets[id]]))))],
    ['7TV global', () => getJson(SEVENTV_URL + '/emote-sets/global').then((j) => seven(j.emotes))],
  ];
  if (uid) jobs.push(
    ['BTTV channel', () => getJson(BTTV_URL + '/cached/users/twitch/' + uid).then((j) => { bttv(j.channelEmotes); bttv(j.sharedEmotes); })],
    ['FFZ channel', () => getJson(FFZ_URL + '/room/id/' + uid).then((j) => ffz(j.sets))],
    ['7TV channel', () => getJson(SEVENTV_URL + '/users/twitch/' + uid).then((j) => seven(j.emote_set && j.emote_set.emotes))],
  );
  const got = {};
  if (uid) jobs.push(['Twitch channel', () => helix('GET', '/chat/emotes?broadcaster_id=' + uid).then((r) => { if (r.ok) (r.json.data || []).forEach((x) => add(x.name, x.images && (x.images.url_2x || x.images.url_1x), 'Twitch', false)); })]);
  for (const [label, fn] of jobs) {   // globals first, channel sets last so they win on name clashes
    chan = /channel/i.test(label) ? 1 : 0;
    try { await fn(); got[label] = true; } catch (e) { log('emotes: ' + label + ' failed (' + e.message + ')'); }
  }
  if (Object.keys(map).length) {
    emotes = map; emotesUpdated = Date.now();
    try { fs.writeFileSync(path.join(DATA, 'emotes.json'), JSON.stringify({ emotes, updated: emotesUpdated })); } catch (e) { /* ignore */ }
    log('emotes loaded: ' + Object.keys(map).length + ' (' + Object.keys(got).join(', ') + ')');
  }
}
async function loadBadges() {
  if (!tokens) return;
  const map = {};
  for (const q of ['/chat/badges/global', '/chat/badges?broadcaster_id=' + tokens.user_id]) {
    try {
      const r = await helix('GET', q);
      if (r.ok) for (const set of r.json.data || []) for (const v of set.versions || []) map[set.set_id + '/' + v.id] = v.image_url_2x || v.image_url_1x;
    } catch (e) { log('badges failed:', e.message); }
  }
  if (Object.keys(map).length) badges = map;
}

// ------------------------------------------------------------------ moderation (Helix)
async function resolveUser(login) {
  const r = await helix('GET', '/users?login=' + encodeURIComponent(String(login).trim().replace(/^@+/, '').replace(/[,.:;!?]+$/, '').toLowerCase()));
  const u = r.ok && r.json.data && r.json.data[0];
  if (!u) throw new Error('No such user: ' + login);
  return u.id;
}
function must(r, what) {
  if (!r.ok) {
    let msg = (r.json && r.json.message) || 'HTTP ' + r.status;
    if (r.status === 401 || r.status === 403) msg += ' (press Connect Twitch again to grant moderation permissions)';
    throw new Error(what + ': ' + msg);
  }
  return r;
}
async function modAction(kind, b) {
  if (!tokens) throw new Error('Not connected to Twitch');
  const me = tokens.user_id, q = 'broadcaster_id=' + me + '&moderator_id=' + me;
  const userId = () => (b.userId ? b.userId : resolveUser(b.login));
  switch (kind) {
    case 'delete': must(await helix('DELETE', '/moderation/chat?' + q + '&message_id=' + encodeURIComponent(b.messageId)), 'Delete'); break;
    case 'clear': must(await helix('DELETE', '/moderation/chat?' + q), 'Clear chat'); break;
    case 'timeout': must(await helix('POST', '/moderation/bans?' + q, { data: { user_id: await userId(), duration: Math.min(1209600, Math.max(1, +b.seconds || 600)), reason: oneLine(b.reason, 400) } }), 'Timeout'); break;
    case 'ban': must(await helix('POST', '/moderation/bans?' + q, { data: { user_id: await userId(), reason: oneLine(b.reason, 400) } }), 'Ban'); break;
    case 'unban': must(await helix('DELETE', '/moderation/bans?' + q + '&user_id=' + await userId()), 'Unban'); break;
    case 'settings': {
      const o = {};
      if ('slow' in b) { o.slow_mode = !!b.slow; if (b.slow) o.slow_mode_wait_time = +b.slow === 1 ? 30 : Math.min(120, Math.max(3, +b.slow)); }
      if ('followers' in b) { o.follower_mode = !!b.followers; if (b.followers) o.follower_mode_duration = +b.followers === 1 ? 10 : Math.max(0, +b.followers); }
      if ('subs' in b) o.subscriber_mode = !!b.subs;
      if ('emote' in b) o.emote_mode = !!b.emote;
      if ('unique' in b) o.unique_chat_mode = !!b.unique;
      must(await helix('PATCH', '/chat/settings?' + q, o), 'Chat settings'); break;
    }
    case 'automod': {
      must(await helix('POST', '/moderation/automod/message', { user_id: me, msg_id: String(b.messageId || ''), action: b.allow ? 'ALLOW' : 'DENY' }), b.allow ? 'Allow' : 'Deny');
      automodHeld = automodHeld.filter((x) => x.id !== b.messageId); broadcast('automod', automodView()); break;
    }
    case 'send':
      if (bot.hasAccount()) { bot.say(String(b.message || '').slice(0, 500), b.replyTo); break; }   // a bot account speaks for everything typed in the app too
      must(await helix('POST', '/chat/messages', { broadcaster_id: me, sender_id: me, message: String(b.message || '').slice(0, 500),
      reply_parent_message_id: b.replyTo || undefined }), 'Send'); break;
    default: throw new Error('unknown action');
  }
  return { ok: true };
}
async function chatSettings() {
  if (!tokens) return {};
  const r = await helix('GET', '/chat/settings?broadcaster_id=' + tokens.user_id + '&moderator_id=' + tokens.user_id);
  const d = r.ok && r.json.data && r.json.data[0];
  return d ? { slow: d.slow_mode ? d.slow_mode_wait_time : 0, followers: d.follower_mode ? (d.follower_mode_duration || 0) + 1 : 0,
    subs: !!d.subscriber_mode, emote: !!d.emote_mode, unique: !!d.unique_chat_mode } : {};
}

// ------------------------------------------------------------------ stream title + category
const artUrl = (u, w = 144, h = 192) => String(u || '').replace('{width}x{height}', w + 'x' + h).replace(/-\d+x\d+(\.\w+)$/, '-' + w + 'x' + h + '$1');
async function searchCategories(q) {
  q = String(q || '').trim(); if (!q) return [];
  const r = await helix('GET', '/search/categories?first=12&query=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('Category search failed: ' + ((r.json && r.json.message) || r.status));
  return (r.json.data || []).map((c) => ({ id: c.id, name: c.name, art: artUrl(c.box_art_url) }));
}
async function channelInfo() {
  if (!tokens) throw new Error('Not connected to Twitch');
  const c = await helix('GET', '/channels?broadcaster_id=' + tokens.user_id), d = c.ok && c.json.data && c.json.data[0];
  if (!d) throw new Error('Could not read your channel info');
  let art = '';
  if (d.game_id && d.game_id !== '0') { const g = await helix('GET', '/games?id=' + d.game_id); art = artUrl(g.ok && g.json.data && g.json.data[0] ? g.json.data[0].box_art_url : ''); }
  return { title: d.title || '', gameId: d.game_id || '', gameName: d.game_name || '', art, language: d.broadcaster_language || '', recents: state.recentCategories, presets: state.streamPresets };
}
/** Change the stream title and/or category (Helix PATCH /channels). Used by the dashboard page and the bot's !title / !game. */
async function setChannel(b) {
  if (!tokens) throw new Error('Not connected to Twitch');
  const body = {};
  if (b.title != null) { const t = oneLine(b.title, 140); if (!t) throw new Error('Title cannot be empty'); body.title = t; }
  if (b.gameId != null && b.gameId !== '') body.game_id = String(b.gameId);
  if (!Object.keys(body).length) throw new Error('Nothing to change');
  must(await helix('PATCH', '/channels?broadcaster_id=' + tokens.user_id, body), 'Update channel');
  if (body.title) state.stream.title = body.title;
  if (body.game_id) {
    state.stream.game = body.game_id === '0' ? '' : (b.gameName || state.stream.game);
    if (body.game_id !== '0' && b.gameName) {
      state.recentCategories = [{ id: body.game_id, name: b.gameName, art: b.art || '' }].concat(state.recentCategories.filter((x) => x.id !== body.game_id)).slice(0, 10);
    }
  }
  persist(); broadcast('status', status());
  return { ok: true, title: state.stream.title, game: state.stream.game };
}
async function createClip() {
  if (!tokens) throw new Error('Not connected to Twitch');
  const r = await helix('POST', '/clips?broadcaster_id=' + tokens.user_id);
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'press Connect Twitch again to allow clips' : (r.json && r.json.message) || 'HTTP ' + r.status);
  const c = r.json.data && r.json.data[0]; if (!c) throw new Error('Twitch made no clip');
  return { id: c.id, url: 'https://clips.twitch.tv/' + c.id, editUrl: c.edit_url };
}
async function channelAction(action, b) {
  switch (action) {
    case 'update': return setChannel(b);
    case 'clip': return createClip();
    case 'preset/save': {
      const name = oneLine(b.name, 40) || oneLine(b.title, 40) || 'Preset';
      state.streamPresets.push({ id: 's-' + Math.random().toString(36).slice(2, 7), name, title: oneLine(b.title, 140), gameId: String(b.gameId || ''), gameName: oneLine(b.gameName, 100), art: String(b.art || '').slice(0, 300) });
      persist(); return { ok: true };
    }
    case 'preset/delete': state.streamPresets = state.streamPresets.filter((x) => x.id !== b.id); persist(); return { ok: true };
    default: throw new Error('unknown action');
  }
}

// ------------------------------------------------------------------ polls + predictions (Helix)
const cleanList = (v, min, max, len, what) => {
  const a = (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => oneLine(x, len)).filter(Boolean);
  if (a.length < min || a.length > max) throw new Error(what + ': give between ' + min + ' and ' + max + ' options (one per line)');
  return a;
};
const clamp = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
async function pollsSnapshot() {
  if (!tokens) throw new Error('Not connected to Twitch');
  const me = tokens.user_id, out = { poll: null, prediction: null, pollError: '', predictionError: '' };
  const [p, q] = await Promise.all([helix('GET', '/polls?broadcaster_id=' + me + '&first=1'), helix('GET', '/predictions?broadcaster_id=' + me + '&first=1')]);
  if (p.ok) out.poll = (p.json.data && p.json.data[0]) || null; else out.pollError = (p.json && p.json.message) || 'HTTP ' + p.status;
  if (q.ok) out.prediction = (q.json.data && q.json.data[0]) || null; else out.predictionError = (q.json && q.json.message) || 'HTTP ' + q.status;
  out.presets = { polls: state.pollPresets, predictions: state.predictionPresets };
  return out;
}
async function pollAction(action, b) {
  const out = await pollActionInner(action, b);
  if (b && b.say && !action.startsWith('preset')) bot.say(String(b.say).slice(0, 450));   // optional chat announcement
  return out;
}
async function pollActionInner(action, b) {
  if (!tokens && !action.startsWith('preset')) throw new Error('Not connected to Twitch');
  const me = tokens && tokens.user_id;
  switch (action) {
    case 'poll/create': {
      const body = { broadcaster_id: me, title: oneLine(b.title, 60), choices: cleanList(b.choices, 2, 5, 25, 'Poll').map((title) => ({ title })), duration: clamp(b.duration, 15, 1800, 60) };
      if (!body.title) throw new Error('Poll needs a question');
      if (b.points) { body.channel_points_voting_enabled = true; body.channel_points_per_vote = clamp(b.pointsPerVote, 1, 1000000, 100); }
      const r = must(await helix('POST', '/polls', body), 'Start poll'); return r.json.data[0];
    }
    case 'poll/end': must(await helix('PATCH', '/polls', { broadcaster_id: me, id: String(b.id), status: b.archive ? 'ARCHIVED' : 'TERMINATED' }), 'End poll'); return { ok: true };
    case 'prediction/create': {
      const body = { broadcaster_id: me, title: oneLine(b.title, 45), outcomes: cleanList(b.outcomes, 2, 10, 25, 'Prediction').map((title) => ({ title })), prediction_window: clamp(b.window, 30, 1800, 120) };
      if (!body.title) throw new Error('Prediction needs a question');
      const r = must(await helix('POST', '/predictions', body), 'Start prediction'); return r.json.data[0];
    }
    case 'prediction/lock': must(await helix('PATCH', '/predictions', { broadcaster_id: me, id: String(b.id), status: 'LOCKED' }), 'Lock prediction'); return { ok: true };
    case 'prediction/resolve': {
      if (!b.outcomeId) throw new Error('Pick the winning outcome');
      must(await helix('PATCH', '/predictions', { broadcaster_id: me, id: String(b.id), status: 'RESOLVED', winning_outcome_id: String(b.outcomeId) }), 'Resolve prediction'); return { ok: true };
    }
    case 'prediction/cancel': must(await helix('PATCH', '/predictions', { broadcaster_id: me, id: String(b.id), status: 'CANCELED' }), 'Cancel prediction'); return { ok: true };
    case 'preset/save': {
      const kind = b.kind === 'prediction' ? 'prediction' : 'poll', list = kind === 'poll' ? state.pollPresets : state.predictionPresets;
      const title = oneLine(b.title, kind === 'poll' ? 60 : 45); if (!title) throw new Error('Preset needs a question');
      const options = cleanList(b.options, 2, kind === 'poll' ? 5 : 10, 25, 'Preset');
      const seconds = kind === 'poll' ? clamp(b.seconds, 15, 1800, 60) : clamp(b.seconds, 30, 1800, 120);
      list.push({ id: kind[0] + '-' + Math.random().toString(36).slice(2, 7), title, options, seconds }); persist(); return { ok: true };
    }
    case 'preset/delete': state.pollPresets = state.pollPresets.filter((x) => x.id !== b.id); state.predictionPresets = state.predictionPresets.filter((x) => x.id !== b.id); persist(); return { ok: true };
    default: throw new Error('unknown action');
  }
}

/** A tip from any source (Stripe poller, /api/event webhook). amount is in major units (e.g. 10 = $10). */
function recordTip({ name, amount, currency, msg, tag }) {
  name = oneLine(name || 'Anonymous', 40) || 'Anonymous';
  const amt = Number(amount) || 0;
  let label = '';
  if (amt > 0) {
    try { label = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amt); }
    catch (e) { label = amt.toFixed(2) + (currency ? ' ' + currency : ''); }
  }
  const sess = state.session;
  if (amt > 0) {
    state.latest.tip = name + ' - ' + label; sess.tipTotal += amt; sess.tippers[name] = Math.round(((sess.tippers[name] || 0) + amt) * 100) / 100;
    persist();
  }
  fire('tip', { name, amount: label, message: oneLine(msg) }, amt);
}

let vizBands = [], vizAt = 0, vizWantAt = 0, vizSrc = '';   // live audio spectrum from the desktop app
let duelFreeAt = 0;   // duels play one after another in the overlay
function duelPlay(m) {
  const DUEL_MS = 9800, now = Date.now(), start = Math.max(now, duelFreeAt); duelFreeAt = start + DUEL_MS + 700;
  broadcast('duel', m); return start - now + DUEL_MS;   // how long until the result may be said in chat
}
let kokoroInstall = { running: false, ok: null, lines: [] };
let automodHeld = [];   // messages AutoMod is holding for review (in memory: Twitch drops them after ~3 minutes)
const automodView = () => { automodHeld = automodHeld.filter((x) => Date.now() - x.at < 180000); return automodHeld; };
let botQuiet = false;   // test alerts must not make the bot talk in chat
function handleEvent(type, e, opts = {}) {
  botQuiet = !!opts.test;
  try { return handleEventInner(type, e, opts); } finally { botQuiet = false; }
}
/** Handle one EventSub notification. opts.test = show the alert only, leave counters/labels alone. */
function handleEventInner(type, e, opts = {}) {
  const live = !opts.test;
  const s = state.session, A = state.allTime;
  switch (type) {
    case 'channel.follow': {
      const name = e.user_name;
      if (live) { state.latest.follower = name; pushRecent(state.recent.followers, name); s.followers++; }
      fire('follow', { name, uid: e.user_id });
      break;
    }
    case 'channel.subscribe': {
      const name = e.user_name;
      if (live) {
        state.latest.subscriber = name; pushRecent(state.recent.subscribers, name);
        if (e.is_gift) state.latest.giftRecipient = name; else s.subs++;   // gift recipients are counted via the gifter's total
      }
      if (!e.is_gift) fire('sub', { name, tier: tierOf(e.tier), uid: e.user_id });
      break;
    }
    case 'channel.subscription.gift': {
      const name = e.is_anonymous ? 'Anonymous' : e.user_name, n = e.total || 1;
      if (live) {
        s.giftSubs += n; s.gifters[name] = (s.gifters[name] || 0) + n;
        A.giftSubs += n; A.gifters[name] = (A.gifters[name] || 0) + n;
        state.latest.gifter = name + ' - ' + n;
      }
      fire('giftsub', { name, total: n, tier: tierOf(e.tier), uid: e.is_anonymous ? '' : e.user_id }, n);
      break;
    }
    case 'channel.subscription.message': {
      const name = e.user_name, m = e.cumulative_months || 1;
      if (live) {
        state.latest.subscriber = name; state.latest.resub = name + ' - ' + m + ' months';
        pushRecent(state.recent.subscribers, name); s.resubs++;
      }
      fire('resub', { name, months: m, tier: tierOf(e.tier), message: (e.message && e.message.text) || '', uid: e.user_id }, m);
      break;
    }
    case 'channel.cheer': {
      const name = e.is_anonymous ? 'Anonymous' : e.user_name, bits = e.bits || 0;
      if (live) {
        s.bits += bits; s.cheers++; s.cheerers[name] = (s.cheerers[name] || 0) + bits;
        A.bits += bits; A.cheerers[name] = (A.cheerers[name] || 0) + bits;
        state.latest.cheer = name + ' - ' + bits + ' bits'; pushRecent(state.recent.cheers, state.latest.cheer);
        scheduleLeaderboard();
      }
      fire('bits', { name, amount: bits, message: e.message || '', uid: e.is_anonymous ? '' : e.user_id }, bits);
      break;
    }
    case 'channel.bits.use': {   // cheers also arrive as channel.cheer (handled above); this one adds Power-ups, including custom ones: a Power-up named "Dance Party" starts the party
      if (e.type === 'cheer') break;
      if (live && /dance.?party/.test(JSON.stringify(e).toLowerCase())) bot.execute('!dance', { id: e.user_id || '', name: e.user_name || 'Someone' }, 4).catch(() => {});
      break;
    }
    case 'channel.raid': {
      const name = e.from_broadcaster_user_name, v = e.viewers || 0;
      if (live) {
        s.raids++; s.raiders += v; A.raids++; A.raiders += v;
        state.latest.raider = name + ' - ' + v; state.latest.raidViewers = v; pushRecent(state.recent.raiders, state.latest.raider);
        if (!A.biggestRaid || v > Number(A.biggestRaid.split(' - ')[1] || 0)) A.biggestRaid = name + ' - ' + v;
      }
      fire('raid', { name, viewers: v, uid: e.from_broadcaster_user_id }, v);
      if (live) scenes.fire('raid').catch(() => {});
      break;
    }
    case 'channel.channel_points_custom_reward_redemption.add': {
      const name = e.user_name, title = (e.reward && e.reward.title) || '';
      if (live) {
        s.redemptions++; s.pointsSpent += (e.reward && e.reward.cost) || 0;
        state.latest.redeem = name + ' - ' + title; state.latest.redeemUser = name; state.latest.redeemReward = title;
        pushRecent(state.recent.redemptions, state.latest.redeem);
      }
      fire('redeem', { name, reward: title, cost: (e.reward && e.reward.cost) || 0, input: e.user_input || '' }, (e.reward && e.reward.cost) || 0);
      if (live) hooks.onRedemption(e).catch((err) => log('hook error:', err.message));
      break;
    }
    case 'channel.hype_train.begin':
    case 'channel.hype_train.progress': {
      const hy = state.hype;
      if (live) {
        hy.active = true; hy.level = e.level || 1; hy.total = e.total || 0; hy.progress = e.progress || 0; hy.goal = e.goal || 0;
        hy.top = topContributor(e.top_contributions) || hy.top; hy.lastLevel = hy.level;
      }
      if (type.endsWith('begin')) { fire('hype_start', { level: e.level || 1 }); if (live) scenes.fire('hypeStart').catch(() => {}); }
      break;
    }
    case 'channel.hype_train.end': {
      if (live) { state.hype.active = false; state.hype.lastLevel = e.level || state.hype.level; state.hype.top = topContributor(e.top_contributions) || state.hype.top; }
      fire('hype_end', { level: e.level || 1 });
      if (live) scenes.fire('hypeEnd').catch(() => {});
      break;
    }
    case 'channel.goal.begin': case 'channel.goal.progress': case 'channel.goal.end': {
      if (live) state.goal = { description: e.description || '', current: e.current_amount, target: e.target_amount, type: e.type, achieved: !!e.is_achieved };
      if (type.endsWith('end') && e.is_achieved) systemLog('Goal reached: ' + (e.description || e.type));
      break;
    }
    case 'channel.poll.begin': case 'channel.poll.progress': case 'channel.poll.end': {
      if (live) {
        const ended = type.endsWith('end'), prev = state.poll;
        state.poll = { id: e.id, status: ended ? String(e.status || 'completed').toUpperCase() : 'ACTIVE', title: e.title || '',
          choices: (e.choices || []).map((c) => ({ id: c.id, title: c.title, votes: c.votes || 0 })),
          startedAt: Date.parse(e.started_at) || prev.startedAt || Date.now(), endsAt: e.ends_at ? Date.parse(e.ends_at) : prev.endsAt || 0,
          endedAt: ended ? Date.parse(e.ended_at) || Date.now() : 0 };
      }
      break;
    }
    case 'channel.prediction.begin': case 'channel.prediction.progress': case 'channel.prediction.lock': case 'channel.prediction.end': {
      if (live) {
        const k = type.split('.').pop(), prev = state.prediction;
        const outs = (e.outcomes || []).map((o) => ({ id: o.id, title: o.title, users: o.users || 0, points: o.channel_points || 0 }));
        const winO = k === 'end' && e.winning_outcome_id ? outs.find((o) => o.id === e.winning_outcome_id) : null;
        state.prediction = { id: e.id, status: k === 'lock' ? 'LOCKED' : k === 'end' ? String(e.status || 'resolved').toUpperCase() : 'OPEN', title: e.title || '', outcomes: outs,
          winner: winO ? winO.title : '', winnerId: winO ? winO.id : '',
          startedAt: Date.parse(e.started_at) || prev.startedAt || Date.now(), locksAt: e.locks_at ? Date.parse(e.locks_at) : prev.locksAt || 0,
          endedAt: k === 'end' ? Date.parse(e.ended_at) || Date.now() : 0 };
      }
      break;
    }
    case 'channel.update':
      if (live) { state.stream.title = e.title || state.stream.title; state.stream.game = e.category_name || state.stream.game; }
      break;
    case 'channel.chat.message_delete':
      chatMark((m) => m.id === e.target_message_id, { type: 'delete', id: e.target_message_id });
      return true;
    case 'channel.chat.clear_user_messages':
      chatMark((m) => m.uid === e.target_user_id, { type: 'clearUser', uid: e.target_user_id });
      return true;
    case 'channel.chat.clear':
      chatMark(() => true, { type: 'clear' });
      return true;
    case 'channel.chat.message': {
      if (live) { chatIn(e); bot.onMessage(e).catch((err) => log('bot error:', err.message)); }
      const name = e.chatter_user_name || e.chatter_user_login || '';
      const text = oneLine(e.message && e.message.text);
      if (!live || !name || text.startsWith('!') || CFG.ignoreChatters.includes(String(e.chatter_user_login || '').toLowerCase())) return true;
      s.chatMessages++; s.chatters[name] = (s.chatters[name] || 0) + 1;
      state.latest.chatter = name; state.latest.chatMessage = name + ': ' + text;
      pushRecent(state.recent.chat, state.latest.chatMessage);
      persist(true);
      return true;
    }
    case 'channel.ad_break.begin':
      if (live) adStarted(e.duration_seconds || 0);
      systemLog('Ad break started (' + (e.duration_seconds || '?') + 's)');
      break;
    case 'channel.charity_campaign.donate': {
      const name = e.user_name, amt = money(e.amount);
      if (live) { state.latest.charityDonor = name + ' - ' + amt; state.charity.name = e.charity_name || state.charity.name; }
      fire('charity', { name, amount: amt, charity: e.charity_name || '' }, e.amount ? e.amount.value / Math.pow(10, e.amount.decimal_places || 0) : 0);
      break;
    }
    case 'channel.charity_campaign.start': case 'channel.charity_campaign.progress': {
      if (live) state.charity = { name: e.charity_name || '', current: e.current_amount ? e.current_amount.value / Math.pow(10, e.current_amount.decimal_places || 0) : 0,
        target: e.target_amount ? e.target_amount.value / Math.pow(10, e.target_amount.decimal_places || 0) : null, currency: e.target_amount ? e.target_amount.currency : '' };
      break;
    }
    case 'channel.charity_campaign.stop':
      if (live) state.charity = { name: '', current: null, target: null, currency: '' };
      break;
    case 'automod.message.hold': {
      if (!live) break;
      const why = e.reason === 'blocked_term' ? 'blocked term' : (e.automod && e.automod.category ? e.automod.category + ' (level ' + (e.automod.level || '?') + ')' : 'AutoMod');
      automodHeld = automodHeld.filter((x) => x.id !== e.message_id).concat([{ id: e.message_id, uid: e.user_id, login: e.user_login, name: e.user_name || e.user_login, text: oneLine(e.message && e.message.text, 500), why, at: Date.parse(e.held_at) || Date.now() }]).slice(-30);
      broadcast('automod', automodView()); systemLog('AutoMod is holding a message from ' + (e.user_name || e.user_login));
      return true;
    }
    case 'automod.message.update':
      automodHeld = automodHeld.filter((x) => x.id !== e.message_id); broadcast('automod', automodView());
      return true;
    case 'stream.online':
      if (live) { state.stream.live = true; state.stream.startedAt = e.started_at || new Date().toISOString(); if (CFG.resetSessionOnStreamOnline) resetSession(); pollStream(); scenes.fire('online').catch(() => {}); }
      systemLog('Stream went online');
      break;
    case 'stream.offline':
      if (live) { state.stream.live = false; state.stream.viewers = 0; state.stream.startedAt = ''; scenes.fire('offline').catch(() => {}); }
      systemLog('Stream went offline');
      break;
    default: return false;
  }
  if (live) { persist(); scheduleTotals(); }
  if (type.startsWith('channel.hype_train')) broadcast('hype', state.hype);
  return true;
}

// sample payloads in real EventSub event shape (used by the dashboard test buttons and the self-test)
const SAMPLES = {
  follow: ['channel.follow', { user_name: 'RetroRider', user_login: 'retrorider' }],
  sub: ['channel.subscribe', { user_name: 'VinylVince', tier: '1000', is_gift: false }],
  resub: ['channel.subscription.message', { user_name: 'TealTina', tier: '1000', cumulative_months: 7, message: { text: 'Love the stream!' } }],
  giftsub: ['channel.subscription.gift', { user_name: 'GenerousGamer', total: 5, tier: '1000', is_anonymous: false }],
  bits: ['channel.cheer', { user_name: 'BitBaron', bits: 500, message: 'Take my bits!', is_anonymous: false }],
  raid: ['channel.raid', { from_broadcaster_user_name: 'FriendlyStreamer', viewers: 42 }],
  redeem: ['channel.channel_points_custom_reward_redemption.add', { user_name: 'ChaosChad', reward: { title: 'Hydrate!', cost: 500 }, user_input: '' }],
  hype: ['channel.hype_train.begin', { level: 1 }],
  charity: ['channel.charity_campaign.donate', { user_name: 'KindKira', charity_name: 'Save The Pixels', amount: { value: 1000, decimal_places: 2, currency: 'USD' } }],
};

// ------------------------------------------------------------------ Twitch auth
let tokens = null;
try { tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch (e) { /* not logged in */ }
let authState = { status: tokens ? 'ok' : 'none', message: tokens ? 'Logged in as ' + (tokens.login || '?') : 'Not connected' };
let deviceFlow = null;

const form = (o) => new URLSearchParams(o).toString();
async function idPost(endpoint, body) {
  const r = await fetch(ID_URL + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}
function saveTokens(t) {
  tokens = t;
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2), 'utf8');
}
async function validate(access) {
  const r = await fetch(ID_URL + '/validate', { headers: { Authorization: 'OAuth ' + access } });
  return r.ok ? r.json() : null;
}
async function startDeviceAuth() {
  CFG = loadConfig();
  if (!CFG.clientId) throw new Error('No Twitch Client ID yet: open Setup and add one under Advanced.');
  const r = await idPost('/device', { client_id: CFG.clientId, scopes: SCOPES.join(' ') });
  if (!r.ok) throw new Error('Twitch refused the request: ' + (r.json.message || r.status));
  const d = r.json;
  deviceFlow = { user_code: d.user_code, verification_uri: d.verification_uri, expires: Date.now() + d.expires_in * 1000 };
  authState = { status: 'pending', message: 'Open the link and enter the code' };
  pollDevice(d.device_code, (d.interval || 5) * 1000);
  return deviceFlow;
}
async function pollDevice(code, interval) {
  while (deviceFlow && Date.now() < deviceFlow.expires) {
    await new Promise((r) => setTimeout(r, interval));
    const r = await idPost('/token', {
      client_id: CFG.clientId, scopes: SCOPES.join(' '), device_code: code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (r.ok) {
      const v = await validate(r.json.access_token);
      saveTokens({
        access_token: r.json.access_token, refresh_token: r.json.refresh_token,
        expires_at: Date.now() + (r.json.expires_in || 14400) * 1000,
        user_id: v && v.user_id, login: v && v.login, scopes: r.json.scope,
      });
      deviceFlow = null;
      authState = { status: 'ok', message: 'Logged in as ' + (tokens.login || '?') };
      log('Twitch login OK:', tokens.login);
      broadcast('status', status());
      startEventSub();
      return;
    }
    const msg = r.json.message || '';
    if (!/authorization_pending|slow_down/i.test(msg)) {
      authState = { status: 'error', message: 'Login failed: ' + msg };
      deviceFlow = null; broadcast('status', status()); return;
    }
  }
  authState = { status: 'error', message: 'Login code expired - press Connect again' };
  deviceFlow = null; broadcast('status', status());
}
// A Twitch refresh token works only once, and many requests can find the access token expired at the same moment (the 35 event subscriptions at start-up, for example):
// they must all share ONE refresh, or the extra ones use the already-spent token and the login is lost.
let refreshing = null;
function refreshToken() { return refreshing || (refreshing = refreshTokenOnce().finally(() => { refreshing = null; })); }
async function refreshTokenOnce() {
  if (!tokens || !tokens.refresh_token) throw new Error('no refresh token');
  const r = await idPost('/token', { client_id: CFG.clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  if (!r.ok) { authState = { status: 'error', message: 'Session expired - press Connect Twitch again' }; broadcast('status', status()); throw new Error('refresh failed: ' + (r.json.message || r.status)); }
  log('Twitch login renewed (valid for ' + Math.round((r.json.expires_in || 14400) / 60) + ' min)');
  saveTokens(Object.assign({}, tokens, {
    access_token: r.json.access_token, refresh_token: r.json.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (r.json.expires_in || 14400) * 1000, scopes: r.json.scope || tokens.scopes,
  }));
}
async function helix(method, pathq, body, retry = true) {
  if (!tokens) throw new Error('not logged in');
  if (tokens.expires_at - Date.now() < 5 * 60 * 1000) await refreshToken();
  const r = await fetch(HELIX + pathq, {
    method, headers: { 'Client-Id': CFG.clientId, Authorization: 'Bearer ' + tokens.access_token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && retry) { await refreshToken(); return helix(method, pathq, body, false); }
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

// ------------------------------------------------------------------ totals (follower/sub counts)
let totalsTimer;
function scheduleTotals() { clearTimeout(totalsTimer); totalsTimer = setTimeout(refreshTotals, 4000); }
async function refreshTotals() {
  if (!tokens) return;
  try {
    const f = await helix('GET', '/channels/followers?broadcaster_id=' + tokens.user_id + '&first=1');
    if (f.ok) state.totals.followers = f.json.total;
    const s = await helix('GET', '/subscriptions?broadcaster_id=' + tokens.user_id + '&first=1');
    if (s.ok) { state.totals.subs = Math.max(0, (s.json.total || 1) - 1); state.totals.subPoints = s.json.points; }  // minus the broadcaster's own sub
    persist();
  } catch (e) { log('totals refresh failed:', e.message); }
}


// ------------------------------------------------------------------ pollers (stream info, bits leaderboard, ads) + clock
let lbTimer, adTimer;
function scheduleLeaderboard() { clearTimeout(lbTimer); lbTimer = setTimeout(refreshLeaderboard, 6000); }
async function refreshLeaderboard() {
  if (!tokens) return;
  for (const period of ['day', 'week', 'month', 'year', 'all']) {
    try {
      const r = await helix('GET', '/bits/leaderboard?count=5&period=' + period);
      if (r.ok) state.leaderboard[period] = (r.json.data || []).map((x) => ({ name: x.user_name, score: x.score }));
    } catch (e) { log('leaderboard failed:', e.message); return; }
  }
  persist(true);
}
async function pollStream() {
  if (!tokens) return;
  try {
    const r = await helix('GET', '/streams?user_id=' + tokens.user_id);
    if (r.ok) {
      const d = r.json.data && r.json.data[0];
      if (d) {
        const was = state.stream.live;
        Object.assign(state.stream, { live: true, viewers: d.viewer_count || 0, title: d.title || state.stream.title, game: d.game_name || state.stream.game, startedAt: d.started_at || state.stream.startedAt });
        state.session.peakViewers = Math.max(state.session.peakViewers, state.stream.viewers);
        if (!was && CFG.resetSessionOnStreamOnline && Date.now() - Date.parse(d.started_at) < 120000) resetSession();
      } else { state.stream.live = false; state.stream.viewers = 0; state.stream.startedAt = ''; }
    }
    if (!state.stream.live || !state.stream.title || !state.channel.name) {
      const c = await helix('GET', '/channels?broadcaster_id=' + tokens.user_id);
      const d = c.ok && c.json.data && c.json.data[0];
      if (d) { state.stream.title = d.title || ''; state.stream.game = d.game_name || ''; state.channel.name = d.broadcaster_name || state.channel.name; }
    }
    if (!state.channel.name && tokens.login) state.channel.name = tokens.login;
    persist(true);
  } catch (e) { log('stream poll failed:', e.message); }
}
function scheduleAds() { clearTimeout(adTimer); adTimer = setTimeout(refreshAds, 3000); }
let adWarned = 0;
function adStarted(seconds) {
  const a = state.ads; if (a.running && a.endsAt > Date.now() + 1000) return;   // EventSub + our own button both report the same ad
  scenes.fire('adStart').catch(() => {});
  a.running = true; a.lastDuration = seconds; a.lastAt = Date.now(); a.endsAt = Date.now() + seconds * 1000; persist(true);
  const SS = state.adSettings;
  if (SS.startOn && SS.startMsg) bot.say(String(SS.startMsg).replace(/\{duration\}/g, seconds), undefined, SS.startColor);   // e.g. the "Twitch is rolling a quick ad break" announcement
  const t = setTimeout(() => {
    a.running = false; persist(true); scheduleAds(); scenes.fire('adEnd').catch(() => {});
    if (state.adSettings.afterOn && state.adSettings.afterMsg) bot.say(state.adSettings.afterMsg, undefined, state.adSettings.afterColor);
  }, seconds * 1000);
  if (t.unref) t.unref();
}
function adTicker() {   // optional chat heads-up before the scheduled automatic ad
  const a = state.ads, S = state.adSettings;
  if (!S.warnSeconds || !a.nextAt || a.running || !state.stream.live) return;
  const left = (a.nextAt - Date.now()) / 1000;
  if (left > 0 && left <= S.warnSeconds && adWarned !== a.nextAt) { adWarned = a.nextAt; bot.say(String(S.warnMsg || '').replace(/\{seconds\}/g, Math.round(left)), undefined, S.warnColor); }
}
const AD_LENGTHS = [30, 60, 90, 120, 150, 180];
async function adsAction(action, b) {
  if (!tokens) throw new Error('Not connected to Twitch');
  switch (action) {
    case 'run': {
      const length = AD_LENGTHS.includes(Number(b.length)) ? Number(b.length) : 30;
      const r = must(await helix('POST', '/channels/commercial', { broadcaster_id: tokens.user_id, length }), 'Run ad');
      const d = r.json.data && r.json.data[0];
      if (d && d.message) throw new Error('Run ad: ' + d.message);
      adStarted((d && d.length) || length);
      if (d && d.retry_after) state.ads.nextAt = Math.max(state.ads.nextAt, Date.now() + d.retry_after * 1000);
      scheduleAds();
      return { ok: true, length: (d && d.length) || length, retryAfter: d ? d.retry_after : 0 };
    }
    case 'snooze': {
      const r = must(await helix('POST', '/channels/ads/schedule/snooze?broadcaster_id=' + tokens.user_id), 'Snooze ad');
      const d = r.json.data && r.json.data[0];
      if (d) { state.ads.snoozes = d.snooze_count; state.ads.snoozeRefreshAt = d.snooze_refresh_at ? Date.parse(d.snooze_refresh_at) || d.snooze_refresh_at * 1000 : 0; if (d.next_ad_at) state.ads.nextAt = Date.parse(d.next_ad_at) || d.next_ad_at * 1000; persist(); }
      return { ok: true, snoozes: state.ads.snoozes, nextAt: state.ads.nextAt };
    }
    case 'settings': {
      const S = state.adSettings;
      S.warnSeconds = clamp(b.warnSeconds, 0, 900, 0); S.warnMsg = oneLine(b.warnMsg, 200) || S.warnMsg; S.afterOn = !!b.afterOn; S.afterMsg = oneLine(b.afterMsg, 200) || S.afterMsg;
      const col = (v) => (bot.ANN_COLORS.includes(v) ? v : '');
      S.startOn = !!b.startOn; S.startMsg = oneLine(b.startMsg, 300) || S.startMsg; S.startColor = col(b.startColor); S.warnColor = col(b.warnColor); S.afterColor = col(b.afterColor); persist();
      return S;
    }
    default: throw new Error('unknown action');
  }
}
const adsView = () => Object.assign({}, state.ads, { now: Date.now(), live: state.stream.live, settings: state.adSettings, lengths: AD_LENGTHS });
async function refreshAds() {
  if (!tokens) return;
  try {
    const r = await helix('GET', '/channels/ads?broadcaster_id=' + tokens.user_id);
    const d = r.ok && r.json.data && r.json.data[0];
    if (d) {
      state.ads.nextAt = d.next_ad_at ? d.next_ad_at * 1000 : 0; state.ads.snoozes = d.snooze_count; state.ads.snoozeRefreshAt = d.snooze_refresh_at ? d.snooze_refresh_at * 1000 : 0;
      state.ads.prerollFree = d.preroll_free_time || 0; if (d.last_ad_at) state.ads.lastAt = d.last_ad_at * 1000; if (d.duration) state.ads.lastDuration = d.duration; persist(true);
    }
  } catch (e) { log('ad schedule failed:', e.message); }
}
function startPollers() {
  pollStream(); refreshLeaderboard(); refreshAds(); loadBadges(); loadEmotes(); syncPolls();
  if (startPollers.t) return;
  startPollers.t = [setInterval(pollStream, 30000), setInterval(refreshLeaderboard, 600000), setInterval(refreshAds, 60000), setInterval(refreshTotals, 300000), setInterval(loadEmotes, 1800000), setInterval(loadBadges, 3600000)];
  // 1s clock: uptime and ad countdown tick without any Twitch traffic
  startPollers.t.push(setInterval(() => { if (state.stream.live || state.ads.nextAt) renderLabels(); adTicker(); }, 1000));
  startPollers.t.push(setInterval(() => { if (clients.size) broadcast('stats', statsView()); }, 5000));
  startPollers.t.forEach((t) => t.unref && t.unref());
}
// ------------------------------------------------------------------ Stripe tips (polls Checkout Sessions created by your Payment Link)
let stripeStatus = { enabled: false, ok: null, error: '', lastPoll: 0, tips: 0 };
function customField(session, needles) {
  for (const f of session.custom_fields || []) {
    const hay = ((f.key || '') + ' ' + ((f.label && f.label.custom) || '')).toLowerCase();
    const v = f.text && f.text.value;
    if (v && needles.some((n) => hay.includes(n))) return v;
  }
  return '';
}
async function pollStripe() {
  const cfg = CFG.stripe;
  stripeStatus.enabled = !!cfg.apiKey;
  if (!cfg.apiKey) return;
  try {
    let url = STRIPE_URL + '/checkout/sessions?limit=30&status=complete';
    if (cfg.paymentLinkId) url += '&payment_link=' + encodeURIComponent(cfg.paymentLinkId);
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + cfg.apiKey } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
    const st = state.stripe, fresh = [], seenBefore = st.seen.length, baseline = !st.since;
    for (const x of (j.data || []).slice().reverse()) {           // oldest first
      if (st.seen.includes(x.id)) continue;
      st.seen.push(x.id);
      if (st.since && x.created >= st.since && x.payment_status === 'paid' && x.payment_link) fresh.push(x);
    }
    if (!st.since) st.since = Math.floor(Date.now() / 1000);       // first run: baseline only, never replay history
    st.seen = st.seen.slice(-300);
    for (const x of fresh) {
      const name = customField(x, ['name']) || (x.customer_details && x.customer_details.name) || 'Anonymous';
      recordTip({ name, amount: (x.amount_total || 0) / 100, currency: (x.currency || 'usd').toUpperCase(), msg: customField(x, ['message', 'note', 'comment']) });
      stripeStatus.tips++;
    }
    stripeStatus.ok = true; stripeStatus.error = '';
    if (fresh.length || baseline || st.seen.length !== seenBefore) persist(true);
  } catch (e) {
    stripeStatus.ok = false; stripeStatus.error = e.message;
    if (!pollStripe.warned) { log('Stripe poll failed:', e.message); pollStripe.warned = true; }
  }
  stripeStatus.lastPoll = Date.now();
  broadcast('status', status());
}
function startStripe() {
  CFG = loadConfig();
  stripeStatus.enabled = !!CFG.stripe.apiKey;
  if (!CFG.stripe.apiKey) return;
  log('Stripe tips enabled (' + (CFG.stripe.apiKey.startsWith('rk_test') || CFG.stripe.apiKey.startsWith('sk_test') ? 'TEST mode' : 'live') + ')');
  pollStripe();
  setInterval(pollStripe, process.env.ICM_STRIPE_POLL_MS ? +process.env.ICM_STRIPE_POLL_MS : Math.max(10, CFG.stripe.pollSeconds || 20) * 1000);
}
function missingScopes() { return tokens ? SCOPES.filter((x) => !(tokens.scopes || []).includes(x)) : []; }

// ------------------------------------------------------------------ EventSub websocket
let esWs = null, esTimer = null, esBackoff = 2000, esStopped = false;
const seen = new Set();
function subscriptionList(uid) {
  return [
    ['channel.follow', '2', { broadcaster_user_id: uid, moderator_user_id: uid }],
    ['channel.subscribe', '1', { broadcaster_user_id: uid }],
    ['channel.subscription.gift', '1', { broadcaster_user_id: uid }],
    ['channel.subscription.message', '1', { broadcaster_user_id: uid }],
    ['channel.cheer', '1', { broadcaster_user_id: uid }],
    ['channel.bits.use', '1', { broadcaster_user_id: uid }],
    ['channel.raid', '1', { to_broadcaster_user_id: uid }],
    ['channel.channel_points_custom_reward_redemption.add', '1', { broadcaster_user_id: uid }],
    ['channel.hype_train.begin', '2', { broadcaster_user_id: uid }],
    ['channel.hype_train.progress', '2', { broadcaster_user_id: uid }],
    ['channel.hype_train.end', '2', { broadcaster_user_id: uid }],
    ['channel.goal.begin', '1', { broadcaster_user_id: uid }],
    ['channel.goal.progress', '1', { broadcaster_user_id: uid }],
    ['channel.goal.end', '1', { broadcaster_user_id: uid }],
    ['channel.poll.begin', '1', { broadcaster_user_id: uid }],
    ['channel.poll.progress', '1', { broadcaster_user_id: uid }],
    ['channel.poll.end', '1', { broadcaster_user_id: uid }],
    ['channel.prediction.begin', '1', { broadcaster_user_id: uid }],
    ['channel.prediction.progress', '1', { broadcaster_user_id: uid }],
    ['channel.prediction.lock', '1', { broadcaster_user_id: uid }],
    ['channel.prediction.end', '1', { broadcaster_user_id: uid }],
    ['channel.chat.message', '1', { broadcaster_user_id: uid, user_id: uid }],
    ['channel.chat.message_delete', '1', { broadcaster_user_id: uid, user_id: uid }],
    ['channel.chat.clear_user_messages', '1', { broadcaster_user_id: uid, user_id: uid }],
    ['channel.chat.clear', '1', { broadcaster_user_id: uid, user_id: uid }],
    ['channel.ad_break.begin', '1', { broadcaster_user_id: uid }],
    ['channel.charity_campaign.donate', '1', { broadcaster_user_id: uid }],
    ['channel.charity_campaign.start', '1', { broadcaster_user_id: uid }],
    ['channel.charity_campaign.progress', '1', { broadcaster_user_id: uid }],
    ['channel.charity_campaign.stop', '1', { broadcaster_user_id: uid }],
    ['automod.message.hold', '2', { broadcaster_user_id: uid, moderator_user_id: uid }],
    ['automod.message.update', '2', { broadcaster_user_id: uid, moderator_user_id: uid }],
    ['channel.update', '2', { broadcaster_user_id: uid }],
    ['stream.online', '1', { broadcaster_user_id: uid }],
    ['stream.offline', '1', { broadcaster_user_id: uid }],
  ];
}
async function subscribeAll(sessionId) {
  let ok = 0, fail = 0;
  for (const [type, version, condition] of subscriptionList(tokens.user_id)) {
    try {
      const r = await helix('POST', '/eventsub/subscriptions', { type, version, condition, transport: { method: 'websocket', session_id: sessionId } });
      if (r.ok) ok++; else { fail++; log('subscribe failed', type, r.status, r.json.message || ''); }
    } catch (e) { fail++; log('subscribe error', type, e.message); }
  }
  log('EventSub subscriptions: ' + ok + ' ok, ' + fail + ' failed');
  esStatus = fail === 0 ? 'connected' : (ok ? 'partial' : 'error');
  broadcast('status', status());
}
let esStatus = 'offline';
function startEventSub() {
  esStopped = false;
  bot.start();
  if (!tokens) return;
  openEventSub(EVENTSUB_URL, false);
  refreshTotals();
  startPollers();
}
function openEventSub(url, isReconnect) {
  let ws;
  try { ws = new WebSocket(url); } catch (e) { log('websocket error', e.message); return scheduleReconnect(); }
  let keepaliveMs = 45000, timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { log('EventSub keepalive timeout'); try { ws.close(); } catch (e) { /* ignore */ } }, keepaliveMs); };
  ws.onopen = () => { esStatus = 'connecting'; broadcast('status', status()); arm(); };
  ws.onmessage = async (ev) => {
    arm();
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    const t = msg.metadata && msg.metadata.message_type;
    if (t === 'session_welcome') {
      const sess = msg.payload.session;
      keepaliveMs = ((sess.keepalive_timeout_seconds || 30) + 10) * 1000; arm();
      if (esWs && esWs !== ws) { try { esWs.onclose = null; esWs.close(); } catch (e) { /* ignore */ } }
      esWs = ws; esBackoff = 2000;
      if (!isReconnect) await subscribeAll(sess.id);
      else { esStatus = 'connected'; broadcast('status', status()); }
    } else if (t === 'notification') {
      const id = msg.metadata.message_id;
      if (seen.has(id)) return;
      seen.add(id); if (seen.size > 500) seen.delete(seen.values().next().value);
      handleEvent(msg.payload.subscription.type, msg.payload.event);
    } else if (t === 'session_reconnect') {
      log('EventSub asked us to reconnect');
      openEventSub(msg.payload.session.reconnect_url, true);
    } else if (t === 'revocation') {
      log('EventSub subscription revoked:', msg.payload.subscription.type, msg.payload.subscription.status);
    }
  };
  ws.onclose = () => {
    clearTimeout(timer);
    if (esWs === ws) { esWs = null; esStatus = 'offline'; broadcast('status', status()); scheduleReconnect(); }
  };
  ws.onerror = () => { /* onclose follows */ };
}
function scheduleReconnect() {
  if (esStopped || !tokens) return;
  clearTimeout(esTimer);
  esTimer = setTimeout(() => openEventSub(EVENTSUB_URL, false), esBackoff);
  esBackoff = Math.min(esBackoff * 2, 60000);
}

// ------------------------------------------------------------------ http server
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const STATIC = { overlays: ROOT, assets: ROOT, sounds: ROOT };   // top-level folders that may be served
function status() {
  return {
    auth: authState, eventsub: esStatus, clientId: !!loadConfig().clientId, login: tokens && tokens.login,
    missingScopes: missingScopes(),
    stripe: stripeStatus,
    device: deviceFlow && { user_code: deviceFlow.user_code, verification_uri: deviceFlow.verification_uri },
    totals: state.totals, session: state.session, latest: state.latest,
  };
}
function originOk(req) {
  const o = req.headers.origin;
  if (!o || o === 'null') return true;
  try { const U = new URL(o); return U.hostname === 'localhost' || U.hostname === '127.0.0.1' || U.host === req.headers.host; } catch (e) { return false; }
}
function readJson(req, limit) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > (limit || 1e5)) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

async function route(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(u.pathname);

  if (access.gate(req, res, p)) return;
  if (p === '/api/login' && req.method === 'POST') return access.login(req, res, await readJson(req));
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write('retry: 2000\n\n');
    sseSend(res, 'status', status());
    sseSend(res, 'goals', goalViews());
    sseSend(res, 'media', media.view());
    sseSend(res, 'countdown', countdown.view()); sseSend(res, 'subathon', subathon.view());
    sseSend(res, 'alertctl', Object.assign({ action: 'init' }, alertCtl));
    sseSend(res, 'polls', pollOverlayView());
    sseSend(res, 'overlaycfg', state.overlayCfg); sseSend(res, 'automod', automodView()); sseSend(res, 'hype', state.hype); sseSend(res, 'stats', statsView());
    clients.add(res);
    const ka = setInterval(() => { try { res.write(': keepalive\n\n'); } catch (e) { /* closed */ } }, 20000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }
  if (p === '/api/bot') return json(res, 200, bot.view());
  if (p === '/bot' || p === '/bot/') return serveFile(res, path.join(__dirname, 'public', 'bot.html'));
  if (p === '/api/polls') { try { return json(res, 200, await pollsSnapshot()); } catch (e) { return json(res, 200, { error: e.message, presets: { polls: state.pollPresets, predictions: state.predictionPresets } }); } }
  if (p === '/polls' || p === '/polls/') return serveFile(res, path.join(__dirname, 'public', 'polls.html'));
  if (p === '/api/channel') { try { return json(res, 200, await channelInfo()); } catch (e) { return json(res, 200, { error: e.message, recents: state.recentCategories, presets: state.streamPresets }); } }
  if (p === '/api/categories') { try { return json(res, 200, { results: await searchCategories(u.searchParams.get('q')) }); } catch (e) { return json(res, 200, { results: [], error: e.message }); } }
  if (p === '/stream' || p === '/stream/') return serveFile(res, path.join(__dirname, 'public', 'stream.html'));
  if (p === '/api/ads') return json(res, 200, adsView());
  if (p === '/ads' || p === '/ads/') return serveFile(res, path.join(__dirname, 'public', 'ads.html'));
  if (p === '/api/commands/export') {
    const ex = bot.exportCommands(), f = u.searchParams.get('format') || 'html';
    const type = f === 'md' ? 'text/markdown; charset=utf-8' : f === 'txt' ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Content-Disposition': u.searchParams.get('download') ? 'attachment; filename="chat-commands.' + (f === 'html' ? 'html' : f === 'md' ? 'md' : 'txt') + '"' : 'inline' });
    return res.end(f === 'md' ? ex.md : f === 'txt' ? ex.text : ex.html);
  }
  if (p === '/api/tts/install' && req.method === 'GET') return json(res, 200, kokoroInstall);
  if (p === '/api/overlay-settings') return json(res, 200, state.overlayCfg);
  if (p === '/overlay-editor' || p === '/overlay-editor/') return serveFile(res, path.join(__dirname, 'public', 'overlay-editor.html'));
  if (p === '/api/automod') return json(res, 200, automodView());
  if (p === '/ui-theme.js') return serveFile(res, path.join(__dirname, 'public', 'ui-theme.js'));
  if (p === '/games' || p === '/games/') return serveFile(res, path.join(__dirname, 'public', 'games.html'));
  if (p === '/goals' || p === '/goals/') return serveFile(res, path.join(__dirname, 'public', 'goals.html'));
  if (p === '/api/paypal') return json(res, 200, paypal.view());
  if (p === '/panels' || p === '/panels/') return serveFile(res, path.join(__dirname, 'public', 'panels.html'));
  if (p.startsWith('/panel-img/')) return serveFile(res, path.join(DATA, 'panels', path.basename(p)));
  if (p === '/api/panels') return json(res, 200, { panels: state.panels, login: tokens ? tokens.login : '' });
  if (p === '/tips' || p === '/tips/') return serveFile(res, path.join(__dirname, 'public', 'tips.html'));
  if (p === '/welcome' || p === '/welcome/') return serveFile(res, path.join(__dirname, 'public', 'welcome.html'));
  if (req.method === 'GET' && p === '/api/welcome') return json(res, 200, { done: !!state.setup.done || !!tokens });   // anyone already logged in to Twitch has been through setup
  if (req.method === 'GET' && p === '/api/update') return json(res, 200, updateView());
  if (req.method === 'GET' && p === '/api/diagnostics') return json(res, 200, { text: diagnostics() });
  if (req.method === 'GET' && p === '/api/obs/stats') { try { return json(res, 200, await obsStats()); } catch (e) { return json(res, 200, { error: e.message }); } }
  if (req.method === 'GET' && p === '/api/vm') return json(res, 200, vmix.status());
  if (req.method === 'GET' && p === '/api/vm/volumes') return json(res, 200, await vmix.volumes());
  if (req.method === 'GET' && p === '/api/vm/devices') { try { return json(res, 200, await vmix.devices()); } catch (e) { return json(res, 200, { inputs: [], outputs: [], error: e.message }); } }
  if (req.method === 'GET' && p === '/api/vm/obs/inputs') { try { return json(res, 200, { inputs: await vmix.obsInputs() }); } catch (e) { return json(res, 200, { inputs: [], error: e.message }); } }
  if (p === '/viz-capture') return serveFile(res, path.join(__dirname, 'public', 'viz-capture.html'));
  if (p === '/api/viz' && req.method === 'GET') { vizWantAt = Date.now(); return json(res, 200, { src: vizSrc, b: Date.now() - vizAt < 1500 ? vizBands : [], live: Date.now() - vizAt < 6000 }); }   // overlays call this to switch the spectrum on and as a fallback read
  if (p === '/api/audio') return json(res, 200, audio.touch());
  if (p === '/api/audio/scene') { try { return json(res, 200, await audio.forScene(u.searchParams.get('name') || '')); } catch (e) { return json(res, 200, { error: e.message, inputs: [] }); } }
  if (p === '/api/hype') return json(res, 200, state.hype);
  if (p === '/api/stats') return json(res, 200, statsView());
  if (p === '/api/scenes') return json(res, 200, scenes.view());
  if (p === '/board' || p === '/board/') return serveFile(res, path.join(__dirname, 'public', 'board.html'));
  if (p === '/setup' || p === '/setup/') return serveFile(res, path.join(__dirname, 'public', 'setup.html'));
  if (p === '/api/hooks') return json(res, 200, hooks.view());
  if (p === '/api/hooks/rewards') { try { return json(res, 200, { rewards: await hooks.rewards(false) }); } catch (e) { return json(res, 200, { rewards: [], error: e.message }); } }
  if (p === '/hooks' || p === '/hooks/') return serveFile(res, path.join(__dirname, 'public', 'hooks.html'));
  if (p === '/api/countdown') return json(res, 200, countdown.view());
  if (p === '/api/subathon') return json(res, 200, Object.assign(subathon.view(), { rules: subathon.rules() }));
  if (p === '/subathon' || p === '/subathon/') return serveFile(res, path.join(__dirname, 'public', 'subathon.html'));
  if (p === '/countdown' || p === '/countdown/') return serveFile(res, path.join(__dirname, 'public', 'countdown.html'));
  if (p === '/api/media') return json(res, 200, media.view());
  if (p === '/media/art') { const a = media.art(); if (!a) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': a.type, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' }); return res.end(a.buf); }
  if (p === '/spotify/callback') {
    const q = Object.fromEntries(u.searchParams),
      page = (ok, msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset=utf-8><title>Spotify</title><body style="background:#222A2A;color:#E2DAC2;font-family:Segoe UI,sans-serif;padding:40px"><h2 style="color:' + (ok ? '#4FBBBC' : '#EC4624') + '">' + msg + '</h2><p><a style="color:#F39120" href="/music">Back to the music page</a></p>'); };
    try { await media.spotifyCallback(q); return page(true, 'Spotify connected. You can close this tab.'); } catch (e) { return page(false, String(e.message).replace(/[<>&]/g, '')); }
  }
  if (p === '/music' || p === '/music/') return serveFile(res, path.join(__dirname, 'public', 'music.html'));
  if (p === '/api/access') return json(res, 200, access.view());
  if (p === '/api/backup/list') return json(res, 200, backup.list());
  if (p === '/api/backup/download') {
    const f = backup.create({ out: path.join(os.tmpdir(), 'icm-backup-' + Date.now() + '.zip'), includeLogins: u.searchParams.get('includeLogins') === '1' }).file;
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="ItMeCasey-backup-' + new Date().toISOString().slice(0, 10) + '.zip"' });
    const rs = fs.createReadStream(f); rs.on('close', () => { try { fs.unlinkSync(f); } catch (e) { /* gone */ } });
    return rs.pipe(res); }
  if (p === '/api/health') return json(res, 200, health());
  if (p === '/api/config') { const c = loadConfig(); return json(res, 200, { clientId: c.clientId, port: c.port, version: APP_VERSION, dataDir: DATA, rootDir: ROOT }); }
  if (p === '/api/obs/collection') { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="ItMeCasey.json"', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify(buildCollection({ root: ROOT, dataDir: DATA, port: CFG.port }), null, 4)); }
  if (p === '/api/alerts/history') return json(res, 200, recentAlerts.map((a) => ({ id: a.id, kind: a.kind, event: a.event, tag: a.tag, name: a.name, msg: a.msg, ts: a.ts, tts: !!a.tts })));
  if (p === '/api/tts') { await tts.voices(); return json(res, 200, tts.view()); }
  if (p.startsWith('/tts/')) { const f = tts.clip(p.slice(5)); if (!f) { res.writeHead(404); return res.end(); } return serveFile(res, f); }
  if (p === '/tts' || p === '/tts/') return serveFile(res, path.join(__dirname, 'public', 'tts.html'));
  if (p === '/api/alerts') return json(res, 200, { ctl: alertCtl, rules: state.alertRules, events: ALERT_EVENTS, samples: SAMPLE_VARS, assets: alertAssets() });
  if (p === '/api/goals') return json(res, 200, { goals: goalViews(), metrics: Object.fromEntries(Object.entries(GOAL_METRICS).map(([k, v]) => [k, v[0]])), colors: GOAL_COLORS });
  if (p === '/api/emotes') return json(res, 200, { emotes, updated: emotesUpdated });
  if (p === '/api/badges') return json(res, 200, badges);
  if (p === '/api/chat/recent') return json(res, 200, chatBuf.filter((m) => !m.gone).slice(-120));
  if (p === '/api/chat/settings') { try { return json(res, 200, await chatSettings()); } catch (e) { return json(res, 200, {}); } }
  if (p === '/dock' || p === '/dock/') return serveFile(res, path.join(__dirname, 'public', 'dock.html'));
  if (p === '/api/status') return json(res, 200, Object.assign(status(), { recent: recentAlerts }));
  if (p === '/api/labels') {
    const o = {};
    for (const k of Object.keys(labelDocs)) o[k] = { value: labelCache[k] == null ? '' : labelCache[k], description: labelDocs[k] };
    return json(res, 200, o);
  }

  if (req.method === 'POST' && p.startsWith('/api/')) {
    if (!originOk(req)) return json(res, 403, { error: 'forbidden origin' });
    if (p === '/api/modules/install') {
      if (!access.isLoopback(req.socket.remoteAddress)) return json(res, 403, { error: 'Modules can only be installed on the PC itself' });
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 50e6) return json(res, 413, { error: 'Module zip is over 50 MB' }); chunks.push(c); }
      const tmp = path.join(os.tmpdir(), 'icm-modzip-' + Date.now() + '.zip'); fs.writeFileSync(tmp, Buffer.concat(chunks));
      try { return json(res, 200, modules.install(tmp)); } catch (e) { return json(res, 400, { error: e.message }); } finally { try { fs.unlinkSync(tmp); } catch (e) { /* gone */ } }
    }
    if (p === '/api/backup/restore') {
      if (!access.isLoopback(req.socket.remoteAddress)) return json(res, 403, { error: 'Restoring is only allowed on the PC itself' });
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 300e6) return json(res, 413, { error: 'Backup is over 300 MB' }); chunks.push(c); }
      const tmp = path.join(os.tmpdir(), 'icm-restore-' + Date.now() + '.zip'); fs.writeFileSync(tmp, Buffer.concat(chunks));
      try { return json(res, 200, backup.restore(tmp)); } catch (e) { return json(res, 400, { error: e.message }); } finally { try { fs.unlinkSync(tmp); } catch (e) { /* gone */ } }
    }
    if (p === '/api/alerts/upload') {
      const kind = ['image', 'video'].includes(u.searchParams.get('kind')) ? u.searchParams.get('kind') : 'sound';
      const raw = u.searchParams.get('name') || 'upload';
      const ext = path.extname(raw).toLowerCase(), okExt = kind === 'image' ? IMAGE_EXT : kind === 'video' ? VIDEO_EXT : SOUND_EXT, limit = kind === 'video' ? 80e6 : 15e6;
      if (!okExt.includes(ext)) return json(res, 400, { error: 'Allowed ' + kind + ' files: ' + okExt.join(' ') });
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > limit) return json(res, 413, { error: 'File is over ' + Math.round(limit / 1e6) + ' MB' }); chunks.push(c); }
      const base = path.basename(raw, ext).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'upload';
      const dir = path.join(CUSTOM, kind === 'image' ? 'assets' : kind === 'video' ? 'video' : 'sounds'); fs.mkdirSync(dir, { recursive: true });
      let file = base + ext, n = 1; while (fs.existsSync(path.join(dir, file))) file = base + '-' + (++n) + ext;
      fs.writeFileSync(path.join(dir, file), Buffer.concat(chunks));
      return json(res, 200, { ok: true, path: 'custom/' + file });
    }
    const body = await readJson(req, req.url.startsWith('/api/panels/image') ? 1.6e6 : 1e5);
    try {
      if (p === '/api/test') {
        if (body.type === 'duel') { const n = ['RetroRider', 'VinylVince', 'TealTina', 'ChaosChad', 'BitBaron', 'GenerousGamer'], x = n[Math.floor(Math.random() * 6)]; duelPlay({ a: x, b: n[(n.indexOf(x) + 1 + Math.floor(Math.random() * 5)) % 6], winner: Math.random() < .5 ? 'a' : 'b', amount: 500, currency: 'coins' }); return json(res, 200, { ok: true }); }
        if (body.type === 'poll' || body.type === 'prediction') { runDemo(body.type); return json(res, 200, { ok: true }); }
        if (body.type === 'chat') {   // fake chat line for trying the dock/overlay: one emote from each provider
          const pick = (p) => Object.keys(emotes).find((k) => emotes[k].p === p && !emotes[k].z) || '';
          const text = ['hello', pick('BTTV'), pick('FFZ'), pick('7TV'), 'chat!'].filter(Boolean).join(' ');
          chatIn({ message_id: 'test-' + Date.now(), chatter_user_id: '1', chatter_user_login: 'testviewer', chatter_user_name: 'TestViewer', color: '#4FBBBC',
            badges: [{ set_id: 'subscriber', id: '0' }], message_type: 'text',
            message: { text, fragments: [{ type: 'text', text: text + ' ' }, { type: 'emote', text: 'Kappa', emote: { id: '25' } }] } });
          return json(res, 200, { ok: true, text });
        }
        if (body.type === 'tip') { botQuiet = true; try { fire('tip', SAMPLE_VARS.tip, 10); } finally { botQuiet = false; } return json(res, 200, { ok: true }); }
        const s = SAMPLES[body.type];
        if (!s) return json(res, 400, { error: 'unknown type', types: Object.keys(SAMPLES).concat('tip') });
        handleEvent(s[0], s[1], { test: true });
        return json(res, 200, { ok: true });
      }
      if (p === '/api/event') {   // custom alerts, e.g. tips from a Ko-fi / PayPal / bot webhook
        if (body.event === 'custom' || body.key) {   // your own alert types, e.g. from a Stream Deck button: {"event":"custom","key":"lurk","name":"Sam"}
          const ok = fire('custom', { name: oneLine(body.name, 40), message: oneLine(body.msg || body.message), amount: body.amount == null ? '' : body.amount }, Number(body.amount) || 0, String(body.key || '').toLowerCase());
          return json(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'No enabled custom alert with key "' + body.key + '"' });
        }
        const kind = ['follow', 'sub', 'bits', 'raid', 'tip'].includes(body.kind) ? body.kind : 'tip';
        if (kind === 'tip') recordTip({ name: body.name, amount: body.amount, currency: body.currency, msg: body.msg, tag: body.tag });
        else fire(kind, { name: oneLine(body.name || 'Someone', 40), message: oneLine(body.msg), amount: body.amount == null ? '' : body.amount, viewers: Number(body.amount) || 0, tier: '' }, Number(body.amount) || 0);
        return json(res, 200, { ok: true });
      }
      if (p === '/api/access/settings') { if (!access.isLoopback(req.socket.remoteAddress)) throw new Error('Only the PC itself can change who may connect'); return json(res, 200, access.setSettings(body)); }
      if (p === '/api/backup/create') return json(res, 200, backup.create({ includeLogins: !!body.includeLogins }));
      if (p === '/api/app/restart') { json(res, 200, { ok: true }); setTimeout(() => process.exit(75), 300); return; }
      if (p === '/api/config') {
        let cur = {}; try { cur = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')); } catch (e) { /* new file */ }
        if (body.clientId !== undefined) cur.clientId = String(body.clientId).replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
        fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify(cur, null, 2)); CFG = loadConfig(); broadcast('status', status()); return json(res, 200, { ok: true, clientId: CFG.clientId });
      }
      if (p === '/api/obs/install' && process.env.ICM_PACKAGED) {   // Store version: it cannot write into OBS's own folder, so save the file where the user can import it
        const dir = process.env.ICM_DOCS || path.join(require('node:os').homedir(), 'Documents', 'ItMeCasey Stream'), file = path.join(dir, 'ItMeCasey.json');
        fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(buildCollection({ root: ROOT, dataDir: DATA, port: CFG.port }), null, 4));
        if (!process.env.ICM_NO_EXPLORER) try { require('node:child_process').spawn('explorer.exe', ['/select,' + file], { detached: true, stdio: 'ignore' }).unref(); } catch (e) { /* no explorer */ }
        return json(res, 200, { ok: true, file, manual: true });
      }
      if (p === '/api/obs/install') {
        const dir = path.join(process.env.ICM_OBS_DIR || path.join(process.env.APPDATA || '', 'obs-studio'), 'basic', 'scenes'), file = path.join(dir, 'ItMeCasey.json');
        if (!process.env.ICM_OBS_DIR && !process.env.APPDATA) throw new Error('Could not find the OBS folder: use Download instead and import it in OBS (Scene Collection > Import)');
        fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(file) && !body.overwrite) return json(res, 409, { error: 'exists', file });
        if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak-' + Date.now());
        fs.writeFileSync(file, JSON.stringify(buildCollection({ root: ROOT, dataDir: DATA, port: CFG.port }), null, 4)); return json(res, 200, { ok: true, file });
      }
      if (p === '/api/alerts/ctl') return json(res, 200, alertControl(String(body.action || '')));
      if (p === '/api/alerts/replay') return json(res, 200, replayAlert(body.id));
      if (p.startsWith('/api/tts/') && p !== '/api/tts/install') {
        const a = p.slice(9);
        if (a === 'settings') return json(res, 200, tts.settings(body));
        if (a === 'say') return json(res, 200, await tts.say(body.text, { voice: body.voice || undefined, rate: body.rate, pitch: body.pitch, by: 'dashboard' }));
        if (a === 'preview') return json(res, 200, await tts.speak(body.text, { voice: body.voice || undefined, rate: body.rate, pitch: body.pitch }));   // plays only in this browser tab
        if (a === 'skip' || a === 'clear') return json(res, 200, tts.ctl(a));
        if (a === 'voices') return json(res, 200, await tts.voices(true));
        throw new Error('unknown action');
      }
      if (p.startsWith('/api/subathon/')) { const a = p.slice(14); if (!['start', 'pause', 'resume', 'reset', 'add', 'set', 'show', 'hide', 'visible', 'settings'].includes(a)) throw new Error('unknown action'); const r = subathon[a](body); return json(res, 200, Object.assign({}, r, { rules: subathon.rules() })); }
      if (p.startsWith('/api/countdown/')) { const a = p.slice(15); if (!['start', 'pause', 'resume', 'reset', 'add', 'set', 'show', 'hide', 'visible', 'settings'].includes(a)) throw new Error('unknown action'); return json(res, 200, countdown[a](body)); }
      if (p.startsWith('/api/media/')) {
        const a = p.slice(11);
        if (a === 'settings') return json(res, 200, media.settings(body));
        if (a === 'spotify/connect') return json(res, 200, media.connectSpotify());
        if (a === 'spotify/disconnect') return json(res, 200, media.disconnectSpotify());
        if (a === 'search') return json(res, 200, { results: await media.search(body.q) });
        if (a === 'queue') return json(res, 200, await media.queue(body.uri));
        if (a === 'playuri') return json(res, 200, await media.playUri(body.uri));
        const arg = a === 'seek' ? body.ms : a === 'volume' ? body.percent : a === 'shuffle' ? body.on : a === 'repeat' ? body.mode : undefined;
        return json(res, 200, await media.control(a, arg));
      }
      if (p === '/api/tts/install') {
        if (!access.isLoopback(req.socket.remoteAddress)) throw new Error('Only the PC itself can install voices');
        if (kokoroInstall.running) return json(res, 200, kokoroInstall);
        const script = path.join(__dirname, 'install-kokoro.ps1'), dir = process.env.ICM_KOKORO_DIR || path.join(__dirname, 'kokoro');
        kokoroInstall = { running: true, ok: null, lines: ['Starting...'] };
        const add = (b) => { for (const l of String(b).split(/\r?\n/)) if (l.trim()) kokoroInstall.lines.push(l.trim().slice(0, 200)); kokoroInstall.lines = kokoroInstall.lines.slice(-30); };
        const c = require('node:child_process').spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Dir', dir], { windowsHide: true });
        c.stdout.on('data', add); c.stderr.on('data', add);
        c.on('error', (e) => { add('Could not start PowerShell: ' + e.message); kokoroInstall.running = false; kokoroInstall.ok = false; });
        c.on('exit', (code) => { kokoroInstall.running = false; kokoroInstall.ok = code === 0; if (code === 0) { add('Voices are ready: pick one on the Speech page.'); broadcast('status', status()); } });
        return json(res, 200, kokoroInstall);
      }
      if (p === '/api/vm/volume') return json(res, 200, await vmix.setVolume(body.which, body.db));
      if (p === '/api/obs/overlay') {   // add one of the overlays to the CURRENT OBS collection (every scene) without replacing anything
        const files = { dance: ['Dance Party', 'dance.html?scale=1', 1920, 1080] }, f = files[String(body.which)]; if (!f) throw new Error('Unknown overlay');
        const url = 'http://localhost:' + CFG.port + '/overlays/' + f[1];
        const steps = await obsClient.raw(async (call) => {
          const scenes = ((await call('GetSceneList')).scenes || []).map((x) => x.sceneName), have = ((await call('GetInputList')).inputs || []).some((i) => i.inputName === f[0]), out = [];
          if (!have) { await call('CreateInput', { sceneName: scenes[scenes.length - 1], inputName: f[0], inputKind: 'browser_source', inputSettings: { url, width: f[2], height: f[3], fps: 30, reroute_audio: false, shutdown: false, restart_when_active: false }, sceneItemEnabled: true }); out.push('created "' + f[0] + '"'); }
          for (const sc of scenes) { try { await call('CreateSceneItem', { sceneName: sc, sourceName: f[0], sceneItemEnabled: true }); out.push('added to ' + sc); } catch (e) { /* already in that scene */ } }
          return out;
        });
        return json(res, 200, { ok: true, steps });
      }
      if (p === '/api/welcome/done') { state.setup.done = true; persist(); return json(res, 200, { ok: true }); }
      if (p === '/api/update/check') { await checkUpdate(); return json(res, 200, updateView()); }
      if (p === '/api/update/settings') { state.updates.enabled = !!body.enabled; persist(); return json(res, 200, updateView()); }
      if (p === '/api/vm/download') return json(res, 200, await vmix.download(body.kind));
      if (p === '/api/vm/install') return json(res, 200, vmix.install(body.kind));
      if (p === '/api/vm/configure') return json(res, 200, await vmix.configure(body));
      if (p === '/api/vm/obs/apply') return json(res, 200, await vmix.obsApply(body));
      if (p === '/api/vm/open') {   // only opens Windows' own sound pages
        const pages = { sound: 'ms-settings:sound', volume: 'ms-settings:apps-volume', recording: 'ms-settings:sound-devices' }; const u = pages[body.page]; if (!u) throw new Error('Unknown page');
        require('node:child_process').spawn('cmd.exe', ['/c', 'start', '', u], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return json(res, 200, { ok: true });
      }
      if (p === '/api/viz') {   // the desktop app's hidden capture page posts the spectrum here (only fast while something is asking for it)
        vizSrc = oneLine(body.src, 12); vizBands = (Array.isArray(body.b) ? body.b : []).slice(0, 64).map((v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0))));
        if (vizSrc === 'music') {   // what the STREAM hears: keep the capture's spectrum shape, but scale it to the loudness OBS itself measures on the music source (after its volume and mute), so your own player volume never moves the bars
          const mb = (audio.view().inputs || []).find((i) => /voicemeeter.*\bb2\b|\bb2\b.*voicemeeter/i.test(i.name));
          if (mb) {
            const top = Math.max(0, ...vizBands), loud = mb.muted ? 0 : Math.max(0, Math.min(1, ((Number(mb.peak) || -100) + 55) / 55));
            vizBands = vizBands.map((v) => (top > 0 ? Math.round(v / top * loud * 100) : 0)); }
        }
        vizAt = Date.now();
        const want = Date.now() - vizWantAt < 25000, raw = (Array.isArray(body.r) ? body.r : []).slice(0, 32).map((v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)))); if (want && vizBands.length) broadcast('viz', { b: vizBands, r: raw, ts: Number(body.ts) || Date.now() }); return json(res, 200, { want });
      }
      if (p === '/api/panels/image') {   // one panel picture, kept as a file (too big for the settings JSON)
        const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || '')), id = String(body.id || '').replace(/[^\w-]/g, '').slice(0, 24);
        if (!m || !id) throw new Error('Pick a PNG, JPG or WebP image'); const buf = Buffer.from(m[2], 'base64'); if (buf.length > 1.1e6) throw new Error('That image is over 1 MB: make it smaller');
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1]; fs.mkdirSync(path.join(DATA, 'panels'), { recursive: true });
        for (const e of ['png', 'jpg', 'webp']) { try { fs.unlinkSync(path.join(DATA, 'panels', id + '.' + e)); } catch (x) { /* none */ } }
        fs.writeFileSync(path.join(DATA, 'panels', id + '.' + ext), buf); return json(res, 200, { url: '/panel-img/' + id + '.' + ext + '?v=' + Date.now() });
      }
      if (p === '/api/panels/save') {   // the whole list at once; Twitch has no API for channel panels, so these live here and are exported by hand / synced to chat commands
        const col = (c) => (/^#[0-9a-fA-F]{6}$/.test(String(c)) ? String(c) : '#4FBBBC'), img = (v) => (/^\/panel-img\/[\w-]+\.(png|jpg|webp)(\?v=\d+)?$/.test(String(v || '')) ? String(v) : '');
        state.panels = (Array.isArray(body.panels) ? body.panels : []).slice(0, 30).map((x) => ({ id: oneLine(x.id, 20) || 'pn-' + Math.random().toString(36).slice(2, 7),
          title: oneLine(x.title, 60), body: String(x.body || '').slice(0, 600),
          link: oneLine(x.link, 300), icon: oneLine(x.icon, 8), color: col(x.color),
          command: String(x.command || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30),
          image: img(x.image), synced: !!x.synced, cmdId: oneLine(x.cmdId, 40) }));
        persist(); return json(res, 200, { ok: true, panels: state.panels });
      }
      if (p === '/api/paypal/save') return json(res, 200, paypal.save(body));
      if (p === '/api/paypal/log') return json(res, 200, paypal.logTip(body));
      if (p === '/api/paypal/creds') { if (!access.isLoopback(req.socket.remoteAddress)) throw new Error('Only the PC itself can change PayPal keys'); return json(res, 200, paypal.setCreds(body)); }
      if (p === '/api/duel/test') { const n = ['RetroRider', 'VinylVince', 'TealTina', 'ChaosChad', 'BitBaron', 'GenerousGamer'];
        const a = n[Math.floor(Math.random() * 6)];
        let b = n[Math.floor(Math.random() * 6)];
        if (b === a) b = 'Challenger';
        duelPlay({ a: oneLine(body.a, 20) || a, b: oneLine(body.b, 20) || b, winner: Math.random() < .5 ? 'a' : 'b', amount: 500, currency: 'coins' });
        return json(res, 200, { ok: true }); }
      if (p === '/api/explosion/test') { explode(String(body.reason || 'goal'), { title: 'Test' }, true); return json(res, 200, { ok: true }); }
      if (p === '/api/audio/mute') { if (body.toggle) await audio.toggleMute(String(body.name || '')); else await audio.setMute(String(body.name || ''), !!body.on); return json(res, 200, { ok: true }); }
      if (p === '/api/audio/volume') { await audio.setVolumeDb(String(body.name || ''), body.db); return json(res, 200, { ok: true }); }
      if (p === '/api/overlay-settings/save') {
        const o = state.overlayCfg, a = body.alerts || {}, e = body.events || {}, pick = (v, list, d) => (list.includes(v) ? v : d), n = (v, d, lo, hi) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
        o.alerts = { position: pick(a.position, ['top', 'middle', 'bottom'], o.alerts.position), volume: n(a.volume, o.alerts.volume, 0, 200) };
        o.events = { align: pick(e.align, ['top', 'bottom'], o.events.align), grow: pick(e.grow, ['up', 'down'], o.events.grow), max: n(e.max, o.events.max, 1, 30), mode: pick(e.mode, ['list', 'ticker'], o.events.mode), speed: n(e.speed, o.events.speed, 10, 400),
          include: Object.fromEntries(Object.keys(o.events.include).map((k) => [k, e.include && k in e.include ? !!e.include[k] : o.events.include[k]])) };
        const X = body.explosion; if (X) { const cur = o.explosion; o.explosion = { goal: !!X.goal, raid: !!X.raid, hype: !!X.hype, sub: !!X.sub, giftsub: !!X.giftsub, bits: !!X.bits, count: n(X.count, cur.count, 10, 200), seconds: n(X.seconds, cur.seconds, 2, 15), style: pick(X.style, ['burst', 'rain'], cur.style) }; }
        persist(); broadcast('overlaycfg', o); return json(res, 200, o);
      }
      if (p.startsWith('/api/modules/')) return json(res, 200, modules.api(p.slice(13), body));
      if (p.startsWith('/api/scenes/')) return json(res, 200, await scenes.api(p.slice(12), body));
      if (p.startsWith('/api/hooks/')) return json(res, 200, await hooks.api(p.slice(11), body));
      if (p.startsWith('/api/ads/')) { const out = await adsAction(p.slice(9), body); if (body.say && p.endsWith('/run')) bot.say(String(body.say).slice(0, 450)); return json(res, 200, out); }
      if (p.startsWith('/api/channel/')) return json(res, 200, await channelAction(p.slice(13), body));
      if (p.startsWith('/api/polls/')) return json(res, 200, await pollAction(p.slice(11), body));
      if (p.startsWith('/api/bot/')) return json(res, 200, await bot.api(p.slice(9), body));
      if (p === '/api/alerts/save') return json(res, 200, saveAlertRule(body));
      if (p === '/api/alerts/delete') { state.alertRules = state.alertRules.filter((r) => r.id !== body.id); persist(); return json(res, 200, { ok: true }); }
      if (p === '/api/alerts/reset') { state.alertRules = defaultRules(); persist(); return json(res, 200, { ok: true }); }
      if (p === '/api/alerts/test') {
        const r = state.alertRules.find((x) => x.id === body.id); if (!r) throw new Error('No such alert');
        emitAlert(buildAlert(r, Object.assign({}, SAMPLE_VARS[r.event], r.event === 'custom' ? {} : {})));
        return json(res, 200, { ok: true });
      }
      if (p === '/api/goals/save') return json(res, 200, saveGoal(body));
      if (p === '/api/goals/delete') { state.customGoals = state.customGoals.filter((g) => g.id !== body.id); persist(); return json(res, 200, { ok: true }); }
      if (p === '/api/goals/adjust') {
        const g = state.customGoals.find((x) => x.id === body.id);
        if (!g || g.metric !== 'manual') throw new Error('Only manual goals can be adjusted');
        g.manual = body.set != null ? Number(body.set) || 0 : (Number(g.manual) || 0) + (Number(body.delta) || 0);
        persist(); return json(res, 200, goalView(g));
      }
      if (p.startsWith('/api/mod/')) { const out = await modAction(p.slice(9), body); if (p.endsWith('/settings')) out.settings = await chatSettings(); return json(res, 200, out); }
      if (p === '/api/chat/send') return json(res, 200, await modAction('send', body));
      if (p === '/api/auth/start') return json(res, 200, await startDeviceAuth());
      if (p === '/api/auth/logout') {
        esStopped = true; try { esWs && esWs.close(); } catch (e) { /* ignore */ }
        tokens = null; try { fs.unlinkSync(TOKENS_FILE); } catch (e) { /* ignore */ }
        authState = { status: 'none', message: 'Not connected' }; esStatus = 'offline';
        broadcast('status', status()); return json(res, 200, { ok: true });
      }
      if (p === '/api/session/reset') { resetSession(); broadcast('status', status()); return json(res, 200, { ok: true }); }
    } catch (e) { return json(res, 400, { error: e.message }); }
    return json(res, 404, { error: 'no such endpoint' });
  }

  // static
  if (p === '/' || p === '/index.html') return serveFile(res, path.join(__dirname, 'public', 'shell.html'));
  if (p === '/dashboard' || p === '/dashboard/') return serveFile(res, path.join(__dirname, 'public', 'index.html'));
  if (p === '/api/modules') return json(res, 200, modules.view());
  if (p.startsWith('/widgets/') && !p.includes('..')) return serveFile(res, path.join(__dirname, 'public', p));
  if (p.startsWith('/modules/')) { const mf = modules.file(p); return mf ? serveFile(res, mf) : (res.writeHead(404), res.end('not found')); }
  const cm = /^\/(sounds|assets)\/custom\/([^/]+)$/.exec(p), vm = /^\/video\/custom\/([^/]+)$/.exec(p);
  if (cm && !cm[2].includes('..')) return serveFile(res, path.join(CUSTOM, cm[1], cm[2]));
  if (vm && !vm[1].includes('..')) return serveFile(res, path.join(CUSTOM, 'video', vm[1]));
  const top1 = p.split('/')[1];
  if (STATIC[top1]) {
    const f = path.resolve(ROOT, '.' + p);
    if (f.startsWith(path.join(ROOT, top1) + path.sep)) return serveFile(res, f);
  }
  res.writeHead(404); res.end('not found');
}

const buildCollection = require('./collection.js').build, createBackup = require('./backup.js'), createModules = require('./modules.js'), createAccess = require('./access.js');
const createMedia = require('./media.js'), createCountdown = require('./countdown.js'), createTts = require('./tts.js');
const createBot = require('./bot.js'), createObs = require('./obs.js'), createHooks = require('./hooks.js'), createScenes = require('./scenes.js'), createAudio = require('./audio.js'), createPaypal = require('./paypal.js');
let mediaRenderT = null;
const media = createMedia({ DATA, state, persist, log, broadcast, port: () => CFG.port,
  onChange: () => { if (!mediaRenderT) mediaRenderT = setTimeout(() => { mediaRenderT = null; renderLabels(); }, 500); } });
const tts = createTts({ DATA, state, persist, broadcast, log, blockWords: () => (bot.view().filters.blacklist.on ? bot.view().filters.blacklist.words : []) });
const bot = createBot({
  tts: { cfg: () => state.ttsCfg, say: (t, o) => tts.say(t, o), ctl: (a) => tts.ctl(a) }, alertControl: (a) => alertControl(a),
  countdown: { command: (a) => countdown.command(a) },
  subathon: { command: (a) => subathon.command(a), rules: () => subathon.rules() },
  media: { view: () => media.view(), control: (a, x) => media.control(a, x), search: (q) => media.search(q), queue: (u) => media.queue(u), cfg: () => state.mediaCfg },
  DATA, log,
  get state() { return state; },
  me: () => (tokens ? { id: tokens.user_id, login: tokens.login } : null),
  helix: (m, p, b) => helix(m, p, b),
  searchCategories: (q) => searchCategories(q), setChannel: (o) => setChannel(o),
  labelValue: (k) => (k in labelDocs ? (labelCache[k] == null ? '' : labelCache[k]) : null), labelList: () => Object.keys(labelDocs).map((n) => ({ name: n, desc: labelDocs[n] })),
  changed: () => persist(true), fireCustom: (key, vars, num) => fire('custom', vars, num, key),
  createClip: () => createClip(), sceneFire: (t) => scenes.fire(t),
  runAd: (len) => adsAction('run', { length: len }), snoozeAd: () => adsAction('snooze', {}),
  mod: (kind, b) => modAction(kind, b),
  resolveUser: (login) => resolveUser(login),
  emoteNames: () => emotes,
  tipLink: () => paypal.link(), duel: (m) => duelPlay(m), broadcast: (ev, d) => broadcast(ev, d),
  predict: { create: (title, names, secs) => pollActionInner('prediction/create', { title, outcomes: names, window: secs }), lock: (id) => pollActionInner('prediction/lock', { id }), resolve: (id, outcomeId) => pollActionInner('prediction/resolve', { id, outcomeId }), cancel: (id) => pollActionInner('prediction/cancel', { id }) },
  clientId: () => loadConfig().clientId, ID_URL: () => ID_URL, HELIX: () => HELIX,
});

const obsClient = createObs(() => state.obsCfg, { log });
let obsStatsCache = { t: 0, v: null }, obsBytes = null;
async function obsStats() {   // cached for a second so several open widgets share one OBS connection
  if (obsStatsCache.v && Date.now() - obsStatsCache.t < 1200) return obsStatsCache.v;
  const { s, st } = await obsClient.statsRaw(), now = Date.now(); let kbps = null;
  if (st.outputActive && st.outputBytes != null) { if (obsBytes && now > obsBytes.t && st.outputBytes >= obsBytes.b) kbps = Math.round((st.outputBytes - obsBytes.b) * 8 / 1000 / ((now - obsBytes.t) / 1000)); obsBytes = { b: st.outputBytes, t: now }; } else obsBytes = null;
  const v = { cpu: Math.round(s.cpuUsage * 10) / 10, memMb: Math.round(s.memoryUsage), fps: Math.round(s.activeFps * 10) / 10, frameMs: Math.round(s.averageFrameRenderTime * 10) / 10, renderSkipped: s.renderSkippedFrames || 0, renderTotal: s.renderTotalFrames || 0,
    outSkipped: st.outputSkippedFrames || 0, outTotal: st.outputTotalFrames || 0, diskGb: Math.round(s.availableDiskSpace / 1024 * 10) / 10, streaming: !!st.outputActive, reconnecting: !!st.outputReconnecting, congestion: st.outputCongestion == null ? null : Math.round(st.outputCongestion * 100), kbps };
  obsStatsCache = { t: now, v }; return v;
}
const vmix = require('./voicemeeter.js')({ DATA, obs: obsClient, log });
const hooks = createHooks({
  state, persist, log, bot, obs: obsClient,
  me: () => (tokens ? { id: tokens.user_id, login: tokens.login } : null),
  helix: (m, p, b) => helix(m, p, b), fireCustom: (key, vars, num) => fire('custom', vars, num, key),
  tts: { say: (t, o) => tts.say(t, o) },
  runAd: (len) => adsAction('run', { length: len }), snoozeAd: () => adsAction('snooze', {}), createClip: () => createClip(), alertControl: (a) => alertControl(a), mediaControl: (a) => media.control(a),
  countdown: { start: (b) => countdown.start(b), add: (b) => countdown.add(b), set: (b) => countdown.set(b), pause: () => countdown.pause(), resume: () => countdown.resume(), reset: () => countdown.reset(), show: () => countdown.show(), hide: () => countdown.hide() },
});

const countdown = createCountdown({ state, persist, broadcast, log, obs: obsClient, bot });
const subathon = createCountdown({ state, persist, broadcast, log, obs: obsClient, bot, key: 'subathon', evt: 'subathon', noun: 'Subathon', labelPrefix: 'subathon', cmd: '!subathon' });
const scenes = createScenes({ state, persist, log, obs: obsClient, hooks });
const audio = createAudio({ getCfg: () => state.obsCfg, log, broadcast });
const paypal = createPaypal({ DATA, state, persist, log, recordTip });

const backup = createBackup({ DATA, log });
const access = createAccess({ state, persist, port: () => CFG.port });
const modules = createModules({ DATA, state, persist });

function health() {
  const bad = logRing.filter((l) => l.bad).slice(-8).map((l) => ({ t: l.t, text: l.text }));
  const e = esStatus, ok = true;
  return { ok, version: APP_VERSION, uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000), port: CFG.port,
    twitch: { loggedIn: !!tokens, login: tokens ? tokens.login : '', eventsub: e, expired: !!tokens && authState.status === 'error' && /expired/i.test(authState.message) }, clientId: !!CFG.clientId,
    access: access.view(), backups: backup.list().length,
    obs: { configured: !!(state.obsCfg && state.obsCfg.host), connected: Date.now() - obsClient.lastOk() < 10 * 60e3 }, media: { provider: state.mediaCfg.provider, status: media.view().status },
    tts: { kokoro: tts.kokoroInstalled() }, recentErrors: bad, dataDir: DATA, light: !CFG.clientId || !tokens ? 'amber' : e === 'connected' ? 'green' : e === 'partial' || e === 'connecting' ? 'amber' : 'red' };
}

/** plain text for a bug report: versions, connection states and the last log lines, with anything that looks like a secret blanked out */
function diagnostics() {
  const os = require('node:os'), h = health();
  const scrub = (t) => String(t).replace(/(access_token|refresh_token|authorization|bearer|api[_-]?key|secret|password|client_secret|code)(["':=\s]+)([A-Za-z0-9._\-]{6,})/gi, '$1$2***').replace(/oauth:[A-Za-z0-9]+/gi, 'oauth:***');
  const lines = [
    'ItMeCasey Stream ' + h.version, 'Windows ' + os.release() + ' (' + os.arch() + '), Node ' + process.versions.node + (process.versions.electron ? ', Electron ' + process.versions.electron : ''),
    'Running for ' + h.uptimeSec + ' s, port ' + h.port, 'Twitch: ' + (h.twitch.loggedIn ? 'logged in' : 'not logged in') + ', EventSub ' + h.twitch.eventsub + ', light ' + h.light,
    'Own Client ID set: ' + !!(CFG.clientId), 'Bot account: ' + (bot.hasAccount() ? 'yes' : 'no'), 'OBS configured: ' + h.obs.configured, 'Music source: ' + h.media.provider + ' (' + h.media.status + ')',
    'Voicemeeter: ' + (['banana', 'potato'].filter((k) => vmix.status()[k].installed).join(', ') || 'not installed'), 'Realistic voices: ' + h.tts.kokoro, 'LAN access: ' + h.access.lan, 'Backups: ' + h.backups, '',
    'Recent problems:'].concat(h.recentErrors.length ? h.recentErrors.map((e) => new Date(e.t).toLocaleTimeString() + ' ' + e.text) : ['(none)'], ['', 'Last log lines:'], logRing.slice(-40).map((l) => new Date(l.t).toLocaleTimeString() + ' ' + l.text));
  return lines.map(scrub).join('\n');
}

// ------------------------------------------------------------------ update check (GitHub releases): tells you when a newer installer exists, never installs anything itself
const UPDATE_REPO = 'Drakma/ItMeCasey-Stream';
let updateInfo = { checkedAt: 0, latest: '', url: '', available: false, error: '' };
const verParts = (v) => String(v).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
const isNewer = (a, b) => { const x = verParts(a), y = verParts(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function checkUpdate() {
  try {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 8000), r = await fetch('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', { headers: { 'User-Agent': 'ItMeCasey-Stream', Accept: 'application/vnd.github+json' }, signal: ac.signal }); clearTimeout(t);
    if (r.status === 404) { updateInfo = { checkedAt: Date.now(), latest: '', url: '', available: false, error: 'No public release to compare with yet' }; return updateInfo; }
    if (!r.ok) throw new Error('GitHub answered ' + r.status); const j = await r.json(), latest = String(j.tag_name || '').replace(/^v/, '');
    updateInfo = { checkedAt: Date.now(), latest, url: String(j.html_url || ''), available: !!latest && isNewer(latest, APP_VERSION), error: '' };
  } catch (e) { updateInfo = Object.assign({}, updateInfo, { checkedAt: Date.now(), error: 'Could not check: ' + e.message }); }
  return updateInfo;
}
const updateView = () => Object.assign({ version: APP_VERSION, enabled: state.updates.enabled !== false }, updateInfo);
setTimeout(() => { if (state.updates.enabled !== false) checkUpdate(); }, 30000).unref(); setInterval(() => { if (state.updates.enabled !== false) checkUpdate(); }, 12 * 3600e3).unref();

function statsView() {
  const st = state.stream, t = state.totals, s = state.session;
  return { live: !!st.live, viewers: st.viewers || 0, startedAt: st.startedAt || '', title: st.title, game: st.game, followers: t.followers, subs: t.subs,
    sessionFollowers: s.followers, sessionSubs: s.subs + s.resubs, now: Date.now() };
}

function main() {
  const server = http.createServer((req, res) => route(req, res).catch((e) => { log('request error', e); try { res.writeHead(500); res.end('error'); } catch (x) { /* ignore */ } }));
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error('Port ' + CFG.port + ' is already in use - is the server already running?');
    else console.error(e);
    process.exit(1);
  });
  server.listen(CFG.port, access.bindHost(), () => {
    log('ItMeCasey server running -> http://localhost:' + CFG.port + '/');
    log('Label files:', LABELS);
    renderLabels();
    media.start();
    backup.auto(); const bk = setInterval(() => backup.auto(), 6 * 3600e3); if (bk.unref) bk.unref();
    if (tts.kokoroInstalled() && !state.ttsCfg.voice && !state.ttsCfg.chosen) { state.ttsCfg.voice = 'af_heart'; persist(true); log('Kokoro found: using the realistic voice af_heart by default (change it on the Speech page).'); }
    startStripe(); paypal.start();
    if (!tokens) loadEmotes();
    if (tokens) { log('Found saved Twitch login (' + tokens.login + '), connecting...'); startEventSub(); }
    else log('Not connected to Twitch yet - open the dashboard and press "Connect Twitch".');
  });
}

module.exports = { subathon, paypal, audio, modules, scenes, access, backup, tts, alertControl, replayAlert, countdown, media, hooks, adStarted, adTicker, adsView, setChannel, searchCategories, bot, fire, pickRule, buildAlert, saveAlertRule, ALERT_EVENTS, saveGoal, goalViews, chatBuf, loadEmotes, handleEvent, SAMPLES, state, renderLabels, LABELS, labelCache, labelDocs, resetSession };
if (require.main === module) main();
