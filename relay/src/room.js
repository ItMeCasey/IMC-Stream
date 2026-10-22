// One Durable Object holds the app's websocket and keeps tips until the app confirms it got them,
// so a tip that arrives while the PC is off still alerts when it comes back.
const KEEP_MS = 7 * 24 * 3600e3;

export class Room {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      this.state.acceptWebSocket(pair[1]);
      await this.replay(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (path === '/broadcast' && request.method === 'POST') {
      const tip = await request.json();
      const key = 'tip:' + tip.txnId;
      if (await this.state.storage.get(key)) return Response.json({ duplicate: true });
      await this.state.storage.put(key, { tip, at: Date.now(), acked: false });
      const msg = JSON.stringify({ type: 'tip', ...tip });
      for (const ws of this.state.getWebSockets()) ws.send(msg);
      return Response.json({ duplicate: false });
    }
    return new Response('Not found', { status: 404 });
  }

  // Send everything the app has not confirmed yet; forget old confirmed tips.
  async replay(ws) {
    const all = await this.state.storage.list({ prefix: 'tip:' });
    for (const [key, v] of all) {
      if (Date.now() - v.at > KEEP_MS) await this.state.storage.delete(key);
      else if (!v.acked) ws.send(JSON.stringify({ type: 'tip', ...v.tip }));
    }
  }

  async webSocketMessage(ws, message) {
    if (message === 'ping') return ws.send('pong');
    try {
      const m = JSON.parse(message), key = 'tip:' + m.ack, v = m.ack && await this.state.storage.get(key);
      if (v) await this.state.storage.put(key, { ...v, acked: true });
    } catch { /* ignore junk */ }
  }
}
