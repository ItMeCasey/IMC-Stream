'use strict';
/**
 * Group games for the pixel overlay (overlays/arena.html). Only one runs at a time.
 *   boss   : a monster appears, chat attacks it with !hit (subs and bits hit harder), the damage share decides the prizes.
 *   royale : !arena opens a lobby, chatters !join for an entry fee, up to 8 knock each other out, the last one takes the pot.
 *   teams  : !teams opens sides, chatters pick !red or !blue, the two teams fight, the smaller team gets a damage bonus so it stays fair.
 * Results are decided here (never by the overlay); the overlay only plays them back.
 */
module.exports = function createArena(ctx) {
  const rng = ctx.rng || Math.random, now = ctx.now || (() => Date.now()), setT = ctx.setTimeout || setTimeout, clearT = ctx.clearTimeout || clearTimeout;
  const cfg = () => ctx.cfg(), cur = () => (ctx.currency ? ctx.currency() : 'points'), fmt = (n) => Number(n).toLocaleString('en-US');
  const emit = (type, data) => ctx.broadcast('arena', Object.assign({ type }, data || {}));
  const say = (t) => ctx.say(t);
  let cur_ = null;   // the running game: { kind, ... }
  const MONSTERS = ['Slime', 'Goblin', 'Skeleton', 'Bat King', 'Mushroom Lord', 'Stone Golem', 'Dragon Whelp', 'Lava Imp', 'Cave Troll', 'Ghost Pirate'];
  const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const busyMsg = () => 'A ' + { boss: 'boss raid', royale: 'arena', teams: 'team battle' }[cur_.kind] + ' is already running.';
  const finish = () => { if (cur_ && cur_.timer) clearT(cur_.timer); cur_ = null; };

  // ======================================================================= boss raid
  const boss = {
    start(by, name) {
      if (cur_) return busyMsg();
      const B = cfg().boss, chatters = Math.max(1, ctx.activeCount ? ctx.activeCount() : 1);
      const bn = String(name || '').trim().slice(0, 24) || MONSTERS[Math.floor(rng() * MONSTERS.length)], max = Math.round(B.baseHp + B.hpPerChatter * chatters);
      cur_ = { kind: 'boss', name: bn, hp: max, max, ends: now() + B.seconds * 1000, hits: new Map(), last: new Map(), seed: Math.floor(rng() * 1e9) };
      emit('boss:start', { name: bn, hp: max, max, seconds: B.seconds, seed: cur_.seed });
      say('A wild ' + bn + ' appeared with ' + fmt(max) + ' HP! Type ' + ctx.prefix() + 'hit to attack (every ' + B.hitCd + 's). Subs hit twice as hard, and bits and subs land big blows! You have ' + (B.seconds >= 60 ? Math.round(B.seconds / 60) + ' min' : B.seconds + 's') + '.');
      cur_.timer = setT(() => boss.end(false), B.seconds * 1000);
      return '';
    },
    status() { if (!cur_ || cur_.kind !== 'boss') return 'No boss right now.'; return cur_.name + ': ' + fmt(cur_.hp) + ' / ' + fmt(cur_.max) + ' HP left, ' + Math.max(0, Math.ceil((cur_.ends - now()) / 1000)) + 's to go. ' + ctx.prefix() + 'hit!'; },
    /** u: {id,name,rank}. power: fixed damage (bits/sub events) or undefined for a normal !hit */
    hit(u, power) {
      if (!cur_ || cur_.kind !== 'boss') return '';
      const B = cfg().boss, t = now(); const last = cur_.last.get(u.id) || 0;
      if (power == null) { if (t - last < B.hitCd * 1000) return ''; cur_.last.set(u.id, t); }
      let dmg = power != null ? power : 1 + Math.floor(rng() * 6), crit = false;
      if (power == null) { if (u.rank >= 1) dmg *= 2; if (rng() < 0.1) { dmg *= 3; crit = true; } }
      dmg = Math.min(dmg, cur_.hp); const e = cur_.hits.get(u.id) || { name: u.name, dmg: 0, hits: 0 }; e.dmg += dmg; e.hits++; e.name = u.name; cur_.hits.set(u.id, e); cur_.hp -= dmg;
      emit('boss:hit', { name: u.name, dmg, crit, big: power != null, hp: cur_.hp, max: cur_.max, sub: u.rank >= 1 });
      if (cur_.hp <= 0) boss.end(true, u);
      return '';
    },
    end(win, lastHitter) {
      if (!cur_ || cur_.kind !== 'boss') return; const B = cfg().boss, g = cur_, parts = [...g.hits.entries()].map(([id, e]) => Object.assign({ id }, e)).sort((a, b) => b.dmg - a.dmg), totalDmg = parts.reduce((a, p) => a + p.dmg, 0);
      finish();
      const pay = [];
      if (win && parts.length) { const pool = B.pool * parts.length; for (const p of parts) pay.push({ id: p.id, name: p.name, pts: Math.max(5, Math.floor(pool * p.dmg / Math.max(1, totalDmg))) + (lastHitter && lastHitter.id === p.id ? B.lastHit : 0), dmg: p.dmg }); }
      else if (parts.length) for (const p of parts) pay.push({ id: p.id, name: p.name, pts: B.consolation, dmg: p.dmg });
      for (const p of pay) ctx.addPts(p.id, p.name, p.pts, win ? 'boss raid' : 'boss raid (it got away)');
      emit('boss:end', { win, name: g.name, last: win && lastHitter ? lastHitter.name : '', top: parts.slice(0, 3).map((p) => ({ name: p.name, dmg: p.dmg })), players: parts.length });
      const top = parts.slice(0, 3).map((p) => p.name + ' ' + fmt(p.dmg)).join(', ');
      setT(() => say(win ? g.name + ' is defeated! ' + (lastHitter ? lastHitter.name + ' landed the final blow (+' + fmt(B.lastHit) + ')! ' : '') + 'Top damage: ' + top + '. ' + parts.length + ' fighters share the prize in ' + cur() + '.'
        : g.name + ' escaped with ' + fmt(Math.max(0, g.hp)) + ' HP left. ' + (parts.length ? 'Everyone who fought gets ' + fmt(B.consolation) + ' ' + cur() + '.' : 'Nobody even tried!')), win ? 2500 : 1500);
    },
  };

  // ======================================================================= arena royale
  const royale = {
    open(by) {
      if (cur_) return busyMsg();
      const R = cfg().royale; cur_ = { kind: 'royale', phase: 'lobby', fee: R.fee, players: [], closes: now() + R.lobby * 1000 };
      emit('royale:open', { fee: R.fee, seconds: R.lobby, max: R.max });
      say('The Arena is open! ' + ctx.prefix() + 'join to fight (entry ' + fmt(R.fee) + ' ' + cur() + ', up to ' + R.max + ' fighters). Last one standing takes the whole pot! Closing in ' + R.lobby + 's.');
      cur_.timer = setT(() => royale.fight(), R.lobby * 1000);
      return '';
    },
    join(u) {
      if (!cur_ || cur_.kind !== 'royale' || cur_.phase !== 'lobby') return '';
      const R = cfg().royale;
      if (cur_.players.some((p) => p.id === u.id)) return u.name + ', you are already in.';
      if (cur_.players.length >= R.max) return u.name + ', the arena is full.';
      if (ctx.getPts(u.id, u.name) < R.fee) return u.name + ', entry costs ' + fmt(R.fee) + ' ' + cur() + ' and you have ' + fmt(ctx.getPts(u.id)) + '.';
      ctx.addPts(u.id, u.name, -R.fee, 'arena entry'); cur_.players.push({ id: u.id, name: u.name });
      emit('royale:join', { name: u.name, count: cur_.players.length, max: R.max }); return u.name + ' joins the arena! (' + cur_.players.length + '/' + R.max + ')';
    },
    fight() {
      if (!cur_ || cur_.kind !== 'royale') return; const g = cur_, ps = g.players;
      if (ps.length < 2) { for (const p of ps) ctx.addPts(p.id, p.name, g.fee, 'arena refund'); finish(); emit('royale:cancel', {}); say('The arena was called off: not enough fighters' + (ps.length ? ' (entry refunded)' : '') + '.'); return; }
      g.phase = 'battle'; let alive = ps.slice(); const events = [];
      while (alive.length > 1) { const a = alive.splice(Math.floor(rng() * alive.length), 1)[0], b = alive.splice(Math.floor(rng() * alive.length), 1)[0]; const aw = rng() < 0.5, w = aw ? a : b, l = aw ? b : a; events.push({ a: a.name, b: b.name, winner: aw ? 'a' : 'b', loser: l.name }); alive.push(w); alive = alive.sort(() => rng() - 0.5); }
      const champ = alive[0], pot = g.fee * ps.length, ms = events.length * 3200 + 3600;
      emit('royale:battle', { players: ps.map((p) => p.name), events, champion: champ.name, pot, ms });
      ctx.addPts(champ.id, champ.name, pot, 'arena win');
      g.timer = setT(() => { say(champ.name + ' wins the Arena and takes ' + fmt(pot) + ' ' + cur() + ' from ' + ps.length + ' fighters!'); finish(); }, ms);
    },
  };

  // ======================================================================= team battle
  const teams = {
    open(by) {
      if (cur_) return busyMsg();
      const T = cfg().teams; cur_ = { kind: 'teams', phase: 'lobby', fee: T.fee, red: [], blue: [], closes: now() + T.lobby * 1000 };
      emit('teams:open', { fee: T.fee, seconds: T.lobby });
      say('TEAM BATTLE! Pick a side: ' + ctx.prefix() + 'red or ' + ctx.prefix() + 'blue (entry ' + fmt(T.fee) + ' ' + cur() + '). The winning team splits the pot, and the smaller team hits harder so it stays fair. ' + T.lobby + 's!');
      cur_.timer = setT(() => teams.fight(), T.lobby * 1000);
      return '';
    },
    join(u, side) {
      if (!cur_ || cur_.kind !== 'teams' || cur_.phase !== 'lobby') return '';
      const T = cfg().teams, other = side === 'red' ? 'blue' : 'red';
      if (cur_.red.concat(cur_.blue).some((p) => p.id === u.id)) return u.name + ', you already picked a side.';
      if (cur_[side].length >= T.maxPerTeam) return u.name + ', team ' + side + ' is full.';
      if (ctx.getPts(u.id, u.name) < T.fee) return u.name + ', joining costs ' + fmt(T.fee) + ' ' + cur() + ' and you have ' + fmt(ctx.getPts(u.id)) + '.';
      ctx.addPts(u.id, u.name, -T.fee, 'team battle entry'); cur_[side].push({ id: u.id, name: u.name });
      emit('teams:join', { name: u.name, side, red: cur_.red.length, blue: cur_.blue.length }); return u.name + ' joins team ' + side + '! (red ' + cur_.red.length + ' vs blue ' + cur_.blue.length + ')';
    },
    fight() {
      if (!cur_ || cur_.kind !== 'teams') return; const g = cur_, R = g.red, B = g.blue;
      if (!R.length || !B.length) { for (const p of R.concat(B)) ctx.addPts(p.id, p.name, g.fee, 'team battle refund'); finish(); emit('teams:cancel', {}); say('The team battle was called off: it needs players on both sides' + (R.length + B.length ? ' (entry refunded)' : '') + '.'); return; }
      g.phase = 'battle'; const big = Math.max(R.length, B.length), small = Math.min(R.length, B.length), bonus = Math.min(2, big / small);
      const hpEach = 20; let hp = { red: R.length * hpEach, blue: B.length * hpEach }; const start = Object.assign({}, hp), rounds = [];
      for (let i = 0; i < 14 && hp.red > 0 && hp.blue > 0; i++) {
        const dmg = (n, side) => { let d = 0; for (let k = 0; k < n; k++) d += 2 + Math.floor(rng() * 7); return Math.round(d * (side === 'red' ? (R.length < B.length ? bonus : 1) : (B.length < R.length ? bonus : 1))); };
        const dr = dmg(R.length, 'red'), db = dmg(B.length, 'blue'); hp = { red: Math.max(0, hp.red - db), blue: Math.max(0, hp.blue - dr) };
        rounds.push({ red: dr, blue: db, hpRed: hp.red, hpBlue: hp.blue });
      }
      const winner = hp.red === hp.blue ? (rng() < 0.5 ? 'red' : 'blue') : (hp.red > hp.blue ? 'red' : 'blue'), win = winner === 'red' ? R : B, pot = g.fee * (R.length + B.length), each = Math.floor(pot / win.length), ms = rounds.length * 2300 + 4200;
      emit('teams:battle', { red: R.map((p) => p.name), blue: B.map((p) => p.name), rounds, start, winner, each, ms, bonus: Math.round(bonus * 10) / 10 });
      for (const p of win) ctx.addPts(p.id, p.name, each, 'team battle win');
      g.timer = setT(() => { say('TEAM ' + winner.toUpperCase() + ' WINS! ' + win.length + ' fighters each take ' + fmt(each) + ' ' + cur() + '.'); finish(); }, ms);
    },
  };

  return {
    boss, royale, teams,
    active: () => (cur_ ? cur_.kind : ''),
    /** bits and subs land big blows on the boss */
    onEvent(event, vars) {
      if (!cur_ || cur_.kind !== 'boss') return;
      const who = { id: vars.uid || 'n:' + vars.name, name: vars.name || 'Someone', rank: 1 }, B = cfg().boss;
      if (event === 'bits') boss.hit(who, Math.min(150, Math.max(8, Math.floor((Number(vars.amount) || 0) / 100) * 8)));
      else if (event === 'sub' || event === 'resub') boss.hit(who, 25);
      else if (event === 'giftsub') boss.hit(who, Math.min(150, 25 * (Number(vars.total) || 1)));
      else if (event === 'raid' && B) boss.hit(who, Math.min(150, 3 * (Number(vars.viewers) || 0)));
    },
    view() { return cur_ ? { kind: cur_.kind, phase: cur_.phase || 'fight' } : { kind: '' }; },
    stop() { if (cur_) { finish(); emit('stop', {}); } },
  };
};
