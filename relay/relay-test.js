// The tip relay's PayPal handling, against a fake PayPal and a fake room. Run: node relay-test.js
import assert from 'node:assert';
import { handleIpn } from './src/index.js';

const sent = [];
const env = { PAYPAL_EMAIL: 'Streamer@Example.com', SANDBOX: 'false', CURRENCY: 'USD', ROOM: { idFromName: () => 'id', get: () => ({ fetch: async (_u, o) => { sent.push(JSON.parse(o.body)); return new Response('{}'); } }) } };
let verdict = 'VERIFIED', asked = null;
const paypal = async (url, o) => { asked = { url, body: o.body }; return new Response(verdict); };
const ipn = (o) => new URLSearchParams({ payment_status: 'Completed', txn_id: 'T1', receiver_email: 'streamer@example.com', mc_gross: '5.00', mc_currency: 'USD', custom: JSON.stringify({ n: 'Fan', m: 'hi' }), ...o }).toString();

assert.strictEqual(await handleIpn(ipn(), env, paypal), 'ok');
assert.deepStrictEqual(sent[0], { txnId: 'T1', name: 'Fan', msg: 'hi', amount: 5, currency: 'USD' });
assert.strictEqual(asked.url, 'https://ipnpb.paypal.com/cgi-bin/webscr'); assert.ok(asked.body.startsWith('cmd=_notify-validate&payment_status=Completed'), 'the message is sent back to PayPal to confirm');
assert.strictEqual(await handleIpn(ipn(), { ...env, SANDBOX: 'true' }, paypal), 'ok'); assert.match(asked.url, /sandbox/);

const n = sent.length;
verdict = 'INVALID'; assert.strictEqual(await handleIpn(ipn(), env, paypal), 'not verified by PayPal'); verdict = 'VERIFIED';
assert.strictEqual(await handleIpn(ipn({ receiver_email: 'someone@else.com' }), env, paypal), 'wrong receiver');
assert.strictEqual(await handleIpn(ipn({ payment_status: 'Pending' }), env, paypal), 'not completed');
assert.strictEqual(await handleIpn(ipn({ mc_gross: '-5.00' }), env, paypal), 'not an incoming payment');
assert.strictEqual(await handleIpn(ipn({ txn_id: '' }), env, paypal), 'not an incoming payment');
assert.strictEqual(await handleIpn(ipn(), { ...env, PAYPAL_EMAIL: '' }, paypal), 'wrong receiver');
assert.strictEqual(sent.length, n, 'nothing forged or unfinished reaches the app');

await handleIpn(ipn({ txn_id: 'T9', custom: 'not json' }), env, paypal); assert.strictEqual(sent.at(-1).name, 'Anonymous', 'a missing name is fine');
await handleIpn(ipn({ txn_id: 'T10', custom: JSON.stringify({ n: 'x'.repeat(100), m: 'y'.repeat(500) }) }), env, paypal); assert.deepStrictEqual([sent.at(-1).name.length, sent.at(-1).msg.length], [40, 200], 'long names and messages are cut');
console.log('relay test passed');
