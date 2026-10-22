'use strict';
/**
 * Keeps the stream server running: restarts it when it exits or stops answering, with a growing pause
 * between tries if it keeps failing. Exit code 75 means "restart me" (the Restart button), done at once.
 */
const childProcess = require('node:child_process');

module.exports = function createSupervisor(o) {
  const spawn = o.spawn || childProcess.spawn, fetchFn = o.fetch || globalThis.fetch, log = o.log || (() => {});
  const healthMs = o.healthIntervalMs || 10000, maxFails = o.maxHealthFails || 3, maxBackoff = o.maxBackoffMs || 30000, stableMs = o.stableMs || 60000, startupMs = o.startupMs || 60000;
  let child = null, stopped = true, restartTimer = null, healthTimer = null, fails = 0, backoff = 1000, startedAt = 0, state = 'stopped', lastHealth = null, restarts = 0, checking = false;

  const set = (s) => { if (s !== state) { state = s; if (o.onState) o.onState(s, view()); } };
  const view = () => ({ state, restarts, health: lastHealth });

  function start() {
    stopped = false; clearTimeout(restartTimer);
    if (child) return;
    set(restarts ? 'restarting' : 'starting'); startedAt = Date.now(); fails = 0;
    let c;
    try { c = spawn(o.command, o.args || [], { cwd: o.cwd, env: o.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { log('could not start the server:', e.message); return schedule(); }
    child = c;
    const out = (b) => { if (o.onOutput) o.onOutput(String(b)); };
    if (c.stdout) c.stdout.on('data', out); if (c.stderr) c.stderr.on('data', out);
    c.on('error', (e) => { log('server process error:', e.message); });
    c.on('exit', (code) => {
      if (child === c) child = null;
      lastHealth = null;
      if (stopped) return set('stopped');
      const ranFor = Date.now() - startedAt;
      if (code === 75) { backoff = 1000; restarts++; log('server asked for a restart'); return setTimeout(start, 200); }
      if (ranFor > stableMs) backoff = 1000;
      log('server stopped (code ' + code + ') after ' + Math.round(ranFor / 1000) + 's; restarting in ' + Math.round(backoff / 1000) + 's');
      schedule();
    });
    clearInterval(healthTimer); healthTimer = setInterval(check, healthMs); if (healthTimer.unref) healthTimer.unref();
  }
  function schedule() {
    set('restarting'); restarts++;
    clearTimeout(restartTimer); restartTimer = setTimeout(start, backoff); backoff = Math.min(maxBackoff, backoff * 2);
  }
  async function check() {
    if (!child || stopped || checking) return; checking = true;
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), o.healthTimeoutMs || 4000);
    try {
      const r = await fetchFn('http://127.0.0.1:' + o.port + '/api/health', { signal: ac.signal });
      lastHealth = await r.json(); fails = 0; set('running');
    } catch (e) {
      lastHealth = null;
      const stuck = state === 'running' ? ++fails >= maxFails : Date.now() - startedAt > startupMs;   // died while running, or never came up
      if (stuck) { log('server stopped answering; restarting it'); fails = 0; if (child) child.kill(); }
    } finally { clearTimeout(t); checking = false; }
    if (o.onHealth) o.onHealth(lastHealth, view());
  }
  function stop() { stopped = true; clearTimeout(restartTimer); clearInterval(healthTimer); if (child) { try { child.kill(); } catch (e) { /* gone */ } } else set('stopped'); }
  function restart() { backoff = 1000; if (child) { child.kill(); } else start(); }
  return { start, stop, restart, view, check };
};
