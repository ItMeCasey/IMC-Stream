/* The little speaker button shown in a web page that has sound (bottom-left corner), plus a small menu and message bubble.
   Drawn inside a closed shadow root so the page's own styles cannot touch it and it cannot touch the page. Used by the Chrome and Firefox content scripts. */
(function () {
  if (window.__imcGlyph) return;
  const CSS = [
    ':host{all:initial}',
    '.g{all:unset;box-sizing:border-box;width:34px;height:34px;border-radius:50%;background:#1A2020;border:2px solid #4FBBBC;cursor:pointer;display:grid;place-items:center;opacity:.5;transition:opacity .15s,transform .15s;position:relative;box-shadow:0 2px 8px rgba(0,0,0,.4)}',
    '.g:hover,.g:focus-visible{opacity:1;transform:scale(1.08)}.g:focus-visible{outline:2px solid #F39120;outline-offset:2px}',
    '.g svg{width:18px;height:18px}.g.on{border-color:#F39120;opacity:1}.g.on::after{content:"";position:absolute;right:-2px;top:-2px;width:10px;height:10px;border-radius:50%;background:#F39120;border:2px solid #1A2020}',
    '.pop{position:absolute;left:0;bottom:44px;min-width:230px;max-width:290px;background:#1A2020;color:#E2DAC2;border:2px solid #46504f;border-left:5px solid #F39120;padding:10px 12px;font:13px/1.4 "Segoe UI",system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5)}',
    '.pop[hidden]{display:none}.pop b{display:block;letter-spacing:2px;font-size:11px;color:#4FBBBC;margin-bottom:6px}.pop p{margin:0 0 6px;color:#b5bdb9}',
    '.pop button{all:unset;box-sizing:border-box;display:block;width:100%;padding:7px 9px;margin-top:5px;background:#F39120;color:#1A2020;font-weight:700;font-size:12px;letter-spacing:.5px;cursor:pointer;text-align:left}',
    '.pop button:hover,.pop button:focus-visible{filter:brightness(1.15)}.pop button.ghost{background:transparent;color:#E2DAC2;outline:1px solid #46504f;outline-offset:-1px}'
  ].join('');
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#E2DAC2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="#E2DAC2"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';

  /** opts: { title } . Returns { show, hide, setRouted(label|null), say(text), menu({title,text,items:[{label,ghost,run}]}), close, onClick(fn) } */
  function create(opts) {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;left:12px;bottom:12px;z-index:2147483647;display:none';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<style>' + CSS + '</style><div class="pop" hidden role="dialog"></div><button class="g" type="button" aria-label="' + ((opts && opts.title) || 'Choose where this page plays its sound') + '" title="' + ((opts && opts.title) || 'Choose where this page plays its sound') + '">' + ICON + '</button>';
    const btn = root.querySelector('.g'), pop = root.querySelector('.pop'); let click = () => {}, timer = null;
    const text = (el, t) => { el.textContent = t; return el; };
    const api = {
      show() { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); host.style.display = 'block'; },
      hide() { host.style.display = 'none'; pop.hidden = true; },
      setRouted(label) { btn.classList.toggle('on', !!label); btn.title = label ? 'Sound goes to: ' + label : (opts && opts.title) || ''; },
      close() { pop.hidden = true; },
      onClick(fn) { click = fn; },
      /** a short message bubble that goes away by itself */
      say(msg) { api.menu({ text: msg, items: [] }); clearTimeout(timer); timer = setTimeout(() => { timer = null; api.close(); }, 5000); },
      /** a bubble with a title, a line of text and buttons; every item is {label, ghost?, run} and the bubble closes when one is used */
      menu(m) {
        clearTimeout(timer); timer = null; pop.textContent = '';
        if (m.title) pop.appendChild(text(document.createElement('b'), m.title));
        if (m.text) pop.appendChild(text(document.createElement('p'), m.text));
        for (const it of m.items || []) { const b = text(document.createElement('button'), it.label); b.type = 'button'; if (it.ghost) b.className = 'ghost'; b.onclick = () => { pop.hidden = true; it.run && it.run(); }; pop.appendChild(b); }
        pop.hidden = false;
      },
      isOpen() { return !pop.hidden; }
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); click(e); });
    document.addEventListener('click', () => { if (!pop.hidden && !timer) pop.hidden = true; }, true);
    return api;
  }
  window.__imcGlyph = { create };
})();
