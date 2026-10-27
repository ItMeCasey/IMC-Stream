'use strict';
/**
 * Chat summaries made with the Claude Code command line tool (the streamer's own Claude login, so there is no separate bill), always with the cheapest model.
 *  - an end-of-stream recap (topics, funny moments, open questions, shout-outs), saved as a file and optionally posted in Discord,
 *  - a "catch me up" summary of the last few minutes (the !recap chat command and the dashboard).
 * The app keeps the chat of the current stream in memory (messages a mod or the bot deleted are dropped, commands and bots are left out),
 * and sends only that text to the tool: `claude -p --model haiku --tools ""` (no tools, no saved session).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn: nodeSpawn } = require('node:child_process');

// MAX_KEEP: most chat lines kept in memory; MAX_PROMPT_CHARS: most text sent to the tool in one go
const MAX_KEEP = 6000, MAX_PROMPT_CHARS = 60000;

module.exports = function createRecap(ctx) {
  const now = ctx.now || Date.now, log = ctx.log || (() => {}), spawn = ctx.spawn || nodeSpawn, FILE = ctx.file, win = process.platform === 'win32';
  // S: saved settings and the last recaps (file); buf: this stream's chat; busy: the recap being made; cache: the last catch-up answer
  let S = { auto: false, discord: false, model: 'haiku', names: true, chat: false, last: [] }, buf = [], startedAt = now(), busy = null, cache = null;
  try { S = Object.assign(S, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { /* first run */ }
  // write the settings and the list of recaps
  const save = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(S, null, 2)); } catch (e) { log('recap save failed:', e.message); } };
  // only a plausible model name reaches the command line, otherwise the cheap default
  const model = () => (/^[A-Za-z0-9._-]{2,60}$/.test(S.model || '') ? S.model : 'haiku');

  // ---------------------------------------------------------------- the chat of this stream
  const HIDE = (ctx.hideBots || []).map((x) => String(x).toLowerCase());
  // keep a chat line for the summary; commands, bots and system notices are skipped
  function add(m) {
    const text = String(m.text || '').replace(/\s+/g, ' ').trim(), login = String(m.login || m.name || '').toLowerCase();
    if (!text || text.startsWith('!') || !login || HIDE.includes(login) || (m.type && m.type !== 'text' && m.type !== 'user_intro')) return;
    buf.push({ id: m.id || '', uid: m.uid || '', t: m.ts || now(), name: String(m.name || m.login).slice(0, 40), text: text.slice(0, 300) }); if (buf.length > MAX_KEEP) buf.splice(0, buf.length - MAX_KEEP);
  }
  // forget messages a mod or the bot removed, so they never end up in a summary
  function moderate(ev) {
    if (ev.type === 'delete') buf = buf.filter((x) => x.id !== ev.id); else if (ev.type === 'clearUser' && ev.uid) buf = buf.filter((x) => x.uid !== ev.uid); else if (ev.type === 'clear') buf = [];
  }
  // a new stream starts with an empty chat
  const newStream = () => { buf = []; startedAt = now(); cache = null; };

  // ---------------------------------------------------------------- making the text for the tool
  const clock = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  /** the messages as lines, sampled evenly when there are too many for one request */
  function transcript(list) {
    // with names switched off every chatter becomes Viewer1, Viewer2... so the model never sees real names
    const anon = new Map(), who = (m) => (S.names ? m.name : (anon.has(m.name) ? anon.get(m.name) : (anon.set(m.name, 'Viewer' + (anon.size + 1)), anon.get(m.name))));
    let lines = list.map((m) => clock(m.t) + ' ' + who(m) + ': ' + m.text), total = lines.reduce((a, b) => a + b.length + 1, 0);
    if (total > MAX_PROMPT_CHARS) { const keep = Math.max(50, Math.floor(lines.length * MAX_PROMPT_CHARS / total)), step = lines.length / keep; lines = Array.from({ length: keep }, (_, i) => lines[Math.floor(i * step)]); }
    return lines.join('\n');
  }
  // the instructions sent with the chat log; they say not to invent anything and not to repeat insults
  const PROMPTS = {
    recap: 'You write a recap of a Twitch stream\'s chat for the streamer. Below is the chat log (time, name, message). Write a short, friendly recap in plain text with these parts, each one or two lines or a short list: "What chat talked about", "Funny or hype moments", "Questions nobody answered", "Shout-outs and regulars". Only use what is in the log; do not invent anything. Keep it under 250 words. Do not repeat insults or slurs; just say chat got heated.',
    catchup: 'You summarize the last few minutes of a Twitch stream\'s chat for someone who just arrived. Below is the chat log (time, name, message). Reply with ONE or TWO short sentences (under 300 characters in total) saying what chat has been talking about. Plain text, no formatting, no names unless it matters. Only use what is in the log. Do not repeat insults or slurs.',
  };

  /** run the tool: resolves the text it printed, or throws an Error the streamer can act on */
  function runClaude(prompt) {
    return new Promise((resolve, reject) => {
      let out = '', err = '', c;
      // on Windows the npm install is a claude.cmd shim, which only runs through the shell (every argument here is a fixed word or the checked model name)
      const args = ['-p', '--model', model(), '--tools', '', '--no-session-persistence', '--output-format', 'text'], viaShell = win && !ctx.spawn;
      try { c = spawn('claude', viaShell ? args.map((a) => a || '""') : args, { windowsHide: true, shell: viaShell, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch (e) { return reject(new Error('Claude Code is not installed on this PC (install it from claude.com/claude-code and log in once)')); }
      const t = setTimeout(() => { try { c.kill(); } catch (e) { /* gone */ } reject(new Error('Claude took too long to answer')); }, ctx.timeoutMs || 180000); if (t.unref) t.unref();
      c.stdout.on('data', (d) => { out += d.toString('utf8'); }); c.stderr && c.stderr.on('data', (d) => { err += d.toString('utf8'); });
      c.on('error', (e) => { clearTimeout(t); reject(new Error(e.code === 'ENOENT' ? 'Claude Code is not installed on this PC (install it from claude.com/claude-code and log in once)' : 'Could not start Claude: ' + e.message)); });
      c.on('exit', (code) => {
        clearTimeout(t); const all = (out + '\n' + err).trim();
        if (/failed to authenticate|oauth session expired|not logged in|please run \/login|invalid api key|credit balance/i.test(all)) return reject(new Error('Claude is not logged in on this PC: open a terminal, type claude, then /login (and press Allow in the browser)'));
        if (code !== 0 || !out.trim()) return reject(new Error('Claude did not answer' + (all ? ': ' + all.split('\n').slice(-1)[0].slice(0, 160) : '')));
        resolve(out.trim());
      });
      c.stdin.on('error', () => { /* it closed early: the exit handler reports why */ }); c.stdin.end(prompt);
    });
  }

  // pick the chat to use (all of it, or the last few minutes) and run the tool; refuses when there is too little to say
  async function summarize(kind, minutes) {
    const from = kind === 'catchup' ? now() - (minutes || 10) * 60000 : 0, list = buf.filter((m) => m.t >= from);
    if (list.length < (kind === 'catchup' ? 3 : 5)) throw new Error(kind === 'catchup' ? 'Not enough chat in the last ' + (minutes || 10) + ' minutes to summarise yet' : 'Not enough chat in this stream to make a recap');
    return runClaude(PROMPTS[kind] + '\n\nCHAT LOG:\n' + transcript(list));
  }

  /** the recap of the whole stream: made once at a time, saved as a file, kept in the list */
  async function makeRecap() {
    if (busy) return busy;
    const job = (async () => {
      const text = await summarize('recap'), when = new Date(now()), stamp = when.getFullYear() + '-' + String(when.getMonth() + 1).padStart(2, '0') + '-' + String(when.getDate()).padStart(2, '0') + '_' + clock(now()).replace(':', '');
      const item = { id: stamp, at: now(), messages: buf.length, text, file: '' };
      try { const dir = ctx.dir(); fs.mkdirSync(dir, { recursive: true }); item.file = path.join(dir, 'recap_' + stamp + '.md'); fs.writeFileSync(item.file, '# Stream recap ' + stamp + '\n\n' + text + '\n'); } catch (e) { log('could not save the recap file:', e.message); item.file = ''; }
      S.last.unshift(item); S.last.length = Math.min(S.last.length, 20); save();
      if (S.discord && ctx.discordPost) await ctx.discordPost('Stream recap', text).catch((e) => log('recap Discord post failed:', e.message));
      return item;
    })();
    busy = job; job.then(() => { busy = null; }, () => { busy = null; }); return job;
  }
  /** a short "what is chat talking about", for !recap: at most one call every 5 minutes (the answer is reused in between) */
  async function catchUp() {
    if (cache && now() - cache.at < 5 * 60000) return cache.text;
    const text = (await summarize('catchup', 10)).replace(/\s+/g, ' ').slice(0, 400); cache = { at: now(), text }; return text;
  }
  /** a stream ended: wait a little for the last messages, then make the recap (if switched on and there was enough chat) */
  function onStreamEnd() { if (!S.auto) return; const t = setTimeout(() => { makeRecap().catch((e) => log('automatic recap failed:', e.message)); }, ctx.endDelayMs == null ? 120000 : ctx.endDelayMs); if (t.unref) t.unref(); }

  // settings from the Setup page; the model name is checked before it is used
  function configure(b) {
    b = b || {};
    for (const k of ['auto', 'discord', 'names', 'chat']) if (b[k] !== undefined) S[k] = !!b[k];
    if (b.model !== undefined) S.model = /^[A-Za-z0-9._-]{2,60}$/.test(String(b.model).trim()) ? String(b.model).trim() : 'haiku';
    save(); return view();
  }
  /** a tiny request to check the tool is installed and logged in */
  async function check() { const t = await runClaude('Reply with the single word: ready'); return { ok: true, reply: t.slice(0, 60), model: model() }; }
  // what the page shows, without the chat itself
  const view = () => ({ auto: !!S.auto, discord: !!S.discord, names: S.names !== false, chat: !!S.chat, model: model(), messages: buf.length, since: startedAt, busy: !!busy, last: S.last.map((x) => ({ id: x.id, at: x.at, messages: x.messages, text: x.text, file: x.file })) });
  return { add, moderate, newStream, makeRecap, catchUp, onStreamEnd, configure, check, view, summarize, transcript, chatOn: () => !!S.chat };
};
