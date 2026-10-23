'use strict';
// The viewers' website and its publishing to Cloudflare Pages, with fakes for the bot, the voice and wrangler. Run: node site-test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { EventEmitter } = require('events');
const createSite = require('./site'), createPublisher = require('./site-publish');

const bot = {
  exportCommands: () => ({ count: 3, custom: [['!discord', 'Everyone', 'Join <our> Discord & chat']], groups: { Games: [['!gamble <amount|all>', 'Everyone', 'Bet your coins'], ['!wordtop', 'Everyone', 'The all-time Word Rush leaderboard']] } }),
  view: () => ({ games: { prefix: '!', currency: 'coins', builtin: [
    { id: 'gamble', name: 'Gamble', how: '!gamble <amount|all>', desc: 'Bet points on a coin flip.', on: true }, { id: 'slots', name: 'Slots', how: '!slots <amount>', desc: 'Three reels.', on: false },
    { id: 'words', name: 'Word Rush', how: '!words (mods)', desc: 'A full-screen word game.', on: true }, { id: 'boss', name: 'Boss raid', how: '!boss (mods) then everyone !hit', desc: 'A monster appears.', on: true }],
    custom: [{ name: 'Go Fishing', command: 'fish', cost: 10, cooldown: 30, enabled: true, outcomes: [1, 2, 3] }, { name: 'Hidden', command: 'hid', cost: 1, cooldown: 0, enabled: false, outcomes: [] }] } }),
};
const sfxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-sfx-')); fs.writeFileSync(path.join(sfxDir, 'ding.wav'), 'RIFF'); fs.writeFileSync(path.join(sfxDir, 'boom.wav'), 'RIFF');
const tts = { cfg: () => ({ voice: 'Microsoft Zira Desktop', sfxMax: 3, maxChars: 200, sfx: true, command: { on: true, level: 'subscriber', cost: 5 } }), view: () => ({ voices: [{ name: 'Microsoft Zira Desktop' }, { name: 'Microsoft David Desktop' }], sfx: [{ name: 'ding', desc: 'a bright ding' }, { name: 'boom', desc: 'an explosion' }] }) };
const hooks = [{ name: 'Text-to-speech: Talk <b>to</b> me', enabled: true, actions: [{ type: 'ttsreward' }] }];
const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-assets-')); fs.writeFileSync(path.join(assetsDir, 'logo.png'), 'PNG');
const site = createSite({ bot, tts, hooks: () => hooks, channel: () => 'ItMeCasey', assetsDir, sfxDir });

(async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icm-site-')), 'website'), files = site.build(out);
  for (const f of ['index.html', 'commands.html', 'games.html', 'tts.html', 'logo.png', '_headers', 'sounds/tts/ding.wav', 'sounds/tts/boom.wav']) assert.ok(fs.existsSync(path.join(out, f)) && files.includes(f), f);
  const read = (f) => fs.readFileSync(path.join(out, f), 'utf8');
  const c = read('commands.html'); assert.ok(c.includes('!discord') && c.includes('Join &lt;our&gt; Discord &amp; chat') && !c.includes('<our>'), 'commands are listed and escaped'); assert.ok(c.includes('!wordtop') && c.includes('Fun &amp; info'));
  const g = read('games.html'); assert.ok(g.includes('Gamble') && g.includes('Bet coins on a coin flip') && g.includes('Word Rush') && g.includes('Boss raid') && g.includes('Go Fishing'), 'active games are listed, with your currency'); assert.ok(!g.includes('Slots') && !g.includes('Hidden'), 'games that are off are left out');
  assert.ok(g.includes('Play any time') && g.includes('Stream events') && g.includes('!wordtop'), 'sections and the Word Rush note'); assert.ok(/!boss \(mods\) then everyone !hit/.test(g));
  const t = read('tts.html'); assert.ok(t.includes('Talk &lt;b&gt;to&lt;/b&gt; me') && !t.includes('<b>to</b>'), 'the reward name is escaped'); assert.ok(t.includes('[ding]') && t.includes('data-s="boom"') && t.includes('sounds/tts/'), 'sound effects with play buttons');
  assert.ok(t.includes('Microsoft Zira Desktop') && t.includes('Microsoft David Desktop') && t.includes('Up to 3 sound effects') && t.includes('!tts your message') && t.includes('costs 5 coins') && t.includes('subscribers'), 'voice, limits and the command');
  const i = read('index.html'); assert.ok(i.includes('3 chat commands') && i.includes('4 games and stream events'), 'the home page counts what is on');
  for (const f of ['index.html', 'commands.html', 'games.html', 'tts.html']) { const h = read(f); assert.ok(h.includes('<title>') && h.includes('href="tts.html"') && h.includes('ItMeCasey'), f + ' has the shared look and menu'); assert.ok(!/<script src=|https?:\/\/(?!www\.w3)/i.test(h.replace(/<script>[\s\S]*?<\/script>/, '')), f + ' loads nothing from outside'); }

  // ---- publishing: wrangler is faked; nothing leaves this PC
  const state = { site: { project: '', auto: true, published: false, lastHash: '', lastDeploy: 0, lastUrl: '', lastError: '', lastTry: 0 } }, calls = []; let loggedIn = false, deployFails = false, projectExists = false, t0 = 1e12;
  const fakeSpawn = (cmd, args) => {
    const a = args.slice(2).join(' '); calls.push(a); const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
    setImmediate(() => {
      let out = '', code = 0;
      if (a.startsWith('whoami')) { out = loggedIn ? 'You are logged in with an OAuth Token, associated with the email casey@example.com.' : 'You are not authenticated. Please run `wrangler login`.'; }
      else if (a.startsWith('login')) { loggedIn = true; out = 'Successfully logged in.'; }
      else if (a.startsWith('pages project create')) { if (!loggedIn) { out = 'Not logged in'; code = 1; } else if (projectExists) { out = 'A project with this name already exists.'; code = 1; } else { out = 'Successfully created the project'; projectExists = true; } }
      else if (a.startsWith('pages deploy')) { if (deployFails) { out = 'Error: network down'; code = 1; } else out = 'Uploading... (26/26)\n✨ Deployment complete! Take a peek over at https://a1b2c3d4.itmecasey.pages.dev'; }
      c.stdout.emit('data', Buffer.from(out)); c.emit('exit', code);
    });
    return c;
  };
  let siteDirUsed = null; const pub = createPublisher({ state, persist: () => {}, log: () => {}, spawn: fakeSpawn, now: () => t0, site, tts, siteDir: () => (siteDirUsed = path.join(path.dirname(out), 'pub')), channel: () => 'ItMeCasey' });
  assert.equal(pub.clean('My Site!! 2'), 'my-site-2'); assert.equal(pub.view().defaultName, 'itmecasey');
  assert.deepEqual(await pub.whoami(), { ok: false, email: '', node: true }); await assert.rejects(pub.publish(), /Choose a name/);
  assert.throws(() => pub.settings({ project: '!!' }), /at least 3/); assert.equal(pub.settings({ project: 'ItMeCasey' }).project, 'itmecasey');
  await assert.rejects(pub.publish(), /Not logged in to Cloudflare/, 'asks for the login first'); assert.ok(state.site.lastError);
  pub.login(); await new Promise((r) => setTimeout(r, 30)); assert.deepEqual(await pub.whoami(), { ok: true, email: 'casey@example.com', node: true });
  const r = await pub.publish('test'); assert.deepEqual(r, { ok: true, url: 'https://itmecasey.pages.dev' }, 'the address is the project address, not the one-off preview'); assert.ok(calls.some((x) => /pages project create itmecasey --production-branch main/.test(x)) && calls.some((x) => /pages deploy .*pub.* --project-name itmecasey --branch main/.test(x)));
  assert.ok(fs.existsSync(path.join(siteDirUsed, 'tts.html')), 'the pages were built before the upload'); assert.deepEqual([state.site.published, state.site.lastError, state.site.lastUrl], [true, '', 'https://itmecasey.pages.dev']);
  const n = calls.length; await pub.publish(); assert.ok(calls.slice(n).some((x) => /pages deploy/.test(x)), 'publishing again works when the project already exists'); deployFails = true; await assert.rejects(pub.publish(), /Upload failed: Error: network down/); deployFails = false;
  // automatic: nothing happens while nothing changed, then a change is published (but not more than once in 5 minutes)
  const before = calls.length; await pub.publish(); t0 += 6 * 60000; pub.tick(); await new Promise((r) => setTimeout(r, 30)); assert.equal(calls.length - before, calls.length - before); const quiet = calls.length; pub.tick(); await new Promise((r) => setTimeout(r, 30)); assert.equal(calls.length, quiet, 'no change, no upload');
  hooks[0].name = 'Text-to-speech: A new title'; t0 += 6 * 60000; pub.tick(); await new Promise((r) => setTimeout(r, 60)); assert.ok(calls.length > quiet && calls.slice(quiet).some((x) => /pages deploy/.test(x)), 'a change is published by itself');
  state.site.auto = false; hooks[0].name = 'Text-to-speech: Another'; t0 += 6 * 60000; const off = calls.length; pub.tick(); await new Promise((r) => setTimeout(r, 30)); assert.equal(calls.length, off, 'automatic can be switched off');
  console.log('site test passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
