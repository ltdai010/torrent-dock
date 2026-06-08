# TorrentDock

TorrentDock is a desktop-first torrent and magnet workflow app for legitimate content. The goal is to make authorized torrent streaming, downloads, and provider-based discovery easier without bundling piracy-oriented catalogs.

## Current Status

This repository contains the initial Tauri + React + TypeScript scaffold and the first technical docs:

- `techdocs/knowledge-exploration.md`: BitTorrent, magnet, peer discovery, DHT, streaming, and safety deep dive.
- `techdocs/engineering-spec.md`: Implementation architecture, data model, commands, flows, phases, and tests.

## Development

Prerequisites:

- Node.js
- Rust
- Tauri desktop prerequisites for your OS

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
npm run tauri:dev
```

Build the frontend:

```bash
npm run build
```
