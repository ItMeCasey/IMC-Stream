# IMC Audio Router (browser extension)

Sends one tab's (or page's) sound to a chosen audio device. With Voicemeeter that means: put a YouTube tab on **Voicemeeter AUX Input** and it is heard by you but kept out of the stream recording (VOD), because the app's Voicemeeter setup keeps the AUX input off OBS's VOD track.

A small speaker glyph appears in the bottom-left corner of a page once it has video or audio. It lights up (orange dot) while that page's sound is being sent somewhere.

## Build and install

```bash
node extension/build.js          # makes extension/dist/chrome and extension/dist/firefox
node extension/build.js --zip    # also makes a zip of each
node extension/test.js           # checks the logic, manifests and files
```

- **Chrome / Edge:** `chrome://extensions` (or `edge://extensions`), turn on *Developer mode*, *Load unpacked*, choose `extension/dist/chrome`. Pin the speaker icon from the puzzle-piece menu.
- **Firefox:** `about:debugging` > *This Firefox* > *Load Temporary Add-on*, choose `extension/dist/firefox/manifest.json` (temporary: it goes away when Firefox closes). A permanent install needs the zip signed by Mozilla.

## How it works

| | Chrome / Edge (116+) | Firefox (128+) |
|---|---|---|
| Method | Captures the tab's sound (`tabCapture`) and plays it through a hidden page on the chosen device (`setSinkId`) | Points the page's `<video>` / `<audio>` elements at the chosen device (`setSinkId`) |
| Select box | Toolbar popup (Chrome only allows capture after you click the extension). The glyph on the page tries to open it | The glyph's menu, then Firefox's own device picker |
| Covers | Everything the tab plays, including Web Audio, and frames | Plain media elements in the top page only |
| Remembered | The tab, until it is closed or you press *Back to normal* | The device per site |

While a Chrome tab is captured it stops playing on your normal output, so the sound only comes out where you sent it.

### Device names

Browsers show "Audio output 1, 2, 3" until the extension page may read device names. The popup then offers **Show device names**, which asks for the microphone once and lets go of it at once. Nothing is recorded or sent anywhere. The popup preselects a device whose name contains a word you set (default `Aux`, which matches *Voicemeeter AUX Input*).

## Privacy and permissions

- Chrome: `tabCapture`, `offscreen`, `storage`, `activeTab`. The glyph script runs on all pages but only draws the button.
- Firefox: `storage` only, https pages.
- No network access, no analytics, no data leaves the browser.

## Known limits

- Chrome cannot start a capture from the in-page glyph itself (needs the toolbar click); the glyph opens the popup where the browser allows it (Chrome 127+).
- After a browser restart, Chrome tabs have to be routed again.
- Firefox: Web Audio sound (some games and web players) and media in other sites' frames are not covered, and each site asks for permission once.
- Browser pages (`chrome://`, the Web Store, Firefox's own pages) cannot be captured.
