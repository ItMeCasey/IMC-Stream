# Importing StreamElements / Streamlabs alerts (Alert Builder)

Researched October 2026 from the public docs. What could not be verified is marked **unverified** and is not built.

## What the two services actually use

**StreamElements** (docs.streamelements.com)
- Custom widget / custom alert code has four tabs: **HTML**, **CSS**, **JS**, **FIELDS**. The community widget repo stores a widget as `widget.html`, `widget.css`, `widget.js`, `widget.json` (the fields).
- FIELDS is JSON: each key is a field name with `type`, `label`, `value`. Types named in the docs: `text`, `colorpicker`, `dropdown`, `slider`, `image-input`, `googleFont` (third-party docs add `number`, `checkbox`, `hidden`, `button`).
- `{{field}}` is substituted in HTML and CSS. JS gets values as `obj.detail.fieldData` in `onWidgetLoad`.
- Alert box inline variables, `{{x}}` or `{x}` (equivalent): `name`, `amount`, `tier`, `sender`, `currency`, `items`, `announcement`, `message`, `messageRaw`, `image`, `video`, `audio`, `videoVolume`, `audioVolume`, `widgetDuration`. `amount` is months for resubs.
- Browser events: `onWidgetLoad` (`detail`: `fieldData`, `session.data`, `recents`, `currency`, `channel`) and `onEventReceived` (`detail.listener` = `follower-latest`, `subscriber-latest`, `host-latest`, `cheer-latest`, `tip-latest`, `raid-latest`; `detail.event` has `name`, `amount`, `message`, `gifted`, `sender`, `bulkGifted`, `isCommunityGift`, `playedAsCommunityGift`).
- **Purchased overlay packs are not files you can read.** They ship an import link (a `.url` shortcut) that only works logged in to StreamElements. Third-party importers ask for your JWT token. There is no documented overlay JSON. The importer does not log in, take tokens or fetch anything.

**Streamlabs**
- Alert Box has a "Custom HTML/CSS/JS" toggle and custom JSON; message templates use single braces. Documented parameters: `{name}`, `{amount}` (donation, bits), `{months}`, `{gifter}` (subs), `{count}` (host, raid), `{product}` (merch). Streamlabs' own custom-code reference could not be fetched (**unverified**: JS API names, custom JSON schema).
- Streamlabs Desktop overlays are `.overlay` files (sellers describe a zip; imported through Settings > Scene Collections). Internal layout and how it references assets are **unverified** (no public documentation found), so there is no `.overlay` reader.

**Typical purchased pack:** a zip of PNG / WebP / GIF / WebM (sometimes MOV, fonts) and MP3 / WAV sounds, plus the service-specific import file (`.overlay`, or a StreamElements link). The media is what we can use.

## What the importer reads (decided with the user)

You pick a `.zip` or single files you already own. Nothing is downloaded.
1. **Media**: PNG, GIF, WebP (incl. animated), JPG, WebM, MP4, WAV, MP3, OGG are copied into your custom asset folders under the same type and size limits as alert uploads (15 MB, video 80 MB). The first bytes must match the file type. Other files (MOV, fonts, `.overlay`, `.url`) are listed in the report as not imported.
2. **Custom code**: HTML + CSS + JS + fields JSON, in the StreamElements widget layout (`widget.html/css/js/json`) or any `.html` / `.css` / `.js` / `fields.json`. It becomes an HTML-mode design. Our own design JSON is also accepted.
3. Files in the zip that the code refers to are re-pointed at the copied media; the report lists anything missing.

## How closely our model mirrors theirs

HTML-mode designs accept both `{{name}}` and `{name}`, the StreamElements variable names above (message and every viewer value are HTML-escaped), `{{field}}` values from a design's fields JSON (sanitised in CSS), and fire the StreamElements browser events `onWidgetLoad` / `onEventReceived` with the field names above, so a typical widget runs unchanged. Existing designs keep working.

Not supported, and shown in the report when seen: external scripts, fonts or images (`https://...`; the sandbox has no network by design), `onSessionUpdate` data (session totals, goals), `SE_API`, TTS, chat messages, merch events, `.overlay` and StreamElements overlay files.
