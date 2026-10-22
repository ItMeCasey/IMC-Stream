'use strict';
/**
 * Tips through PayPal.
 *  - PayPal.Me link: no keys, no address shown to tippers. Used by the !tip chat command and shown on the Tips page.
 *  - Log a tip yourself (one button) to fire the tip alert.
 *  - Optional auto-detect: PayPal's Transaction Search API with your own app's Client ID + Secret (kept in <data>/paypal.json).
 *    PayPal reports new payments there with a delay (minutes, sometimes hours), so this is for "catch every tip", not instant alerts.
 */
const fs = require('node:fs');
const path = require('node:path');

module.exports = function createPaypal(ctx) {
  const state = ctx.state, log = ctx.log || (() => {}), FILE = path.join(ctx.DATA, 'paypal.json'), doFetch = ctx.fetch || fetch;
  const BASE = ctx.baseUrl || process.env.ICM_PAYPAL_URL || 'https://api-m.paypal.com';
  const P = () => state.paypal;
  let creds = null; try { creds = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* none yet */ }
  let token = null, status = { ok: null, error: '', lastPoll: 0, tips: 0 }, timer = null;
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

  const meClean = (v) => String(v || '').trim().replace(/^https?:\/\/(www\.)?paypal\.me\//i, '').replace(/^paypal\.me\//i, '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
  const link = (amount) => (P().me ? 'https://paypal.me/' + P().me + (amount ? '/' + amount + P().currency : '') : '');
  const view = () => ({ me: P().me, currency: P().currency, suggest: P().suggest, link: link(), links: P().suggest.map((a) => ({ amount: a, url: link(a) })), note: P().note,
    api: { configured: !!(creds && creds.clientId && creds.secret), clientIdHint: creds && creds.clientId ? creds.clientId.slice(0, 6) + '…' : '', status }, recent: P().recent.slice(0, 20) });

  function save(b) {
    const p = P();
    if (b.me !== undefined) p.me = meClean(b.me);
    if (b.currency !== undefined) p.currency = /^[A-Za-z]{3}$/.test(b.currency) ? String(b.currency).toUpperCase() : p.currency;
    if (b.suggest !== undefined) p.suggest = String(b.suggest).split(/[ ,]+/).map(Number).filter((n) => n > 0 && n <= 10000).slice(0, 5);
    if (b.note !== undefined) p.note = str(b.note, 200);
    ctx.persist(); return view();
  }
  function setCreds(b) {
    if (b.clear) { creds = null; try { fs.unlinkSync(FILE); } catch (e) { /* none */ } token = null; stop(); return view(); }
    const clientId = str(b.clientId, 200), secret = str(b.secret, 300);
    if (!clientId || !secret) throw new Error('Enter both the Client ID and the Secret');
    creds = { clientId, secret }; token = null; fs.writeFileSync(FILE, JSON.stringify(creds)); P().since = 0; P().seen = []; start(); return view();
  }
  function logTip(b) {
    const amount = Number(b.amount); if (!(amount > 0)) throw new Error('Enter the amount');
    const rec = { name: str(b.name, 40) || 'Anonymous', amount, currency: P().currency, msg: str(b.msg, 200), at: Date.now(), manual: true };
    ctx.recordTip(rec); P().recent.unshift(rec); P().recent.length = Math.min(P().recent.length, 50); ctx.persist(true); return { ok: true };
  }

  async function getToken() {
    if (token && token.exp > Date.now() + 60000) return token.v;
    const r = await doFetch(BASE + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(creds.clientId + ':' + creds.secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || 'PayPal refused the login (check the Client ID and Secret, and that it is a Live app)');
    token = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 }; return token.v;
  }
  async function poll() {
    if (!creds) return;
    try {
      const tk = await getToken(), end = new Date(), start = new Date((P().since || Date.now()) - 36 * 3600e3);   // look back a day and a half: PayPal reports late
      const url = BASE + '/v1/reporting/transactions?start_date=' + start.toISOString().replace(/\.\d+Z$/, '-0000') + '&end_date=' + end.toISOString().replace(/\.\d+Z$/, '-0000') + '&fields=transaction_info,payer_info&page_size=100';
      const r = await doFetch(url, { headers: { Authorization: 'Bearer ' + tk } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 403 ? 'Your PayPal app needs the "Transaction Search" feature turned on (developer.paypal.com > your app > Features)' : j.message || 'HTTP ' + r.status);
      const baseline = !P().since, fresh = [];
      for (const t of (j.transaction_details || []).slice().reverse()) {
        const ti = t.transaction_info || {}, id = ti.transaction_id, amt = Number(ti.transaction_amount && ti.transaction_amount.value);
        if (!id || P().seen.includes(id)) continue; P().seen.push(id);
        if (!baseline && ti.transaction_status === 'S' && amt > 0 && /^T00/.test(ti.transaction_event_code || '')) {
          const pi = t.payer_info || {}, nm = (pi.payer_name && (pi.payer_name.alternate_full_name || [pi.payer_name.given_name, pi.payer_name.surname].filter(Boolean).join(' '))) || '';
          fresh.push({ name: str(nm, 40) || 'Anonymous', amount: amt, currency: ti.transaction_amount.currency_code, msg: str(ti.transaction_note || ti.transaction_subject, 200), at: Date.now() });
        }
      }
      if (!P().since) P().since = Date.now(); P().seen = P().seen.slice(-400);
      for (const f of fresh) { ctx.recordTip(f); P().recent.unshift(f); status.tips++; } P().recent.length = Math.min(P().recent.length, 50);
      status.ok = true; status.error = ''; ctx.persist(true);
    } catch (e) { status.ok = false; status.error = e.message; if (!poll.warned) { log('PayPal check failed:', e.message); poll.warned = true; } }
    status.lastPoll = Date.now();
  }
  function start() { stop(); if (!creds) return; poll(); timer = setInterval(poll, ctx.pollMs || 120000); if (timer.unref) timer.unref(); }
  function stop() { clearInterval(timer); timer = null; }
  return { view, save, setCreds, logTip, poll, start, stop, link };
};
