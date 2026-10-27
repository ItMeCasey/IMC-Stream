import page from './page.js';
export { Room } from './room.js';

const VERIFY_URL = { live: 'https://ipnpb.paypal.com/cgi-bin/webscr', sandbox: 'https://ipnpb.sandbox.paypal.com/cgi-bin/webscr' };
const room = (env) => env.ROOM.get(env.ROOM.idFromName('main'));
// A streamer who only uses one service leaves the other's boxes empty (or types "none" when the deploy form insists on something).
const paypalEmail = (env) => (/^\S+@\S+$/.test(env.PAYPAL_EMAIL || '') ? env.PAYPAL_EMAIL : '');
const kofiPage = (env) => (/^[A-Za-z0-9_.-]{1,60}$/.test(env.KOFI_PAGE || '') && !/^none$/i.test(env.KOFI_PAGE) ? env.KOFI_PAGE : '');
const kofiToken = (env) => ((env.KOFI_TOKEN || '').length >= 8 ? env.KOFI_TOKEN : '');

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // PayPal and Ko-fi both want a fast 200, so the real work happens after replying.
    for (const [path, handler] of [['/ipn', handleIpn], ['/kofi', handleKofi]]) {
      if (url.pathname === path && request.method === 'POST') {
        if (Number(request.headers.get('content-length') || 0) > 20000) return new Response('Too large', { status: 413 });   // real PayPal / Ko-fi notifications are a few KB
        const raw = await request.text(); if (raw.length > 20000) return new Response('Too large', { status: 413 });
        ctx.waitUntil(handler(raw, env).then((r) => r !== 'ok' && console.warn(path, 'ignored:', r), (e) => console.error(path, 'failed', e)));
        return new Response('OK');
      }
    }

    if (url.pathname === '/' && request.method === 'GET') return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

    if (url.pathname === '/ws') {
      if (!env.RELAY_TOKEN || !same(String(url.searchParams.get('token') || ''), env.RELAY_TOKEN)) return new Response('Forbidden', { status: 403 });
      return room(env).fetch(new Request('https://room/ws', request));
    }

    if (url.pathname === '/config') {
      return Response.json({ business: paypalEmail(env), kofi: kofiPage(env), sandbox: env.SANDBOX === 'true', streamer: env.STREAMER_NAME, currency: env.CURRENCY || 'USD', notifyUrl: url.origin + '/ipn' });
    }
    return new Response('Not found', { status: 404 });
  },
};

const forward = async (env, tip) => { await room(env).fetch('https://room/broadcast', { method: 'POST', body: JSON.stringify(tip) }); return 'ok'; };

// Returns 'ok' when the tip was passed on, otherwise the reason it was ignored.
export async function handleIpn(raw, env, doFetch = fetch) {
  const p = new URLSearchParams(raw);
  if (!p.get('txn_id')) return 'not an incoming payment';   // checked before PayPal is asked, so junk posts cost nothing

  if (env.DEV_SKIP_VERIFY !== 'true') {
    const res = await doFetch(env.SANDBOX === 'true' ? VERIFY_URL.sandbox : VERIFY_URL.live, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'cmd=_notify-validate&' + raw,
    });
    if ((await res.text()).trim() !== 'VERIFIED') return 'not verified by PayPal';
  }

  const receiver = (p.get('receiver_email') || p.get('business') || '').toLowerCase();
  if (!paypalEmail(env) || receiver !== paypalEmail(env).toLowerCase()) return 'wrong receiver';
  if (p.get('payment_status') !== 'Completed') return 'not completed';
  const amount = Number(p.get('mc_gross'));
  if (!(amount > 0) || !p.get('txn_id')) return 'not an incoming payment';

  let name = 'Anonymous', msg = '';
  try { const c = JSON.parse(p.get('custom') || '{}'); name = String(c.n || name).slice(0, 40); msg = String(c.m || '').slice(0, 200); } catch { /* plain text */ }

  return forward(env, { txnId: p.get('txn_id'), source: 'paypal', name, msg, amount, currency: p.get('mc_currency') || env.CURRENCY || 'USD' });
}

// Ko-fi posts a form field "data" holding JSON; its verification_token proves it came from the streamer's Ko-fi.
export async function handleKofi(raw, env) {
  let d; try { d = JSON.parse(new URLSearchParams(raw).get('data')); } catch { return 'not Ko-fi data'; }
  if (!d || !kofiToken(env) || !same(String(d.verification_token || ''), kofiToken(env))) return 'wrong verification token';
  if (d.type !== 'Donation') return 'not a donation';
  const amount = Number(d.amount);
  if (!(amount > 0) || !d.message_id) return 'not an incoming payment';

  const open = d.is_public !== false;   // a private donation keeps its name and message off the stream
  return forward(env, { txnId: 'kofi:' + d.message_id, source: 'kofi', name: open ? String(d.from_name || 'Anonymous').slice(0, 40) : 'Anonymous', msg: open ? String(d.message || '').slice(0, 200) : '', amount, currency: d.currency || env.CURRENCY || 'USD' });
}

function same(a, b) {   // compares without stopping at the first difference
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
