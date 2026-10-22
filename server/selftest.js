// Feeds real-shaped EventSub payloads through the server's handler and checks the label files.
// Run: node selftest.js
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert');
process.env.ICM_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'icm-test-'));
const S = require('./server.js');
const read = (n) => fs.readFileSync(path.join(S.LABELS, n + '.txt'), 'utf8');

const ev = (t, e) => assert.ok(S.handleEvent(t, e), 'unhandled ' + t);
ev('channel.follow', { user_name: 'Ann' });
ev('channel.follow', { user_name: 'Bob' });
ev('channel.subscribe', { user_name: 'Cy', tier: '1000', is_gift: false });
ev('channel.subscribe', { user_name: 'Dee', tier: '1000', is_gift: true });
ev('channel.subscription.gift', { user_name: 'Eve', total: 5, tier: '1000', is_anonymous: false });
ev('channel.subscription.message', { user_name: 'Fay', tier: '2000', cumulative_months: 9, message: { text: 'hi' } });
ev('channel.cheer', { user_name: 'Gus', bits: 300, message: 'x', is_anonymous: false });
ev('channel.cheer', { is_anonymous: true, bits: 100, message: '' });
ev('channel.cheer', { user_name: 'Gus', bits: 250, message: '', is_anonymous: false });
ev('channel.raid', { from_broadcaster_user_name: 'Hal', viewers: 42 });
ev('channel.channel_points_custom_reward_redemption.add', { user_name: 'Ivy', reward: { title: 'Hydrate' }, user_input: '' });

assert.strictEqual(read('latest_follower'), 'Bob');
assert.strictEqual(read('recent_followers'), 'Bob\nAnn');
assert.strictEqual(read('session_follower_count'), '2');
assert.strictEqual(read('latest_subscriber'), 'Fay');
assert.strictEqual(read('session_subscriber_count'), String(1 + 1 + 5));   // 1 new + 1 resub + 5 gifted (recipient Dee is covered by the gifter's total)
assert.strictEqual(read('latest_gift_recipient'), 'Dee');
assert.strictEqual(read('latest_resubscriber'), 'Fay - 9 months');
assert.strictEqual(read('latest_gift_subscriber'), 'Eve - 5');
assert.strictEqual(read('session_bits'), '650');
assert.strictEqual(read('session_top_cheerer'), 'Gus - 550');
assert.strictEqual(read('latest_cheer'), 'Gus - 250 bits');
assert.strictEqual(read('latest_raider'), 'Hal - 42');
assert.strictEqual(read('latest_redemption'), 'Ivy - Hydrate');

// test alerts must not touch counters
S.handleEvent(...S.SAMPLES.follow, { test: true });
assert.strictEqual(read('session_follower_count'), '2');
S.resetSession();
assert.strictEqual(read('session_follower_count'), '0');
assert.strictEqual(read('latest_follower'), 'Bob');   // "latest" survives a session reset

// ---- extended labels
ev('channel.hype_train.begin', { level: 1, total: 500, progress: 500, goal: 2000, top_contributions: [{ user_name: 'Gus', total: 300 }] });
ev('channel.hype_train.progress', { level: 2, total: 2600, progress: 600, goal: 3000, top_contributions: [{ user_name: 'Gus', total: 900 }] });
assert.strictEqual(read('hype_train_status'), 'ACTIVE');
assert.strictEqual(read('hype_train_level'), '2');
assert.strictEqual(read('hype_train_progress'), '600 / 3000');
assert.strictEqual(read('hype_train_top_contributor'), 'Gus (900)');
ev('channel.hype_train.end', { level: 3, top_contributions: [{ user_name: 'Gus', total: 1500 }] });
assert.strictEqual(read('hype_train_status'), 'IDLE');
assert.strictEqual(read('hype_train_last_level'), '3');

ev('channel.goal.progress', { type: 'follow', description: 'Road to 100', current_amount: 40, target_amount: 100 });
assert.strictEqual(read('goal_progress'), '40 / 100');
assert.strictEqual(read('goal_percent'), '40%');

ev('channel.poll.begin', { title: 'Next game?', choices: [{ title: 'Doom' }, { title: 'Tetris' }] });
ev('channel.poll.progress', { title: 'Next game?', choices: [{ title: 'Doom', votes: 3 }, { title: 'Tetris', votes: 9 }] });
assert.strictEqual(read('poll_leader'), 'Tetris');
assert.strictEqual(read('poll_total_votes'), '12');
assert.strictEqual(read('poll_choices'), 'Doom - 3\nTetris - 9');
ev('channel.poll.end', { title: 'Next game?', status: 'completed', choices: [{ title: 'Doom', votes: 3 }, { title: 'Tetris', votes: 9 }] });
assert.strictEqual(read('poll_status'), 'COMPLETED');

ev('channel.prediction.begin', { title: 'Win?', outcomes: [{ id: 'a', title: 'Yes' }, { id: 'b', title: 'No' }] });
ev('channel.prediction.lock', { title: 'Win?', outcomes: [{ id: 'a', title: 'Yes', users: 4, channel_points: 800 }, { id: 'b', title: 'No', users: 1, channel_points: 100 }] });
assert.strictEqual(read('prediction_status'), 'LOCKED');
ev('channel.prediction.end', { title: 'Win?', status: 'resolved', winning_outcome_id: 'a', outcomes: [{ id: 'a', title: 'Yes', users: 4, channel_points: 800 }, { id: 'b', title: 'No', users: 1, channel_points: 100 }] });
assert.strictEqual(read('prediction_winner'), 'Yes');
assert.strictEqual(read('prediction_outcomes'), 'Yes - 800 pts (4 users)\nNo - 100 pts (1 users)');

ev('channel.update', { title: 'Retro night', category_name: 'Tetris' });
assert.strictEqual(read('stream_title'), 'Retro night');
assert.strictEqual(read('stream_game'), 'Tetris');
ev('stream.online', { started_at: new Date(Date.now() - 65000).toISOString() });
assert.ok(/^0:01:0\d$/.test(read('stream_uptime')), 'uptime ' + read('stream_uptime'));
assert.strictEqual(read('stream_status'), 'LIVE');
assert.strictEqual(read('session_follower_count'), '0');       // stream.online reset the session
ev('stream.offline', {});
assert.strictEqual(read('stream_status'), 'OFFLINE');

ev('channel.charity_campaign.donate', { user_name: 'Kira', charity_name: 'Pixels', amount: { value: 1000, decimal_places: 2, currency: 'USD' } });
assert.strictEqual(read('latest_charity_donor'), 'Kira - 10.00 USD');
assert.strictEqual(read('alltime_top_cheerer'), 'Gus - 550');
assert.strictEqual(read('alltime_gift_sub_count'), '5');
assert.strictEqual(read('alltime_biggest_raid'), 'Hal - 42');
assert.strictEqual(read('recent_raiders'), 'Hal - 42');
assert.strictEqual(read('session_channel_points_spent'), '0');   // reset by stream.online


// ---- custom goals
const g1 = S.saveGoal({ title: 'Road to 10 bits', metric: 'bits_session', target: 1000, start: 0, color: 'heat' });
assert.strictEqual(g1.value, 0); assert.strictEqual(g1.percent, 0); assert.strictEqual(g1.done, false);
S.handleEvent('channel.cheer', { user_name: 'Q', bits: 250, message: '', is_anonymous: false });
assert.strictEqual(S.goalViews().find((g) => g.id === g1.id).percent, 25);
assert.strictEqual(read('goal_' + g1.id.replace(/-/g, '_')), '250 / 1000');
assert.strictEqual(read('goal_' + g1.id.replace(/-/g, '_') + '_percent'), '25%');
const g2 = S.saveGoal({ title: 'Manual jar', metric: 'manual', target: 10, start: 0 });
assert.strictEqual(g2.color, 'rainbow');
assert.throws(() => S.saveGoal({ title: 'bad', metric: 'manual', target: 5, start: 9 }), /lower than the target/);
assert.throws(() => S.saveGoal({ title: 'bad', metric: 'manual', target: 0 }), /above 0/);
const g3 = S.saveGoal({ title: 'Offset', metric: 'bits_session', target: 1250, start: 250, celebrate: true });
assert.strictEqual(S.goalViews().find((g) => g.id === g3.id).percent, 0);   // progress counts from "start"
S.handleEvent('channel.cheer', { user_name: 'Q', bits: 1000, message: '', is_anonymous: false });
const done = S.goalViews().find((g) => g.id === g1.id);
assert.strictEqual(done.done, true); assert.strictEqual(done.percent, 100);


// ---- alert rules
const pick = (ev, vars, num, key) => S.pickRule(ev, num || 0, vars, key);
assert.strictEqual(pick('bits', { name: 'a' }, 500).name, 'Bits');
const big = S.saveAlertRule({ event: 'bits', name: 'Mega cheer', min: 1000, tag: 'MEGA {amount}', title: '{name}!!', msg: '{message}', color: '#EC4624', sound: 'alert_raid.wav', volume: 80, seconds: 9 });
assert.strictEqual(pick('bits', {}, 1500).name, 'Mega cheer');
assert.strictEqual(pick('bits', {}, 999).name, 'Bits');
const built = S.buildAlert(pick('bits', {}, 1500), { name: 'Zoe', amount: 1500, message: '' });
assert.deepStrictEqual([built.tag, built.name, built.msg, built.accent, built.sound, built.seconds, built.volume], ['MEGA 1500', 'Zoe!!', '', '#EC4624', '/sounds/alert_raid.wav', 9, 80]);
assert.strictEqual(S.buildAlert(pick('resub', {}, 7), { name: 'Ann', months: 7, tier: 'Tier 1', message: '' }).msg, '7 months');   // dangling "//" trimmed
assert.strictEqual(pick('giftsub', {}, 1).tag, 'GIFT SUB'); assert.strictEqual(pick('giftsub', {}, 5).tag, '{total} GIFT SUBS');
S.saveAlertRule({ event: 'redeem', name: 'Hydrate special', match: 'hydrate', tag: 'GLUG', title: '{name}', msg: '', color: '#4FBBBC' });
assert.strictEqual(pick('redeem', { reward: 'Hydrate!' }, 100).name, 'Hydrate special');
assert.strictEqual(pick('redeem', { reward: 'Other' }, 100).name, 'Channel points');
assert.throws(() => S.saveAlertRule({ event: 'custom', name: 'x', tag: 'x', title: 'x' }), /trigger key/);
S.saveAlertRule({ event: 'custom', name: 'Lurk', key: 'Lurk!', tag: 'LURKING', title: '{name}', msg: 'Enjoy the lurk', color: '#E2DAC2' });
assert.strictEqual(pick('custom', {}, 0, 'lurk').name, 'Lurk'); assert.strictEqual(pick('custom', {}, 0, 'nope'), null);
assert.throws(() => S.saveAlertRule({ event: 'bits', min: 10, max: 5 }), /higher than the maximum/);
const bad = S.saveAlertRule({ event: 'follow', name: 'bad paths', tag: 't', title: 't', sound: '../../server/server.js', image: '../x.png', color: 'red' });
assert.strictEqual(bad.sound, ''); assert.strictEqual(bad.image, ''); assert.strictEqual(bad.color, '#4FBBBC');   // unknown files / colours are rejected
S.state.alertRules.filter((r) => r.event === 'follow').forEach((r) => { r.enabled = false; });
assert.strictEqual(pick('follow', {}, 0), null, 'all follow alerts disabled = no alert');

// chat is debounced; bots and !commands are ignored
const chat = (u, t) => S.handleEvent('channel.chat.message', { chatter_user_name: u, chatter_user_login: u.toLowerCase(), message: { text: t } });
chat('Zed', 'hello there'); chat('Zed', 'again'); chat('Amy', '!lurk'); chat('Nightbot', 'buy stuff'); chat('Bea', 'hi');
setTimeout(() => {
  assert.strictEqual(read('session_chat_messages'), '3');
  assert.strictEqual(read('session_unique_chatters'), '2');
  assert.strictEqual(read('session_top_chatter'), 'Zed - 2');
  assert.strictEqual(read('latest_chat_message'), 'Bea: hi');
  assert.strictEqual(read('recent_chat'), 'Bea: hi\nZed: again\nZed: hello there');
  const unwritten = Object.keys(S.labelDocs).filter((k) => !fs.existsSync(path.join(S.LABELS, k + '.txt')));
  assert.deepStrictEqual(unwritten, []);
  console.log('selftest passed:', Object.keys(S.labelDocs).length, 'labels');
  process.exit(0);
}, 600);
