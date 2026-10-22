// The tip page, served by the Worker itself so the whole relay is plain script files (the app uploads them straight to Cloudflare).
export default String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Send a tip</title>
<style>
  body { font: 16px system-ui, sans-serif; background: #14141a; color: #eee; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  form { background: #1f1f29; padding: 28px; border-radius: 14px; width: min(92vw, 360px); display: grid; gap: 12px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  input, textarea, button { font: inherit; padding: 10px; border-radius: 8px; border: 1px solid #333; background: #14141a; color: #eee; }
  button { background: #ffc439; color: #111; border: 0; font-weight: 700; cursor: pointer; }
</style>
</head>
<body>
<form id="f" method="post">
  <h1 id="title">Send a tip</h1>
  <input id="n" placeholder="Your name" maxlength="40">
  <input id="amt" name="amount" type="number" min="1" step="0.01" value="5" required>
  <textarea id="m" placeholder="Message (optional)" maxlength="150" rows="3"></textarea>
  <button>Tip with PayPal</button>
  <input type="hidden" name="cmd" value="_donations">
  <input type="hidden" name="business">
  <input type="hidden" name="item_name">
  <input type="hidden" name="currency_code">
  <input type="hidden" name="notify_url">
  <input type="hidden" name="custom" id="custom">
</form>
<script>
  const f = document.getElementById('f');
  fetch('/config').then((r) => r.json()).then((c) => {
    if (c.kofi && !c.business) return location.replace('https://ko-fi.com/' + encodeURIComponent(c.kofi));   // Ko-fi only: its own page is the tip page
    if (c.kofi) { const a = document.createElement('a'); a.href = 'https://ko-fi.com/' + encodeURIComponent(c.kofi); a.textContent = 'Or tip on Ko-fi'; a.style.cssText = 'color:#ffc439;text-align:center'; f.append(a); }
    f.action = 'https://www.' + (c.sandbox ? 'sandbox.' : '') + 'paypal.com/cgi-bin/webscr';
    f.business.value = c.business;
    f.currency_code.value = c.currency;
    f.notify_url.value = c.notifyUrl;
    f.item_name.value = 'Tip for ' + c.streamer;
    document.getElementById('title').textContent = 'Tip ' + c.streamer;
  });
  f.addEventListener('submit', () => {
    document.getElementById('custom').value = JSON.stringify({ n: document.getElementById('n').value.trim() || 'Anonymous', m: document.getElementById('m').value.trim() }).slice(0, 255);
  });
</script>
</body>
</html>
`;
