'use strict';
// BetterTTV and FrankerFaceZ badges, against fake lists. Run: node extrabadges-test.js
const assert = require('assert'), createExtraBadges = require('./extrabadges');
let calls = 0, t = 1e12, bttvDown = false;
const fake = async (url) => {
  calls++;
  if (url.includes('betterttv')) return bttvDown ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, json: async () => [{ providerId: '111', badge: { description: 'NightDev Developer', svg: 'https://cdn.betterttv.net/badges/developer.svg' } }, { providerId: '111', badge: { description: 'Emote Approver', svg: 'https://cdn.betterttv.net/badges/emote_approver.svg' } }, { providerId: '222', badge: { description: 'Evil', svg: 'https://evil.example/x.svg' } }] };
  return { ok: true, json: async () => ({ badges: [{ id: 3, name: 'supporter', title: 'FFZ Supporter', color: '#755000', urls: { 1: 'https://cdn.frankerfacez.com/badge/3/1', 2: 'https://cdn.frankerfacez.com/badge/3/2' } }, { id: 2, name: 'bot', title: 'Bot', color: 'red;}', urls: { 2: 'https://cdn.frankerfacez.com/badge/2/2' } }, { id: 9, name: 'bad', title: 'Bad', urls: { 2: 'https://evil.example/9' } }], users: { 3: ['Alice', 'bob'], 2: ['alice'], 9: ['alice'] } }) };
};
const B = createExtraBadges({ fetch: fake, now: () => t });
(async () => {
  const a = await B.forUser({ uid: '111', login: 'Alice' });
  assert.deepEqual(a.map((x) => [x.provider, x.title]), [['BetterTTV', 'NightDev Developer'], ['BetterTTV', 'Emote Approver'], ['FrankerFaceZ', 'Bot'], ['FrankerFaceZ', 'FFZ Supporter']]); assert.equal(a[3].bg, '#755000'); assert.equal(a[2].bg, '', 'a bad colour is dropped');
  assert.deepEqual(await B.forUser({ uid: '222', login: 'nobody' }), [], 'badges from outside the services own servers never get in'); assert.deepEqual((await B.forUser({ uid: '5', login: 'BOB' })).map((x) => x.title), ['FFZ Supporter'], 'FFZ is by login, in any case');
  await Promise.all([B.forUser({ uid: '1', login: 'a' }), B.forUser({ uid: '2', login: 'b' })]); assert.equal(calls, 2, 'the lists are downloaded once (one call each) and shared'); t += 25 * 3600000; await B.forUser({ uid: '1', login: 'a' }); assert.equal(calls, 4, 'and again after a day');
  // a failed download is retried later and does not break chat
  const down = createExtraBadges({ fetch: async () => { throw new Error('offline'); }, now: () => t }); assert.deepEqual(await down.forUser({ uid: '111', login: 'alice' }), []);
  console.log('extrabadges test passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
