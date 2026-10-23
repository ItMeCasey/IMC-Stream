'use strict';
/**
 * The viewers' website: a few static pages (commands, games, text-to-speech with its voices and sound effects) made from what is switched on in the app right now,
 * ready to upload to any free static host (Cloudflare Pages, GitHub Pages, Netlify...). No server and no domain needed: just the folder.
 * build(outDir) writes index.html, commands.html, games.html, tts.html, a logo and the sound effects, and returns the list of files.
 */
const fs = require('node:fs');
const path = require('node:path');

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `:root{--iron:#222A2A;--iron-d:#1A2020;--aqua:#4FBBBC;--heat:#F39120;--cream:#E2DAC2;--rust:#EC4624;--drust:#B13A22;--line:#2f3938}
*{box-sizing:border-box}html{background:var(--iron)}body{margin:0;color:var(--cream);font-family:"Bahnschrift","Segoe UI","Arial Narrow",system-ui,sans-serif;line-height:1.45;min-height:100vh;
background:repeating-conic-gradient(#262f2f 0 25%,#222A2A 0 50%) 0 0/16px 16px}
header{background:var(--iron-d);padding:14px 22px 16px;position:relative}header::after{content:"";position:absolute;left:0;right:0;bottom:0;height:5px;background:linear-gradient(90deg,#4FBBBC 0 30%,#F39120 30% 55%,#EC4624 55% 75%,#B13A22 75% 90%,#E2DAC2 90%)}
.top{max-width:920px;margin:0 auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap}.top img{width:40px;height:40px}
h1{margin:0;font-size:22px;letter-spacing:6px;text-transform:uppercase;font-stretch:85%}.sub{color:var(--heat);letter-spacing:4px;font-size:12px;text-transform:uppercase}
nav{max-width:920px;margin:12px auto 0;display:flex;gap:8px;flex-wrap:wrap}nav a{color:var(--cream);text-decoration:none;padding:8px 14px;outline:2px solid #46504f;outline-offset:-2px;font-weight:700;font-size:13px;letter-spacing:2px;text-transform:uppercase}nav a:hover{outline-color:var(--aqua);color:var(--aqua)}nav a.on{background:var(--heat);color:var(--iron);outline-color:var(--heat)}
main{max-width:920px;margin:0 auto;padding:16px 22px 50px;display:grid;gap:16px}
section{background:var(--iron-d);padding:18px 20px;border-top:1px solid var(--line)}section:nth-of-type(3n+2){border-top-color:var(--heat)}section:nth-of-type(3n){border-top-color:var(--rust)}
h2{font-size:14px;letter-spacing:5px;color:var(--aqua);margin:0 0 12px;text-transform:uppercase}section:nth-of-type(3n+2) h2{color:var(--heat)}section:nth-of-type(3n) h2{color:var(--rust)}
p{margin:8px 0}.muted{color:#9aa39f;font-size:14px}code,.cmd{background:#151b1b;padding:1px 6px;color:var(--aqua);font-family:Consolas,"Cascadia Mono",monospace;font-size:.92em}
table{width:100%;border-collapse:collapse}td{padding:8px 10px 8px 0;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}td.c{color:var(--aqua);font-weight:700;white-space:nowrap;padding-right:14px}td.w{color:#9aa39f;font-size:12px;letter-spacing:1px;text-transform:uppercase;white-space:nowrap;padding-right:14px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.card{background:var(--iron-d);border-top:3px solid var(--aqua);padding:16px 18px;text-decoration:none;color:var(--cream)}.card:nth-child(2){border-color:var(--heat)}.card:nth-child(3){border-color:var(--rust)}
.card b{display:block;font-size:20px;letter-spacing:3px;text-transform:uppercase;margin-bottom:4px}.card span{color:#9aa39f;font-size:14px}.card:hover{background:#202727}
.game{background:var(--iron);border-left:5px solid var(--aqua);padding:10px 16px;margin:10px 0}.game:nth-of-type(3n+2){border-color:var(--heat)}.game:nth-of-type(3n){border-color:var(--rust)}.game b{font-size:17px;letter-spacing:1px;text-transform:uppercase}.how{margin:4px 0}
.fx{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.fx button{font:inherit;font-weight:700;background:var(--iron);color:var(--cream);border:0;outline:2px solid #46504f;outline-offset:-2px;padding:9px 13px;cursor:pointer;text-align:left}.fx button:hover{outline-color:var(--heat);color:var(--heat)}.fx button i{display:block;font-style:normal;font-weight:400;color:#9aa39f;font-size:12px}
.ex{background:var(--iron);border-left:5px solid var(--heat);padding:12px 18px;margin:12px 0;font-size:19px}.ex em{font-style:normal;color:var(--heat);font-weight:700}ol,ul{padding-left:22px}li{margin:6px 0}li::marker{color:var(--heat)}
footer{max-width:920px;margin:0 auto;padding:0 22px 40px;color:#707b78;font-size:12px}`;

const sec = (title, body) => '<section><h2>' + title + '</h2>' + body + '</section>';

module.exports = function createSite(ctx) {
  const channel = () => (ctx.channel && ctx.channel()) || 'the stream';
  const page = (file, title, sub, body) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title + ' - ' + channel()) + '</title><style>' + CSS + '</style></head><body>'
    + '<header><div class="top"><img src="logo.png" alt=""><div><h1>' + esc(channel()) + '</h1><div class="sub">' + esc(sub) + '</div></div></div><nav>'
    + [['index.html', 'Home'], ['commands.html', 'Commands'], ['games.html', 'Games'], ['tts.html', 'Text-to-speech']].map(([f, n]) => '<a href="' + f + '"' + (f === file ? ' class="on"' : '') + '>' + n + '</a>').join('') + '</nav></header><main>' + body + '</main>'
    + '<footer>Last updated ' + new Date().toISOString().slice(0, 10) + '. What is listed here is what is switched on in the stream right now.</footer></body></html>';

  function commandsPage() {
    const ex = ctx.bot.exportCommands(), table = (rows) => '<table>' + rows.map((r) => '<tr><td class="c">' + esc(r[0]) + '</td><td class="w">' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>').join('') + '</table>';
    return page('commands.html', 'Commands', 'Chat commands',
      sec('Chat commands', '<p class="muted">Type these in chat. The small grey word says who can use each one.</p>') + (ex.custom.length ? sec('Fun &amp; info', table(ex.custom)) : '') + Object.keys(ex.groups).map((g) => sec(esc(g), table(ex.groups[g]))).join(''));
  }

  function gamesPage() {
    const v = ctx.bot.view().games, P = v.prefix || '!', cur = v.currency || 'points', fix = (t) => esc(String(t).replace(/!(?=[a-z0-9])/gi, P).replace(/\bpoints\b/gi, cur));
    const on = v.builtin.filter((g) => g.on), play = ['gamble', 'slots', 'duel', '8ball', 'roll', 'flip', 'trivia', 'raffle'], ev = ['words', 'wheel', 'dance', 'race', 'boss', 'royale', 'teams'];
    const card = (g, cls) => '<div class="game ' + cls + '"><b>' + esc(g.name) + '</b><div class="how"><span class="cmd">' + fix(g.how) + '</span></div><div class="muted">' + fix(g.desc) + '</div></div>';
    const extra = {
      words: '<p class="muted">Word Rush: the screen shows some letters and a board of hidden words. Just type a word in chat (no command): the first person to type a word gets its points. Every round adds a letter, then some letters become unknown (?) and some are fake. Points are paid out in ' + esc(cur) + ' after every round, and chat has to find more of the words each round to keep going. Type <span class="cmd">' + esc(P) + 'wordtop</span> to see the all-time board.</p>',
    };
    return page('games.html', 'Games', 'Chat games',
      sec('Play any time', '<p class="muted">Everything here spends or wins <b>' + esc(cur) + '</b>. Earn it by chatting and watching, or with <span class="cmd">' + esc(P) + 'daily</span>.</p>' + (on.filter((g) => play.includes(g.id)).map((g) => card(g, '')).join('') || '<p class="muted">No chat games are switched on right now.</p>'))
      + ((v.custom || []).filter((g) => g.enabled).length ? sec('More games', v.custom.filter((g) => g.enabled).map((g) => '<div class="game"><b>' + esc(g.name) + '</b><div class="how"><span class="cmd">' + esc(P + g.command) + '</span></div><div class="muted">Costs ' + esc(g.cost) + ' ' + esc(cur) + (g.cooldown ? ', then wait ' + esc(g.cooldown) + ' seconds' : '') + '. ' + g.outcomes.length + ' possible outcomes.</div></div>').join('')) : '')
      + sec('Stream events', '<p class="muted">These are started by the streamer or the mods, and then everyone joins in.</p>' + (on.filter((g) => ev.includes(g.id)).map((g) => card(g, 'ev')).join('') || '<p class="muted">None switched on right now.</p>') + (on.some((g) => g.id === 'words') ? extra.words : '')));
  }

  function ttsPage() {
    const c = ctx.tts.cfg(), v = ctx.tts.view(), P = (ctx.bot.view().games || {}).prefix || '!', cur = (ctx.bot.view().games || {}).currency || 'points';
    const lvl = { everyone: 'everyone', subscriber: 'subscribers', vip: 'VIPs', moderator: 'mods' }, hook = (ctx.hooks ? ctx.hooks() : []).find((h) => h.enabled && (h.actions || []).some((a) => a.type === 'ttsreward')), title = hook ? String(hook.name).replace(/^Text-to-speech:\s*/, '') : '';
    const cmd = c.command && c.command.on ? '<li>Or type <span class="cmd">' + esc(P) + 'tts your message</span> in chat (' + esc(lvl[c.command.level] || 'everyone') + (c.command.cost ? ', costs ' + esc(c.command.cost) + ' ' + esc(cur) : '') + ').</li>' : '';
    const voices = (v.voices || []).map((x) => x.name);
    return page('tts.html', 'Text-to-speech', 'Text-to-speech',
      sec('How to do it', '<p>Get your own message read out loud on stream, with sound effects.</p><ol><li>Redeem the <b>' + esc(title || 'Text-to-Speech') + '</b> reward with your channel points.</li><li>Type what you want read out loud in the box.</li><li>Add sounds with their name in square brackets (see below).</li>' + cmd + '</ol><div class="ex">good luck <em>[airhorn]</em> you will need it <em>[boom]</em></div>')
      + sec('Sound effects', '<p class="muted">Put a sound anywhere in your message by typing its name in [square brackets]. The voice reads the words and the sound plays right where the tag is. Press a button to hear it.</p><div class="fx">' + (v.sfx || []).map((x) => '<button type="button" data-s="' + esc(x.name) + '">[' + esc(x.name) + ']<i>' + esc(x.desc) + '</i></button>').join('') + '</div>')
      + sec('Good to know', '<ul><li>Up to ' + esc(c.sfxMax || 3) + ' sound effects in one message.</li><li>Messages are cut at ' + esc(c.maxChars) + ' characters. Links and emoji are not read.</li><li>Some words are never read out loud. If your message cannot be read, your points are refunded.</li>' + '</ul>')
      + sec('The voice', '<p>' + (c.voice ? 'The stream reads messages with <b>' + esc(c.voice) + '</b>.' : 'The stream reads messages with the default voice.') + '</p>'
      + (voices.length ? '<p class="muted">Voices installed on the stream PC: ' + voices.map(esc).join(', ') + '. The streamer picks the voice; viewers cannot change it.</p>' : ''))
      + '<script>document.querySelectorAll("[data-s]").forEach(function(b){b.onclick=function(){new Audio("sounds/tts/"+b.dataset.s+".wav").play()}})</script>');
  }

  function indexPage() {
    const ex = ctx.bot.exportCommands(), v = ctx.bot.view().games, g = v.builtin.filter((x) => x.on).length + (v.custom || []).filter((x) => x.enabled).length;
    return page('index.html', 'Welcome', 'Welcome', sec('Welcome', '<p>Everything you can do in the chat of <b>' + esc(channel()) + '</b>.</p>') + '<div class="cards">'
      + '<a class="card" href="commands.html"><b>Commands</b><span>' + ex.count + ' chat commands</span></a><a class="card" href="games.html"><b>Games</b><span>' + g + ' games and stream events</span></a><a class="card" href="tts.html"><b>Text-to-speech</b><span>Get your message read out loud, with sound effects</span></a></div>');
  }

  /** write the whole site into outDir; returns the list of files written */
  function build(outDir) {
    const files = { 'index.html': indexPage(), 'commands.html': commandsPage(), 'games.html': gamesPage(), 'tts.html': ttsPage() };
    fs.mkdirSync(outDir, { recursive: true }); const written = [];
    for (const [f, html] of Object.entries(files)) { fs.writeFileSync(path.join(outDir, f), html); written.push(f); }
    try { fs.copyFileSync(path.join(ctx.assetsDir, 'logo.png'), path.join(outDir, 'logo.png')); written.push('logo.png'); } catch (e) { /* no logo */ }
    const sd = path.join(outDir, 'sounds', 'tts'); fs.mkdirSync(sd, { recursive: true });
    for (const x of ctx.tts.view().sfx || []) { try { fs.copyFileSync(path.join(ctx.sfxDir, x.name + '.wav'), path.join(sd, x.name + '.wav')); written.push('sounds/tts/' + x.name + '.wav'); } catch (e) { /* a missing sound */ } }
    fs.writeFileSync(path.join(outDir, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n/sounds/*\n  Cache-Control: public, max-age=86400\n'); written.push('_headers');   // read by Cloudflare Pages and Netlify
    return written;
  }
  return { build, pages: { indexPage, commandsPage, gamesPage, ttsPage } };
};
