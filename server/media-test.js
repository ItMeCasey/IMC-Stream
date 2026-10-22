// Tests the media module: Windows media-session provider (fake PowerShell) and Spotify provider (fake Spotify). Run: node media-test.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert');
const { EventEmitter } = require('node:events');
const createMedia = require('./media.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ------------------------------------------------------------ fake PowerShell
const spawned = []; let cmdReply = '{"ok":true}';
function fakeSpawn(exe, args) {
  const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.killed = false;
  c.kill = () => { c.killed = true; setImmediate(() => c.emit('exit')); };
  const file = path.basename(args[args.indexOf('-File') + 1]); spawned.push({ file, args, child: c });
  if (file === 'smtc-cmd.ps1') setImmediate(() => { c.stdout.emit('data', Buffer.from(cmdReply + '\n')); c.emit('exit'); });
  return c;
}
const emit = (obj, split) => { const p = spawned.filter((s) => s.file === 'smtc-poll.ps1' && !s.child.killed).pop(); const t = JSON.stringify(obj) + '\n'; if (split) { p.child.stdout.emit('data', Buffer.from(t.slice(0, split))); p.child.stdout.emit('data', Buffer.from(t.slice(split))); } else p.child.stdout.emit('data', Buffer.from(t)); };
const mk = (over = {}) => {
  const broadcasts = [], state = { mediaCfg: { provider: 'windows', app: 'auto', spotifyClientId: '', requests: false, requestLevel: 'everyone' } };
  const m = createMedia(Object.assign({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'icm-media-')), state, persist: () => {}, broadcast: (e, d) => broadcasts.push([e, d]), port: () => 8420, log: () => {}, noLookup: true }, over));
  return { m, broadcasts, state };
};

(async () => {
  // ================= Windows provider
  {
    const { m, broadcasts, state } = mk({ spawn: fakeSpawn });
    m.start(); broadcasts.length = 0;   // ignore the initial "nothing yet" broadcast
    const poll = spawned.find((s) => s.file === 'smtc-poll.ps1');
    assert.deepStrictEqual(poll.args.slice(poll.args.indexOf('-App')), ['-App', 'auto'], 'follows music players by default');
    const song = { status: 'playing', sessions: ['AppleInc.AppleMusicWin_x!App'], app: 'AppleInc.AppleMusicWin_x!App', title: 'Golden Hour', artist: 'JVKE', album: 'this is what ____ feels like', durationMs: 209000, positionMs: 5000, shuffle: true, repeat: 'list', canSeek: true, art: 'image/png;AAEC' };
    emit(song, 40);   // arrives in two chunks
    let v = m.view();
    assert.deepStrictEqual([v.status, v.title, v.artist, v.album, v.durationMs, v.shuffle, v.repeat, v.canSeek, v.provider], ['playing', 'Golden Hour', 'JVKE', 'this is what ____ feels like', 209000, true, 'list', true, 'windows']);
    assert.strictEqual(v.art, '/media/art?v=1'); assert.deepStrictEqual([...m.art().buf], [0, 1, 2]); assert.strictEqual(m.art().type, 'image/png');
    assert.strictEqual(broadcasts.length, 1, 'new track is broadcast');
    const tick = (pos, extra = {}) => { const o = Object.assign({}, song, { positionMs: pos }, extra); delete o.art; emit(o); };
    await sleep(1000); tick(6000); assert.strictEqual(broadcasts.length, 1, 'normal progress is not re-broadcast (overlays interpolate)');
    await sleep(1000); tick(7000); assert.strictEqual(broadcasts.length, 1);
    tick(150000); assert.strictEqual(broadcasts.length, 2, 'a seek is broadcast'); assert.strictEqual(m.view().art, '/media/art?v=1', 'art kept until the track changes');
    tick(150000, { status: 'paused' }); assert.strictEqual(broadcasts.length, 3, 'pause is broadcast'); assert.strictEqual(m.view().status, 'paused');
    tick(10, { title: 'Next one', artist: 'Someone' }); emit(Object.assign({}, song, { title: 'Next one', artist: 'Someone', art: '' })); assert.strictEqual(m.view().art, '', 'empty art clears the picture');
    const L = m.labels(); assert.deepStrictEqual([L.now_playing.value, L.now_playing_title.value, L.now_playing_status.value], ['Someone - Next one', 'Next one', 'PLAYING']);
    assert.match(L.now_playing_progress.value, /^0:0\d \/ 3:29$/);
    emit({ status: 'none', sessions: ['chrome.exe'] }); v = m.view(); assert.deepStrictEqual([v.status, v.title, v.sessions], ['none', '', ['chrome.exe']]); assert.strictEqual(m.labels().now_playing.value, '');

    // controls spawn the command script with the right arguments
    await m.control('next'); let cmd = spawned.filter((s) => s.file === 'smtc-cmd.ps1').pop().args;
    assert.deepStrictEqual(cmd.slice(cmd.indexOf('-Action')), ['-Action', 'next', '-Value', '', '-App', 'auto']);
    await m.control('seek', 90000); cmd = spawned.filter((s) => s.file === 'smtc-cmd.ps1').pop().args; assert.deepStrictEqual(cmd.slice(cmd.indexOf('-Action'), cmd.indexOf('-Action') + 4), ['-Action', 'seek', '-Value', '90000']);
    cmdReply = '{"ok":false,"error":"No media player is open"}'; await assert.rejects(m.control('toggle'), /No media player is open/); cmdReply = '{"ok":true}';

    // choosing a specific app restarts the poller
    const before = spawned.filter((s) => s.file === 'smtc-poll.ps1').length;
    m.settings({ app: 'Spotify.exe' }); await sleep(20);
    const polls = spawned.filter((s) => s.file === 'smtc-poll.ps1'); assert.strictEqual(polls.length, before + 1); assert.ok(polls[before - 1].child.killed, 'old poller stopped');
    assert.deepStrictEqual(polls[before].args.slice(polls[before].args.indexOf('-App')), ['-App', 'Spotify.exe']);
    assert.strictEqual(state.mediaCfg.app, 'Spotify.exe');
    m.settings({ provider: 'spotify' }); await sleep(20); assert.ok(spawned.filter((s) => s.file === 'smtc-poll.ps1').pop().child.killed, 'switching to Spotify stops PowerShell'); m.stop();
  }

  // ================= Spotify provider (fake Spotify)
  const calls = []; let mode = 'ok', challenge = '', accessOk = 'AT1', refreshes = 0, tokenReq = null;
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
      const u = new URL(req.url, 'http://x'), j = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/api/token') {
        const p = new URLSearchParams(body); tokenReq = Object.fromEntries(p);
        if (p.get('grant_type') === 'authorization_code') { if (b64url(crypto.createHash('sha256').update(p.get('code_verifier')).digest()) !== challenge) return j({ error: 'invalid_grant', error_description: 'bad verifier' }, 400); return j({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 }); }
        refreshes++; accessOk = 'AT2'; return j({ access_token: 'AT2', expires_in: 3600 });
      }
      const auth = req.headers.authorization; calls.push([req.method, u.pathname + u.search, auth]);
      if (auth !== 'Bearer ' + accessOk) { res.writeHead(401); return res.end('{"error":{"message":"The access token expired"}}'); }
      if (mode === 'premium' && req.method !== 'GET') return j({ error: { status: 403, message: 'Player command failed: Premium required' } }, 403);
      if (mode === 'nodevice' && req.method !== 'GET') return j({ error: { status: 404, message: 'NO_ACTIVE_DEVICE' } }, 404);
      if (u.pathname === '/v1/me') return j({ display_name: 'Casey' });
      if (u.pathname === '/v1/me/player' && req.method === 'GET') {
        if (mode === 'idle') { res.writeHead(204); return res.end(); }
        return j({ is_playing: true, progress_ms: 61000, shuffle_state: true, repeat_state: 'context', device: { name: 'Casey PC', volume_percent: 35 },
          item: { type: 'track', name: 'Midnight City', duration_ms: 243000, external_urls: { spotify: 'https://open.spotify.com/track/abc' }, artists: [{ name: 'M83' }, { name: 'Guest' }], album: { name: 'Hurry Up, We\'re Dreaming', images: [{ url: 'https://i.scdn.co/big.jpg' }, { url: 'https://i.scdn.co/small.jpg' }] } } });
      }
      if (u.pathname === '/v1/search') return j({ tracks: { items: [{ uri: 'spotify:track:t1', name: 'Song One', duration_ms: 1000, artists: [{ name: 'A' }], album: { name: 'Alb', images: [{ url: 'big' }, { url: 'tiny' }] } }] } });
      res.writeHead(204); res.end();
    });
  });
  await new Promise((r) => server.listen(9955, '127.0.0.1', r));
  try {
    const { m, broadcasts, state } = mk({ spotifyApi: 'http://127.0.0.1:9955/v1', spotifyAuth: 'http://127.0.0.1:9955', spotifyPollMs: 50 });
    m.settings({ provider: 'spotify' }); await sleep(30);
    assert.match(m.view().error, /Not connected to Spotify/);
    assert.throws(() => m.connectSpotify(), /Client ID/);
    m.settings({ spotifyClientId: 'abc 123!' }); assert.strictEqual(state.mediaCfg.spotifyClientId, 'abc123', 'client id is sanitised');
    const { url, redirectUri } = m.connectSpotify(); const q = new URL(url).searchParams;
    assert.strictEqual(redirectUri, 'http://127.0.0.1:8420/spotify/callback');
    assert.deepStrictEqual([q.get('response_type'), q.get('client_id'), q.get('redirect_uri'), q.get('code_challenge_method')], ['code', 'abc123', redirectUri, 'S256']);
    assert.ok(q.get('scope').includes('user-modify-playback-state') && q.get('scope').includes('user-read-playback-state'));
    challenge = q.get('code_challenge');
    await assert.rejects(m.spotifyCallback({ code: 'C', state: 'wrong' }), /expired/);
    assert.deepStrictEqual(await m.spotifyCallback({ code: 'CODE', state: q.get('state') }), { ok: true });
    assert.strictEqual(tokenReq.client_id, 'abc123'); assert.ok(!('client_secret' in tokenReq), 'PKCE: no client secret');
    assert.deepStrictEqual([m.view().spotify.connected, m.view().spotify.user], [true, 'Casey']);

    await sleep(150);
    let v = m.view();
    assert.deepStrictEqual([v.status, v.title, v.artist, v.album, v.art, v.durationMs, v.shuffle, v.repeat, v.volume, v.app, v.link, v.provider, v.canVolume],
      ['playing', 'Midnight City', 'M83, Guest', 'Hurry Up, We\'re Dreaming', 'https://i.scdn.co/big.jpg', 243000, true, 'list', 35, 'Casey PC', 'https://open.spotify.com/track/abc', 'spotify', true]);
    assert.ok(broadcasts.some(([e, d]) => e === 'media' && d.title === 'Midnight City'));
    assert.strictEqual(m.labels().now_playing_link.value, 'https://open.spotify.com/track/abc');

    // controls hit the right endpoints
    const last = () => calls.filter((c) => c[0] !== 'GET').pop();
    await m.control('pause'); assert.deepStrictEqual(last().slice(0, 2), ['PUT', '/v1/me/player/pause']);
    await m.control('next'); assert.deepStrictEqual(last().slice(0, 2), ['POST', '/v1/me/player/next']);
    await m.control('previous'); assert.deepStrictEqual(last().slice(0, 2), ['POST', '/v1/me/player/previous']);
    await m.control('toggle'); assert.deepStrictEqual(last().slice(0, 2), ['PUT', '/v1/me/player/pause'], 'toggle pauses while playing');
    await m.control('seek', 90500.7); assert.strictEqual(last()[1], '/v1/me/player/seek?position_ms=90500');
    await m.control('volume', 140); assert.strictEqual(last()[1], '/v1/me/player/volume?volume_percent=100');
    await m.control('shuffle', false); assert.strictEqual(last()[1], '/v1/me/player/shuffle?state=false');
    await m.control('repeat', 'list'); assert.strictEqual(last()[1], '/v1/me/player/repeat?state=context');
    await m.control('repeat', 'none'); assert.strictEqual(last()[1], '/v1/me/player/repeat?state=off');
    await assert.rejects(m.control('explode'), /Unknown action/);

    // search, queue, play
    assert.deepStrictEqual(await m.search('song one'), [{ uri: 'spotify:track:t1', name: 'Song One', artist: 'A', album: 'Alb', art: 'tiny', durationMs: 1000 }]);
    assert.deepStrictEqual(await m.search('  '), []);
    await m.queue('spotify:track:t1'); assert.strictEqual(last()[1], '/v1/me/player/queue?uri=spotify%3Atrack%3At1');
    await assert.rejects(m.queue('https://evil.test'), /not a Spotify track/);
    await m.playUri('spotify:track:t1'); assert.strictEqual(last()[0] + ' ' + last()[1], 'PUT /v1/me/player/play');

    // friendly errors
    mode = 'premium'; await assert.rejects(m.control('next'), /Premium is required/);
    mode = 'nodevice'; await assert.rejects(m.control('next'), /No active Spotify device/);
    mode = 'idle'; await sleep(150); assert.deepStrictEqual([m.view().status, m.view().error], ['none', 'Nothing is playing on any Spotify device']);

    // expired access token: refreshed once, request retried
    mode = 'ok'; accessOk = 'EXPIRED-SERVER-SIDE'; const r0 = refreshes; await m.control('pause'); assert.strictEqual(refreshes, r0 + 1, 'a 401 triggers one refresh'); assert.strictEqual(last()[2], 'Bearer AT2');
    m.disconnectSpotify(); assert.strictEqual(m.view().spotify.connected, false); await sleep(120); assert.match(m.view().error, /Not connected/);
    m.stop();
    // the Windows build cannot search or queue
    const w = mk({ spawn: fakeSpawn }); await assert.rejects(w.m.search('x'), /needs Spotify/); await assert.rejects(w.m.queue('spotify:track:abc'), /need Spotify/);
    console.log('media test passed (' + calls.length + ' Spotify requests, ' + spawned.length + ' PowerShell runs)');
  } catch (e) { console.error('FAILED:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exitCode = 1; }
  server.close(); setTimeout(() => process.exit(), 100);
})();
