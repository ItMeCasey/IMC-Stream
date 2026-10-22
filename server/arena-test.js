'use strict';
const assert = require('assert'); const createArena = require('./arena');
let seq = [0.5], ev = [], said = [], bal = { a: 500, b: 500, c: 500, d: 20 }, timers = [], T = 1e6;
const cfg = { boss: { baseHp: 100, hpPerChatter: 10, seconds: 60, hitCd: 3, pool: 40, lastHit: 100, consolation: 10 }, royale: { fee: 50, lobby: 60, max: 3 }, teams: { fee: 50, lobby: 60, maxPerTeam: 2 } };
let r = 0; const rng = () => (r = (r * 9301 + 49297 + 0.1) % 1, r);
const A = createArena({ rng, now: () => T, cfg: () => cfg, currency: () => 'coins', prefix: () => '!', say: (t) => said.push(t), broadcast: (e, d) => ev.push(d), addPts: (id, n, d) => { bal[id] = (bal[id] || 0) + d; }, getPts: (id) => bal[id] || 0, activeCount: () => 3, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: () => {} });
const flush = () => { while (timers.length) timers.shift().f(); };
const U = (id) => ({ id, name: id.toUpperCase(), rank: 0 });
// boss
A.boss.start(U('a'), 'Slimey'); assert.equal(A.active(), 'boss'); assert(A.boss.start(U('a')).includes('already'));
assert.equal(ev[0].max, 130);
for (let i = 0; i < 80 && A.active() === 'boss'; i++) { T += 4000; A.boss.hit(U('abc'[i % 3])); }
assert.equal(A.active(), ''); assert(ev.some((e) => e.type === 'boss:end' && e.win)); assert(bal.a > 500 && bal.b > 500);
// hit cooldown
A.boss.start(U('a')); A.boss.hit(U('a')); const n = ev.filter((e) => e.type === 'boss:hit').length; A.boss.hit(U('a')); assert.equal(ev.filter((e) => e.type === 'boss:hit').length, n);
A.onEvent('bits', { name: 'Big', uid: 'x', amount: 500 }); assert(ev.some((e) => e.big)); A.stop(); assert.equal(A.active(), '');
// royale
A.royale.open(); A.royale.join(U('a')); A.royale.join(U('b')); assert(A.royale.join(U('a')).includes('already')); assert(A.royale.join(U('d')).includes('costs'));
const before = bal.a + bal.b; flush(); assert(ev.some((e) => e.type === 'royale:battle')); flush(); assert.equal(bal.a + bal.b, before + 100); assert.equal(A.active(), '');
A.royale.open(); A.royale.join(U('c')); const c0 = bal.c; flush(); assert.equal(bal.c, c0 + 50); // refund
// teams
A.teams.open(); A.teams.join(U('a'), 'red'); A.teams.join(U('b'), 'blue'); A.teams.join(U('c'), 'blue'); const t0 = bal.a + bal.b + bal.c; flush(); const b = ev.filter((e) => e.type === 'teams:battle')[0]; assert(b && b.rounds.length); flush();
assert.equal(bal.a + bal.b + bal.c, t0 + b.each * (b.winner === 'red' ? 1 : 2)); assert.equal(A.active(), '');
console.log('arena ok');
