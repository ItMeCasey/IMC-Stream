'use strict';
/** Builds the ItMeCasey OBS scene collection with absolute paths for wherever the app is installed.
 *  Used by the app ("Export / install OBS scenes") and from the command line:  node collection.js [out.json] */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const G = { game: [0, 0, 1920, 1016], cam_game: [1496, 767, 400, 225], cam_chat: [40, 70, 1200, 675], chat_panel: [1280, 40, 600, 936], chat_box: [1296, 112, 568, 852], cam_full: [40, 70, 1840, 906] };
const VER = 537001986;
const uid = () => crypto.randomUUID();

function build({ root, dataDir, port = 8420 }) {
  const P = root.replace(/\\/g, '/'), D = dataDir.replace(/\\/g, '/');
  const source = (name, id, settings, versioned, filters, o = {}) => {
    const s = { prev_ver: VER, name, uuid: uid(), id, versioned_id: versioned || id, settings, mixers: o.mixers || (o.audio ? 255 : 0), sync: 0, flags: 0, volume: o.volume == null ? 1.0 : o.volume,
      balance: 0.5, enabled: true, muted: false, 'push-to-mute': false, 'push-to-mute-delay': 0, 'push-to-talk': false, 'push-to-talk-delay': 0, hotkeys: o.hotkeys || {},
      deinterlace_mode: 0, deinterlace_field_order: 0, monitoring_type: 0, private_settings: {} };
    if (filters) s.filters = filters.map(([n, i, st, v]) => source(n, i, st, v));
    return s;
  };
  const image = (name, rel) => source(name, 'image_source', { file: P + '/' + rel });
  const abgr = (hex) => { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0; };
  const text = (name, size, color, content, file) => {
    const st = { font: { face: 'Bahnschrift', size, style: 'Bold', flags: 1 }, color: abgr(color), opacity: 100, antialiasing: true, align: 'left', valign: 'top', extents: false, outline: false };
    if (file) Object.assign(st, { read_from_file: true, file: D + '/labels/' + file + '.txt' }); else st.text = content;
    return source(name, 'text_gdiplus', st, 'text_gdiplus_v3');
  };
  const browser = (name, url, w, h, audio) => source(name, 'browser_source', { url, width: w, height: h, fps: 30, fps_custom: false, css: '', shutdown: false, restart_when_active: false, reroute_audio: !!audio, is_local_file: false },
    undefined, undefined, { audio, mixers: audio ? 255 : 0, hotkeys: { 'libobs.mute': [], 'libobs.unmute': [], 'libobs.push-to-mute': [], 'libobs.push-to-talk': [], 'ObsBrowser.Refresh': [] } });
  const K = 0.8;   // every overlay is drawn at 80%: the page scales itself (overlays/config.js 'scale') and the OBS source box shrinks with it, keeping its corner
  const sz = (n) => Math.round(n * K);
  const overlay = (name, file, w, h, audio) => browser(name, 'file:///' + P + '/overlays/' + file, w, h, audio);

  class Scene {
    constructor(name) { this.name = name; this.items = []; this.n = 0; }
    add(src, x = 0, y = 0, rect = null, visible = true) {
      this.n++;
      const it = { name: src.name, source_uuid: src.uuid, visible, locked: false, rot: 0.0, align: 5, bounds_type: 0, bounds_align: 0, bounds_crop: false, crop_left: 0, crop_top: 0, crop_right: 0, crop_bottom: 0,
        id: this.n, group_item_backup: false, pos: { x, y }, scale: { x: 1.0, y: 1.0 }, bounds: { x: 0.0, y: 0.0 }, scale_filter: 'disable', blend_method: 'default', blend_type: 'normal',
        show_transition: { duration: 0 }, hide_transition: { duration: 0 }, private_settings: {} };
      if (rect) Object.assign(it, { pos: { x: rect[0], y: rect[1] }, bounds: { x: rect[2], y: rect[3] }, bounds_type: 3, bounds_crop: true });
      this.items.push(it); return this;
    }
    build() {
      return { prev_ver: VER, name: this.name, uuid: uid(), id: 'scene', versioned_id: 'scene', settings: { custom_size: false, id_counter: this.n, items: this.items }, mixers: 0, sync: 0, flags: 0, volume: 1.0, balance: 0.5,
        enabled: true, muted: false, 'push-to-mute': false, 'push-to-mute-delay': 0, 'push-to-talk': false, 'push-to-talk-delay': 0, hotkeys: {}, deinterlace_mode: 0, deinterlace_field_order: 0, monitoring_type: 0, private_settings: {} };
    }
  }

  // ---- sources
  const bgIron = image('BG - Iron', 'assets/bg_iron.png'), bgStart = image('BG - Starting Soon', 'assets/scene_starting.png'), bgBrb = image('BG - Be Right Back', 'assets/scene_brb.png'), bgEnd = image('BG - Ending', 'assets/scene_ending.png');
  const ovGame = image('Overlay - Gameplay', 'assets/overlay_gameplay.png'), ovChat = image('Overlay - Just Chatting', 'assets/overlay_justchatting.png'), ovFull = image('Overlay - Full Cam', 'assets/overlay_fullcam.png');
  const game = source('Game Capture', 'game_capture', { capture_mode: 'any_fullscreen', priority: 1, capture_cursor: true });
  const display = source('Display Capture', 'monitor_capture', { monitor: 0, capture_cursor: true });
  const cam = source('Webcam', 'dshow_input', {});
  const explosion = overlay('Emote Explosion', 'explosion.html?scale=1', 1920, 1080), danceParty = overlay('Dance Party', 'dance.html?scale=1', 1920, 1080), alerts = overlay('Alerts', 'alerts.html', 1920, 1080, true), chat = overlay('Chat', 'chat.html?scale=1', G.chat_box[2], G.chat_box[3]);
  const gameArena = overlay('Game Arena', 'arena.html?scale=1', 520, 300), subathonTimer = overlay('Subathon Timer', 'subathon.html', sz(640), sz(190)), countdown = overlay('Countdown', 'countdown.html', sz(640), sz(230)), nowplaying = overlay('Now Playing', 'nowplaying.html?scale=0.64', Math.round(700 * 0.64), Math.round(220 * 0.64));   // 20% smaller than the other overlays
  const poll = overlay('Poll Overlay', 'poll.html', sz(620), sz(560)), prediction = overlay('Prediction Overlay', 'prediction.html', sz(620), sz(620));
  const hype = overlay('Hype Train', 'hypetrain.html', sz(760), sz(170)), events = overlay('Recent Events', 'events.html', sz(520), sz(440)), ticker = overlay('Event Ticker', 'events.html?mode=ticker', 1920, sz(62)), viewers = overlay('Stream Stats', 'viewers.html', sz(520), sz(90));
  const capF = text('Label - Latest Follower (caption)', 26, '#4FBBBC', 'LATEST FOLLOWER'), valF = text('Label - Latest Follower', 60, '#E2DAC2', null, 'latest_follower');
  const capS = text('Label - Latest Subscriber (caption)', 26, '#4FBBBC', 'LATEST SUBSCRIBER'), valS = text('Label - Latest Subscriber', 60, '#F39120', null, 'latest_subscriber');

  const sc = [];
  sc.push(new Scene('Starting Soon').add(bgStart).add(countdown, 704, 803).add(alerts).add(danceParty).add(explosion));
  sc.push(new Scene('Gameplay').add(bgIron).add(display, 0, 0, G.game, false).add(game, 0, 0, G.game).add(cam, 0, 0, G.cam_game).add(ovGame).add(viewers, 1484, 12).add(hype, 656, 12).add(poll, 1424, 80).add(prediction, 1424, 80).add(events, 0, 40).add(ticker, 0, 940, null, false).add(subathonTimer, 20, 130, null, false).add(nowplaying, 0, 869).add(gameArena, 700, 540).add(alerts).add(danceParty).add(explosion));
  sc.push(new Scene('Just Chatting').add(bgIron).add(cam, 0, 0, G.cam_chat).add(ovChat).add(chat, G.chat_box[0], G.chat_box[1]).add(hype, 40, 784).add(poll, 662, 70).add(prediction, 662, 70).add(subathonTimer, 20, 130, null, false).add(gameArena, 700, 540).add(alerts).add(danceParty).add(explosion));
  sc.push(new Scene('Full Cam').add(bgIron).add(cam, 0, 0, G.cam_full).add(ovFull).add(viewers, 1484, 12).add(hype, 656, 12).add(poll, 1424, 80).add(prediction, 1424, 80).add(nowplaying, 0, 869).add(subathonTimer, 20, 130, null, false).add(gameArena, 700, 540).add(alerts).add(danceParty).add(explosion));
  sc.push(new Scene('Be Right Back').add(bgBrb).add(danceParty).add(explosion));
  sc.push(new Scene('Ending').add(bgEnd).add(capF, 640, 715).add(valF, 640, 750).add(capS, 640, 860).add(valS, 640, 895).add(alerts).add(danceParty).add(explosion));

  const desktop = source('Desktop Audio', 'wasapi_output_capture', { device_id: 'default' }, null, [['Limiter', 'limiter_filter', { threshold: -6.0, release_time: 60 }, null]], { audio: true, volume: 0.7 });
  const mic = source('Mic/Aux', 'wasapi_input_capture', { device_id: 'default' }, null, [
    ['Noise Suppression', 'noise_suppress_filter', { method: 'rnnoise' }, 'noise_suppress_filter_v2'], ['Noise Gate', 'noise_gate_filter', { open_threshold: -32.0, close_threshold: -38.0 }, null],
    ['Compressor', 'compressor_filter', { ratio: 4.0, threshold: -18.0, attack_time: 6, release_time: 60, output_gain: 4.0 }, null], ['Limiter', 'limiter_filter', { threshold: -3.0, release_time: 60 }, null]], { audio: true });
  const shared = [danceParty, gameArena, subathonTimer, explosion, hype, events, ticker, viewers, nowplaying, poll, prediction, bgIron, bgStart, bgBrb, bgEnd, capF, valF, capS, valS, ovGame, ovChat, ovFull, game, display, cam, alerts, chat, countdown];
  const sources = sc.map((x) => x.build()).concat(shared, [desktop, mic]);
  return {
    name: 'ItMeCasey', DesktopAudioDevice1: desktop, AuxAudioDevice1: mic, sources, groups: [], scene_order: sc.map((x) => ({ name: x.name })),
    current_scene: 'Starting Soon', current_program_scene: 'Starting Soon', canvases: [], current_transition: 'ItMeCasey Stinger', transition_duration: 900,
    transitions: [{ name: 'ItMeCasey Stinger', id: 'obs_stinger_transition', settings: { path: P + '/transitions/stinger.mov', transition_point: 900, tp_type: 0, audio_fade_style: 1, audio_monitoring: 0 } }],
    quick_transitions: [{ name: 'Cut', duration: 300, hotkeys: [], id: 1, fade_to_black: false }, { name: 'Fade', duration: 300, hotkeys: [], id: 2, fade_to_black: false }, { name: 'ItMeCasey Stinger', duration: 900, hotkeys: [], id: 3, fade_to_black: false }],
    saved_projectors: [], preview_locked: false, scaling_enabled: false, scaling_level: -8, scaling_off_x: 0.0, scaling_off_y: 0.0, modules: {}, version: 1,
  };
}

module.exports = { build, G };
if (require.main === module) {
  const root = process.env.ICM_ROOT ? path.resolve(process.env.ICM_ROOT) : path.resolve(__dirname, '..');
  const data = process.env.ICM_DATA ? path.resolve(process.env.ICM_DATA) : path.join(root, 'data');
  const out = process.argv[2] || path.join(root, 'ItMeCasey.json');
  fs.writeFileSync(out, JSON.stringify(build({ root, dataDir: data }), null, 4)); console.log('wrote', out);
}
