'use strict';
/**
 * Tips through PayPal.
 *  - Tip link: the streamer's own tip page (relay/), used by the !tip chat command and shown on the Tips page.
 *  - Log a tip yourself (one button) to fire the tip alert.
 *  - Optional auto-detect: PayPal's Transaction Search API with your own app's Client ID + Secret (kept in <data>/paypal.json).
 *    PayPal reports new payments there with a delay (minutes, sometimes hours), so this is for "catch every tip", not instant alerts.
 *  - Instant alerts: the tip relay (relay/) that this app deploys to the streamer's own Cloudflare account (see relay-deploy.js). PayPal calls the relay the moment a
 *    tip is paid, and this app keeps an outgoing connection to it, so nothing on this PC has to be reachable from the internet.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = function createPaypal(ctx) {
  const state = ctx.state, log = ctx.log || (() => {}), FILE = path.join(ctx.DATA, 'paypal.json'), doFetch = ctx.fetch || fetch;
  const BASE = ctx.baseUrl || process.env.ICM_PAYPAL_URL || 'https://api-m.paypal.com';
  // the saved tip settings (currency, recent tips, ids already seen)
  const P = () => state.paypal;
  // creds: the streamer's own PayPal app Client ID + Secret, kept in paypal.json and never sent to the page
  let creds = null; try { creds = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* none yet */ }
  let token = null, status = { ok: null, error: '', lastPoll: 0, tips: 0 }, timer = null;
  // relay: address and shared key of the streamer's tip relay (paypal-relay.json); the r* variables are its live connection
  const RFILE = path.join(ctx.DATA, 'paypal-relay.json'), WS = ctx.WebSocket || globalThis.WebSocket;
  let relay = { url: '', token: '' }; try { relay = Object.assign(relay, JSON.parse(fs.readFileSync(RFILE, 'utf8'))); } catch (e) { /* none yet */ }
  let rws = null, rtimer = null, rping = null, rgen = 0, rfail = 0, rstatus = { connected: false, error: '', tips: 0 };
  // tidy untrusted text: collapse whitespace, trim, cap the length
  const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

  const link = () => (relay.url ? relay.url + '/' : '');   // the streamer's own tip page
  // what the Tips page gets: never the secret, only a short hint of the Client ID
  const view = () => ({ currency: P().currency, service: P().service === 'kofi' ? 'kofi' : 'paypal', link: link(), note: P().note,
    api: { configured: !!(creds && creds.clientId && creds.secret), clientIdHint: creds && creds.clientId ? creds.clientId.slice(0, 6) + '…' : '', status },
    relay: { url: relay.url, hasKey: !!relay.token, config: relay.config || {}, status: rstatus }, recent: P().recent.slice(0, 20) });

  // tip settings from the page: service, currency (3 letters) and the note
  function save(b) {
    const p = P();
    if (b.service !== undefined) p.service = b.service === 'kofi' ? 'kofi' : 'paypal';
    if (b.currency !== undefined) p.currency = /^[A-Za-z]{3}$/.test(b.currency) ? String(b.currency).toUpperCase() : p.currency;
    if (b.note !== undefined) p.note = str(b.note, 200);
    ctx.persist(); return view();
  }
  // store or clear the PayPal app login; a new login starts checking from scratch
  function setCreds(b) {
    if (b.clear) { creds = null; try { fs.unlinkSync(FILE); } catch (e) { /* none */ } token = null; pollStop(); return view(); }
    const clientId = str(b.clientId, 200), secret = str(b.secret, 300);
    if (!clientId || !secret) throw new Error('Enter both the Client ID and the Secret');
    creds = { clientId, secret }; token = null; fs.writeFileSync(FILE, JSON.stringify(creds)); P().since = 0; P().seen = []; start(); return view();
  }
  // a tip typed in by hand fires the same alert as a real one
  function logTip(b) {
    const amount = Number(b.amount); if (!(amount > 0)) throw new Error('Enter the amount');
    const rec = { name: str(b.name, 40) || 'Anonymous', amount, currency: P().currency, msg: str(b.msg, 200), at: Date.now(), manual: true };
    ctx.recordTip(rec); P().recent.unshift(rec); P().recent.length = Math.min(P().recent.length, 50); ctx.persist(true); return { ok: true };
  }

  // OAuth token for the Transaction Search API, reused until a minute before it expires
  async function getToken() {
    if (token && token.exp > Date.now() + 60000) return token.v;
    const r = await doFetch(BASE + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(creds.clientId + ':' + creds.secret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || 'PayPal refused the login (check the Client ID and Secret, and that it is a Live app)');
    token = { v: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 }; return token.v;
  }
  // ask PayPal for recent payments and alert the new ones
  async function poll() {
    if (!creds) return;
    try {
      const tk = await getToken(), end = new Date(), start = new Date((P().since || Date.now()) - 36 * 3600e3);   // look back a day and a half: PayPal reports late
      const url = BASE + '/v1/reporting/transactions?start_date=' + start.toISOString().replace(/\.\d+Z$/, '-0000') + '&end_date=' + end.toISOString().replace(/\.\d+Z$/, '-0000') + '&fields=transaction_info,payer_info&page_size=100';
      const r = await doFetch(url, { headers: { Authorization: 'Bearer ' + tk } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 403 ? 'Your PayPal app needs the "Transaction Search" feature turned on (developer.paypal.com > your app > Features)' : j.message || 'HTTP ' + r.status);
      // the very first check only remembers what is already there, so old payments do not all fire alerts
      const baseline = !P().since, fresh = [];
      for (const t of (j.transaction_details || []).slice().reverse()) {
        const ti = t.transaction_info || {}, id = ti.transaction_id, amt = Number(ti.transaction_amount && ti.transaction_amount.value);
        if (!id || P().seen.includes(id)) continue; P().seen.push(id);
        // only completed (S) incoming payments count: event codes T00xx are payments received
        if (!baseline && ti.transaction_status === 'S' && amt > 0 && /^T00/.test(ti.transaction_event_code || '')) {
          const pi = t.payer_info || {}, nm = (pi.payer_name && (pi.payer_name.alternate_full_name || [pi.payer_name.given_name, pi.payer_name.surname].filter(Boolean).join(' '))) || '';
          fresh.push({ name: str(nm, 40) || 'Anonymous', amount: amt, currency: ti.transaction_amount.currency_code, msg: str(ti.transaction_note || ti.transaction_subject, 200), at: Date.now() });
        }
      }
      // the list of seen ids is capped so the file stays small
      if (!P().since) P().since = Date.now(); P().seen = P().seen.slice(-400);
      for (const f of fresh) { ctx.recordTip(f); P().recent.unshift(f); status.tips++; } P().recent.length = Math.min(P().recent.length, 50);
      status.ok = true; status.error = ''; ctx.persist(true);
    } catch (e) { status.ok = false; status.error = e.message; if (!poll.warned) { log('PayPal check failed:', e.message); poll.warned = true; } }
    status.lastPoll = Date.now();
  }
  // stop the slow PayPal check
  function pollStop() { clearInterval(timer); timer = null; }
  // connect the relay and, when a PayPal login exists, start the slow check
  function start() { pollStop(); if (!rws && !rtimer) relayConnect(); if (!creds) return; poll(); timer = setInterval(poll, ctx.pollMs || 120000); if (timer.unref) timer.unref(); }
  function stop() { pollStop(); relayStop(); }

  // ---- instant alerts through the streamer's own relay (see relay/) ----
  const relayUrlClean = (v) => {
    let u; try { u = new URL(String(v || '').trim()); } catch (e) { throw new Error('That is not a web address. Paste the address Cloudflare shows after deploying (https://…workers.dev)'); }
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('The relay address must start with https://');
    return u.origin;
  };
  // write the relay address and key to disk
  const saveRelay = () => fs.writeFileSync(RFILE, JSON.stringify(relay));
  // the secret shared with the relay; made once
  function relayKey() { if (!relay.token) { relay.token = crypto.randomBytes(24).toString('hex'); saveRelay(); } return relay.token; }
  // save the relay address (or forget it) and reconnect
  function setRelay(b) {
    if (b.clear) { relay = { url: '', token: relay.token }; saveRelay(); rstatus = { connected: false, error: '', tips: rstatus.tips }; relayStop(); return view(); }
    relay.url = relayUrlClean(b.url); relayKey(); saveRelay(); rfail = 0; relayConnect(); return view();
  }
  // Deploys the relay to the streamer's Cloudflare account with the token they pasted (used once, never saved), then connects to it.
  async function deployRelay(b) {
    const r = await ctx.relayDeploy.deploy(Object.assign({}, b, { relayKey: relayKey(), service: view().service, currency: P().currency }));
    relay.config = { paypalEmail: str(b.paypalEmail, 200), kofiPage: str(b.kofiPage, 80), streamerName: str(b.streamerName, 60), accountId: r.accountId };
    saveRelay(); return Object.assign(setRelay({ url: r.url }), { updated: r.updated });
  }
  // close the connection; rgen++ makes every late callback of the old socket ignore itself
  function relayStop() { rgen++; clearTimeout(rtimer); clearInterval(rping); rtimer = rping = null; const w = rws; rws = null; rstatus.connected = false; if (w) { w.onclose = w.onerror = w.onmessage = null; try { w.close(); } catch (e) { /* already closed */ } } }
  // keep one outgoing WebSocket to the relay; gen is checked in each callback so a replaced socket cannot act. Retries with a growing wait (3s up to 60s)
  function relayConnect() {
    relayStop(); if (!relay.url || !relay.token || !WS) return;
    const gen = rgen; let ws;
    const retry = () => { if (gen !== rgen) return; rstatus.connected = false; clearInterval(rping); rtimer = setTimeout(relayConnect, Math.min(60000, 3000 * 2 ** Math.min(rfail++, 5))); if (rtimer.unref) rtimer.unref(); };
    try { ws = new WS(relay.url.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(relay.token)); } catch (e) { rstatus.error = e.message; return retry(); }
    rws = ws;
    // ping every 30 seconds so the connection is not dropped for being idle
    ws.onopen = () => { if (gen !== rgen) return; rfail = 0; rstatus.connected = true; rstatus.error = ''; rping = setInterval(() => { try { ws.send('ping'); } catch (e) { /* reconnects on close */ } }, 30000); if (rping.unref) rping.unref(); };
    ws.onmessage = (ev) => { if (gen !== rgen) return; let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m && m.type === 'tip') relayTip(m, ws); };
    ws.onerror = () => { if (gen === rgen) rstatus.error = 'Could not reach your tip service yet. A new one can take a minute to start; if this stays, press Set up my tip link again.'; };
    ws.onclose = () => { if (gen === rgen) { rws = null; retry(); } };
  }
  // a tip pushed by the relay: show it once, then ack it so the relay stops resending
  function relayTip(m, ws) {
    const id = 'relay:' + m.txnId, amount = Number(m.amount); if (!m.txnId || !(amount > 0)) return;
    if (!P().seen.includes(id)) {   // a tip is shown once, even if the relay sends it again
      P().seen.push(id); P().seen = P().seen.slice(-400);
      const rec = { name: str(m.name, 40) || 'Anonymous', amount, currency: str(m.currency, 3).toUpperCase() || P().currency, msg: str(m.msg, 200), at: Date.now(), relay: true, source: m.source === 'kofi' ? 'kofi' : 'paypal' };
      ctx.recordTip(rec); P().recent.unshift(rec); P().recent.length = Math.min(P().recent.length, 50); rstatus.tips++; ctx.persist(true);
    }
    try { ws.send(JSON.stringify({ ack: m.txnId })); } catch (e) { /* relay resends on reconnect */ }
  }
  return { view, save, setCreds, setRelay, deployRelay, relayKey, logTip, poll, start, stop, link };
};
