# LAB 438 Multi-Speaker Audio Control

Local-first control surface for routing background music and sound effects to separate Windows audio outputs. The control page can run on the laptop or another device on the same private Wi-Fi network; the Playback page must stay open in a recent Chrome or Microsoft Edge window on the laptop connected to the speakers.

## Requirements

- Windows 11
- Node.js 20 or newer
- npm 10 or newer
- Recent Chrome or Microsoft Edge with Audio Output Devices API support
- Speakers paired in Windows before binding them in Playback Mode

## Run in development

```powershell
cd C:\Users\ASUS\Escape-Room-3D-view\audio-control
npm install
npm run dev
```

Open:

- Control UI: `http://localhost:5173`
- Playback Mode: `http://localhost:5173/?mode=playback`

The local service listens on port `5180`. Vite proxies API and WebSocket traffic during development.

## Production/offline run

```powershell
npm run build
npm start
```

Open `http://localhost:5180`. For a phone or tablet, use `http://<laptop-ip>:5180` on the same private Wi-Fi network. Remote control clients must enter the control PIN. The default PIN is `438438`; change `controlPin` in `data/config.json` or set the `CONTROL_PIN` environment variable before deployment.

## Audio setup

1. Pair Bluetooth speakers in Windows Settings.
2. Open Playback Mode on the laptop and leave it open.
3. Press **Select output** for each logical zone and approve the browser output picker.
4. Press **Test** to verify the physical speaker.
5. Put supported audio files in `audio/` and press **Scan audio folder**, or upload them in the Library drawer.
6. Mark music files as Background and sound pads as Effect.

The system never reroutes a disconnected zone automatically. Commands sent while Playback Mode is offline are rejected rather than queued. Bluetooth devices from different brands can have different latency and are not guaranteed to stay synchronized.

## Commands

- `npm run dev` — run the web UI and local service
- `npm run build` — type-check and build client/server output
- `npm start` — run the production local service
- `npm test` — run unit tests
- `npm run check` — type-check client and server without producing a new build

## Local data

- `audio/` — playable files
- `data/config.json` — room, zone and PIN settings
- `data/library.json` — audio metadata and button behavior
