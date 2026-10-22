# Contributing

Thanks for helping. The code is GPL-3.0-or-later (see LICENSE); by contributing you agree your changes are released under the same license. The art, sounds and branding are covered by ASSETS.md.

## Run it
```
npm install            # dev tools (ESLint) in the repo root
cd server && node server.js          # the server on http://localhost:8420
cd app && npm install && npm start    # the desktop app (needs Windows)
```
Keep the project in a normal local folder, not a cloud-synced one (Google Drive, OneDrive): npm and git can corrupt there.

## Before you send a change
- `npm run lint` must pass with no warnings.
- Run the tests: every `server/*-test.js` with `node` (GitHub Actions runs them all on each push).
- Add or update a test for new behaviour. Tests use fake Twitch, OBS and Voicemeeter, so nothing real is touched.
- Keep changes small and say in the description what you tried and what you did not test.

## Layout
`server/` the local server and bot (plain Node, no dependencies) and `server/public/` its pages; `overlays/` OBS browser sources; `app/` the Electron desktop app; `docs/` policies.

## Reporting a bug
Use the bug report form on GitHub. On the Setup page press **Copy diagnostics** and paste the text into the report.
