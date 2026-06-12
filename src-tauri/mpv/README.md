# TorrentDock mpv Runtime Directory

Place LGPL-only libmpv runtime files here before building platform installers.
TorrentDock uses `libmpv` directly; there is no packaged `mpv.exe` process fallback.

- Windows x86-64: `libmpv-2.dll` plus LGPL-compatible dependency DLLs.
- macOS x86-64 and arm64: `libmpv.2.dylib` plus LGPL-compatible dependency dylibs.
- Linux x86-64: `libmpv.so.2` plus LGPL-compatible dependency shared objects when not relying on system packages.

TorrentDock loads these files dynamically. If they are absent, native playback is unavailable and the app falls back to the HTML player.

Current local Windows test runtime:

- Source: `https://downloads.sourceforge.net/project/mpv-player-windows/libmpv/mpv-dev-x86_64-20260607-git-71ebd08.7z`
- File: `libmpv-2.dll`
- SHA-256: `02FA97CBDB32A651ADDBB0EAFCDC8446E3B4CB7A09DA83518DAC4FBF8D62FD81`
