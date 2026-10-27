'use strict';
/**
 * The bridge to IMC-Bot (the Discord bot, a separate program).
 *  - Keeps the last events (stream online / offline / update, a new recap) in a small list with a counting number, so the bot can ask
 *    "what happened since number N" and miss nothing when it restarts or the PC was busy. Nothing is sent out: the bot comes and asks.
 *  - The routes are only for this PC (see server.js), so no password or token is involved.
 *  - Chat messages (chat.message / chat.delete / chat.clearUser / chat.clear) are only kept while the bot has asked for them in the last minute
 *    (it does that when the Twitch chat mirror is on), and live in their own list so a busy chat never pushes a go-live event out.
 * Run: node bridge-test.js
 */
module.exports = function createBridge(ctx) {
  const now = ctx.now || Date.now, cap = ctx.cap || 500, boot = Math.random().toString(36).slice(2, 10);
  const chatCap = ctx.chatCap || 400;
  let list = [], chat = [], seq = 0, chatUntil = 0;

  /** add an event; type is e.g. 'stream.online'. Returns the event */
  function publish(type, data) {
    if (type.startsWith('chat.')) {
      if (now() > chatUntil) return null;   // nobody is reading chat: do not even keep it
      const ev = { id: ++seq, ts: now(), type, data: data || {} };
      chat.push(ev); if (chat.length > chatCap) chat = chat.slice(-chatCap);
      return ev;
    }
    const ev = { id: ++seq, ts: now(), type, data: data || {} };
    list.push(ev); if (list.length > cap) list = list.slice(-cap);
    return ev;
  }
  /** everything after number `since`. `boot` changes when IMC-Stream restarts, so the bot knows the numbers started over */
  function since(n, wantChat) {
    const from = Math.max(0, Number(n) || 0);
    if (wantChat) chatUntil = now() + 60000;
    const events = list.filter((e) => e.id > from).concat(chat.filter((e) => e.id > from)).sort((a, b) => a.id - b.id);
    return { boot, cursor: seq, events };
  }
  /** what the bot needs to know right now (title and game of a stream that just started, the website, the points top) */
  const snapshot = () => Object.assign({ boot, cursor: seq }, ctx.snapshot ? ctx.snapshot() : {});
  /** the lists the viewer commands answer from (commands, games, points top, text-to-speech help) */
  const info = () => (ctx.info ? ctx.info() : {});
  return { publish, since, snapshot, info, boot };
};
