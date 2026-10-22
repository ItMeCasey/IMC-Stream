'use strict';
/** Minimal OBS WebSocket (v5, built into OBS 28+) client. Opens a short-lived connection per action. */
const crypto = require('node:crypto');
const sha = (s) => crypto.createHash('sha256').update(s).digest('base64');

module.exports = function createObs(getCfg, opts = {}) {
  const WS = opts.WebSocket || WebSocket;
  const log = opts.log || (() => {});
  let lastOk = 0;   // when OBS last answered, so the Setup page can say whether it is really connected

  async function session(fn) {
    const cfg = getCfg() || {}, url = 'ws://' + (cfg.host || '127.0.0.1') + ':' + (+cfg.port || 4455);
    let ws; try { ws = new WS(url); } catch (e) { throw new Error('Could not open ' + url); }
    let seq = 0, ready, failed, sawHello = false; const pending = new Map();
    const ident = new Promise((res, rej) => { ready = res; failed = rej; });
    ident.catch(() => {});   // handled by the await below; avoids an unhandled rejection if it fails after we are done
    const timer = setTimeout(() => failed(new Error('Timed out connecting to OBS at ' + url)), 6000);
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.op === 0) {                                  // Hello
        sawHello = true;
        const d = m.d || {}, id = { rpcVersion: 1, eventSubscriptions: 0 };
        if (d.authentication) {
          if (!cfg.password) return failed(new Error('OBS is asking for a password: enter it in the OBS box on this page'));
          id.authentication = sha(sha(cfg.password + d.authentication.salt) + d.authentication.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: id }));
      } else if (m.op === 2) { lastOk = Date.now(); ready(); }   // Identified
      else if (m.op === 7) {                             // RequestResponse
        const p = pending.get(m.d.requestId); if (!p) return; pending.delete(m.d.requestId);
        if (m.d.requestStatus && m.d.requestStatus.result) p.res(m.d.responseData || {}); else p.rej(new Error((m.d.requestStatus && m.d.requestStatus.comment) || 'OBS request failed'));
      }
    };
    ws.onerror = () => failed(new Error(sawHello ? 'OBS closed the connection (wrong password?)' : 'Could not connect to OBS at ' + url + ' - in OBS open Tools > WebSocket Server Settings and enable it'));
    ws.onclose = (ev) => { failed(new Error(ev && ev.code === 4009 ? 'OBS password is wrong' : sawHello ? 'OBS closed the connection (wrong password?)' : 'OBS closed the connection')); for (const p of pending.values()) p.rej(new Error('OBS closed the connection')); };
    try {
      await ident; clearTimeout(timer);
      const call = (type, data) => new Promise((res, rej) => {
        const id = String(++seq); pending.set(id, { res, rej });
        ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
        const t = setTimeout(() => { if (pending.delete(id)) rej(new Error('OBS did not answer ' + type)); }, 6000); if (t.unref) t.unref();
      });
      return await fn(call);
    } finally { clearTimeout(timer); try { ws.close(); } catch (e) { /* already closed */ } }
  }

  const currentScene = async (call) => { const r = await call('GetCurrentProgramScene'); return r.sceneName || r.currentProgramSceneName; };
  async function setSource(scene, source, enabled) {
    return session(async (call) => {
      const sc = scene || await currentScene(call);
      const r = await call('GetSceneItemId', { sceneName: sc, sourceName: source });
      await call('SetSceneItemEnabled', { sceneName: sc, sceneItemId: r.sceneItemId, sceneItemEnabled: !!enabled });
      return { scene: sc };
    });
  }
  return {
    lastOk: () => lastOk,
    /** OBS's own performance numbers: CPU, memory, FPS, frame times, skipped frames, disk, and the stream's bytes/congestion */
    statsRaw: () => session(async (call) => { const s = await call('GetStats'), st = await call('GetStreamStatus').catch(() => ({})); return { s, st }; }),
    raw: (fn) => session(fn),   // several requests in one connection (used by the Voicemeeter setup)
    test: () => session(async (call) => { const v = await call('GetVersion'); return { obsVersion: v.obsVersion, websocketVersion: v.obsWebSocketVersion }; }),
    current: () => session(currentScene),
    /** is OBS streaming / recording right now? */
    status: () => session(async (call) => { const s = await call('GetStreamStatus'), r = await call('GetRecordStatus'); return { streaming: !!s.outputActive, reconnecting: !!s.outputReconnecting, seconds: Math.floor((s.outputDuration || 0) / 1000), recording: !!r.outputActive, paused: !!r.outputPaused, recordSeconds: Math.floor((r.outputDuration || 0) / 1000) }; }),
    /** op: start | stop | toggle. Uses the stream key already saved in OBS (Settings > Stream). */
    stream: (op) => session(async (call) => { const on = (await call('GetStreamStatus')).outputActive; if (op === 'start' ? !on : op === 'stop' ? on : true) await call(on ? 'StopStream' : 'StartStream'); return { streaming: op === 'start' ? true : op === 'stop' ? false : !on }; }),
    record: (op) => session(async (call) => { const on = (await call('GetRecordStatus')).outputActive; if (op === 'start' ? !on : op === 'stop' ? on : true) await call(on ? 'StopRecord' : 'StartRecord'); return { recording: op === 'start' ? true : op === 'stop' ? false : !on }; }),
    scenes: () => session(async (call) => (await call('GetSceneList')).scenes.map((s) => s.sceneName).reverse()),
    sources: (scene) => session(async (call) => { const sc = scene || await currentScene(call); return (await call('GetSceneItemList', { sceneName: sc })).sceneItems.map((i) => i.sourceName); }),
    setScene: (name) => session((call) => call('SetCurrentProgramScene', { sceneName: name })),
    /** Show a source in a scene (blank scene = current), then hide it again after `seconds` (0 = leave it on). */
    async showSource({ scene, source, seconds }) {
      const r = await setSource(scene, source, true);
      if (seconds > 0) { const t = setTimeout(() => setSource(r.scene, source, false).catch((e) => log('OBS hide failed:', e.message)), seconds * 1000); if (t.unref) t.unref(); }
      return r;
    },
    hideSource: ({ scene, source }) => setSource(scene, source, false),
  };
};
