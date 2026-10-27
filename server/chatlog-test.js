'use strict';
// The full stream log: everything is written as it happens, a new stream starts a new log, saving gives readable text or complete JSON. Run: node chatlog-test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), createChatLog = require('./chatlog.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-chatlog-')); let clock = new Date(2026, 9, 22, 20, 0, 0).getTime();
const mk = () => createChatLog({ dir: path.join(tmp, 'logs'), exportDir: () => path.join(tmp, 'out'), now: () => clock });
let L = mk();

L.event('stream.online', { started_at: 'x' }); clock += 5000;
L.chat({ id: 'm1', uid: 'u1', login: 'ann', name: 'Ann', text: 'hello chat', badges: [{ s: 'subscriber', i: '0' }], type: 'text' }); clock += 1000;
L.chat({ id: 'm2', uid: 'u2', login: 'bob', name: 'Bob', text: 'rude message', badges: [], type: 'text', reply: { name: 'Ann', text: 'hello' } }); clock += 1000;
L.moderate({ type: 'delete', id: 'm2' });
L.event('channel.follow', { user_name: 'Cat' });
L.event('channel.subscribe', { user_name: 'Dan', tier: '1000', is_gift: false });
L.event('channel.cheer', { user_name: 'Eve', bits: 100, message: 'cheer100 go' });
L.event('channel.raid', { from_broadcaster_user_name: 'Fay', viewers: 42 });
L.event('channel.channel_points_custom_reward_redemption.add', { user_name: 'Gus', reward: { title: 'Hydrate', cost: 500 }, user_input: 'now' });
L.event('channel.hype_train.progress', {}); L.event('channel.update', { title: 'Tetris', category_name: 'Tetris' });
L.tip({ name: 'Hal', amount: '$5.00', message: 'thanks' });

const id = L.view().current.id; assert.match(id, /^2026-10-22 20-00$/);
const txt = L.text(id);
for (const want of ['[20:00:05] Ann: hello chat', 'Bob: rude message  (reply to Ann)  [deleted]', '*** MOD: a message was deleted', '*** FOLLOW: Cat', '*** SUB: Dan (Tier 1)', '*** BITS: Eve cheered 100 - "cheer100 go"', '*** RAID: Fay raided with 42 viewers', '*** REDEEM: Gus redeemed "Hydrate" (500 points) - "now"', '*** TIP: Hal tipped $5.00 - "thanks"', '=== STREAM WENT ONLINE'])
  assert.ok(txt.includes(want), 'text log has: ' + want + '\n' + txt);
assert.equal(JSON.parse(L.json(id)).entries.length, 12, 'the JSON file keeps every entry, even the ones the text file leaves out');

// saved files
const t = L.save(id, 'txt'), j = L.save(id, 'json');
assert.ok(t.file.endsWith('.zip') && j.file.endsWith('.zip') && t.file !== j.file);
const unzip = (f) => { const b = fs.readFileSync(f); assert.equal(b.readUInt32LE(0), 0x04034b50); const n = b.readUInt16LE(26), x = b.readUInt16LE(28), len = b.readUInt32LE(18), out = require('zlib').inflateRawSync(b.subarray(30 + n + x, 30 + n + x + len)); assert.equal(out.length, b.readUInt32LE(22)); return { name: b.toString('utf8', 30, 30 + n), body: out.toString('utf8') }; };
const ut = unzip(t.file), uj = unzip(j.file); assert.equal(ut.name, 'Stream chat ' + id + '.txt'); assert.ok(ut.body.includes('hello chat'));
assert.equal(JSON.parse(uj.body).entries.length, 12);
assert.ok(fs.statSync(t.file).size < Buffer.byteLength(L.text(id)), 'the zip is smaller than the text');

// restart soon after: carries on in the same log; a new stream starts a new one
L = mk(); clock += 60000; L.chat({ id: 'm3', uid: 'u1', login: 'ann', name: 'Ann', text: 'back again', badges: [], type: 'text' });
assert.equal(L.view().current.id, id); assert.equal(L.read(id).length, 13);
clock += 3600e3; L.event('stream.online', {}); const id2 = L.view().current.id; assert.notEqual(id2, id); assert.equal(L.view().logs.length, 2);
L.event('stream.online', {}); assert.match(L.view().current.id, /\(2\)$/, 'two streams in the same minute do not overwrite each other');

// old log is not resumed after a long gap
const old = path.join(tmp, 'logs'); for (const f of fs.readdirSync(old)) fs.utimesSync(path.join(old, f), new Date(clock - 20 * 3600e3), new Date(clock - 20 * 3600e3));
L = mk(); L.chat({ id: 'm4', uid: 'u1', login: 'ann', name: 'Ann', text: 'new day', badges: [], type: 'text' }); assert.equal(L.read(L.view().current.id).length, 1);

// bad ids never reach the disk
for (const bad of ['../../etc/passwd', '', 'x', '2026-10-22 20-00/../../a']) { assert.throws(() => L.text(bad), /Unknown chat log/); assert.throws(() => L.remove(bad), /Unknown chat log/); }
L.remove(id); assert.ok(!L.view().logs.some((x) => x.id === id));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('chatlog-test: ok');
