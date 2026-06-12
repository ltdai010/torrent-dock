# Third Party Notices

TorrentDock can optionally bundle a native mpv runtime for desktop playback. The app loads that runtime dynamically and falls back to HTML playback when it is absent.

## mpv

- Source: https://github.com/mpv-player/mpv
- Pinned tag: `v0.41.0`
- Pinned commit: `41f6a645068483470267271e1d09966ca3b9f413`
- License mode for TorrentDock runtime: LGPL-compatible build only.
- Required build constraints: `libmpv=true`, GPL disabled, no GPL-only optional dependencies.

## FFmpeg

- Source: https://github.com/FFmpeg/FFmpeg
- Pinned tag: `n8.1.1`
- Pinned commit: `239f2c733de417201d7ad3b3b8b0d9b63285b2b1`
- License mode for TorrentDock runtime: LGPL-compatible build only.
- Required build constraints: `--disable-gpl --disable-nonfree`, shared libraries enabled.

## LGPL Replacement Instructions

Users must be able to replace the bundled mpv/FFmpeg dynamic libraries with compatible modified versions. TorrentDock supports that by dynamically loading runtime files from the app resources directory:

- Windows: `resources/mpv/libmpv-2.dll`
- macOS: `Contents/Resources/mpv/libmpv.2.dylib`
- Linux: `resources/mpv/libmpv.so.2`

To replace the runtime, close TorrentDock, replace the matching dynamic libraries and dependent LGPL libraries in the `mpv` resource directory, then reopen the app. The runtime must expose the standard libmpv C ABI used by `src-tauri/src/playback/mpv.rs`.

Generated runtime artifacts must be accompanied by source links, build flags, checksums, and license texts. Record those details in `src-tauri/mpv-runtime.json` before publishing installers.
