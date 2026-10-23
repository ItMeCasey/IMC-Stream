// IMC-Stream overlay settings -- edit here, then right-click the browser source in OBS > Refresh.
window.CFG = {
  channel: "itmecasey",     // your Twitch channel (lowercase) -- used by chat.html
  serverPort: 8420,         // port of the local stream server (server/config.json) -- used by alerts.html
  startMinutes: 5,          // countdown.html length
  startMessage: "WE GO LIVE IN",
  doneMessage: "LET'S GO!",
  alertSeconds: 6,          // how long each alert stays on screen
  alertVolume: 0.6,         // 0 - 1
  chatMaxMessages: 14,
  pollResultSeconds: 15,    // how long poll / prediction results stay on screen
  chatBadges: true,         // show badges in the on-stream chat
  chatFadeSeconds: 0,       // 0 = messages never fade; e.g. 45 fades them out
  scale: 0.8,               // overall size of every overlay (1 = original). Or per source: add ?scale=0.7 to its URL
  hideBots: ["nightbot", "streamelements", "streamlabs", "moobot", "fossabot"]
};

// Every overlay talks to the server on its own <name>.localhost address (it still means this PC). Browsers allow only ~6 live
// connections per address, and OBS shares them between all browser sources, so with one address the later overlays never connected.
window.icmBase = function (name, port) { return 'http://' + name + '.localhost:' + port; };

// shrink/grow the whole overlay. The body is laid out at 1/scale of the window and then scaled, so anything anchored
// to the bottom / centre / right of the source stays where it was; only the size changes.
(function () {
  var q = new URLSearchParams(location.search).get('scale'), s = +(q || (window.CFG && window.CFG.scale) || 1);
  if (!(s > 0) || s === 1) return;
  var st = document.createElement('style');
  st.textContent = 'html{overflow:hidden}body{transform:scale(' + s + ');transform-origin:0 0;width:' + 100 / s + '%!important;height:' + 100 / s + '%!important;overflow:hidden}';
  document.head.appendChild(st);
})();
