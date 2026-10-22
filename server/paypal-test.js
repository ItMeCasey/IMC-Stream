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
  const state = { paypal: { currency: 'USD', note: '', since: 0, seen: [], recent: [] } }, tips = []; let saved = 0;
  class FakeWS { constructor(url) { this.url = url; this.sent = []; FakeWS.last = this; setTimeout(() => this.onopen && this.onopen(), 0); } send(d) { this.sent.push(d); } close() { this.closed = true; } }
  const pp = createPaypal({ DATA, state, persist: () => { saved++; }, log: () => {}, recordTip: (t) => tips.push(t), baseUrl: 'http://127.0.0.1:' + PORT, pollMs: 300, WebSocket: FakeWS });

  // currency; there is no tip link until the relay is connected
  assert.strictEqual(pp.link(), ''); pp.save({ currency: 'xx' }); assert.strictEqual(state.paypal.currency, 'USD', 'a bad currency is ignored'); pp.save({ currency: 'cad' }); assert.strictEqual(pp.view().currency, 'CAD');
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
  // which service the streamer sets up: PayPal unless they pick Ko-fi
  assert.strictEqual(pp.view().service, 'paypal'); pp.save({ service: 'kofi' }); assert.strictEqual(pp.view().service, 'kofi'); pp.save({ service: 'bogus' }); assert.strictEqual(pp.view().service, 'paypal');
  // deploying the relay: the Cloudflare token is passed along once and never kept; the app connects to the new address
  let deployed = null; const pp2 = createPaypal({ DATA, state, persist: () => {}, log: () => {}, recordTip: () => {}, WebSocket: FakeWS, pollMs: 1e9,
    relayDeploy: { deploy: async (b) => { deployed = b; return { url: 'https://itmecasey-tip-relay.me.workers.dev', accountId: 'acct1', updated: false }; } } });
  const out = await pp2.deployRelay({ token: 'cf-secret-token', paypalEmail: 'me@example.com', streamerName: 'ItMeCasey' });
  assert.strictEqual(deployed.token, 'cf-secret-token'); assert.strictEqual(deployed.service, 'paypal'); assert.match(deployed.relayKey, /^[0-9a-f]{48}$/);
  assert.strictEqual(out.relay.url, 'https://itmecasey-tip-relay.me.workers.dev'); assert.strictEqual(out.relay.config.paypalEmail, 'me@example.com');
  assert.ok(!fs.readFileSync(path.join(DATA, 'paypal-relay.json'), 'utf8').includes('cf-secret-token') && !JSON.stringify(out).includes('cf-secret-token'), 'the Cloudflare token is never saved or shown');
  assert.strictEqual(pp2.view().link, 'https://itmecasey-tip-relay.me.workers.dev/'); pp2.stop(); pp.setRelay({ clear: true });
  // instant tips through the streamer's own relay
  assert.throws(() => pp.setRelay({ url: 'not a url' }), /web address/); assert.throws(() => pp.setRelay({ url: 'http://relay.example.com' }), /https/);
  const key = pp.relayKey(); assert.match(key, /^[0-9a-f]{48}$/); assert.strictEqual(pp.relayKey(), key, 'the key stays the same');
  assert.ok(!JSON.stringify(state).includes(key) && fs.existsSync(path.join(DATA, 'paypal-relay.json')), 'the key is on disk, never in the settings');
  assert.strictEqual(pp.setRelay({ url: 'https://relay.example.workers.dev/some/path' }).relay.url, 'https://relay.example.workers.dev', 'only the address is kept');
  assert.strictEqual(pp.link(), 'https://relay.example.workers.dev/', 'the tip link is the relay tip page'); assert.strictEqual(pp.view().link, pp.link());
  await sleep(50); const ws = FakeWS.last; assert.strictEqual(ws.url, 'wss://relay.example.workers.dev/ws?token=' + key); assert.strictEqual(pp.view().relay.status.connected, true);
  const before = tips.length, relayTip = { type: 'tip', txnId: 'R1', source: 'kofi', name: 'Fast Fan', msg: 'instant!', amount: 9, currency: 'usd' };
  ws.onmessage({ data: JSON.stringify(relayTip) });
  assert.strictEqual(tips.length, before + 1); assert.deepStrictEqual([tips[before].name, tips[before].amount, tips[before].currency, tips[before].msg], ['Fast Fan', 9, 'USD', 'instant!']);
  assert.strictEqual(pp.view().recent[0].source, 'kofi', 'the tip remembers where it came from');
  assert.deepStrictEqual(JSON.parse(ws.sent[ws.sent.length - 1]), { ack: 'R1' }, 'the relay is told the tip arrived');
  ws.onmessage({ data: JSON.stringify(relayTip) }); ws.onmessage({ data: 'junk' }); ws.onmessage({ data: JSON.stringify({ type: 'tip', txnId: 'R2', amount: -3 }) });
  assert.strictEqual(tips.length, before + 1, 'a resent, broken or negative tip never alerts again'); assert.strictEqual(ws.sent.filter((s) => s.includes('R1')).length, 2, 'but a resent tip is still acknowledged');
  ws.onclose(); await sleep(50); assert.strictEqual(pp.view().relay.status.connected, false, 'a dropped connection is noticed (and retried)');
  pp.setRelay({ clear: true }); assert.strictEqual(pp.view().relay.url, ''); assert.strictEqual(pp.link(), '', 'no tip link once disconnected'); const last = FakeWS.last; await sleep(50); assert.strictEqual(FakeWS.last, last, 'no reconnecting after disconnect');
  pp.stop(); fake.close();
  console.log('paypal test passed');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
