'use strict';
// Cross-site request rules, CORS and the bot's address filter. Run: node webguard-test.js
const assert = require('assert'), g = require('./webguard.js');

const H = (o) => Object.assign({ host: 'localhost:8420' }, o);
// who may change things
assert.ok(g.postAllowed(H({})), 'OBS / Stream Deck send no Origin');
assert.ok(g.postAllowed(H({ origin: 'http://localhost:8420' })) && g.postAllowed(H({ origin: 'http://127.0.0.1:8420' })), 'our own pages');
assert.ok(g.postAllowed(H({ origin: 'http://overlay1.localhost:8420' })), 'overlays use <name>.localhost');
assert.ok(g.postAllowed({ host: '192.168.1.20:8420', origin: 'http://192.168.1.20:8420' }), 'a phone on the LAN using its own page');
assert.ok(!g.postAllowed(H({ origin: 'null' })), 'Origin: null (sandboxed frame, data: page) is refused');
assert.ok(!g.postAllowed(H({ origin: 'https://evil.example' })), 'another site');
assert.ok(!g.postAllowed(H({ origin: 'http://localhost:3000' })), 'another local app on another port');
assert.ok(!g.postAllowed(H({ origin: 'http://localhost.evil.com:8420' })) && !g.postAllowed(H({ origin: 'http://evil.localhost.evil.com:8420' })));
assert.ok(!g.postAllowed(H({ origin: 'file:///C:/x.html' })) && !g.postAllowed(H({ origin: '' })));
assert.ok(!g.postAllowed(H({ 'sec-fetch-site': 'cross-site' })), 'a browser that says cross-site and sends no Origin');
assert.ok(g.postAllowed(H({ 'sec-fetch-site': 'same-origin' })) && g.postAllowed(H({ 'sec-fetch-site': 'none' })));

// CORS is never "*"
assert.deepEqual(g.cors(H({})), {}, 'no Origin: nothing to grant');
assert.deepEqual(g.cors(H({ origin: 'https://evil.example' })), {}, 'other sites cannot read responses');
assert.deepEqual(g.cors(H({ origin: 'null' })), {});
assert.equal(g.cors(H({ origin: 'http://ov.localhost:8420' }))['Access-Control-Allow-Origin'], 'http://ov.localhost:8420');

// addresses the bot may not fetch
for (const ip of ['127.0.0.1', '127.1.2.3', '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:192.168.0.9', 'not-an-ip'])
  assert.ok(g.blockedAddress(ip), 'blocked: ' + ip);
for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
  assert.ok(!g.blockedAddress(ip), 'allowed: ' + ip);

(async () => {
  const seen = [], resp = (status, loc, body) => ({ status, headers: { get: (k) => (k === 'location' ? loc : null) }, text: async () => body || '' });
  const lookup = async (h) => ({ 'good.example': [{ address: '93.184.216.34' }], 'internal.example': [{ address: '10.0.0.8' }], 'mixed.example': [{ address: '93.184.216.34' }, { address: '127.0.0.1' }], 'redir.example': [{ address: '93.184.216.34' }] }[h] || []);
  const fetchFn = async (u, o) => { seen.push(u); assert.equal(o.redirect, 'manual'); return u.includes('redir.example') ? resp(302, 'http://127.0.0.1:8420/api/diagnostics') : u.includes('hop.example') ? resp(302, 'http://good.example/ok') : resp(200, null, 'hello'); };
  assert.equal(await (await g.safeFetch('http://good.example/x', {}, fetchFn, lookup)).text(), 'hello');
  for (const bad of ['http://127.0.0.1:8420/api/diagnostics', 'http://[::1]/', 'http://internal.example/', 'http://mixed.example/', 'http://169.254.169.254/latest/meta-data/', 'http://nothing.example/', 'ftp://good.example/', 'not a url'])
    await assert.rejects(g.safeFetch(bad, {}, fetchFn, lookup), /blocked|only http|bad address/, 'refused: ' + bad);
  seen.length = 0; await assert.rejects(g.safeFetch('http://redir.example/', {}, fetchFn, lookup), /blocked/, 'a redirect into the PC is refused');
  assert.ok(!seen.some((u) => u.startsWith('http://127.0.0.1')), 'the private address is never requested');
  assert.equal(await (await g.safeFetch('http://good.example/hop.example', {}, async (u, o) => (u === 'http://good.example/hop.example' ? resp(302, 'http://good.example/ok') : resp(200, null, 'done')), lookup)).text(), 'done', 'a harmless redirect is followed');
  await assert.rejects(g.safeFetch('http://good.example/', {}, async () => resp(302, 'http://good.example/again'), lookup), /too many redirects/);
  console.log('webguard-test: ok');
})().catch((e) => { console.error(e); process.exit(1); });
