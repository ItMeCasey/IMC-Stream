'use strict';
/**
 * Who may talk to the server.
 *  - This PC (OBS, the app window): always allowed, no password.
 *  - Other devices on your network: only if you switched on "control from other devices" AND set a password; then they must log in.
 *  - Requests whose Host header is not this machine (DNS-rebinding tricks from web pages) are always refused.
 */
const crypto = require('node:crypto');
const os = require('node:os');

module.exports = function createAccess(ctx) {
  // shortcut to the saved access settings (lan flag, password hash and salt)
  const A = () => ctx.state.access;
  const sessions = new Map();   // token -> expires
  const fails = new Map();      // ip -> [timestamps]
  // scrypt is slow on purpose, so guessing passwords from a stolen settings file is expensive
  const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
  // true for connections from this PC itself (no address at all counts too)
  const isLoopback = (ip) => !ip || ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
  // this PC's own IPv4 addresses, i.e. how other devices on the network reach it
  const lanIps = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4').map((i) => i.address);
  // Host-header check: stops a web page from reaching us through a made-up name that points at 127.0.0.1 (DNS rebinding)
  function hostAllowed(hostHeader) {
    const h = String(hostHeader || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (['localhost', '127.0.0.1', '::1', ''].includes(h) || /^[a-z0-9-]{1,40}\.localhost$/.test(h)) return true;   // overlays use <name>.localhost so each gets its own browser connection pool
    return !!A().lan && (lanIps().includes(h) || h === String(os.hostname()).toLowerCase() || h === String(os.hostname()).toLowerCase() + '.local');
  }
  // the 64-hex session token from the icm_session cookie, if there is one
  const cookieToken = (req) => /(?:^|;\s*)icm_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
  // a session is valid until its expiry time; an expired one is forgotten here
  const valid = (req) => { const t = cookieToken(req); const e = t && sessions.get(t); if (e && e > Date.now()) return true; if (t) sessions.delete(t); return false; };
  // the small self-contained login page for other devices (no extra files, since they cannot load any before logging in)
  const LOGIN = '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>IMC-Stream</title><body style="background:#222A2A;color:#E2DAC2;font-family:Bahnschrift,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0">' +
    '<form id=f style="background:#1A2020;padding:28px;border-left:8px solid #F39120;width:min(340px,90vw)"><h2 style="letter-spacing:5px;margin:0 0 14px;color:#4FBBBC">ITMECASEY</h2><input id=p type=password placeholder="Password" autofocus style="width:100%;font:inherit;padding:10px;background:#222A2A;color:#E2DAC2;border:2px solid #46504f">' +
    '<button style="margin-top:12px;width:100%;font:inherit;font-weight:700;padding:10px;background:#F39120;border:0;cursor:pointer;letter-spacing:2px">LOG IN</button><div id=e style="color:#EC4624;margin-top:10px;min-height:18px"></div></form>' +
    '<script>f.onsubmit=async(x)=>{x.preventDefault();const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:p.value})}).then(r=>r.json());if(r.ok)location.reload();else e.textContent=r.error||"Wrong password"}</script>';

  /** returns true when it already answered the request */
  function gate(req, res, p, body) {
    if (!hostAllowed(req.headers.host)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Blocked: unexpected Host header'); return true; }
    if (isLoopback(req.socket && req.socket.remoteAddress)) return false;
    const a = A();
    if (!a.lan || !a.hash) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Remote access is switched off. Turn it on in the app (Setup page) on the PC.'); return true; }
    if (valid(req)) return false;
    if (p === '/api/login') return false;   // handled by login()
    if (p.startsWith('/api/') || p === '/events') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"Not logged in"}'); return true; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(LOGIN); return true;
  }
  // password check: at most 5 wrong tries a minute per address, and timingSafeEqual so timing does not reveal how close a guess was
  function login(req, res, body) {
    for (const [k, v] of fails) if (!v.some((t) => Date.now() - t < 60000)) fails.delete(k);   // forget addresses with no recent failures, so the map cannot grow without end
    const ip = (req.socket && req.socket.remoteAddress) || '', now = Date.now(), list = (fails.get(ip) || []).filter((t) => now - t < 60000);
    const json = (code, o, h) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, h)); res.end(JSON.stringify(o)); };
    if (list.length >= 5) return json(429, { error: 'Too many tries: wait a minute' });
    const a = A(); let ok = false;
    if (a.hash) { try { ok = crypto.timingSafeEqual(Buffer.from(hash(body.password || '', a.salt), 'hex'), Buffer.from(a.hash, 'hex')); } catch (e) { ok = false; } }
    if (!ok) { list.push(now); fails.set(ip, list); return json(401, { error: 'Wrong password' }); }
    // session lasts 24 hours; HttpOnly + SameSite=Strict keep page scripts and other sites from using the cookie
    const t = crypto.randomBytes(32).toString('hex'); sessions.set(t, now + 86400e3);
    return json(200, { ok: true }, { 'Set-Cookie': 'icm_session=' + t + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400' });
  }
  /** only the PC itself may change these */
  function setSettings(b) {
    const a = A();
    if (typeof b.password === 'string' && b.password) { if (b.password.length < 8) throw new Error('Use at least 8 characters'); a.salt = crypto.randomBytes(16).toString('hex'); a.hash = hash(b.password, a.salt); sessions.clear(); }
    if (b.lan !== undefined) { if (b.lan && !a.hash) throw new Error('Set a password first'); a.lan = !!b.lan; }
    if (b.clearPassword) { a.hash = ''; a.salt = ''; a.lan = false; sessions.clear(); }
    ctx.persist(); return view();
  }
  // what the Setup page may see: never the hash or the salt
  const view = () => ({ lan: !!A().lan, hasPassword: !!A().hash, addresses: A().lan ? lanIps().map((i) => 'http://' + i + ':' + ctx.port()) : [] });
  // bindHost: only listen on the network when remote access is on and a password exists
  // end this device's session: forget the token and clear the cookie
  function logout(req, res) {
    const t = cookieToken(req); if (t) sessions.delete(t);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'icm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); res.end('{"ok":true}');
  }
  return { gate, login, logout, setSettings, view, hostAllowed, isLoopback, bindHost: () => (A().lan && A().hash ? '0.0.0.0' : '127.0.0.1'), _sessions: sessions };
};
