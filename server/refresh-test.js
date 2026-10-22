'use strict';
// Twitch refresh tokens can be used only once. Many requests that find the access token expired at the same time must share ONE refresh,
// otherwise the extra refreshes fail and the login is lost ("Invalid refresh token").
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-refresh-')), PORT = 8496, MOCK = 8495; let refreshes = 0, used = new Set(), stale = 0;
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    const j = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/id/token') {
      const p = new URLSearchParams(body), rt = p.get('refresh_token');
      if (used.has(rt)) { stale++; return j({ status: 400, message: 'Invalid refresh token' }, 400); }   // a refresh token works once
      used.add(rt); refreshes++; return j({ access_token: 'NEW' + refreshes, refresh_token: 'RT' + refreshes, expires_in: 14400 });
    }
    if (req.url.startsWith('/id/validate')) return j({ user_id: '777', login: 'itmecasey', expires_in: 14000 });
    if (req.url.startsWith('/helix/channels')) return j({ data: [{ title: 'T', game_id: '1', game_name: 'G', broadcaster_language: 'en' }] });
    return j({ data: [] });
  });
});
fs.writeFileSync(path.join(T, 'tokens.json'), JSON.stringify({ access_token: 'OLD', refresh_token: 'RT0', expires_at: Date.now() - 1000, user_id: '777', login: 'itmecasey', scopes: [] }));
const api = (p) => fetch('http://127.0.0.1:' + PORT + p).then((r) => r.json());
mock.listen(MOCK, async () => {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { stdio: 'ignore', env: Object.assign({}, process.env, { ICM_PORT: String(PORT), ICM_DATA: T, ICM_CLIENT_ID: 'x', ICM_HELIX_URL: 'http://127.0.0.1:' + MOCK + '/helix', ICM_ID_URL: 'http://127.0.0.1:' + MOCK + '/id', ICM_EVENTSUB_URL: 'ws://127.0.0.1:1/' }) });
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch('http://127.0.0.1:' + PORT + '/api/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 250)); } }
    const before = refreshes;
    await new Promise((r) => setTimeout(r, 1500));   // the server's own start-up calls
    const results = await Promise.all(Array.from({ length: 10 }, () => api('/api/channel')));
    assert(results.every((r) => r.title === 'T'), 'every request worked: ' + JSON.stringify(results[0]));
    assert.equal(stale, 0, 'no refresh token was used twice (' + stale + ' tried)'); assert(refreshes >= 1 && refreshes - before <= 3, 'refreshed ' + refreshes + ' times');
    console.log('refresh test passed (' + refreshes + ' refresh for 10 simultaneous requests)');
  } catch (e) { console.error(e); process.exitCode = 1; } finally { child.kill(); mock.close(); }
});
