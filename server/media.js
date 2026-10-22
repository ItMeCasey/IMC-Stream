'use strict';
/**
 * Now-playing + media control.
 *  - "windows" provider: Windows' media session (SMTC) via PowerShell. Works with Apple Music for Windows, Spotify desktop,
 *    iTunes, foobar, browsers... no sign-in needed. Gives title/artist/album/art/progress and play/pause/next/previous/seek.
 *  - "spotify" provider: Spotify Web API with PKCE login. Adds volume, queue + song search. Control needs Spotify Premium.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const SPOTIFY_SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

module.exports = function createMedia(ctx) {
  const log = ctx.log || (() => {});
  const cfg = () => ctx.state.mediaCfg;
  const API = ctx.spotifyApi || process.env.ICM_SPOTIFY_API || 'https://api.spotify.com/v1';
  const AUTH = ctx.spotifyAuth || process.env.ICM_SPOTIFY_AUTH || 'https://accounts.spotify.com';
  const doFetch = ctx.fetch || fetch;
  const spawnFn = ctx.spawn || spawn;
  const SCRIPTS = path.join(__dirname, 'media');
  const TOKENS = path.join(ctx.DATA, 'spotify.json');

  const blank = () => ({ status: 'none', title: '', artist: '', album: '', art: '', durationMs: 0, positionMs: 0, positionAt: Date.now(), shuffle: false, repeat: 'none', volume: null, app: '', link: '', canSeek: false, sessions: [], error: '' });
  let cur = blank(), lastKey = '';
  let artBuf = null, artVer = 0;

  /** publish a new state; tell overlays only when something visible changed (they interpolate the progress bar themselves) */
  function set(next) {
    const prev = cur, now = Date.now();
    const expected = prev.positionMs + (prev.status === 'playing' ? now - prev.positionAt : 0);
    next.positionAt = now;
    cur = next;
    const key = [next.status, next.title, next.artist, next.album, next.art, next.shuffle, next.repeat, next.volume, next.error, next.app].join('|');
    if (key !== lastKey || Math.abs(expected - next.positionMs) > 2500) { lastKey = key; ctx.broadcast('media', view()); }
    if (ctx.onChange) ctx.onChange();
  }

  // ---------------------------------------------------------------- Windows media session
  let child = null, restartT = null, wantWindows = false, buf = '';
  function startWindows() {
    if (child || process.platform !== 'win32' && !ctx.spawn) return;
    wantWindows = true;
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, 'smtc-poll.ps1'), '-ParentPid', String(process.pid), '-App', cfg().app === 'any' ? '' : cfg().app || 'auto'];
    let c;
    try { c = spawnFn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { log('media: could not start PowerShell:', e.message); return; }
    child = c; buf = '';
    c.stdout.on('data', (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onWindowsLine(line); } });
    c.stderr && c.stderr.on('data', () => {});
    c.on('error', (e) => log('media: PowerShell error:', e.message));
    c.on('exit', () => { if (child === c) child = null; if (wantWindows) { clearTimeout(restartT); restartT = setTimeout(startWindows, 3000); if (restartT.unref) restartT.unref(); } });
  }
  function stopWindows() { wantWindows = false; clearTimeout(restartT); const c = child; child = null; if (c) { try { c.kill(); } catch (e) { /* gone */ } } }
  // Some players (browsers especially) publish a cover Windows can't hand to PowerShell: look it up by artist + title instead (iTunes search, no key needed)
  let lookKey = '', lookBuf = null;
  async function lookupArt(artist, title, key) {
    const f = ctx.fetch || (ctx.noLookup ? null : globalThis.fetch); if (!f) return;
    try {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 6000); if (t.unref) t.unref();
      const r = await f('https://itunes.apple.com/search?media=music&entity=song&limit=1&term=' + encodeURIComponent((artist + ' ' + title).trim()), { signal: ac.signal }), j = await r.json();
      const u = j && j.results && j.results[0] && j.results[0].artworkUrl100; if (!u || key !== lookKey) return;
      const img = await f(u.replace(/\d+x\d+(bb)?\./, '600x600bb.'), { signal: ac.signal }); if (!img.ok) return;
      const buf = Buffer.from(await img.arrayBuffer()); if (!buf.length || buf.length > 3e6 || key !== lookKey) return;
      lookBuf = { type: img.headers.get('content-type') || 'image/jpeg', buf }; artBuf = lookBuf; artVer++;
      if (cur.title && !cur.art) { cur.art = '/media/art?v=' + artVer; ctx.broadcast('media', view()); if (ctx.onChange) ctx.onChange(); }
    } catch (e) { /* offline or no match: no cover */ }
  }
  function onWindowsLine(line) {
    let j; try { j = JSON.parse(line); } catch (e) { return; }
    if (typeof j.art === 'string') {   // sent only when the track changes: "image/jpeg;BASE64"
      const i = j.art.indexOf(';'); artBuf = i > 0 && j.art.length > i + 1 ? { type: j.art.slice(0, i) || 'image/jpeg', buf: Buffer.from(j.art.slice(i + 1), 'base64') } : null; artVer++;
    }
    const base = blank(); base.sessions = j.sessions || []; base.error = j.error || '';
    if (j.status === 'none' || !j.title) { if (j.status === 'none') { artBuf = null; } return set(Object.assign(base, { status: 'none' })); }
    const tkey = (j.artist || '') + '|' + j.title;
    if (tkey !== lookKey) { lookKey = tkey; lookBuf = null; if (typeof j.art !== 'string' || !artBuf) { artBuf = null; artVer++; if (!j.art) lookupArt(j.artist || '', j.title, tkey); } }
    else if (!artBuf && lookBuf) artBuf = lookBuf;
    set(Object.assign(base, { status: j.status === 'playing' ? 'playing' : 'paused', title: j.title || '', artist: j.artist || '', album: j.album || '', art: artBuf ? '/media/art?v=' + artVer : '',
      durationMs: j.durationMs || 0, positionMs: j.positionMs || 0, shuffle: !!j.shuffle, repeat: j.repeat === 'track' ? 'track' : j.repeat === 'list' ? 'list' : 'none', app: j.app || '', canSeek: !!j.canSeek }));
  }
  function winControl(action, arg) {
    return new Promise((resolve, reject) => {
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, 'smtc-cmd.ps1'), '-Action', action, '-Value', String(arg == null ? '' : arg), '-App', cfg().app === 'any' ? '' : cfg().app || 'auto'];
      let out = '', c; try { c = spawnFn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return reject(new Error('Could not start PowerShell')); }
      c.stdout.on('data', (d) => { out += d.toString('utf8'); });
      c.on('error', () => reject(new Error('Could not start PowerShell')));
      c.on('exit', () => { let j = {}; try { j = JSON.parse(out.trim().split('\n').pop()); } catch (e) { /* empty */ } j.ok ? resolve({ ok: true }) : reject(new Error(j.error || 'The player did not respond')); });
    });
  }

  // ---------------------------------------------------------------- Spotify Web API
  let tokens = null, pending = null, pollT = null, wantSpotify = false;
  try { tokens = JSON.parse(fs.readFileSync(TOKENS, 'utf8')); } catch (e) { /* not connected */ }
  const redirectUri = () => 'http://127.0.0.1:' + ctx.port() + '/spotify/callback';
  const saveTokens = (t) => { tokens = t; if (t) fs.writeFileSync(TOKENS, JSON.stringify(t, null, 2)); else { try { fs.unlinkSync(TOKENS); } catch (e) { /* none */ } } };
  async function tokenCall(body) {
    const r = await doFetch(AUTH + '/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  }
  function connectSpotify() {
    if (!cfg().spotifyClientId) throw new Error('Paste your Spotify Client ID first');
    const verifier = b64url(crypto.randomBytes(48)), state = b64url(crypto.randomBytes(12));
    pending = { verifier, state, at: Date.now() };
    const q = new URLSearchParams({ response_type: 'code', client_id: cfg().spotifyClientId, scope: SPOTIFY_SCOPES, redirect_uri: redirectUri(), state, code_challenge_method: 'S256', code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) });
    return { url: AUTH + '/authorize?' + q.toString(), redirectUri: redirectUri() };
  }
  async function spotifyCallback(query) {
    if (!pending || query.state !== pending.state || Date.now() - pending.at > 600000) throw new Error('That login link expired - press Connect Spotify again');
    if (query.error) throw new Error('Spotify said: ' + query.error);
    const r = await tokenCall({ grant_type: 'authorization_code', code: query.code, redirect_uri: redirectUri(), client_id: cfg().spotifyClientId, code_verifier: pending.verifier });
    pending = null;
    if (!r.ok) throw new Error('Spotify refused the login: ' + (r.json.error_description || r.json.error || 'unknown error'));
    saveTokens({ access_token: r.json.access_token, refresh_token: r.json.refresh_token, expires_at: Date.now() + (r.json.expires_in || 3600) * 1000, user: '' });
    const me = await sp('GET', '/me'); if (me.status === 200) { tokens.user = me.json.display_name || me.json.id || ''; saveTokens(tokens); }
    if (cfg().provider === 'spotify') startSpotify();
    return { ok: true };
  }
  let refreshing = null;   // single-flight: the poller and a control call must not refresh with the same refresh token at once
  const refresh = () => (refreshing || (refreshing = doRefresh().finally(() => { refreshing = null; })));
  async function doRefresh() {
    if (!tokens || !tokens.refresh_token) throw new Error('Not connected to Spotify');
    const r = await tokenCall({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: cfg().spotifyClientId });
    if (!r.ok) { saveTokens(null); throw new Error('Spotify login expired - connect it again'); }
    saveTokens(Object.assign({}, tokens, { access_token: r.json.access_token, refresh_token: r.json.refresh_token || tokens.refresh_token, expires_at: Date.now() + (r.json.expires_in || 3600) * 1000 }));
  }
  async function sp(method, p, body, retry = true) {
    if (!tokens) throw new Error('Not connected to Spotify');
    if (tokens.expires_at - Date.now() < 60000) await refresh();
    const r = await doFetch(API + p, { method, headers: { Authorization: 'Bearer ' + tokens.access_token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && retry) { await refresh(); return sp(method, p, body, false); }
    const txt = r.status === 204 ? '' : await r.text().catch(() => '');
    let json = {}; try { json = txt ? JSON.parse(txt) : {}; } catch (e) { /* not json */ }
    return { status: r.status, ok: r.ok, json };
  }
  const spErr = (r) => (r.status === 403 ? 'Spotify Premium is required to control playback' : r.status === 404 ? 'No active Spotify device: open Spotify somewhere and start a song first'
    : (r.json && r.json.error && (r.json.error.message || r.json.error)) || 'Spotify error ' + r.status);
  async function pollSpotify() {
    if (!wantSpotify) return;
    try {
      if (!tokens) return set(Object.assign(blank(), { status: 'none', error: 'Not connected to Spotify' }));
      const r = await sp('GET', '/me/player?additional_types=episode');
      if (r.status === 204 || !r.json.item) set(Object.assign(blank(), { status: 'none', error: r.status === 204 ? 'Nothing is playing on any Spotify device' : '' }));
      else if (!r.ok) set(Object.assign(blank(), { status: 'none', error: spErr(r) }));
      else {
        const it = r.json.item, ep = it.type === 'episode', imgs = (ep ? it.images : it.album && it.album.images) || [];
        set(Object.assign(blank(), { status: r.json.is_playing ? 'playing' : 'paused', title: it.name || '', artist: ep ? (it.show && it.show.name) || '' : (it.artists || []).map((a) => a.name).join(', '),
          album: ep ? '' : (it.album && it.album.name) || '', art: (imgs[0] && imgs[0].url) || '', durationMs: it.duration_ms || 0, positionMs: r.json.progress_ms || 0, shuffle: !!r.json.shuffle_state,
          repeat: r.json.repeat_state === 'track' ? 'track' : r.json.repeat_state === 'context' ? 'list' : 'none', volume: r.json.device ? r.json.device.volume_percent : null,
          app: r.json.device ? r.json.device.name : 'Spotify', link: (it.external_urls && it.external_urls.spotify) || '', canSeek: true }));
      }
    } catch (e) { set(Object.assign(blank(), { status: 'none', error: e.message })); }
  }
  function startSpotify() { wantSpotify = true; clearInterval(pollT); pollSpotify(); pollT = setInterval(pollSpotify, +ctx.spotifyPollMs || 2000); if (pollT.unref) pollT.unref(); }
  function stopSpotify() { wantSpotify = false; clearInterval(pollT); }
  async function spControl(action, arg) {
    const m = { play: ['PUT', '/me/player/play'], pause: ['PUT', '/me/player/pause'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] };
    let call;
    if (action === 'toggle') call = cur.status === 'playing' ? m.pause : m.play;
    else if (m[action]) call = m[action];
    else if (action === 'seek') call = ['PUT', '/me/player/seek?position_ms=' + Math.max(0, Math.floor(Number(arg) || 0))];
    else if (action === 'volume') call = ['PUT', '/me/player/volume?volume_percent=' + Math.min(100, Math.max(0, Math.floor(Number(arg) || 0)))];
    else if (action === 'shuffle') call = ['PUT', '/me/player/shuffle?state=' + (arg === true || arg === 'true')];
    else if (action === 'repeat') call = ['PUT', '/me/player/repeat?state=' + (arg === 'track' ? 'track' : arg === 'list' ? 'context' : 'off')];
    else throw new Error('Unknown action');
    const r = await sp(call[0], call[1]); if (!r.ok) throw new Error(spErr(r));
    setTimeout(pollSpotify, 400); return { ok: true };
  }

  // ---------------------------------------------------------------- public API
  const provider = () => (cfg().provider === 'spotify' ? 'spotify' : 'windows');
  function view() {
    const c = cur, now = Date.now();
    return Object.assign({}, c, { provider: provider(), now, canVolume: provider() === 'spotify', canQueue: provider() === 'spotify',
      cfg: { provider: provider(), app: cfg().app, spotifyClientId: cfg().spotifyClientId, requests: !!cfg().requests, requestLevel: cfg().requestLevel },
      spotify: { connected: !!tokens, user: tokens ? tokens.user : '', redirectUri: redirectUri() }, platform: process.platform });
  }
  async function control(action, arg) {
    if (provider() === 'spotify') return spControl(action, arg);
    if (process.platform !== 'win32' && !ctx.spawn) throw new Error('The Windows media controls only work on Windows: use Spotify instead');
    return winControl(action, arg);
  }
  async function search(q) {
    if (provider() !== 'spotify') throw new Error('Song search needs Spotify');
    q = String(q || '').trim(); if (!q) return [];
    const r = await sp('GET', '/search?type=track&limit=8&q=' + encodeURIComponent(q)); if (!r.ok) throw new Error(spErr(r));
    return ((r.json.tracks && r.json.tracks.items) || []).map((t) => ({ uri: t.uri, name: t.name, artist: (t.artists || []).map((a) => a.name).join(', '), album: t.album && t.album.name, art: t.album && t.album.images && t.album.images.length ? t.album.images[t.album.images.length - 1].url : '', durationMs: t.duration_ms }));
  }
  async function queue(uri) {
    if (provider() !== 'spotify') throw new Error('Song requests need Spotify');
    if (!/^spotify:track:[A-Za-z0-9]+$/.test(String(uri))) throw new Error('That is not a Spotify track');
    const r = await sp('POST', '/me/player/queue?uri=' + encodeURIComponent(uri)); if (!r.ok) throw new Error(spErr(r)); return { ok: true };
  }
  async function playUri(uri) {
    if (provider() !== 'spotify') throw new Error('Needs Spotify');
    if (!/^spotify:track:[A-Za-z0-9]+$/.test(String(uri))) throw new Error('That is not a Spotify track');
    const r = await sp('PUT', '/me/player/play', { uris: [uri] }); if (!r.ok) throw new Error(spErr(r)); setTimeout(pollSpotify, 500); return { ok: true };
  }
  function settings(b) {
    const c = cfg(), prevProv = provider(), prevApp = c.app;
    if (b.provider === 'spotify' || b.provider === 'windows') c.provider = b.provider;
    if (typeof b.app === 'string') c.app = b.app.replace(/[^A-Za-z0-9_.!\-]/g, '').slice(0, 80) || 'auto';
    if (typeof b.spotifyClientId === 'string') c.spotifyClientId = b.spotifyClientId.replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
    if (b.requests !== undefined) c.requests = !!b.requests;
    if (['everyone', 'subscriber', 'vip', 'moderator'].includes(b.requestLevel)) c.requestLevel = b.requestLevel;
    ctx.persist();
    if (provider() !== prevProv || (provider() === 'windows' && c.app !== prevApp)) apply();
    return view();
  }
  function apply() {
    stopWindows(); stopSpotify(); cur = blank(); lastKey = '';
    if (provider() === 'spotify') startSpotify(); else startWindows();
    ctx.broadcast('media', view());
  }
  function labels() {
    const c = cur, mm = (ms) => Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    const live = c.status === 'playing' ? Math.min(c.durationMs || 1e12, c.positionMs + (Date.now() - c.positionAt)) : c.positionMs;
    return {
      now_playing: { value: c.title ? (c.artist ? c.artist + ' - ' : '') + c.title : '', desc: 'Current song as "Artist - Title"' },
      now_playing_title: { value: c.title, desc: 'Current song title' }, now_playing_artist: { value: c.artist, desc: 'Current song artist' }, now_playing_album: { value: c.album, desc: 'Current song album' },
      now_playing_status: { value: c.status === 'none' ? '' : c.status.toUpperCase(), desc: 'PLAYING or PAUSED (blank when nothing is playing)' },
      now_playing_progress: { value: c.title && c.durationMs ? mm(live) + ' / ' + mm(c.durationMs) : '', desc: 'Song progress, e.g. 1:23 / 3:45' },
      now_playing_link: { value: c.link, desc: 'Spotify link to the current song' },
    };
  }
  return { start: () => apply(), stop: () => { stopWindows(); stopSpotify(); }, view, control, search, queue, playUri, settings, labels, connectSpotify, spotifyCallback,
    disconnectSpotify: () => { saveTokens(null); if (provider() === 'spotify') pollSpotify(); return { ok: true }; }, art: () => artBuf, state: () => cur, _poll: pollSpotify };
};
