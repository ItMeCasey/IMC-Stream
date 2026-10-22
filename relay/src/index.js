export { Room } from './room.js';

const VERIFY_URL = { live: 'https://ipnpb.paypal.com/cgi-bin/webscr', sandbox: 'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr' };
const room = (env) => env.ROOM.get(env.ROOM.idFromName('main'));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/ipn' && request.method === 'POST') {
      const raw = await request.text();
      ctx.waitUntil(handleIpn(raw, env).then((r) => r !== 'ok' && console.warn('ipn ignored:', r), (e) => console.error('ipn failed', e)));
      return new Response('OK');   // PayPal wants a fast 200
    }

    if (url.pathname === '/ws') {
      if (!env.RELAY_TOKEN || url.searchParams.get('token') !== env.RELAY_TOKEN) return new Response('Forbidden', { status: 403 });
      return room(env).fetch(new Request('https://room/ws', request));
    }

    if (url.pathname === '/config') {
      return Response.json({ business: env.PAYPAL_EMAIL, sandbox: env.SANDBOX === 'true', streamer: env.STREAMER_NAME, currency: env.CURRENCY || 'USD', notifyUrl: url.origin + '/ipn' });
    }
    return new Response('Not found', { status: 404 });
  },
};

// Returns 'ok' when the tip was passed on, otherwise the reason it was ignored.
export async function handleIpn(raw, env, doFetch = fetch) {
  const p = new URLSearchParams(raw);

  if (env.DEV_SKIP_VERIFY !== 'true') {
    const res = await doFetch(env.SANDBOX === 'true' ? VERIFY_URL.sandbox : VERIFY_URL.live, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'cmd=_notify-validate&' + raw,
    });
    if ((await res.text()).trim() !== 'VERIFIED') return 'not verified by PayPal';
  }

  const receiver = (p.get('receiver_email') || p.get('business') || '').toLowerCase();
  if (!env.PAYPAL_EMAIL || receiver !== env.PAYPAL_EMAIL.toLowerCase()) return 'wrong receiver';
  if (p.get('payment_status') !== 'Completed') return 'not completed';
  const amount = Number(p.get('mc_gross'));
  if (!(amount > 0) || !p.get('txn_id')) return 'not an incoming payment';

  let name = 'Anonymous', msg = '';
  try { const c = JSON.parse(p.get('custom') || '{}'); name = String(c.n || name).slice(0, 40); msg = String(c.m || '').slice(0, 200); } catch { /* plain text */ }

  await room(env).fetch('https://room/broadcast', { method: 'POST', body: JSON.stringify({ txnId: p.get('txn_id'), name, msg, amount, currency: p.get('mc_currency') || env.CURRENCY || 'USD' }) });
  return 'ok';
}
