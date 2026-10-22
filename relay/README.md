# Tip relay (instant PayPal alerts)

A tiny Cloudflare Worker each streamer deploys to their own free Cloudflare account. PayPal tells it the moment a tip is paid (IPN), and the app keeps an outgoing connection to it, so nothing on the streamer's PC has to be reachable from the internet. Tips that arrive while the PC is off are kept for 7 days and alert when the app reconnects.

## For streamers

Open the app's **Tips** page, section 1, pick **PayPal** or **Ko-fi**, and follow the steps it shows (copy key, deploy, paste the address).
PayPal needs a **Business** account. Either service fires the same tip alert. The relay's address is the tip link: the app shows it, and `!tip` answers with it (with Ko-fi it forwards viewers to the streamer's Ko-fi page).

## How it works

- `/` the tip page; it posts to PayPal's checkout with the streamer's email as the payee and `/ipn` as the `notify_url`.
- `/kofi` Ko-fi's webhook. The Worker checks Ko-fi's verification token (`KOFI_TOKEN`) and forwards donations (private ones without the name and message).
- `/ipn` PayPal's notification. The Worker sends it back to PayPal to confirm it is genuine, checks the receiver email, then hands it to the Durable Object.
- `/ws?token=…` the app's connection. The key (`RELAY_TOKEN`) is made by the app and stored only on the PC and in the streamer's Cloudflare account.

## Developing

```
npm install
cp .dev.vars.example .dev.vars      # add DEV_SKIP_VERIFY=true to skip PayPal's confirmation locally
npx wrangler dev
node relay-test.js
```

The deploy button points at this folder on GitHub (`https://deploy.workers.cloudflare.com/?url=https://github.com/Drakma/ItMeCasey-Stream/tree/main/relay`), so the repository must be public for it to work.
