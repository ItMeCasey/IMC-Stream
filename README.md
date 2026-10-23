# ItMeCasey Stream

A Windows desktop app and OBS pack for Twitch streamers. It replaces Streamlabs / StreamElements and a separate chat bot with one app that runs on your own PC: alerts, a chat bot with games, channel-point reward actions, goals, tips, a subathon timer, an audio mixer, pixel-art mini-games and a Dance Party, all themed (palette below) and shown through ordinary OBS browser sources.

Everything runs locally. Your Twitch login, settings and data stay on your PC (see [Privacy](#privacy-and-your-data)).

## What you get
- **Alerts and overlays:** follows, subs, gift subs, bits, raids, tips, hype train, polls and predictions, a recent-events list and ticker, viewer stats, Now Playing (with a live music visualizer), goals with an emote explosion, subathon timer.
- **Chat bot:** custom commands, timers, points, filters, AutoMod review, welcome messages, raid shoutouts, text-to-speech (optional realistic voices), an optional separate bot account.
- **Games for chat:** duels (also against the bot), boss raid, arena royale, team battle, horse race (Twitch predictions pay out), a pixel spin-the-wheel for you and your mods (your own options, each with its own percentage), **Word Rush** (a full-screen word game: chat makes words from the letters on screen and points are paid every round), gamble, slots, trivia, raffles, and a builder for your own games. Everything plays on one pixel overlay.
- **Dance Party:** a bits reward (1,000 bits by default; mods can also type `!dance`). Two minutes of lights, lasers, strobes (3 flashes a second at most), pixel dancers named after chatters, a DJ, pyrotechnics and steam, all following the beat of your current song.
- **Channel points:** make and switch rewards on and off (pixel-art icons for the built-in rewards and power-ups are in `twitch/reward_icons/`), and run actions (alerts, chat, OBS scene changes, sounds, points) when they are redeemed.
- **Control:** a control board, automatic scene switching, an audio mixer with per-scene sources, Voicemeeter setup that keeps music and alerts out of your VOD, OBS stats, Twitch panels you can design and sync to chat commands.
- **Reliability:** tray status light, a watchdog that restarts the server, daily backups, and a Setup page that checks everything.

## Requirements
- Windows 10 or 11, OBS Studio 28 or newer (WebSocket is built in), a Twitch account.
- Affiliate or Partner is needed only for predictions (horse race), channel-point rewards and bits.

## Quick start
1. Run **`ItMeCasey Stream Setup <version>.exe`** (for example `2026.10.2`). Windows may say "unknown publisher" because the app is not code-signed yet: click **More info, then Run anyway**.
2. The first time, a **welcome guide** opens and walks you through the steps below (you can skip it and use the **Setup** page in the left rail instead).
3. **Connect Twitch:** press the button, a browser page opens, approve it. The status light turns green.
4. **OBS:** in OBS open *Tools, WebSocket Server Settings* and tick *Enable WebSocket server*. Enter the port and password on the Setup page, then press **Test**.
5. **Install the scenes:** press **Install into OBS**, then in OBS pick *Scene Collection, ItMeCasey*.
6. Test an alert from the dashboard. If it shows in OBS, you are done.

Optional: **Audio + VOD** on the Setup page walks you through Voicemeeter so music and alert sounds stay out of your VOD.

## Troubleshooting
- **"Local server connected - Twitch: error" appears in OBS, or alerts stop:** the Twitch login expired. Press **Connect Twitch** again. Only run one copy of the app at a time, because two copies fight over the same login.
- **Word Rush does not appear:** add the **Word Rush** browser source `http://localhost:8420/overlays/words.html` (1920 x 1080); it stays invisible until `!words` starts a game.
- **The wheel (or another game) does not appear:** add the **Game Arena** browser source `http://localhost:8420/overlays/arena.html` (1920 x 1080); the starter scenes already include it.
- **Nothing shows in OBS:** the app must be running (check the tray icon). In the browser source, use *Refresh cache of current page*.
- **OBS says it cannot connect:** enable the WebSocket server in OBS and check the port and password on the Setup page.
- **Music visualizer or Dance Party does not move:** the app has to be running, because it listens to your PC's audio.
- **Something else:** on the Setup page press **Copy diagnostics** and include the text when you report a problem.

## Privacy and your data
Your settings, bot data, logins and backups live in `%APPDATA%\ItMeCasey Stream\data`. Updating or reinstalling never touches them. The app only talks to: Twitch (login, events, chat), emote lists (BTTV, FrankerFaceZ, 7TV), Apple's iTunes search (album art for songs Windows can't give a cover for), VB-Audio's site (only if you press Download Voicemeeter), GitHub (a check for newer versions twice a day, which you can switch off on the Setup page), and any services you connect yourself (Spotify, PayPal, Stripe). Nothing is sent to the author.

## More documents
[Privacy](docs/PRIVACY.md) · [Contributing](CONTRIBUTING.md) · [Artwork and branding](ASSETS.md) · [Code signing policy (draft)](docs/CODE_SIGNING_POLICY.md)

## License
The code is free software under the **GNU General Public License v3.0 or later** (see [LICENSE](LICENSE)): you may use, study, change and share it, and anything you distribute based on it must stay open under the same license. The name, logo, sounds and artwork are not part of that license, see [ASSETS.md](ASSETS.md).

## Reference
Palette: Iron Core `#222A2A` · Industrial Aqua `#4FBBBC` · Rust Signal `#EC4624` · Heat Marker `#F39120` · Architectural Cream `#E2DAC2` (+ Dark Rust `#B13A22` from the logo). Font: Bahnschrift (ships with Windows 10/11).

### Versions
Version numbers are `YYYY.M.Increment` (for example `2026.10.3`: the third release of October 2026). `npm run bump` in `app/` picks the next one: the number after the month goes up by one, and restarts at 1 in a new month.

### The app
- Lives in the **system tray** with a status light (green = connected to Twitch, amber = needs attention, red = server problem). Closing the window keeps it running so alerts and overlays keep working; **Quit** is in the tray menu.
- **Self-healing:** a watchdog restarts the stream server if it crashes or stops answering. Tray options: start with Windows, open OBS and Voicemeeter when the app starts, restart server, open data folder.
- OBS browser sources use `http://localhost:8420/overlays/...`.

**Build the installer** (needs Node.js 22+ once, on the PC you build on):
```
powershell -ExecutionPolicy Bypass -File app\build-installer.ps1   # -> app\release\ItMeCasey Stream Setup <version>.exe
cd app && npm test                                                  # watchdog test
```
Tests for the server live in `server/*-test.js` (run each with `node`). `npm install` then `npm run lint` in the repository root runs ESLint; both run on every push in GitHub Actions.

## More features
- **Control Board** (`/board`): big buttons for your OBS scenes, run/snooze ads, clip, pause/mute/skip alerts, music, timer, plus **your own buttons** (anything a reward hook can do) and **automatic scene switching** (going live/offline, raid, ad break, hype train, `!brb` / `!back`; temporary scenes return to where you were).
- **Setup & health** (`/setup`): status light, Twitch Client ID, OBS scene install/download, OBS WebSocket, **backup / restore** (manual download, daily automatic copy, safety copy before every restore), **control from your phone** (LAN access with password, off by default), restart, realistic-voice installer.
- **More overlays:** `hypetrain.html` (760x170), `events.html` (recent alerts list, 520x440, `?max=6`), `viewers.html` (viewers / uptime / followers / subs, 520x90, `?show=viewers,uptime,followers,subs`). They are already placed in the Gameplay scene of the collection; all support `?demo=1`.
- **Video alerts:** pick an `.mp4`/`.webm` (up to 80 MB, upload from the alert editor) for any alert; it plays full-frame behind the alert card.
- **Chat extras** (bot > Event messages): welcome first-time chatters, auto-shoutout on raids, "regulars" (treated as subscribers after N minutes / messages). `!brb` / `!back` switch scenes.
- **AutoMod review** in the Chat dock: held messages show up with Allow / Deny buttons (needs the `moderator:manage:automod` permission, which Connect Twitch asks for).

## Install without the app (2 minutes)
1. OBS > **Scene Collection > Import** > pick `ItMeCasey.json` (this folder), then switch to **ItMeCasey**. It does not touch your existing collections.
2. Set canvas/output to **1920x1080, 30 or 60 fps** (Settings > Video).
3. Fill in the placeholders:
   - **Webcam** source: double-click > pick your camera.
   - **Game Capture**: set to "Capture specific window" for your game (or enable the hidden **Display Capture** in the Gameplay scene).
   - **Mic/Aux** and **Desktop Audio** use the Windows default devices; change in Settings > Audio if needed. Mic already has noise suppression, gate, compressor and limiter.
4. Edit `overlays/config.js`: your channel name and countdown length. Right-click a browser source > **Refresh** to apply.
5. For live alerts and stat files, set up the local server (next section).

## Scenes
**Waiting room** (Starting Soon scene): a pixel-art doctor's waiting room across the bottom third of the picture (`overlays/waitingroom.html`, 1920 x 360, the source **Waiting Room**). It has a reception window, couches, chairs, a coffee table with magazines, plants, a water cooler, a clock, a TV, pictures and an exit door. Everybody who talks in chat walks in through the door and takes a seat (or stands when the seats are full), shown as a pixel person who looks the same as in the games, with a speech bubble of what they said and their name while they talk. People leave after 10 minutes of silence, and the one who has been quiet longest leaves when the room is full. Bots in `hideBots` and commands that start with `!` are ignored. A message is held for 1.5 seconds before it becomes a bubble, so the chat bot's filters and your mods can delete it first: a deleted message never gets a bubble (or loses it), and a chatter who is timed out or banned loses theirs. Twitch AutoMod holds never reach the room because Twitch does not send held messages. The room has no wall or floor of its own, so the scene's background shows through behind the furniture (soft shadows keep it from floating); `?walls=1` brings the wall and tiled floor back. Options on the source's address: `?max=14` (how many people fit), `?idle=600` (seconds of silence before leaving), `?demo=1` (pretend chatters, `&speed=5` to walk faster). To fill the room in OBS for a test, run `POST /api/test {"type":"chat","fill":14}` (14 pretend chatters talk over about 15 seconds). It sits above the background and below the countdown. A fresh import of `ItMeCasey.json` already has it; to add it to the OBS collection you already use, run `POST /api/obs/overlay {"which":"waitingroom"}`.

Starting Soon (live countdown) · Gameplay (game + corner cam + bottom bar) · Just Chatting (big cam + themed live chat) · Full Cam · Be Right Back · Ending.
Transition: **ItMeCasey Stinger** (slanted palette wipe + logo, cut point 900 ms) is the default. Fade and Cut remain available.

## Alerts
`overlays/alerts.html` shows follow / sub (incl. gifts) / bits / raid / tip alerts with logo spin, shine and custom sounds (`sounds/`).
Alerts come from the local server below (no Streamlabs/StreamElements). Test them from the dashboard buttons, or add `?demo=1` to the browser source URL to cycle all types without the server.

## Local stream server (`server/`)
Replaces Streamlabs/StreamElements: connects to Twitch directly, pushes alerts to the overlay, and writes stream-label text files. Needs Node.js 22+ (no installs, no npm).

**One-time setup**
1. Go to https://dev.twitch.tv/console > **Register Your Application**. Name: anything. OAuth Redirect URL: `http://localhost`. Category: Application Integration. **Client Type: Public**. Copy the **Client ID**.
2. Paste it into `server/config.json` (`"clientId"`).
3. Run `server/start-server.bat`. The dashboard opens at http://localhost:8420/. Press **Connect Twitch**, open the link, enter the code, approve. The login is saved to `data/tokens.json` (private, do not share).

**Every stream:** run `start-server.bat` before going live (it reconnects on its own). Sources named *Alerts* in OBS read from it.

**Events handled:** follows, subs, resubs, gift subs, bits, raids, channel-point redemptions, hype train (start/progress/end), creator goals, polls, predictions, chat messages, ad breaks, charity donations, title/category changes, stream online/offline. Also polled: viewer count, uptime, ad schedule, bits leaderboards, follower/sub totals. If you logged in before this list grew, press **Connect Twitch** again to approve the new permissions.

**Timer / countdown / subathon** at http://localhost:8420/countdown (also an OBS dock)
- The Starting Soon countdown is now controlled by the server: **Start** (1 / 5 / 10 / 15 / 30 min, 1 hour, or any length), **Pause / Resume**, **Reset**, **+/- minutes**, **set an exact time**, and **Hide / Show** it on stream. Change the label ("WE GO LIVE IN") and the message shown at zero.
- **When it hits zero** it can switch OBS to a scene (e.g. Gameplay, through the OBS connection on the Reward hooks page) and say something in chat.
- **Subathon mode:** while running, subs/resubs, gift subs, bits, follows and raiders add time automatically (you set the seconds for each, plus a cap) and a "+5:00 SUB FROM ANN" flashes over the clock.
- **Chat (mods):** `!countdown 10`, `!countdown +5`, `-30s`, `pause`, `resume`, `reset`, `hide`, `show`. Everyone: `!timeleft`. A **reward hook** action can add time too ("Change the countdown / subathon timer"). Labels: `countdown_remaining`, `countdown_status`.
- Without the server running, the overlay falls back to a plain countdown of `startMinutes` in `overlays/config.js`.

**Alert controls** (dashboard > Alerts): **Pause alerts** (new alerts wait in line and play when you resume), **Skip current**, **Clear waiting**, **Mute sounds** (alert sounds and voices stay quiet, banners still show), and **Recent alerts** with a **Replay** button. Mods: `!alerts pause|resume|skip|clear|mute|unmute`.

**Text-to-speech** at http://localhost:8420/tts: uses the voices installed in Windows (offline, free; this PC has Microsoft David and Zira). Pick a voice, speed, pitch and volume, try it (**Hear it here** or **Speak on stream**), and set words it must never read (your chat bot's banned words always apply too). Links, emoji and long repeated letters are tidied before speaking; clips are cached as WAV files in `data/tts/`.
- **Sound effects in messages:** a viewer can put one of **20 sound effects** in the middle of a spoken message by typing its name in square brackets: `good luck [airhorn] you will need it`. The voice reads the words and the sound plays right where the tag is. It works everywhere speech does (`!tts`, the TTS reward, alerts that read the viewer's message). The sounds are `[ding] [bell] [airhorn] [rimshot] [trombone] [boing] [whoosh] [laser] [coin] [powerup] [powerdown] [boom] [drumroll] [tada] [buzzer] [crickets] [applause] [pop] [siren] [sparkle]`; they were made from scratch for this app (8-bit style, nothing to license) and live in `sounds/tts/` (`python _build/make_tts_sfx.py` regenerates them). Up to 3 per message by default (1 to 6 on the Speech page, where each sound has a play button, and the whole thing can be switched off); extra ones are dropped, an unknown `[tag]` is just read as a word, and the never-read list still applies. A message of only a sound effect works too. A ready-made **Twitch panel** explaining how to use it is `twitch/panel_tts_640.png` (`python _build/make_tts_panel.py`).
- **Text-to-speech reward:** on the Speech page, **Create the reward on Twitch** makes a channel point reward with a box for the message (title, cost and cooldown are yours to set) and the hook that reads it. When a viewer redeems it, their message is read out loud (`{name} says {message}`) with the default voice, blocked words are never read, and the redemption is fulfilled. If the message cannot be read (blocked, empty, speech off), the viewer is told why in chat and the points are refunded. The same thing is a Reward Hooks action ("Read the viewer message out loud and fulfil the redemption"). Reward icons for it and for the 7TV emote reward (a "7TV" in 7TV colours) are in `twitch/reward_icons/` (`reward_tts_*.png`, `reward_emote_*.png`; Twitch has no API for a reward's icon, so upload them by hand under Viewer Rewards > Channel Points).
- **Alerts can speak:** edit an alert, tick **Read it aloud**, and choose what the voice says (default `{name} says {message}`, which stays quiet when there is no message). The voice plays right after the alert sound.
- **`!tts <message>`** for viewers: choose who may use it, a cost in your chat currency, and a per-viewer wait. Blocked or failed messages are refunded. Mods: `!ttsskip`.
- **Reward hooks:** the **Speak aloud** action reads what the viewer typed.
- The sound comes through the Alerts browser source, so keep **Control audio via OBS** ticked (already set in the starter scenes).
- **Realistic voices (Kokoro, free, offline):** installed in `server/kokoro` (about 120 MB; 41 voices such as `af_heart`, `af_bella`, `am_adam`, `am_michael`, `bf_emma`). They sound far more natural than the Windows voices. On this PC a short line takes about a second to make (the first one loads the model), so an alert's banner shows immediately and the voice follows a moment later. The Speech page lists them under "Kokoro: realistic"; pick one as the default, or per alert. If Kokoro ever fails the Windows voice is used so nothing goes silent. To install it elsewhere, run `server\install-kokoro.bat` (needs Python 3). Sample clips to compare: `server/kokoro/samples/`. Pitch only applies to Windows voices; speed works for both.
- More Windows voices/languages can be added in Settings > Time & language > Speech. Paid cloud voices (e.g. ElevenLabs) are not built in.

**Clips and the viewer commands page**
- `!clip` makes a clip of what just happened (needs you to be live; choose who may use it on the bot page's Settings tab) and replies with the link; the Stream info page has a **Create a clip now** button. Press **Connect Twitch** again once to grant the clips permission.
- **Commands page for viewers:** on the bot page > Commands, **Download commands page for viewers** gives a themed standalone HTML file (host it anywhere, e.g. a free page host, and link it from your Twitch panels) listing your custom commands plus the built-ins that are switched on. Add a short description to each command in the builder. **Copy text for a Twitch panel** copies the same list as Markdown for a panel description.

**Music: player controls + now-playing overlay** at http://localhost:8420/music (also works as an OBS custom browser dock)
- **Windows media (Apple Music, Spotify app, iTunes, foobar...)**, no sign-in: the server reads what your music app tells Windows it is playing (the same thing as the volume-flyout media controls). You get title, artist, album, album art and live progress, plus play / pause / next / previous / seek, shuffle and repeat. It picks the first music player it finds; choose a specific app (or "anything Windows is playing", e.g. YouTube Music in a browser) on the Music page. Needs Windows; uses the built-in Windows PowerShell.
- **Spotify account** (optional, adds volume, a song search box, "add to queue", and chat song requests): create a free app at developer.spotify.com/dashboard (Web API), add the Redirect URI shown on the Music page, paste the Client ID, press **Connect Spotify**. Controlling playback needs Spotify **Premium**.
- **Overlay:** add a Browser source `http://localhost:8420/overlays/nowplaying.html` (700 x 220). Themed card with album art, title (scrolls if long), artist, album, an animated "now playing" tag and a live progress bar. It slides in while music plays. `?mode=always` keeps it up when paused; `?mode=change&hold=12` pops up for 12 seconds at the start of each song (or set `nowPlayingMode` / `nowPlayingHold` in `overlays/config.js`). A fresh import of `ItMeCasey.json` already has it in the Gameplay and Full Cam scenes (bottom-left).
- **Chat:** `!song` (everyone) shows the current song; mods get `!skip !previous !pause !play !volume 50`. With Spotify, enable **song requests** on the Music page and viewers can type `!sr song name` or paste a Spotify link (choose who may request; 30-second per-viewer cooldown).
- **Labels / variables:** `now_playing`, `now_playing_title`, `now_playing_artist`, `now_playing_album`, `now_playing_status`, `now_playing_progress`, `now_playing_link` (also usable as `{now_playing}` etc. in commands).
- Not covered: Apple Music on a Mac (no Windows media session there) and Apple's own web API. Apple Music for Windows is expected to work through the Windows route but I could only test the Windows route with a browser player and a simulated Apple Music session.

**Discord bot** at http://localhost:8420/discord (left rail: Discord)
- A bot that runs inside the app (so it works while the app is running). You make it once on discord.com/developers (New Application > Bot > Reset Token) and paste the token on the page; it stays in `data/discord.json` on your PC and is never shown again. The page then gives you an invite link with exactly the permissions it needs (manage roles and channels, post, and what it hands to the Mods role) and no privileged intents.
- **Server setup:** press **Set up my server** and it adds what is missing, in your style: roles (Mods, Tier 1/2/3 Sub) and the categories INFO (#welcome, #rules, #announcements, #go-live, read-only: only the bot and mods post), COMMUNITY (#general, #clips, #game-chat, #bot-commands), VOICE (Lounge, Gaming 1, Gaming 2) and MODS (#mod-chat, #mod-log, private to Mods), with a welcome message (your Twitch and website links), the rules and a how-to-use message. It only ever **adds**: nothing that exists is changed, moved or deleted, so it is safe on a server you already use. **Show what will be added** lists it first.
- **Go-live post:** when the stream starts it posts the title, game and your Twitch link in #go-live (ping nobody, @here, @everyone or a role).
- **Slash commands:** `/commands` (the viewer commands, not the mod ones), `/games`, `/tts` (with the sound effects), `/top` (points leaderboard), `/live` and `/website`, answered from the same lists as the website. Check: `node discord-test.js`.

**Website for your viewers** at http://localhost:8420/site (left rail: Website)
- Three pages in the app's own look that you can send viewers to: **Commands** (every chat command that is switched on, including a "Mods & streamer" section with all the mod commands), **Games** (the games and stream events that are on, with your currency name and how to join in) and **Text-to-speech** (how to do it, the voice, the limits and all 20 sound effects with play buttons). They are made from what is on in the app right now, need no server and no domain, and load nothing from other sites.
- **Automatic publishing on Cloudflare Pages (free):** press **Connect Cloudflare** once (a browser window opens, you log in and press Allow: the app never sees your password), choose a name (it becomes `yourname.pages.dev`) and press **Publish now**. After that the app checks every few minutes whether the pages would say something different and uploads them again by itself, so a changed command or a new game shows up without you doing anything (you can switch that off). It uses Cloudflare's own command line tool (wrangler, fetched the first time with npx), so it needs Node.js on the PC. Without Node.js, **Build the website** makes the folder in `Documents\ItMeCasey Stream\website` for you to drag into Cloudflare Pages > Upload assets by hand. Check: `node site-test.js`.

**7TV emote rewards** at http://localhost:8420/emotes (left rail: Emote Rewards)
- A viewer redeems a channel point reward and pastes the link of a **7TV** emote (`https://7tv.app/emotes/...`). The app adds it to **your real 7TV emote set** (so everyone with 7TV sees it) and removes it again after 30 days (you choose the days). If the link is wrong, the emote is not allowed or the set is full, the viewer is told why in chat and the points are refunded.
- Set-up on the page: paste your 7TV login token (it stays on your PC, in `data/emotes7tv.json`), press **Test connection**, set the days and the most borrowed emotes at once, then **Create the reward on Twitch** (it makes the reward with a box for the link plus the hook that does the work). The page lists the borrowed emotes with their days left and can remove one early.
- Only 7TV links work: BetterTTV has no way to add emotes to a channel automatically, so BetterTTV links are refused and refunded. Emotes marked adult, flashing, private, unlisted or not allowed on Twitch are always refused (edgy ones too, unless you switch that off), a name that is already taken gets a number, and a full set is reported. Borrowed emotes whose time is up are removed every half hour (and at start-up). The 7TV request that does the adding uses 7TV's own GraphQL API, which can change.
- **Your 7TV emotes and search** (same page): a grid of the emotes in your 7TV channel set right now (with how many of the slots are used; viewer-borrowed ones have an orange border and the days left, and any emote can be removed with a two-click **Remove**), and a **search box for all of 7TV** with pictures: press **Add** to put an emote in your set for good, for 7 days or for 30 days. Search results the app would refuse (adult, flashing, private, unlisted, not allowed on Twitch) are greyed out with the reason. Seeing your set and searching need no login; adding and removing need the 7TV token.
- **7TV name paints in chat:** chatters who have a paint on 7TV (the colours, gradients, pictures and glow on a name) show it on their name in the stream chat overlay and in the mod dock. The app asks 7TV for each chatter's paint once (kept for half an hour; chatters without 7TV or a paint are checked again after 10 minutes) and draws it the way 7TV's own extension does. Switch it off with the checkbox under "2. Rules" or per source with `?paints=0` on the chat overlay URL. Paints with several layers may stack in a different order than on 7TV.
- **All the badges:** next to the Twitch badges, chatters' **7TV** badge, **BetterTTV** badges (developer, emote approver, subscriber...) and **FrankerFaceZ** badges (developer, bot, supporter, subwoofer) are shown in the stream chat overlay and the mod dock. BetterTTV and FrankerFaceZ publish their badge lists openly; the app keeps them for a day, and only pictures from those services' own servers are used. Switch them off with the checkbox under "2. Rules", or per source with `?badges=0` on the chat overlay URL (`chatBadges: false` in `overlays/config.js` hides every badge). Check: `node extrabadges-test.js`.
- The same thing is a Reward Hooks action ("Add the 7TV emote the viewer pasted") if you want it on a reward you already have. Check: `node seventv-test.js`.

**Channel point reward hooks** at http://localhost:8420/hooks
- Pick a reward (from your Twitch list), or "reward name contains ...", or any reward, then build a list of **actions** that run in order, each with an optional delay:
  - **Show an overlay alert:** fires one of your own Custom alerts (create it under Alerts on the dashboard and use its trigger key).
  - **Say in chat** (normal or highlighted announcement) and **run a chat command** (`!so {input}`, `!addquote {input}`, any custom command; optionally with your permissions so mod commands work).
  - **Call a webhook:** POSTs JSON (or your own body) to any web address: Stream Deck, Home Assistant, Zapier, your own script.
  - **Show an OBS source for N seconds** (or switch scene) through OBS's built-in WebSocket.
  - **Give or take currency**, **change a counter**, and **mark the redemption fulfilled or cancel and refund** it.
- Messages and commands can use every variable: `{name}` (the viewer), `{input}` (what they typed), `{reward}`, `{cost}`, `{1}`, plus all the usual ones (`{points}`, `{game}`, `{randomname}`, `{counter.x+}`, any tracked stat...).
- **OBS setup:** in OBS open Tools > WebSocket Server Settings, enable it, then enter the port and password on the hooks page and press **Test connection**. **Load my scenes** gives scene and source suggestions. Your OBS password is stored only in `data/state.json`.
- **Test** runs a hook's actions for real with a sample viewer (OBS, webhooks and chat included). **Recent runs** shows what each action did, with the reason for any failure.
- Limits from Twitch: marking a redemption fulfilled or refunded only works for rewards this app created, so use **Create a reward on Twitch** on the hooks page for those. Rewards need Affiliate or Partner. Press **Connect Twitch** again once to grant the "manage redemptions" permission.
- Dashboard "Test alerts" buttons never trigger hooks; only real redemptions do.

**Ads** at http://localhost:8420/ads (also works as an OBS custom browser dock)
- Live countdown to the next automatic ad (or the time left in a running one), last ad, snoozes left and when they refill, ad-free time earned.
- **Run an ad now:** 30 / 60 / 90 / 120 / 150 / 180 seconds (two clicks to confirm). Optional "Tell chat first" posts a heads-up. **Snooze next ad** pushes the next automatic ad back (~5 min) while you have snoozes left.
- **Chat messages around ads:** optionally post when an ad starts (default text: "Twitch is rolling a quick ad break. To avoid ad-breaks like this, you can !sub, !prime, or use Twitch Turbo!", as a highlighted Announcement), warn chat N seconds before the scheduled automatic ad ("Ad break in {seconds} seconds..."), and thank chat when an ad ends. Off by default.
- **From chat:** mods `!ad 60` and `!snooze`; everyone `!nextad`.
- Needs Affiliate or Partner and you must be live to run ads. Press **Connect Twitch** again once to grant the two new permissions (run commercials, manage ad schedule). The existing `next_ad_in`, `next_ad_time`, `ad_status` label files keep working for an on-stream countdown.

**Stream title + category** at http://localhost:8420/stream (also works as an OBS custom browser dock)
- Shows what's on Twitch right now (title, category with box art). Edit the **title** (140-character counter) and **search categories** as you type: results show box art, click one to select it. Recent categories are one click away. **Update stream info** changes both on Twitch; **Clear category** removes it.
- **Presets:** save a title + category and apply it with one click for your usual go-live setups.
- **From chat** (mods): `!title New title` and `!game Tetris` (also `!settitle` / `!setgame`). The bot takes the exact category match, or the first result that starts with or contains what was typed; if it can't tell it lists the closest names ("Not sure which you meant: ... Use the exact name"). `!gamesearch name` lists categories without changing anything. Anyone can type `!title` or `!game` to see the current ones. Changes made either way update the `stream_title` / `stream_game` labels immediately.
- Needs the "change title/game" permission: press **Connect Twitch** again once if you logged in before this existed.

**Polls and predictions** at http://localhost:8420/polls (also works as an OBS custom browser dock)
- **Poll:** question, 2-5 choices, length (15s to 30min), optional channel-point voting. Live vote bars and a countdown; **End poll** shows the result, **Delete / archive** removes it.
- **Prediction:** question, 2-10 outcomes, voting window. Live point and viewer totals per outcome; **Lock** stops betting, **Winner: ...** locks if needed and pays out (two clicks to confirm), **Cancel** refunds everyone.
- **Presets:** save a question and options once and launch it with one click. Optional chat announcement when you start a poll or prediction or pick a winner (sent by the bot).
- Polls and predictions need Affiliate or Partner status on Twitch. Press **Connect Twitch** again once to grant the two new permissions (manage polls, manage predictions).
- **On-stream overlays** (themed, slide in when a poll or prediction starts and out when done): add Browser sources `http://localhost:8420/overlays/poll.html` (620 x 560) and `http://localhost:8420/overlays/prediction.html` (620 x 620). The panel draws in the top-left of its source, so position the source where you want it. A fresh import of `ItMeCasey.json` already includes both in the Gameplay, Just Chatting and Full Cam scenes. If you already imported before, add the two sources yourself (re-importing would replace your webcam and game settings).
  - Poll: live bars with votes and percent, countdown, then a RESULTS card with the leader highlighted. Prediction: Open (countdown, payout ratio per outcome), Locked, then the winner highlighted and the rest dimmed, or Refunded if cancelled. Results stay on screen 15 seconds (`pollResultSeconds` in `overlays/config.js`, or `?hold=20` on the URL).
  - Try them without a real poll: dashboard **Test alerts** has **Poll overlay** and **Prediction overlay** buttons that run a scripted demo for ~45 seconds.
  - If you start the server in the middle of a poll or prediction, the overlay picks it up from Twitch.
- The `poll_*` and `prediction_*` label files also work (see LABELS.md).

**Chat bot (Nightbot-style)** at http://localhost:8420/bot
- **Command builder** (bot page > Commands > + New command): write what the bot says and click variables from a searchable palette to drop them in; a **live preview** shows the result with real numbers and flags any `{variable}` it doesn't recognise. Both `{name}` and `$(name)` work.
  - **Viewer:** `{name} {username} {touser} {randomname} {points} {rank} {watchtime} {streak} {currency}`. **Command:** `{args} {1} {2}... {count} {prefix}`. **Stream:** `{channel} {game} {title} {viewers} {uptime} {followers} {subs}`.
  - **Random, math, time:** `{random 1 100} {pick a|b|c} {randomfollower} {randomsub} {quote} {math 5*3+1} {time} {date} {urlfetch https://...}`.
  - **Tracked stats:** every dashboard label is a variable too, e.g. `{latest_follower} {session_bits} {total_follower_count} {goal_progress} {stream_uptime} {next_ad_in} {currency_top}` (about 100, all in the palette).
  - **Your own variables:** text (`{var.discord}`), lists that pick a random item (`{var.mood}`), and counters (`{counter.deaths+}` adds one, `{counter.deaths}` reads it). Manage them under *Your variables & counters*, or mods type `!setvar name text` / `!listadd name item` in chat.
  - **Builder options:** several lines can all be sent, one picked at random, or rotated; require words after the command (with your own usage message); live-only commands; reply style (normal chat or announcement); cooldowns and who can use it.
- **Announcements** (the highlighted, colored banner in chat): any command, timer, event message, or dashboard "say" can be sent as an Announcement in your channel color, blue, green, orange or purple. Mods can type `!announce [color] message`. Needs the "announcements" permission (press Connect Twitch again once). If a separate bot account isn't a moderator it falls back to your account.
- **Custom commands** (older syntax still works): `$(user) $(touser) $(1) $(query) $(count) $(channel) $(game) $(title) $(uptime) $(viewers) $(followers) $(subs) $(points) $(random 1 100) $(pick a|b|c) $(chatter) $(counter deaths+) $(time) $(date) $(urlfetch https://...)`. Per command: who can use it (everyone / subscriber / VIP / mod / broadcaster), aliases, global + per-user cooldown, enable switch, use count. Mods and the broadcaster skip cooldowns. Mods can manage commands in chat too: `!addcom`, `!editcom`, `!delcom` (flags `-ul=` and `-cd=`).
- **Edit `!commands` and `!tts`:** on the bot page > Commands > Built-in commands you can change what they say and give them other names. `!commands` has its reply (use `{list}` for the list of commands and `{website}` for your website address, plus `{user}` and `{prefix}`), up to 5 other names (like `!cmds`, `!help`) and its wait. `!tts` has every message it can send (when used with no message, after it is sent to the stream, not allowed, could not be read, off, not allowed to use it, must wait, cannot afford it) and up to 5 other names (like `!say`); who can use it, the cost and the wait stay on the Speech page. Another name cannot be one that is already taken, an empty box goes back to the standard text, and the other names show on the commands page.
- **Built-ins:** `!commands !uptime !game !title` (mods can set the game/title) `!followage !accountage !so !permit !quote !addquote !delquote !counter`, plus the games below. Starter commands `!lurk !hug !socials` are ready to edit.
- **Timers:** repeating messages every N minutes, only after N chat lines, optionally only while live.
- **Spam protection:** links (with allowed domains and `!permit`), excess caps, symbol spam, emote spam (counts BTTV/FFZ/7TV too), repeated characters/words, long messages, banned words and /regex/. Action is delete, timeout (doubles on repeat offences) or ban, with a rank that is exempt and an optional chat warning. Off by default.
- **Currency** (bot page > Currency + Shop tabs): name it anything (`!coins`, `!bits`...); viewers earn it every minute while chatting (subs earn extra) and can claim `!daily` with a streak bonus. Optional bonuses when someone follows (once per person), subs, resubs, gifts subs, cheers bits or raids you. Check with `!points` (or `!<your currency name>`), `!top`, `!watchtime`. Chatters can send currency to each other with `!give <user> <amount|all>` (aliases `!pay`, `!send`): it can't go to yourself or exceed your balance, and shows in the ledger.
- **Shop:** make rewards viewers buy with `!shop` and `!redeem <item or number> [message]`. Each item has a cost, optional stock, cooldowns, a chat reply, an optional **alert trigger key** (fires one of your own Custom alerts on stream) and an optional **approval** step: pending redemptions appear on the Shop tab (Approve, or Deny and refund) and mods can use `!approve 3` / `!deny 3`.
- **Admin:** give, take or set any viewer's balance from the dashboard or chat (`!addpoints`, `!removepoints`, `!setpoints`, `!bonus n` for everyone active). A ledger shows where currency came from and went. Balances never go below 0.
- **Games** (all of these spend and win the same currency; win chances and rewards are on the Games tab): `!gamble !slots !duel/!accept !8ball !roll !flip`, mod-run `!trivia` (25 questions, edit them in `data/bot.json`) and `!raffle open / !enter / !draw`.
- **Pixel games, one overlay** (`overlays/arena.html`, the "Game Arena" source): duels, **boss raid** (`!boss` mod, everyone `!hit`; subs hit 2x, bits/subs/raids land big blows; prizes by damage), **arena royale** (`!arena` mod, `!join`, up to 8 fighters, last one takes the pot) and **team battle** (`!teams` mod, `!red`/`!blue`; the smaller team hits harder). All results are decided on the server, so ping never matters. Settings and Test buttons are on the Chat Games page.
- **Spin the wheel** (same Game Arena overlay; Chat Games page > Spin the wheel): the streamer and mods only. Type your options into the input boxes (2 to 16) and give each one a chance in percent: change one and the others adjust so the total is always 100%, and the slices are drawn that size. Mods type `!wheel` (spins your saved list), `!wheel pizza, tacos, sushi` (a list typed on the spot, all equally likely) or `!wheel stop`. The page also has **Save and spin now**, **Test (silent)** and **Stop**. The winner is picked on the server, the pixel wheel spins about 7 seconds and lands on it, and the bot says the result in chat. An option at 0% is left off the wheel.
- **Word Rush** (its own full-screen overlay, `overlays/words.html`, 1920 x 1080; Chat Games page > Word Rush): mods and the streamer only. Each round the screen shows a rack of letters and a board of hidden words that can be made from them. Chat just types a word (no command); the first person to type a word gets it, worth its length times the points per letter, with a bonus for a word that uses every letter. Halfway through the round the first letter of every missing word is shown.
  - **No round limit:** it keeps going as long as chat **beats each round** and ends when chat fails a round or a mod stops it. Beating a round means finding a share of the board: 50% in round 1 by default (you can change it), **5% more every round**, until chat has to find every word (100%). `!words 3` plays a fixed 3 rounds instead.
  - **It gets harder:** every round adds one letter (you set how many it starts with, 4 to 7, up to 9 in play; bigger racks get more time, and once the rack is full the rounds get shorter). From round 2 some letters are **unknown** (shown as `?`, revealed one by one during the round). From round 3 some tiles are **fake**: they look like any other letter but no word on the board uses them (the review shows which they were).
  - **Points:** when a round ends the board is revealed and **points are paid out in your chat currency** (each viewer gets what they earned, plus a bonus for the round's top scorer), even if the round was failed. The match keeps one running score and crowns a champion.
  - **All-time board:** every chatter's all-time Word Rush points and best round are kept, along with the **record** (the most rounds chat ever beat in one game). Everyone can type `!wordtop`; the game-over screen shows the top 5 and flashes NEW RECORD; the Chat Games page lists the top 10 and can reset them.
  - **Commands:** `!words` starts it, `!words skip` ends the round now, `!words stop` ends the game (what was earned this round still pays). The page has the same buttons plus a silent **Test**, and settings for the limit, the percentage needed, seconds, starting letters and point values. The overlay is invisible until a game runs; add the **Word Rush** browser source `http://localhost:8420/overlays/words.html` (the starter scenes already include it). The word list is `server/words-list.txt` (3 to 9 letter words from the ENABLE list, public domain).
- **Horse race** (same Game Arena overlay): `!race` (mod) or the Chat Games page opens a Twitch prediction with one choice per horse, viewers bet channel points, then bets lock, the horses race, the winner is picked (random, or the one you choose) and the prediction is resolved so Twitch pays out. `!race now`, `!race cancel`. Needs Affiliate/Partner.
- **Event messages:** optional "thanks for the follow / sub / raid..." lines in chat (off by default; test alerts never trigger them).
- **Replies as you by default.** To reply under its own name like Nightbot, connect a second Twitch account in the bot page's Settings tab and press **Connect Twitch** on the dashboard once so your login grants permission. This bot-account path is untested.
- Everything saves to `data/bot.json`. The bot needs the same login as the rest of the server, so press **Connect Twitch** again once to approve the new permissions (bot, change title/game, shoutouts).
- Checks: `node bot-test.js` simulates a whole chat (80+ replies) and `node test-mock.js` confirms replies go out through Helix.

**Editable alerts** (dashboard > **ALERTS**)
- **Bits alerts show the cheer badge:** the Bits alert shows the pixel cheer badge of the tier that was cheered (1, 100, 1,000, 5,000, 10,000, 25,000, 50,000, 75,000, 100,000, 200,000, 300,000, 400,000 or 500,000 bits, the highest tier that fits) in place of the logo; it spins in and then wiggles while the alert is up. If the Bits rule has its own **image**, that image is used instead. The pictures are `assets/bits/` (made by `_build/make_bit_badges.py`).
- **Sub alerts show the sub badge:** new subs, resubs and gift subs show the pixel sub badge for the sub's **tier** (Tier 1, 2 or 3: Tier 2 has the silver II bars, Tier 3 the gold III bars) and **months** (base for a new sub, then 2, 3, 6 and 9 months, 1 year and every half year up to 8.5 years: the highest step that fits, so 30 months shows the 2.5 year badge with its year number and a gold plus), and it spins in and wiggles like the cheer badge. A rule's own image wins. The pictures are `assets/subs/` (made by `_build/make_sub_badges.py`). The dashboard's Test alerts can try other values: `POST /api/test {"type":"resub","tier":"3000","months":30}` (also `bits`).
- Every alert type is a *rule* you can edit or add to: Follow, New sub, Resub, Gift subs, Bits, Raid, Channel point redemption, Hype train start/end, Goal reached, Charity, Tip, and **Custom**.
- Per rule: the **tag** (small badge), **title** (big line) and **message** with variables like `{name} {amount} {months} {tier} {message} {total} {viewers} {reward} {level}`; color (palette swatches or any color); **sound** (pick one or upload .wav/.mp3/.ogg) with volume; seconds on screen; badge **image** (your logo, or upload png/gif/webp/jpg); on/off switch.
- Tiers by amount: add a second rule with a minimum, e.g. *Bits, min 1000* with a bigger look and sound. The best matching enabled rule wins (higher minimum, or a "reward contains" match for channel points). Turn every rule for an event off to silence it.
- **Custom alerts** fire from anything that can send a web request (Stream Deck, bot, script): create a Custom rule with a trigger key such as `lurk`, then `POST http://localhost:8420/api/event` with `{"event":"custom","key":"lurk","name":"Sam"}`.
- The **Test** button plays the alert in the dashboard's live preview and in OBS. **Reset to defaults** restores the standard set. Uploads are saved in `sounds/custom/` and `assets/custom/`.

**Custom goals (progress bars for any scene)**
- Dashboard > **MY GOALS > + New goal**: pick a title, what it counts, the target, an optional "start at", a color (palette rainbow, aqua, orange, rust, cream) and a style (Bar or Slim).
- It can count: total followers, total subs, sub points, new followers/subs/bits/raids/chat messages/chatters/redemptions/tips this stream, all-time bits, current or peak viewers, or **Manual** (use +1 / +10 / Set on the dashboard, for things Twitch doesn't track).
- Press **Copy OBS URL** on a goal, then in OBS **Add > Browser**, paste the URL, size **1000 x 140** (Slim: 1000 x 100). Add the same goal to as many scenes as you like, or make several goals.
- Bars animate as numbers change, and show "Goal reached!" at 100%. Optionally also fires an on-stream alert once when reached. Each goal also writes `goal_<name>.txt` and `goal_<name>_percent.txt` label files.
- Total followers/subs need the Twitch connection; "this stream" counters reset when the stream goes live.

**Chat + moderation dock** (BTTV, FrankerFaceZ, 7TV and Twitch emotes, badges, mod tools)
- In OBS: **Docks > Custom Browser Docks**, name it `Chat + Mod`, URL `http://localhost:8420/dock`, Apply. It also works in any normal browser tab.
- Hover a message for **Del / 10s / 10m / 1h / Ban** (Ban asks for a second click). Click a username to show only that person's messages.
- Top bar toggles **Slow, Followers, Subs, Emotes, Unique** chat modes; **Clear** wipes chat (second click confirms).
- Type in the box to send as yourself. Commands: `/timeout name [secs]`, `/ban name`, `/unban name`, `/clear`, `/slow [secs]`, `/slowoff`, `/followers [mins]`, `/followersoff`, `/subs`, `/subsoff`, `/emoteonly`, `/emoteonlyoff`.
- **Twitch inline GIFs** (added July 2026) show as pictures in the dock and the on-stream chat. This relies on the `gif` message fragment from Twitch's changelog (`gif.url` and `gif.gif_id`); only https GIF addresses are shown, anything else falls back to the message text. The anonymous fallback chat (used only when the server isn't connected) can't show them.
- Deleted and timed-out messages show struck through in the dock and disappear from the on-stream chat overlay.
- Emote sets (global + your channel) refresh every 30 minutes. The on-stream chat overlay (`overlays/chat.html`) uses the same feed, so third-party emotes and badges show there too (`chatBadges: false` in `config.js` hides badges). If the server isn't connected it falls back to plain anonymous Twitch chat.
- Moderation needs extra permissions (manage messages, bans, chat settings, send chat). Press **Connect Twitch** again once to grant them.

**Tips (Stripe, no PayPal):** Twitch has no donation system, so tips go through a Stripe Payment Link that the server polls (no public URL or tunnel needed).
1. Sign up (free): https://dashboard.stripe.com/register . You can try everything in **Test mode** first; to take real money Stripe will ask you to activate the account (identity + bank account).
2. Dashboard > **Payment Links > New**. Add a product (e.g. "Tip Jar"), set the price to **Customers choose what to pay**, and add two **custom fields**: a text field labelled `Your name` and an optional text field labelled `Message`. Set your thank-you message (or redirect URL) under *After payment*. Branding (logo, colors) is under Settings > Branding.
3. Dashboard > **Developers > API keys > Create restricted key**. Give it only **Checkout Sessions: Read**. Copy the key (`rk_live_...`, or `rk_test_...` in test mode).
4. Paste it into `server/config.json` under `stripe.apiKey`. Optional: put the link's id (`plink_...`, from the link's page URL) in `stripe.paymentLinkId` so only that link triggers alerts. Restart the server; the dashboard shows "Tips (Stripe): connected".
5. Put the Payment Link URL in your Twitch panels / a chat command.

Each paid payment becomes a tip alert and updates `latest_tip`, `session_tip_total`, `session_top_tipper`. Payments made before the first start are ignored (no replay of history). Keep `config.json` private: the key can read your Stripe payments.
Other sources can still send tips with `POST http://localhost:8420/api/event` and JSON `{"kind":"tip","name":"Sam","amount":10,"currency":"USD","msg":"hi"}`.

**Label files:** 95 live text files in `data/labels/` (followers, subs, bits, raids, redemptions, hype train, goal, poll, prediction, stream info/uptime/viewers, chat, ads, charity, session + all-time stats). Full list with descriptions: [LABELS.md](LABELS.md), also browsable with live values on the dashboard. In OBS add a *Text (GDI+)* source > **Read from file**. Session counters reset when the stream goes online (or from the dashboard). Raw event history: `data/events.jsonl`; saved state: `data/state.json`.

**Checks:** `node selftest.js` (labels, alerts, goals), `node bot-test.js` (chat bot), `node hooks-test.js` (reward hooks), `node obs-test.js` (OBS client), `node media-test.js` (music), `node countdown-test.js` (timer), `node tts-test.js` (speech, uses the real Windows voices), `node scenes-test.js` (auto scenes + board), `node access-backup-test.js` (password / LAN / backup), `node video-test.js` (video alerts + overlay data), `node arena-test.js`, `node race-test.js` and `node wheel-test.js` and `node words-test.js` (the pixel games), `node beat-test.js` (Dance Party beat detection), `node refresh-test.js` (Twitch login renewal) and `node test-mock.js` (full login + EventSub flow against a fake Twitch). Both pass; neither has touched the real Twitch service.

## Twitch kit (`twitch/`)
Profile picture 800x800, banner 1200x480, offline screen 1920x1080, 8 panel headers (640x140): About, Schedule, Rules, Commands, Socials, Support, Gear, FAQ.
Pixel-art **cheer badges** for the 13 bits tiers (1, 100, 1,000, 5,000, 10,000, 25,000, 50,000, 75,000, 100,000, 200,000, 300,000, 400,000, 500,000) in `twitch/bit_badges/` at the three sizes Twitch asks for (18, 36 and 72 px). Twitch has no upload API for them: add them by hand under Viewer Rewards > Bits > Cheer Badges on your Twitch dashboard. `python _build/make_bit_badges.py` regenerates them.
Pixel-art **subscriber badges** (a star that grows and changes colour) for base, 2, 3, 6 and 9 months, 1 year and then every half year up to 8.5 years (21 badges per tier) for each of Tier 1, 2 and 3 (63 files in `twitch/sub_badges/tier1`, `tier2` and `tier3`, each at 18, 36 and 72 px; Tier 2 adds two silver bars like a roman II and Tier 3 three gold bars like a III in the bottom left corner; the two flairs are also on their own as transparent overlays in `twitch/sub_badges/flair/`); from 1 year the star shows the number of full years and a half year adds a small gold plus. Upload them by hand under Viewer Rewards > Subscriptions > Subscriber Badges. `python _build/make_sub_badges.py` regenerates them.
Pixel-art **emotes** in `twitch/emotes/` (28, 56 and 112 px, transparent background): a heart for Tier 1, 2 and 3 plus the Tier 1 heart in 9 more colours (`python _build/make_heart_emotes.py`), and hype, laugh, sad, gg, hi, lurk, rip, rage, sleep, cheers, facepalm, thumbsup, shocked and salute (`python _build/make_emotes.py`). Add them by hand under Viewer Rewards > Emotes on your Twitch dashboard.
**Channel points icon:** a pixel "1UP" coin in `twitch/channel_points/` (`points_icon_28.png`, `_56.png` and `_112.png`; `python _build/make_points_icon.py` regenerates them). Twitch has no upload API for it: add it by hand under Viewer Rewards > Channel Points > Customize on your Twitch dashboard.
**Animated emotes** in `twitch/emotes/animated/` (looping GIF and APNG at 28, 56 and 112 px, transparent): howdy, jam, clap, pet, modcheck, shake, dance, riot and wave (`python _build/make_animated_emotes.py`). Check Twitch's current animated emote rules (size, frames, who may upload them) before adding them.

## Rebuild / customize
`_build/build_graphics.py` regenerates every image, sound and the stinger; `node server/collection.js ItMeCasey.json` rewrites `ItMeCasey.json` (the app builds it on demand from Setup; `_build/build_collection.py` is the older Python version). If you move this folder, re-run `python build_collection.py` so the file paths update. Change the tagline/scene text at the top of `main()` in `build_graphics.py`.

## Not included
Background music (use royalty-free tracks, e.g. Pretzel / StreamBeats) and emotes/badges.
