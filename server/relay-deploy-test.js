// Deploying the tip relay to a fake Cloudflare account. Run: node relay-deploy-test.js
const http = require('node:http'), path = require('node:path'), assert = require('node:assert');
const createRelayDeploy = require('./relay-deploy.js');
const PORT = 9951;
let accounts = [{ id: 'acct1', name: 'Casey' }], haveSubdomain = '', haveScript = false, uploads = [], enabled = [], deny = false;

const fake = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const buf = Buffer.concat(chunks);
  const j = (code, result, msg) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(code < 300 ? { success: true, result } : { success: false, errors: [{ message: msg || 'nope' }] })); };
  if (req.headers.authorization !== 'Bearer good-token' || deny) return j(403, null, 'Authentication error');
  const u = req.url, A = '/accounts/acct1/workers';
  if (u === '/accounts') return j(200, accounts);
  if (u === A + '/subdomain') { if (req.method === 'PUT') { haveSubdomain = JSON.parse(buf).subdomain; return j(200, { subdomain: haveSubdomain }); } return haveSubdomain ? j(200, { subdomain: haveSubdomain }) : j(404, null, 'no subdomain'); }
  if (u === A + '/scripts/itmecasey-tip-relay/settings') return haveScript ? j(200, {}) : j(404, null, 'not found');
  if (u === A + '/scripts/itmecasey-tip-relay' && req.method === 'PUT') {
    const fd = await new Response(buf, { headers: { 'content-type': req.headers['content-type'] } }).formData();
    uploads.push({ metadata: JSON.parse(await fd.get('metadata').text()), parts: [...fd.keys()].filter((k) => k !== 'metadata'), index: await fd.get('index.js').text() }); haveScript = true; return j(200, {});
  }
  if (u === A + '/scripts/itmecasey-tip-relay/subdomain') { enabled.push(JSON.parse(buf)); return j(200, { enabled: true }); }
  j(404, null, 'unknown ' + u);
});

(async () => {
  await new Promise((r) => fake.listen(PORT, '127.0.0.1', r));
  const d = createRelayDeploy({ root: path.resolve(__dirname, '..'), baseUrl: 'http://127.0.0.1:' + PORT });
  const base = { token: 'good-token', service: 'paypal', paypalEmail: 'me@example.com', relayKey: 'k'.repeat(48), streamerName: 'ItMeCasey', currency: 'cad' };
  const bind = (m, n) => m.bindings.find((b) => b.name === n);

  // first deploy: makes the workers.dev name, creates the storage class, sends all three script files
  let r = await d.deploy(base);
  assert.match(r.url, /^https:\/\/itmecasey-tip-relay\.icm-[0-9a-f]{8}\.workers\.dev$/); assert.strictEqual(r.updated, false);
  let m = uploads[0].metadata; assert.strictEqual(m.main_module, 'index.js');
  assert.deepStrictEqual(m.migrations, { new_tag: 'v1', new_sqlite_classes: ['Room'] }); assert.deepStrictEqual(uploads[0].parts.sort(), ['index.js', 'page.js', 'room.js']);
  assert.match(uploads[0].index, /handleIpn/, 'the real relay code is what gets uploaded');
  assert.deepStrictEqual([bind(m, 'ROOM').type, bind(m, 'RELAY_TOKEN').type, bind(m, 'RELAY_TOKEN').text], ['durable_object_namespace', 'secret_text', 'k'.repeat(48)]);
  assert.deepStrictEqual([bind(m, 'PAYPAL_EMAIL').text, bind(m, 'CURRENCY').text, bind(m, 'STREAMER_NAME').text, bind(m, 'SANDBOX').text], ['me@example.com', 'CAD', 'ItMeCasey', 'false']);
  assert.ok(!bind(m, 'KOFI_TOKEN') && !bind(m, 'KOFI_PAGE'), 'PayPal setup carries nothing from Ko-fi'); assert.deepStrictEqual(enabled[0], { enabled: true });

  // deploying again replaces the code only (the storage class already exists), and keeps the same address
  const first = r.url; r = await d.deploy(Object.assign({}, base, { service: 'kofi', kofiPage: 'https://ko-fi.com/ItMeKofi/?x=1', kofiToken: 'verify-token-123' }));
  assert.strictEqual(r.url, first); assert.strictEqual(r.updated, true);
  m = uploads[1].metadata; assert.strictEqual(m.migrations, undefined, 'no second migration');
  assert.deepStrictEqual([bind(m, 'KOFI_PAGE').text, bind(m, 'KOFI_TOKEN').type, bind(m, 'KOFI_TOKEN').text], ['ItMeKofi', 'secret_text', 'verify-token-123']); assert.ok(!bind(m, 'PAYPAL_EMAIL'));

  // friendly errors
  await assert.rejects(d.deploy(Object.assign({}, base, { token: 'wrong' })), /Edit Cloudflare Workers/);
  await assert.rejects(d.deploy({ ...base, token: '' }), /Paste your Cloudflare token/);
  await assert.rejects(d.deploy({ ...base, paypalEmail: 'not an email' }), /PayPal Business/);
  await assert.rejects(d.deploy({ ...base, service: 'kofi', kofiPage: 'me', kofiToken: 'short' }), /Verification Token/);
  accounts = [{ id: 'acct1', name: 'Casey' }, { id: 'acct2', name: 'Work' }]; await assert.rejects(d.deploy(base), /several Cloudflare accounts.*Account ID/);
  const n = uploads.length; await d.deploy({ ...base, accountId: 'acct1' }); assert.strictEqual(uploads.length, n + 1, 'an Account ID skips the lookup');
  fake.close(); console.log('relay deploy test passed'); process.exit(0);
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exit(1); });
