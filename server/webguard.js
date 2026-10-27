'use strict';
/**
 * Keeps web pages on other sites from using this server through the browser.
 *  - postAllowed: a state-changing request must come from this app's own pages (or from a program that sends no Origin, like OBS or a Stream Deck).
 *    "Origin: null" (sandboxed frames, data: pages) and any other site are refused.
 *  - cors: cross-origin reads are only granted to this app's own pages (the overlays run on <name>.localhost), never to a whole-internet "*".
 *  - blockedAddress / safeFetch: the chat bot's $(urlfetch) may not reach this PC, the home network or link-local addresses.
 */
const dns = require('node:dns').promises;
const net = require('node:net');

const LOCAL_NAME = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]{1,40}\.localhost)$/i;
const portOf = (u) => u.port || (u.protocol === 'https:' ? '443' : '80');

/** is this Origin one of our own pages? Same host as the request, or a local name on the same port as the Host header. */
function localOrigin(origin, hostHeader) {
  let U; try { U = new URL(String(origin)); } catch (e) { return false; }
  if (U.protocol !== 'http:' && U.protocol !== 'https:') return false;
  const h = String(hostHeader || '').toLowerCase();
  if (U.host.toLowerCase() === h) return true;
  let hp = ''; try { hp = portOf(new URL('http://' + h)); } catch (e) { return false; }
  return LOCAL_NAME.test(U.hostname) && portOf(U) === hp;
}

/** may this request change anything? (headers = req.headers) */
function postAllowed(headers) {
  const o = headers.origin;
  if (o !== undefined) return localOrigin(o, headers.host);   // includes "null", which fails to parse
  const site = String(headers['sec-fetch-site'] || '').toLowerCase();
  return site === '' || site === 'same-origin' || site === 'same-site' || site === 'none';   // a browser that says "cross-site" is a web page on another site
}

/** response headers that let one of our own pages read a response from another of our own origins; nothing for anybody else */
function cors(headers) {
  const o = headers && headers.origin;
  return o !== undefined && localOrigin(o, headers.host) ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : {};
}

/** an address no chat-triggered request may reach: this PC, private networks, link-local (incl. cloud metadata), carrier-grade NAT, multicast, unspecified */
function blockedAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && ip.startsWith('192.0.0.')) || (a === 198 && (b === 18 || b === 19));
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x); if (m) return blockedAddress(m[1]);   // IPv4 written as IPv6
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');   // unique-local, link-local, multicast
  }
  return true;   // not an address at all
}

/** fetch a URL, but only from public addresses; redirects are followed by hand so each hop is checked too. Returns the Response, or throws. */
async function safeFetch(url, opts, fetchFn, lookup) {
  const look = lookup || ((h) => dns.lookup(h, { all: true }));
  let cur = String(url);
  for (let hop = 0; hop < 4; hop++) {
    let U; try { U = new URL(cur); } catch (e) { throw new Error('bad address'); }
    if (U.protocol !== 'http:' && U.protocol !== 'https:') throw new Error('only http(s) addresses');
    const host = U.hostname.replace(/^\[|\]$/g, ''), addrs = net.isIP(host) ? [{ address: host }] : await look(host);
    if (!addrs.length || addrs.some((a) => blockedAddress(a.address))) throw new Error('blocked address');
    const r = await fetchFn(cur, Object.assign({}, opts, { redirect: 'manual' }));
    if (r.status >= 300 && r.status < 400 && r.headers && r.headers.get('location')) { cur = new URL(r.headers.get('location'), cur).href; continue; }
    return r;
  }
  throw new Error('too many redirects');
}

module.exports = { localOrigin, postAllowed, cors, blockedAddress, safeFetch };
