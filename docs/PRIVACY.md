# Privacy

ItMeCasey Stream runs on your own PC. It does not have an account system, does not collect analytics and does not send anything to the author.

## What stays on your PC
Settings, the chat bot's data (commands, points, quotes), your Twitch login, any bot account, PayPal or Spotify details you add, uploaded sounds and videos, panels and backups are stored in `%APPDATA%\ItMeCasey Stream\data` (or `Documents\ItMeCasey Stream\data` in the Microsoft Store version). Logins are kept in files on your PC and are left out of backups unless you choose to include them.

## What the app contacts
| Service | Why | When |
|---|---|---|
| Twitch (twitch.tv, id.twitch.tv, api.twitch.tv, eventsub) | login, alerts, chat, stream tools | always, once you connect |
| BetterTTV, FrankerFaceZ, 7TV | emote pictures for the chat overlay | at startup |
| Apple iTunes Search (itunes.apple.com) | album art for the song that is playing, when Windows cannot supply one (sends artist and title) | while music plays |
| GitHub (api.github.com) | checks whether a newer version exists | at startup and twice a day; can be turned off in Setup |
| VB-Audio (vb-audio.com) | downloads Voicemeeter | only when you press Download |
| Spotify, PayPal, Stripe | features you connect yourself | only if you set them up |

Chat messages and viewer names are processed on your PC to run the bot, alerts and games. They are not sent anywhere else, except text-to-speech, which can run entirely on your PC (the realistic voices are optional and local).

## Audio
The music visualizer and Dance Party listen to your PC's audio output (or the Voicemeeter music bus) to draw the lights. The audio is analysed on your PC and never recorded or sent anywhere.

## Your viewers' data
The bot stores chatter names, ids and points on your PC so commands and games work. You can delete this from the Chat Bot page.

## Contact
Questions: open an issue on the project's GitHub page.
