'use strict';
/**
 * Live audio mixer for OBS: level meters, mute and volume per audio source, filtered per scene.
 * Keeps one OBS WebSocket connection open while a mixer widget is looking (it asks every few seconds), and closes it again when nobody is.
 */
const crypto = require('node:crypto');
const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');
const EVENTS = 1 | (1 << 2) | (1 << 3) | (1 << 16);   // Scenes + Inputs + InputVolumeMeters (the fast meter stream)

module.exports = function createAudio(ctx) {
  const WS = ctx.WebSocket || WebSocket, IDLE_MS = ctx.idleMs || 20000;
  // connection state: ready = OBS accepted our login; wanted = a widget still needs us (keep reconnecting); backoff grows between retries
  let ws = null, ready = false, seq = 0, pend = new Map(), idleT = null, retryT = null, wanted = false, lastTouch = 0, backoff = 1500, sawHello = false;
  // inputs: audio sources by name; program: scene on air; sceneCache: per-scene source lists; specials: global devices (desktop, mic)
  let inputs = new Map(), program = '', error = '', sceneCache = new Map(), specials = [];
  // pushT / dirty batch the meter updates; quietUntil pauses reconnecting while OBS is shutting down or swapping collections
  let pushT = null, dirty = false, quietUntil = 0;

  // OBS happily reports a volume for every source, including ones that make no sound (a browser overlay, a screen capture). Show real audio kinds,
  // and anything else only once they have actually made sound (a browser overlay that plays alerts shows up after its first alert).
  const AUDIO_KINDS = /^(wasapi_|coreaudio_|pulse_|alsa_|jack_|sndio_|ffmpeg_source|vlc_source|openal)/;
  const shown = (i) => i.heard || AUDIO_KINDS.test(i.kind || '') || specials.includes(i.name);
  // linear level multiplier to dB, floored at -100
  const levelDb = (mul) => (mul > 0.00001 ? Math.max(-100, 20 * Math.log10(mul)) : -100);
  // send the state to the widgets: now = right away, otherwise batched
  function push(now) {
    if (now) { clearTimeout(pushT); pushT = null; dirty = false; return ctx.broadcast('audio', view()); }
    dirty = true; if (pushT) return;
    pushT = setTimeout(() => { pushT = null; if (dirty) { dirty = false; ctx.broadcast('audio', view()); } }, 30);   // OBS sends meters about 20 times a second: pass nearly every one on
  }
  // what widgets get: only the sources worth showing
  const view = () => ({ connected: ready, error, program, inputs: [...inputs.values()].filter(shown).map((i) => ({ name: i.name, muted: i.muted, db: i.db, peak: i.peak, peaks: i.peaks || [i.peak, i.peak], kind: i.kind })), specials });

  // send one OBS request; resolves with its data, rejects after 6 s
  function request(type, data) {
    return new Promise((res, rej) => {
      if (!ready) return rej(new Error('OBS is not connected'));
      const id = String(++seq); const t = setTimeout(() => { if (pend.delete(id)) rej(new Error('OBS did not answer ' + type)); }, 6000);
      pend.set(id, { res: (d) => { clearTimeout(t); res(d); }, rej: (e) => { clearTimeout(t); rej(e); } });
      ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
    });
  }
  // swallow errors (sources without audio reject volume requests)
  const safe = (p) => p.catch(() => null);

  // reload the source list with current mute and volume, keeping the meter values we already have
  async function loadInputs() {
    const list = (await request('GetInputList')).inputs || [], next = new Map();
    for (const i of list) {
      const old = inputs.get(i.inputName) || {};
      next.set(i.inputName, { name: i.inputName, kind: i.inputKind, heard: !!old.heard, muted: !!old.muted, db: old.db == null ? 0 : old.db, peak: old.peak == null ? -100 : old.peak, audio: old.audio });
    }
    inputs = next;
    await Promise.all([...inputs.values()].map(async (i) => {
      const m = await safe(request('GetInputMute', { inputName: i.name })), v = await safe(request('GetInputVolume', { inputName: i.name }));
      if (m) i.muted = !!m.inputMuted; if (v) { i.db = v.inputVolumeDb; i.audio = true; } else i.audio = false;   // sources without audio have no volume
    }));
    for (const [k, v] of [...inputs]) if (v.audio === false) inputs.delete(k);
    const sp = await safe(request('GetSpecialInputs')); specials = sp ? Object.values(sp).filter(Boolean) : [];
    const cur = await safe(request('GetCurrentProgramScene')); program = cur ? cur.sceneName || cur.currentProgramSceneName || '' : program;
    sceneCache.clear(); push(true);
  }

  // handle OBS events: meters, mute and volume changes, sources and scenes coming and going
  function onEvent(t, d) {
    // OBS can crash if its audio thread is busy with meters while a scene collection is swapped or OBS closes: let go of the meter stream for a while
    if (t === 'CurrentSceneCollectionChanging' || t === 'ExitStarted') { quietUntil = Date.now() + 15000; close(true); return; }
    if (t === 'InputVolumeMeters') {
      let changed = false;
      // peaks = left and right separately (a mono source shows the same on both)
      for (const m of d.inputs || []) { const i = inputs.get(m.inputName); if (!i) continue; let p = 0; const chs = []; for (const ch of m.inputLevelsMul || []) { p = Math.max(p, ch[1] || 0); chs.push(levelDb(ch[1] || 0)); } i.peak = levelDb(p); i.peaks = chs.length >= 2 ? chs.slice(0, 2) : chs.length ? [chs[0], chs[0]] : [-100, -100];   if (!i.heard && i.peak > -80) { i.heard = true; changed = true; } }
      return push(changed);
    }
    if (t === 'InputMuteStateChanged') { const i = inputs.get(d.inputName); if (i) { i.muted = !!d.inputMuted; push(true); } }
    else if (t === 'InputVolumeChanged') { const i = inputs.get(d.inputName); if (i) { i.db = d.inputVolumeDb; push(true); } }
    else if (['InputCreated', 'InputRemoved', 'InputNameChanged'].includes(t)) { sceneCache.clear(); safe(loadInputs()); }
    else if (t === 'CurrentProgramSceneChanged') { program = d.sceneName; push(true); }
    else if (t === 'SceneItemCreated' || t === 'SceneItemRemoved') sceneCache.delete(d.sceneName);
  }

  // open the WebSocket and log in; on failure schedule() retries until nobody wants it
  function connect() {
    if (ws || !wanted) return;
    if (Date.now() < quietUntil) return schedule();
    const cfg = ctx.getCfg() || {}, url = 'ws://' + (cfg.host || '127.0.0.1') + ':' + (+cfg.port || 4455);
    try { ws = new WS(url); } catch (e) { error = 'Could not open ' + url; return schedule(); }
    const mine = ws; sawHello = false;
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.op === 0) {
        sawHello = true; const id = { rpcVersion: 1, eventSubscriptions: EVENTS };
        if (m.d.authentication) { if (!cfg.password) { error = 'OBS wants a password (enter it on Setup)'; return mine.close(); } id.authentication = sha(sha(cfg.password + m.d.authentication.salt) + m.d.authentication.challenge); }
        mine.send(JSON.stringify({ op: 1, d: id }));
      } else if (m.op === 2) { ready = true; error = ''; backoff = 1500; safe(loadInputs()).then(() => {}); }
      else if (m.op === 5) onEvent(m.d.eventType, m.d.eventData || {});
      else if (m.op === 7) { const p = pend.get(m.d.requestId); if (!p) return; pend.delete(m.d.requestId); if (m.d.requestStatus && m.d.requestStatus.result) p.res(m.d.responseData || {}); else p.rej(new Error((m.d.requestStatus && m.d.requestStatus.comment) || 'OBS request failed')); }
    };
    ws.onerror = () => { if (!error) error = sawHello ? 'OBS closed the connection (wrong password?)' : 'Could not connect to OBS: is it running with the WebSocket server on?'; };
    ws.onclose = () => { if (ws === mine) { ws = null; ready = false; for (const p of pend.values()) p.rej(new Error('OBS closed the connection')); pend.clear(); inputs = new Map(); push(true); schedule(); } };
  }
  // retry later, waiting longer each time (up to 15 s)
  function schedule() { clearTimeout(retryT); if (!wanted) return; retryT = setTimeout(connect, backoff); backoff = Math.min(15000, backoff * 1.7); if (retryT.unref) retryT.unref(); }
  // drop the connection; keepWanted = come back later (used when OBS is restarting)
  function close(keepWanted) { wanted = !!keepWanted; clearTimeout(retryT); clearTimeout(idleT); if (ws) { const w = ws; ws = null; ready = false; try { w.close(); } catch (e) { /* gone */ } } inputs = new Map(); if (keepWanted) schedule(); }

  /** a widget is looking: open (or keep open) the connection */
  function touch() {
    lastTouch = Date.now(); wanted = true; clearTimeout(idleT);
    idleT = setTimeout(() => { if (Date.now() - lastTouch >= IDLE_MS - 50) close(); }, IDLE_MS); if (idleT.unref) idleT.unref();
    if (!ws) connect();
    return view();
  }

  /** audio sources that belong in a scene's mixer: the global ones (desktop, mic) + every audio source placed in that scene (and its nested scenes) */
  async function forScene(scene) {
    if (!ready) throw new Error(error || 'OBS is not connected');
    const sc = scene || program, key = sc;
    if (!sceneCache.has(key)) {
      const names = new Set(specials), seen = new Set();
      const walk = async (s) => { if (seen.has(s)) return; seen.add(s); const r = await safe(request('GetSceneItemList', { sceneName: s })); for (const it of (r && r.sceneItems) || []) { if (it.isGroup || (it.inputKind == null && it.sourceType === 'OBS_SOURCE_TYPE_SCENE')) await walk(it.sourceName); else names.add(it.sourceName); } };
      await walk(sc); sceneCache.set(key, [...names]);
    }
    const allowed = new Set(sceneCache.get(key));
    return { scene: sc, inputs: [...inputs.keys()].filter((n) => allowed.has(n)) };   // the widget shows the ones that are real audio (see `shown`)
  }
  // plain OBS requests; volume is clamped to OBS's own -100..+26 dB range
  const setMute = (name, on) => request('SetInputMute', { inputName: name, inputMuted: !!on });
  const toggleMute = (name) => request('ToggleInputMute', { inputName: name });
  const setVolumeDb = (name, db) => request('SetInputVolume', { inputName: name, inputVolumeDb: Math.max(-100, Math.min(26, Number(db) || 0)) });
  return { touch, view, forScene, setMute, toggleMute, setVolumeDb, close, scenes: () => request('GetSceneList').then((r) => r.scenes.map((s) => s.sceneName).reverse()) };
};
