'use strict';
/**
 * Puts the tip relay (relay/src) on the streamer's own free Cloudflare account, so they never need GitHub or a command line.
 * They make an API token from Cloudflare's "Edit Cloudflare Workers" template and paste it here; it is used for this one deploy and never saved.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// SCRIPT is the worker's name on the streamer's account; MODULES are the files of relay/src that are uploaded as one module worker
const SCRIPT = 'itmecasey-tip-relay', MODULES = ['index.js', 'page.js', 'room.js'];

module.exports = function createRelayDeploy(ctx) {
  const doFetch = ctx.fetch || fetch, BASE = ctx.baseUrl || process.env.ICM_CLOUDFLARE_URL || 'https://api.cloudflare.com/client/v4';
  const dir = () => path.join(ctx.root, 'relay', 'src');

  // one Cloudflare API call: returns .result, or throws a message the streamer can act on (a refused token gets a hint how to make the right one)
  async function api(token, method, p, body, isForm) {
    const r = await doFetch(BASE + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + token }, body && !isForm ? { 'Content-Type': 'application/json' } : {}), body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const msg = (j.errors && j.errors[0] && j.errors[0].message) || 'Cloudflare answered ' + r.status;
      const e = new Error(r.status === 401 || r.status === 403 || /auth|permission/i.test(msg) ? 'Cloudflare did not accept that token (' + msg + '). Make it from the "Edit Cloudflare Workers" template and copy the whole token.' : msg); e.status = r.status; throw e;
    }
    return j.result;
  }

  // the account to deploy to: the one typed in, or the only one the token can see
  async function findAccount(token, wanted) {
    if (wanted) return String(wanted).trim();
    const list = await api(token, 'GET', '/accounts');
    if (!list || !list.length) throw new Error('That token cannot see a Cloudflare account. Paste your Account ID in the optional box.');
    if (list.length > 1) throw new Error('Your token can see several Cloudflare accounts (' + list.map((a) => a.name).join(', ') + '). Paste the Account ID of the one to use in the optional box.');
    return list[0].id;
  }

  // Every account needs a workers.dev name once; make one if this account has none yet.
  async function subdomain(token, acct) {
    try { const s = await api(token, 'GET', '/accounts/' + acct + '/workers/subdomain'); if (s && s.subdomain) return s.subdomain; } catch (e) { if (e.status !== 404) throw e; }
    return (await api(token, 'PUT', '/accounts/' + acct + '/workers/subdomain', { subdomain: 'icm-' + crypto.randomBytes(4).toString('hex') })).subdomain;
  }

  // check the form, upload the worker (making the workers.dev name on first use) and switch its public address on
  async function deploy(b) {
    const token = String(b.token || '').trim(); if (!token) throw new Error('Paste your Cloudflare token first');
    const paypal = String(b.paypalEmail || '').trim(), kofiPage = String(b.kofiPage || '').trim().replace(/^https?:\/\/(www\.)?ko-fi\.com\//i, '').replace(/[/?#].*$/, ''), kofiToken = String(b.kofiToken || '').trim();
    if (b.service === 'kofi') { if (!/^[A-Za-z0-9_.-]{1,60}$/.test(kofiPage)) throw new Error('Enter your Ko-fi name (the part after ko-fi.com/)'); if (kofiToken.length < 8) throw new Error('Enter the Verification Token from Ko-fi (Settings, API)'); }
    else if (!/^\S+@\S+$/.test(paypal)) throw new Error('Enter the email of your PayPal Business account');
    if (!b.relayKey) throw new Error('No relay key');

    const acct = await findAccount(token, b.accountId), sub = await subdomain(token, acct);
    // does this worker exist already? That decides whether the one-time storage migration is sent
    const exists = await api(token, 'GET', '/accounts/' + acct + '/workers/scripts/' + SCRIPT + '/settings').then(() => true, (e) => { if (e.status === 404) return false; throw e; });
    const vars = { STREAMER_NAME: String(b.streamerName || 'the stream').slice(0, 60), CURRENCY: /^[A-Za-z]{3}$/.test(b.currency || '') ? String(b.currency).toUpperCase() : 'USD', SANDBOX: 'false' };
    if (b.service === 'kofi') { vars.KOFI_PAGE = kofiPage; } else { vars.PAYPAL_EMAIL = paypal; }
    // the relay key and the Ko-fi token go in as secrets (not readable again later); the other settings are plain variables
    const metadata = {
      main_module: 'index.js', compatibility_date: '2025-01-01',
      bindings: [{ type: 'durable_object_namespace', name: 'ROOM', class_name: 'Room' }, { type: 'secret_text', name: 'RELAY_TOKEN', text: b.relayKey }]
        .concat(b.service === 'kofi' ? [{ type: 'secret_text', name: 'KOFI_TOKEN', text: kofiToken }] : [])
        .concat(Object.keys(vars).map((k) => ({ type: 'plain_text', name: k, text: vars[k] }))),
    };
    if (!exists) metadata.migrations = { new_tag: 'v1', new_sqlite_classes: ['Room'] };   // the storage class is created once; later deploys only replace the code

    // multipart upload: metadata.json plus the module files
    const form = new FormData(); form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
    for (const m of MODULES) form.append(m, new Blob([fs.readFileSync(path.join(dir(), m))], { type: 'application/javascript+module' }), m);
    await api(token, 'PUT', '/accounts/' + acct + '/workers/scripts/' + SCRIPT, form, true);
    await api(token, 'POST', '/accounts/' + acct + '/workers/scripts/' + SCRIPT + '/subdomain', { enabled: true });
    return { url: 'https://' + SCRIPT + '.' + sub + '.workers.dev', accountId: acct, updated: exists };
  }
  return { deploy };
};
