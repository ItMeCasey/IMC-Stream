'use strict';
// 7TV emote rewards, against a fake 7TV. Run: node seventv-test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), createSevenTV = require('./seventv');
const ID = '01M4TQBBJRVAC5ETDM0CV4FBN7', ID2 = '01F0000000000000000000AAAA', ID3 = '01F0000000000000000000BBBB';
const emotes = { [ID]: { id: ID, name: 'KEKW', flags: 0, lifecycle: 3, listed: true, animated: false, owner: { username: 'someone' } }, [ID2]: { id: ID2, name: 'Spicy', flags: 1 << 16, lifecycle: 3, listed: true }, [ID3]: { id: ID3, name: 'Flash', flags: 1 << 17, lifecycle: 3, listed: true },
  '01F0000000000000000000CCCC': { id: '01F0000000000000000000CCCC', name: 'Hidden', flags: 0, lifecycle: 3, listed: false }, '01F0000000000000000000DDDD': { id: '01F0000000000000000000DDDD', name: 'Edgy', flags: 1 << 18, lifecycle: 3, listed: true }, '01F0000000000000000000EEEE': { id: '01F0000000000000000000EEEE', name: 'Pending', flags: 0, lifecycle: 2, listed: true } };
const set = { id: 'SET1', name: 'My set', capacity: 3, emotes: [{ id: 'X1', name: 'KEKW2' }, { id: 'X2', name: 'Other' }] }; const calls = []; let goodToken = true;
const fake = async (url, opt) => {
  opt = opt || {}; const ok = (j) => ({ ok: true, status: 200, json: async () => j }), nf = { ok: false, status: 404, json: async () => ({}) };
  if (url.includes('/v3/emotes/')) { const e = emotes[url.split('/').pop()]; return e ? ok(e) : nf; }
  if (url.includes('/v3/users/twitch/')) return url.endsWith('/999') ? ok({ emote_set_id: 'SET1', emote_set: set }) : nf;
  const body = JSON.parse(opt.body); if (/emotes\(query/.test(body.query)) { const items = Object.values(emotes); /* the fake returns everything it knows */ return ok({ data: { emotes: { count: items.length, items } } }); }
  calls.push({ q: body.query, v: body.variables, auth: opt.headers && opt.headers.Authorization });
  if (/actor/.test(body.query)) return ok({ data: { actor: goodToken ? { id: 'U1', username: 'casey' } : null } });
  if (!opt.headers.Authorization) return ok({ errors: [{ message: '70401 not logged in' }] });
  if (/ADD/.test(body.query)) { set.emotes.push({ id: body.variables.id, name: body.variables.name }); return ok({ data: { emoteSet: { emotes: [{ id: body.variables.id, name: body.variables.name }] } } }); }
  if (/REMOVE/.test(body.query)) { set.emotes = set.emotes.filter((x) => x.id !== body.variables.id); return ok({ data: { emoteSet: { emotes: [] } } }); }
  return ok({ data: {} });
};
let t = 1e12; const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icm-7tv-')), 'emotes7tv.json');
const S = createSevenTV({ file, fetch: fake, now: () => t, twitchId: () => '999' });
(async () => {
  assert.equal(S.parseEmoteId('look https://7tv.app/emotes/' + ID + ' pls'), ID); assert.equal(S.parseEmoteId('https://cdn.7tv.app/emote/' + ID + '/4x.webp'), ID); assert.equal(S.parseEmoteId('https://7tv.app/emotes/abc'), ''); assert.equal(S.parseEmoteId('nothing here'), ''); assert(S.isBttv('https://betterttv.com/emotes/54fa925e01e468494b85b54d'));
  await assert.rejects(S.add({ url: 'https://7tv.app/emotes/' + ID, by: 'Ann' }), /not set up/, 'no token, no emotes');
  assert.equal(S.configure({ token: 'Bearer "abc.def.ghi"', days: 30, max: 2 }).hasToken, true); assert.equal(JSON.stringify(S.view()).includes('abc.def'), false, 'the token is never sent to the page');
  await assert.rejects(S.add({ url: 'https://betterttv.com/emotes/54fa925e01e468494b85b54d', by: 'Ann' }), /only 7TV/); await assert.rejects(S.add({ url: 'hello', by: 'Ann' }), /paste a 7TV emote link/);
  await assert.rejects(S.add({ url: 'https://7tv.app/emotes/01F0000000000000000000FFFF', by: 'Ann' }), /does not exist/);
  await assert.rejects(S.add({ url: 'https://7tv.app/emotes/' + ID2, by: 'Ann' }), /not allowed on Twitch/); await assert.rejects(S.add({ url: 'https://7tv.app/emotes/' + ID3, by: 'Ann' }), /not allowed on Twitch/);
  await assert.rejects(S.add({ url: 'https://7tv.app/emotes/01F0000000000000000000CCCC', by: 'Ann' }), /not listed/); await assert.rejects(S.add({ url: 'https://7tv.app/emotes/01F0000000000000000000DDDD', by: 'Ann' }), /edgy/); await assert.rejects(S.add({ url: 'https://7tv.app/emotes/01F0000000000000000000EEEE', by: 'Ann' }), /not live/);
  assert.equal(calls.filter((c) => /ADD/.test(c.q)).length, 0, 'nothing was added by any of the refused links');
  const r = await S.add({ url: 'https://7tv.app/emotes/' + ID, by: 'Ann' }); assert.equal(r.name, 'KEKW'); assert.equal(r.days, 30); const add = calls.find((c) => /ADD/.test(c.q)); assert.equal(add.v.set, 'SET1'); assert.equal(add.v.id, ID); assert.equal(add.auth, 'Bearer abc.def.ghi', 'the token is sent as a bearer token');
  assert.equal(S.view().active[0].daysLeft, 30); assert.equal(S.view().active[0].by, 'Ann');
  await assert.rejects(S.add({ url: 'https://7tv.app/emotes/' + ID, by: 'Bob' }), /already added/);
  // the set is full now (capacity 3)
  emotes['01F0000000000000000000GGGG'] = { id: '01F0000000000000000000GGGG', name: 'KEKW', flags: 0, lifecycle: 3, listed: true };
  await assert.rejects(S.add({ url: 'https://7tv.app/emotes/01F0000000000000000000GGGG', by: 'Bob' }), /set is full/); set.capacity = 10;
  const r2 = await S.add({ url: 'https://7tv.app/emotes/01F0000000000000000000GGGG', by: 'Bob' }); assert.equal(r2.name, 'KEKW3', 'a taken name gets a number');
  emotes['01F0000000000000000000HHHH'] = { id: '01F0000000000000000000HHHH', name: 'Third', flags: 0, lifecycle: 3, listed: true };
  await assert.rejects(S.add({ url: 'https://7tv.app/emotes/01F0000000000000000000HHHH', by: 'Cy' }), /already 2 borrowed emotes/, 'only a few at a time');
  // time passes: after 30 days the emotes are taken away again
  t += 29 * 86400000; assert.equal(await S.expireDue(), 0); assert.equal(S.view().active.length, 2); assert.equal(S.view().active[0].daysLeft, 1);
  t += 2 * 86400000; assert.equal(await S.expireDue(), 2); assert.equal(S.view().active.length, 0); assert(!set.emotes.some((x) => x.id === ID), 'removed from the 7TV set'); assert.equal(calls.filter((c) => /REMOVE/.test(c.q)).length, 2);
  // removing by hand, and the saved list survives a restart
  await S.add({ url: 'https://7tv.app/emotes/' + ID, by: 'Dee' }); const again = createSevenTV({ file, fetch: fake, now: () => t, twitchId: () => '999' }); assert.equal(again.view().active.length, 1); assert.equal(again.view().hasToken, true);
  await again.removeNow(ID); assert.equal(again.view().active.length, 0); await assert.rejects(again.removeNow(ID), /not on the list/);
  // the token check
  assert.deepEqual(await S.test(), { user: 'casey', set: 'My set', emotes: set.emotes.length, capacity: 10 }); goodToken = false; await assert.rejects(S.test(), /did not accept/);
  // search, the set, adding for good and removing by hand
  const found = await S.search('e'); assert(found.items.length >= 4); assert.equal(found.items.find((x) => x.name === 'KEKW').refused, ''); assert.match(found.items.find((x) => x.name === 'Spicy').refused, /not allowed/); assert.match(found.items.find((x) => x.name === 'Hidden').refused, /not listed/); assert.deepEqual(await S.search('  '), { count: 0, items: [] });
  goodToken = true; const before = S.view().active.length; const perm = await S.addById('01F0000000000000000000HHHH', { by: 'you', days: 0 }); assert.equal(perm.name, 'Third'); assert.equal(perm.expiresAt, 0); assert.equal(S.view().active.length, before, 'an emote added for good is not on the borrowed list');
  await S.removeNow(ID); await S.addById(ID, { by: 'you', days: 5 }); const ms = await S.mySet(); assert.equal(ms.emotes.find((x) => x.id === ID).borrowed, true); assert.equal(ms.emotes.find((x) => x.id === ID).daysLeft, 5); assert.equal(ms.emotes.find((x) => x.id === '01F0000000000000000000HHHH').borrowed, false); assert.equal(ms.capacity, 10);
  await S.removeFromSet('01F0000000000000000000HHHH'); assert(!set.emotes.some((x) => x.id === '01F0000000000000000000HHHH')); await S.removeFromSet(ID); assert.equal(S.view().active.some((a) => a.emoteId === ID), false); await assert.rejects(S.removeFromSet('NOPE'), /not in your set/); assert.throws(() => S.addById('x', {}), /not an emote id/);
  console.log('seventv test passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
