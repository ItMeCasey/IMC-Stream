'use strict';
// The bridge event list. Run: node bridge-test.js
const assert = require('assert');
const createBridge = require('./bridge.js');

let t = 1000;
const B = createBridge({ cap: 3, now: () => t++, snapshot: () => ({ live: true, title: 'Hi' }) });
assert.deepEqual(B.since(0).events, [], 'starts empty');
const a = B.publish('stream.online', { login: 'x' }); B.publish('stream.update', { game: 'Tetris' });
assert.equal(a.id, 1); assert.equal(a.ts, 1000);
let r = B.since(0); assert.deepEqual(r.events.map((e) => e.type), ['stream.online', 'stream.update']); assert.equal(r.cursor, 2); assert.equal(r.boot, B.boot);
assert.deepEqual(B.since(1).events.map((e) => e.id), [2], 'only what is after the number asked for');
assert.deepEqual(B.since(2).events, [], 'nothing new');
assert.deepEqual(B.since('junk').events.map((e) => e.id), [1, 2], 'a bad number means everything');
B.publish('recap', { text: 'a' }); B.publish('stream.offline', {});
r = B.since(0); assert.deepEqual(r.events.map((e) => e.id), [2, 3, 4], 'only the newest few are kept');
assert.equal(r.cursor, 4, 'the counting number keeps going');
assert.deepEqual(B.snapshot(), { boot: B.boot, cursor: 4, live: true, title: 'Hi' });
assert.notEqual(createBridge({}).boot, B.boot, 'each start has its own boot id');
// chat: kept only while the bot asks for it, in its own list, merged in order
let t2 = 5000; const C = createBridge({ chatCap: 2, cap: 2, now: () => t2 });
assert.equal(C.publish('chat.message', { text: 'nobody listens' }), null, 'chat is dropped while nobody asks');
C.publish('stream.online', {}); assert.deepEqual(C.since(0, true).events.map((e) => e.type), ['stream.online'], 'asking for chat switches it on');
C.publish('chat.message', { text: 'a' }); C.publish('stream.update', {}); C.publish('chat.delete', { id: 'x' });
assert.deepEqual(C.since(0, true).events.map((e) => e.type), ['stream.online', 'chat.message', 'stream.update', 'chat.delete'], 'in the order they happened');
C.publish('chat.message', { text: 'b' }); C.publish('chat.message', { text: 'c' }); C.publish('stream.offline', {});
assert.deepEqual(C.since(0, true).events.map((e) => e.type + (e.data.text || '')), ['stream.update', 'chat.messageb', 'chat.messagec', 'stream.offline'], 'a busy chat only pushes out older chat, never stream events');
t2 += 61000; assert.equal(C.publish('chat.message', { text: 'late' }), null, 'switches itself off a minute after the bot stops asking');
assert.deepEqual(createBridge({}).info(), {}, 'no info source means an empty answer'); assert.deepEqual(createBridge({ info: () => ({ top: [1] }) }).info(), { top: [1] });
// Discord alerts from IMC-Bot: only known events, only their variables, plain short text
const DA = B.discordAlert;
assert.deepEqual(DA({ event: 'discord_boost', vars: { name: '  Sam\n  the Great ', boosts: 7.6, level: 2, evil: '<script>' } }), { event: 'discord_boost', vars: { name: 'Sam the Great', boosts: 8, level: 2 }, num: 8 });
assert.deepEqual(DA({ event: 'discord_join', vars: { name: 'x'.repeat(200), members: 5 } }), { event: 'discord_join', vars: { name: 'x'.repeat(60) }, num: 0 });
assert.deepEqual(DA({ event: 'discord_milestone', vars: { members: 500 } }), { event: 'discord_milestone', vars: { members: 500 }, num: 500 }); assert.deepEqual(DA({ event: 'discord_boost' }).vars, { name: '', boosts: '', level: '' }, 'missing variables are empty');
for (const bad of [{ event: 'follow', vars: { name: 'Fake' } }, { event: 'tip' }, { event: 'custom' }, {}, null, { event: '__proto__' }, { event: 'constructor' }, { event: 'toString' }]) assert.throws(() => DA(bad), /Unknown Discord event/, JSON.stringify(bad));
console.log('bridge test passed');
