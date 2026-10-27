'use strict';
/**
 * Full stream log: every chat message and every Twitch event (follows, subs, gifts, cheers, raids, channel point redemptions, polls, hype trains,
 * ads, moderation, tips...) of a stream, written to disk as it happens (one JSON line each), so nothing is lost if the app closes.
 * A new log starts when the stream goes online. "Save chat" turns a log into a readable text file or a complete JSON file in the Documents folder.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const pad = (n) => String(n).padStart(2, '0');
const stamp = (t) => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + '-' + pad(d.getMinutes()); };
const clock = (t) => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
const TIERS = { 1000: 'Tier 1', 2000: 'Tier 2', 3000: 'Tier 3' };
const money = (a) => (a && typeof a === 'object' && a.value != null ? (a.value / Math.pow(10, a.decimal_places || 0)).toFixed(2) + ' ' + (a.currency || '') : '');

/** one readable line for an entry (no time stamp), or '' to leave it out of the text file */
function describe(x, gone) {
  const e = x.e || {};
  if (x.k === 'chat') return (x.name || x.login) + ': ' + x.text + (x.reply ? '  (reply to ' + x.reply.name + ')' : '') + (gone.has(x.id) ? '  [deleted]' : '');
  if (x.k === 'tip') return '*** TIP: ' + x.name + ' tipped ' + x.amount + (x.message ? ' - "' + x.message + '"' : '');
  if (x.k === 'mod') return '*** MOD: ' + (x.action === 'clear' ? 'chat was cleared' : x.action === 'clearUser' ? 'all messages of a user were removed' : 'a message was deleted');
  switch (x.type) {
    case 'channel.follow': return '*** FOLLOW: ' + e.user_name;
    case 'channel.subscribe': return '*** SUB: ' + e.user_name + ' (' + (TIERS[e.tier] || e.tier) + (e.is_gift ? ', gifted' : '') + ')';
    case 'channel.subscription.gift': return '*** GIFT SUBS: ' + (e.is_anonymous ? 'Anonymous' : e.user_name) + ' gifted ' + (e.total || 1) + ' (' + (TIERS[e.tier] || e.tier) + ')';
    case 'channel.subscription.message': return '*** RESUB: ' + e.user_name + ' for ' + (e.cumulative_months || 1) + ' months (' + (TIERS[e.tier] || e.tier) + ')' + (e.message && e.message.text ? ' - "' + e.message.text + '"' : '');
    case 'channel.cheer': return '*** BITS: ' + (e.is_anonymous ? 'Anonymous' : e.user_name) + ' cheered ' + (e.bits || 0) + (e.message ? ' - "' + e.message + '"' : '');
    case 'channel.bits.use': return e.type === 'cheer' ? '' : '*** POWER-UP: ' + (e.user_name || '') + ' used bits (' + (e.type || 'power-up') + ', ' + (e.bits || 0) + ' bits)';
    case 'channel.raid': return '*** RAID: ' + e.from_broadcaster_user_name + ' raided with ' + (e.viewers || 0) + ' viewers';
    case 'channel.channel_points_custom_reward_redemption.add': return '*** REDEEM: ' + e.user_name + ' redeemed "' + ((e.reward && e.reward.title) || '') + '" (' + ((e.reward && e.reward.cost) || 0) + ' points)' + (e.user_input ? ' - "' + e.user_input + '"' : '');
    case 'channel.hype_train.begin': return '*** HYPE TRAIN started';
    case 'channel.hype_train.end': return '*** HYPE TRAIN ended at level ' + (e.level || '?');
    case 'channel.poll.begin': return '*** POLL: ' + e.title + ' [' + (e.choices || []).map((c) => c.title).join(' / ') + ']';
    case 'channel.poll.end': return '*** POLL RESULT: ' + e.title + ' - ' + (e.choices || []).map((c) => c.title + ' ' + (c.votes || 0)).join(', ');
    case 'channel.prediction.begin': return '*** PREDICTION: ' + e.title + ' [' + (e.outcomes || []).map((o) => o.title).join(' / ') + ']';
    case 'channel.prediction.end': { const w = (e.outcomes || []).find((o) => o.id === e.winning_outcome_id); return '*** PREDICTION RESULT: ' + e.title + ' - ' + (w ? 'winner: ' + w.title : e.status); }
    case 'channel.goal.end': return '*** GOAL ' + (e.is_achieved ? 'reached' : 'ended') + ': ' + (e.description || e.type);
    case 'channel.update': return '*** CHANNEL: title "' + (e.title || '') + '", category "' + (e.category_name || '') + '"';
    case 'channel.ad_break.begin': return '*** AD BREAK: ' + (e.duration_seconds || '?') + ' seconds';
    case 'channel.charity_campaign.donate': return '*** CHARITY: ' + e.user_name + ' donated ' + money(e.amount) + ' to ' + (e.charity_name || 'charity');
    case 'automod.message.hold': return '*** AUTOMOD held a message from ' + (e.user_name || e.user_login);
    case 'stream.online': return '=== STREAM WENT ONLINE';
    case 'stream.offline': return '=== STREAM WENT OFFLINE';
    default: return '';   // progress updates and other noise stay in the JSON file only
  }
}

/** CRC-32 of a buffer (the checksum the zip format stores for each file); the lookup table is built on first use */
let CRC = null;
function crc32(buf) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
/** a .zip holding one file (deflate), readable by Windows Explorer and every unzip tool */
function zipOne(name, data) {
  // layout: local file header + name + data, then the central directory entry (same fields again) + name, then the end-of-archive record
  const raw = Buffer.from(data), def = zlib.deflateRawSync(raw, { level: 9 }), nm = Buffer.from(name, 'utf8'), crc = crc32(raw), d = new Date();
  // zip stores time and date as packed 16-bit values (seconds in 2 s steps, years since 1980)
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  // flag 0x0800 = the file name is UTF-8, method 8 = deflate, version 20 = needs nothing newer than zip 2.0
  const head = (sig, ext) => { const b = Buffer.alloc(ext); b.writeUInt32LE(sig, 0); return b; };
  const local = head(0x04034b50, 30); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(def.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nm.length, 26);
  const central = head(0x02014b50, 46); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(def.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nm.length, 28);
  const cdOffset = local.length + nm.length + def.length, end = head(0x06054b50, 22); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + nm.length, 12); end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nm, def, central, nm, end]);
}

module.exports = function createChatLog(ctx) {
  const now = ctx.now || Date.now, log = ctx.log || (() => {}), DIR = ctx.dir, exportDir = ctx.exportDir;
  let cur = null;   // the log being written now: { id, startedAt, file, count }; null until the first entry

  // a log id is its start time ("2026-10-22 20-00", plus " (2)" if two start in the same minute); checking the shape keeps ids from reaching outside the folder
  const file = (id) => path.join(DIR, id + '.jsonl');
  const idOk = (id) => /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}-[0-9]{2}( \(\d+\))?$/.test(String(id));
  /** start a new log file named after the time */
  function open(t) {
    let id = stamp(t), n = 1; while (fs.existsSync(file(id))) id = stamp(t) + ' (' + (++n) + ')';
    cur = { id, startedAt: t, file: file(id), count: 0 };
    try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(cur.file, ''); } catch (e) { log('chat log: could not create', cur.file, e.message); }
  }
  /** carry on with the newest log if it is recent (the app was restarted mid-stream), else start a fresh one */
  function resume() {
    try {
      const last = fs.readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f, m: fs.statSync(path.join(DIR, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
      if (last && now() - last.m < 6 * 3600e3) { const id = last.f.slice(0, -6); cur = { id, startedAt: fs.statSync(path.join(DIR, last.f)).birthtimeMs || last.m, file: path.join(DIR, last.f), count: read(id).length }; return; }
    } catch (e) { /* no logs yet */ }
    open(now());
  }
  /** append one entry (one JSON line); written straight to disk so a crash loses nothing */
  function put(x) {
    if (!cur) resume();
    x.t = now(); cur.count++;
    try { fs.appendFileSync(cur.file, JSON.stringify(x) + '\n'); } catch (e) { log('chat log write failed:', e.message); }
  }
  /** all entries of a log; a torn last line (crash mid-write) is skipped */
  function read(id) {
    if (!idOk(id)) throw new Error('Unknown chat log');
    let raw; try { raw = fs.readFileSync(file(id), 'utf8'); } catch (e) { throw new Error('That chat log is gone'); }
    return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  }

  // ---------------------------------------------------------------- recording
  const chat = (m) => put({ k: 'chat', id: m.id, uid: m.uid, login: m.login, name: m.name, color: m.color, badges: (m.badges || []).map((b) => b.s), type: m.type, text: m.text, reply: m.reply || undefined });
  const moderate = (ev) => put({ k: 'mod', action: ev.type, id: ev.id, uid: ev.uid });
  const tip = (t) => put({ k: 'tip', name: t.name, amount: t.amount, message: t.message });
  /** a raw Twitch notification; stream.online starts a new log */
  function event(type, e) {
    if (type === 'stream.online') open(now());
    put({ k: 'event', type, e });
  }

  // ---------------------------------------------------------------- listing and saving
  /** every saved log, newest first */
  function list() {
    let files = []; try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.jsonl')); } catch (e) { /* none yet */ }
    return files.map((f) => { const id = f.slice(0, -6), st = fs.statSync(path.join(DIR, f)); let n = 0; try { n = read(id).length; } catch (e) { /* unreadable */ } return { id, entries: n, bytes: st.size, updated: st.mtimeMs, current: !!cur && cur.id === id }; })
      .sort((a, b) => b.updated - a.updated);
  }
  /** the readable version: one line per chat message or notable event; deleted messages are marked, not removed */
  function text(id) {
    const items = read(id), gone = new Set(items.filter((x) => x.k === 'mod' && x.action === 'delete').map((x) => x.id));
    const chats = items.filter((x) => x.k === 'chat').length, lines = [];
    for (const x of items) { const d = describe(x, gone); if (d) lines.push('[' + clock(x.t) + '] ' + d); }
    const first = items[0] ? items[0].t : now();
    return ['IMC-Stream chat log: ' + id, 'Started ' + new Date(first).toLocaleString() + ' - ' + chats + ' chat messages, ' + items.length + ' entries in total', ''].concat(lines).join('\r\n') + '\r\n';
  }
  /** the complete version: every entry exactly as recorded, including the ones the text file leaves out */
  function json(id) { return JSON.stringify({ app: 'IMC-Stream', log: id, entries: read(id) }, null, 1); }
  /** the log as a .zip holding one file; format 'txt' (readable) or 'json' (everything, as received) */
  function zip(id, format) { const fmt = format === 'json' ? 'json' : 'txt'; return zipOne('Stream chat ' + id + '.' + fmt, fmt === 'json' ? json(id) : text(id)); }
  /** write the zipped log into the Documents folder */
  function save(id, format) {
    const out = path.join(exportDir(), 'Stream chat ' + id + (format === 'json' ? ' (json)' : '') + '.zip'), body = zip(id, format);
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, body);
    return { ok: true, file: out };
  }
  function view() { return { current: cur ? { id: cur.id, entries: cur.count, since: cur.startedAt } : null, logs: list(), folder: exportDir() }; }
  function remove(id) { if (!idOk(id)) throw new Error('Unknown chat log'); if (cur && cur.id === id) cur = null; try { fs.unlinkSync(file(id)); } catch (e) { /* already gone */ } return view(); }

  return { chat, moderate, tip, event, list, text, json, zip, save, view, remove, read };
};
module.exports.describe = describe;
