# TorrentDock

TorrentDock is a desktop-first torrent and magnet workflow app for legitimate content. It uses Electron, React, TypeScript, Video.js, and an rqbit sidecar to make authorized torrent streaming and downloads easier without bundling piracy-oriented catalogs.

## Development

Prerequisites:

- Node.js 22+
- npm

Install dependencies:

```bash
npm install
```

Run the web UI:

```bash
npm run dev
```

Run the desktop app:

```bash
npm run sidecar:prepare
npm run electron:dev
```

`sidecar:prepare` downloads the correct rqbit sidecar binary into `resources/binaries/`. Docker web development still starts rqbit as a Compose service, while packaged desktop builds bundle the sidecar as an Electron resource.

## Verification

Build the frontend:

```bash
npm run build
```

Run the full local check suite:

```bash
npm run check:all
```

Run the same checks in Docker:

```bash
docker compose -f docker-compose.check.yml up --build --abort-on-container-exit
```

Run the web UI in Docker:

```bash
docker compose -f docker-compose.dev.yml up --build
```

Then open:

```text
http://localhost:1420
```

## Desktop Builds

Windows:

```bash
npm run electron:build:win
```

macOS builds must be produced on macOS:

```bash
npm install
npm run sidecar:prepare:mac
make mac-check
make mac-dev
make mac-build
```

For a universal macOS app bundle:

```bash
make mac-build-universal
```

`electron:build:mac` prepares the universal rqbit sidecar automatically. For a distributable signed build, run on a machine with a valid Apple Developer ID certificate available to `electron-builder`; notarization credentials should be supplied through your release environment before publishing.

Linux:

```bash
npm run electron:build:linux
```
