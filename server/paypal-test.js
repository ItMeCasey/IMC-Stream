// PayPal tips against a fake PayPal API. Run: node paypal-test.js
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert');
const createPaypal = require('./paypal.js');
const PORT = 9947, DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-pp-')); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let txs = [], tokenCalls = 0, denied = false, authHeaders = [];
const fake = http.createServer((req, res) => {
  const j = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/v1/oauth2/token') { tokenCalls++; authHeaders.push(req.headers.authorization); return Buffer.from(req.headers.authorization.slice(6), 'base64').toString() === 'cid:secret' ? j(200, { access_token: 'TOKEN', expires_in: 3000 }) : j(401, { error_description: 'Client Authentication failed' }); }
  if (req.url.startsWith('/v1/reporting/transactions')) { if (req.headers.authorization !== 'Bearer TOKEN') return j(401, {}); if (denied) return j(403, { message: 'NOT_AUTHORIZED' }); return j(200, { transaction_details: txs }); }
  j(404, {});
});
const tx = (id, amt, name, note, extra) => ({ transaction_info: Object.assign({ transaction_id: id, transaction_event_code: 'T0006', transaction_status: 'S', transaction_amount: { value: String(amt), currency_code: 'USD' }, transaction_note: note }, extra), payer_info: { payer_name: { alternate_full_name: name } } });

(async () => {
  await new Promise((r) => fake.listen(PORT, '127.0.0.1', r));
  const state = { paypal: { me: '', currency: 'USD', suggest: [5, 10, 20], note: '', since: 0, seen: [], recent: [] } }, tips = []; let saved = 0;
  const pp = createPaypal({ DATA, state, persist: () => { saved++; }, log: () => {}, recordTip: (t) => tips.push(t), baseUrl: 'http://127.0.0.1:' + PORT, pollMs: 300 });

  // PayPal.Me link
  assert.strictEqual(pp.link(), ''); pp.save({ me: 'https://www.paypal.me/ItMe Casey!' }); assert.strictEqual(state.paypal.me, 'ItMeCasey', 'url and junk characters are cleaned');
  pp.save({ me: 'paypal.me/ItMeCasey', currency: 'cad', suggest: '5, 10 abc 25' }); assert.strictEqual(pp.link(), 'https://paypal.me/ItMeCasey'); assert.strictEqual(pp.link(10), 'https://paypal.me/ItMeCasey/10CAD');
  assert.deepStrictEqual(pp.view().suggest, [5, 10, 25]); assert.strictEqual(pp.view().links[1].url, 'https://paypal.me/ItMeCasey/10CAD');
  // logging a tip by hand
  assert.throws(() => pp.logTip({ amount: 0 }), /amount/); pp.logTip({ name: 'Sam', amount: '7.5', msg: 'hi' });
  assert.deepStrictEqual([tips[0].name, tips[0].amount, tips[0].currency, tips[0].msg], ['Sam', 7.5, 'CAD', 'hi']); assert.strictEqual(pp.view().recent[0].manual, true);

  // keys: need both; stored on disk, never in the settings
  assert.throws(() => pp.setCreds({ clientId: 'cid' }), /both/); pp.setCreds({ clientId: 'cid', secret: 'wrong' }); await sleep(250);
  assert.strictEqual(pp.view().api.status.ok, false); assert.match(pp.view().api.status.error, /refused|Authentication/, 'bad keys are explained');
  assert.ok(!JSON.stringify(state).includes('wrong') && fs.existsSync(path.join(DATA, 'paypal.json')));
  txs = [tx('OLD1', 5, 'Old Tipper', 'before the app'), tx('REFUND', -5, 'x', '', { transaction_event_code: 'T1107' })];
  pp.setCreds({ clientId: 'cid', secret: 'secret' }); await sleep(250);
  assert.strictEqual(pp.view().api.status.ok, true); assert.strictEqual(tips.length, 1, 'the first look is a baseline: old payments never alert');
  // new payments alert once, with the right details; refunds and pending ones are ignored
  txs = [tx('NEW1', '12.00', 'Generous Gamer', 'Keep it up!'), tx('PEND', 3, 'Pending', '', { transaction_status: 'P' }), tx('OUT', -4, 'Me', '', { transaction_event_code: 'T0400' }), ...txs];
  await sleep(700);
  const got = tips.slice(1); assert.strictEqual(got.length, 1, 'only the real incoming payment: ' + JSON.stringify(got)); assert.deepStrictEqual([got[0].name, got[0].amount, got[0].currency, got[0].msg], ['Generous Gamer', 12, 'USD', 'Keep it up!']);
  await sleep(700); assert.strictEqual(tips.length, 2, 'never alerts twice for the same payment'); assert.strictEqual(tokenCalls >= 2 && tokenCalls < 12, true, 'login token is reused');
  // missing Transaction Search feature is explained
  denied = true; await sleep(500); assert.match(pp.view().api.status.error, /Transaction Search/);
  pp.setCreds({ clear: true }); assert.strictEqual(pp.view().api.configured, false); assert.ok(!fs.existsSync(path.join(DATA, 'paypal.json'))); const n = tokenCalls; await sleep(600); assert.strictEqual(tokenCalls, n, 'stops checking when the keys are removed');
  pp.stop(); fake.close();
  console.log('paypal test passed');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
