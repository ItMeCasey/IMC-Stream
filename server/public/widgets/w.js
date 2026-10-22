// tiny helpers shared by the Home widgets
window.$ = (id) => document.getElementById(id);
window.esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
window.post = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then((r) => r.json());
window.get = (p) => fetch(p).then((r) => r.json());
window.mmss = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
/** run an async action from a button and flash the result */
window.act = async (btn, fn) => { try { const r = await fn(); if (r && r.error) throw new Error(r.error); btn.classList.add('ok'); } catch (e) { btn.classList.add('bad'); btn.title = e.message; } setTimeout(() => btn.classList.remove('ok', 'bad'), 700); };
window.live = (handlers) => { const bus = window.parent !== window && window.parent.__icmBus; const es = bus ? { addEventListener: (t, f) => bus.on(window, t, f) } : new EventSource('/events'); for (const k of Object.keys(handlers)) es.addEventListener(k, (e) => { try { handlers[k](JSON.parse(e.data)); } catch (x) { /* ignore */ } }); return es; };
