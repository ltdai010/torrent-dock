import { app, BrowserWindow, ipcMain, screen } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const rqbitEndpoint = "http://127.0.0.1:3030";
const rqbitListenAddr = "127.0.0.1:3030";
const rqbitStartupAttempts = 60;
const rqbitStartupDelayMs = 250;
const probeMode = process.env.TORRENTDOCK_PROBE_MODE;
const isSmokeRun = probeMode === "smoke" || hasSwitch("smoke");
const isMediaProbeRun = probeMode === "media" || hasSwitch("media-probe");
const isPlaybackProbeRun = probeMode === "playback" || hasSwitch("playback-probe");
const isRqbitStreamProbeRun = probeMode === "rqbit-stream" || hasSwitch("rqbit-stream-probe");
const defaultTrackers = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce"
];
const defaultRqbitProbeSource = "https://webtorrent.io/torrents/sintel.torrent";
const playableExtensions = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".ogg", ".ogm", ".ogv", ".webm"]);

let mainWindow = null;
let rqbitChild = null;

function hasSwitch(name) {
  return process.argv.includes(`--${name}`) || app.commandLine.hasSwitch(name);
}

function writeProbeResult(result) {
  const text = JSON.stringify(result, null, 2);
  const outputPath = process.env.TORRENTDOCK_PROBE_OUTPUT || process.env.MEDIA_PROBE_OUTPUT;
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, text, "utf8");
  }
  console.log(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRqbitBinary() {
  const platformCandidates = {
    win32: ["rqbit-x86_64-pc-windows-msvc.exe", "rqbit-x86_64-pc-windows-gnu.exe"],
    darwin: ["rqbit-universal-apple-darwin", "rqbit-aarch64-apple-darwin", "rqbit-x86_64-apple-darwin", "rqbit"],
    linux: ["rqbit-x86_64-unknown-linux-gnu", "rqbit"]
  };
  const names = platformCandidates[process.platform] ?? ["rqbit"];
  const roots = [
    path.join(appRoot, "resources", "binaries"),
    path.join(process.resourcesPath ?? "", "binaries")
  ];

  for (const root of roots) {
    for (const name of names) {
      const candidate = path.join(root, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(`rqbit sidecar was not found. Checked: ${roots.join(", ")}`);
}

async function waitForRqbit() {
  let lastError = "rqbit did not answer";

  for (let attempt = 0; attempt < rqbitStartupAttempts; attempt += 1) {
    try {
      const response = await fetch(`${rqbitEndpoint}/torrents`, {
        signal: AbortSignal.timeout(1000)
      });
      if (response.ok) {
        return;
      }
      lastError = `rqbit returned HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(rqbitStartupDelayMs);
  }

  throw new Error(`rqbit sidecar did not become ready at ${rqbitEndpoint}: ${lastError}`);
}

async function ensureRqbitSidecar() {
  if (rqbitChild) {
    try {
      await waitForRqbit();
      return rqbitEndpoint;
    } catch {
      stopRqbitSidecar();
    }
  }

  const downloadsDir = path.join(app.getPath("userData"), "rqbit", "downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });

  const rqbitPath = resolveRqbitBinary();
  rqbitChild = spawn(rqbitPath, ["server", "start", downloadsDir], {
    env: {
      ...process.env,
      RQBIT_HTTP_API_LISTEN_ADDR: rqbitListenAddr
    },
    windowsHide: true
  });

  rqbitChild.stdout?.on("data", (chunk) => console.info(`[rqbit] ${String(chunk).trimEnd()}`));
  rqbitChild.stderr?.on("data", (chunk) => console.error(`[rqbit] ${String(chunk).trimEnd()}`));
  rqbitChild.on("exit", (code, signal) => {
    console.error(`[rqbit] exited: code=${code ?? "null"} signal=${signal ?? "null"}`);
    rqbitChild = null;
  });

  try {
    await waitForRqbit();
    return rqbitEndpoint;
  } catch (error) {
    stopRqbitSidecar();
    throw error;
  }
}

function stopRqbitSidecar() {
  if (!rqbitChild) {
    return;
  }

  const child = rqbitChild;
  rqbitChild = null;
  child.kill();
}

async function rqbitApiRequest({ method = "GET", path: requestPath, body = null, contentType = null }) {
  if (!requestPath?.startsWith("/")) {
    throw new Error("rqbit API path must start with '/'.");
  }

  const headers = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const response = await fetch(`${rqbitEndpoint}${requestPath}`, {
    method,
    headers,
    body: body ?? undefined,
    signal: AbortSignal.timeout(30000)
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await response.text()
  };
}

async function rqbitRequest(requestPath, init = {}, timeoutMs = 30000) {
  const response = await fetch(`${rqbitEndpoint}${requestPath}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(body || `rqbit returned HTTP ${response.status}`);
  }

  return body ? JSON.parse(body) : {};
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, init);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(body || `HTTP ${response.status}`);
  }

  return body;
}

async function fetchBytes(url, init = {}) {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw new Error(await response.text() || `HTTP ${response.status}`);
  }

  return Array.from(new Uint8Array(await response.arrayBuffer()));
}

function normalizeCatalogQuery(value) {
  return String(value ?? "").replace(/[^\p{L}\p{N}\s:'-]/gu, " ").split(/\s+/).filter(Boolean).join(" ").trim();
}

function slugifyCatalogQuery(value) {
  return normalizeCatalogQuery(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function sanitizeMediaSearchTitle(value = "") {
  return String(value)
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[._]+/g, " ")
    .replace(
      /\b(?:2160p|1080p|720p|480p|4k|uhd|hdr|hdr10|dv|webrip|web-dl|webdl|web|bluray|blu-ray|brrip|dvdrip|hdtv|x264|x265|h264|h265|hevc|avc|aac|dts|truehd|atmos|remux|proper|repack|extended|unrated|yts|rarbg)\b/gi,
      " "
    )
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function formatKind(value) {
  return {
    feature: "movie",
    movie: "movie",
    tvSeries: "series",
    tvMiniSeries: "mini series",
    tvMovie: "tv movie",
    video: "video"
  }[value ?? ""] ?? "title";
}

function normalizeText(value) {
  return String(value ?? "").split(/\s+/).filter(Boolean).join(" ");
}

function parseOptionalInt(value) {
  const parsed = Number.parseInt(String(value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildMagnet(infoHash, title) {
  const params = new URLSearchParams({
    xt: `urn:btih:${infoHash}`,
    dn: title
  });
  defaultTrackers.forEach((tracker) => params.append("tr", tracker));
  return `magnet:?${params.toString()}`;
}

function tpbCategoryLabel(category) {
  return {
    "201": "video / movie",
    "202": "video / movie dvdr",
    "203": "video / music video",
    "204": "video / clip",
    "205": "video / tv",
    "206": "video / handheld",
    "207": "video / hd movie",
    "208": "video / hd tv",
    "209": "video / 3d",
    "299": "video / other"
  }[category];
}

async function searchMovieTitles({ query }) {
  const normalizedQuery = normalizeCatalogQuery(query);
  const slug = slugifyCatalogQuery(normalizedQuery);
  const firstCharacter = slug.charAt(0);
  const response = await fetch(`https://v3.sg.media-imdb.com/suggestion/${firstCharacter}/${slug}.json`);

  if (!response.ok) {
    throw new Error(`Title lookup returned HTTP ${response.status}.`);
  }

  const payload = await response.json();
  return (payload.d ?? [])
    .filter((item) => item.id?.startsWith("tt"))
    .filter((item) => item.l)
    .filter((item) => ["movie", "feature", "tvSeries", "tvMiniSeries", "tvMovie", "video"].includes(item.qid ?? item.q ?? ""))
    .slice(0, 8)
    .map((item) => {
      const title = item.l ?? "Untitled";
      return {
        id: item.id ?? `${slugifyCatalogQuery(title)}-${item.y ?? "unknown"}`,
        title,
        year: item.y,
        kind: formatKind(item.qid ?? item.q),
        credits: item.s,
        imageUrl: item.i?.imageUrl,
        searchTitle: sanitizeMediaSearchTitle(item.y ? `${title} ${item.y}` : title)
      };
    });
}

async function searchTorrentSourceProvider({ query, providerId }) {
  if (providerId !== "the-pirate-bay") {
    throw new Error("Electron Chromium/FFmpeg test path currently enables The Pirate Bay provider only.");
  }

  const response = await fetch(`https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=0`);
  if (!response.ok) {
    throw new Error(`The Pirate Bay returned HTTP ${response.status}.`);
  }

  const apiResults = await response.json();
  return apiResults
    .filter((result) => result.id !== "0")
    .filter((result) => result.info_hash?.trim().length > 0)
    .filter((result) => !String(result.category ?? "").startsWith("5"))
    .slice(0, 24)
    .map((result) => {
      const title = normalizeText(result.name);
      const infoHash = result.info_hash.trim().toUpperCase();
      return {
        id: `the-pirate-bay-${result.id}`,
        providerId: "the-pirate-bay",
        providerName: "The Pirate Bay",
        title,
        sourceUrl: `https://thepiratebay.org/description.php?id=${result.id}`,
        magnetUri: buildMagnet(infoHash, title),
        infoHashV1: infoHash,
        size: parseOptionalInt(result.size),
        seeders: parseOptionalInt(result.seeders),
        leechers: parseOptionalInt(result.leechers),
        category: tpbCategoryLabel(String(result.category ?? ""))
      };
    });
}

async function runMediaProbe() {
  const probeWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  await probeWindow.loadURL("data:text/html;charset=utf-8,<html><body>media-probe</body></html>");
  const result = await probeWindow.webContents.executeJavaScript(`
    (async () => {
      const video = document.createElement("video");
      const audio = document.createElement("audio");
      const cases = [
        ["mp4_h264_aac", "video/mp4; codecs=\\"avc1.42E01E, mp4a.40.2\\""],
        ["mp4_hevc_hvc1_aac", "video/mp4; codecs=\\"hvc1.1.6.L93.B0, mp4a.40.2\\""],
        ["mp4_hevc_hev1_aac", "video/mp4; codecs=\\"hev1.1.6.L93.B0, mp4a.40.2\\""],
        ["webm_vp9_opus", "video/webm; codecs=\\"vp9, opus\\""],
        ["webm_av1_opus", "video/webm; codecs=\\"av01.0.05M.08, opus\\""],
        ["mkv_h264_aac", "video/x-matroska; codecs=\\"avc1.42E01E, mp4a.40.2\\""],
        ["mkv_hevc_ac3", "video/x-matroska; codecs=\\"hvc1.1.6.L93.B0, ac-3\\""],
        ["avi_mpeg4_mp3", "video/x-msvideo"],
        ["mov_h264_aac", "video/quicktime; codecs=\\"avc1.42E01E, mp4a.40.2\\""],
        ["flac", "audio/flac"]
      ];

      const canPlayType = Object.fromEntries(
        cases.map(([name, type]) => [name, { type, value: type.startsWith("audio/") ? audio.canPlayType(type) : video.canPlayType(type) }])
      );
      const mediaCapabilities = {};

      if (navigator.mediaCapabilities?.decodingInfo) {
        for (const [name, type] of cases) {
          try {
            const config = type.startsWith("audio/")
              ? {
                  type: "file",
                  audio: {
                    contentType: type,
                    channels: 2,
                    bitrate: 256000,
                    samplerate: 48000
                  }
                }
              : {
                  type: "file",
                  video: {
                    contentType: type,
                    width: 1280,
                    height: 720,
                    bitrate: 2500000,
                    framerate: 24
                  }
                };
            mediaCapabilities[name] = await navigator.mediaCapabilities.decodingInfo(config);
          } catch (error) {
            mediaCapabilities[name] = { error: error instanceof Error ? error.message : String(error) };
          }
        }
      }

      return {
        userAgent: navigator.userAgent,
        canPlayType,
        mediaCapabilities
      };
    })()
  `);
  probeWindow.destroy();

  return {
    status: "ok",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    ffmpegDll: process.platform === "win32" ? path.join(path.dirname(process.execPath), "ffmpeg.dll") : null,
    ...result
  };
}

async function runPlaybackProbe() {
  const fileArgIndex = process.argv.indexOf("--file");
  const filePath = fileArgIndex >= 0 ? process.argv[fileArgIndex + 1] : process.env.MEDIA_PROBE_FILE;
  const useHttp = process.env.TORRENTDOCK_PROBE_HTTP === "1" || hasSwitch("http");
  const useVideoJs = process.env.TORRENTDOCK_PROBE_VIDEOJS === "1" || hasSwitch("videojs");

  if (!filePath) {
    throw new Error("Pass --file <path> for --playback-probe.");
  }

  const absoluteFilePath = path.resolve(filePath);
  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`Playback probe file does not exist: ${absoluteFilePath}`);
  }

  let closeServer = () => undefined;
  let mediaUrl = pathToFileURL(absoluteFilePath).toString();

  if (useHttp) {
    const { url, close } = await createRangeServer(absoluteFilePath);
    mediaUrl = url;
    closeServer = close;
  }

  const sourceType = process.env.TORRENTDOCK_PROBE_SOURCE_TYPE || contentTypeForFile(absoluteFilePath);
  const result = useVideoJs
    ? await probeVideoJsMediaUrl(mediaUrl, Number(process.env.TORRENTDOCK_PROBE_TIMEOUT_MS ?? 10000), sourceType)
    : await probeMediaUrl(mediaUrl, Number(process.env.TORRENTDOCK_PROBE_TIMEOUT_MS ?? 10000));
  closeServer();

  return {
    status: "ok",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    file: absoluteFilePath,
    url: mediaUrl,
    probePlayer: useVideoJs ? "videojs" : "html-video",
    outputPathSeen: process.env.TORRENTDOCK_PROBE_OUTPUT || process.env.MEDIA_PROBE_OUTPUT || null,
    ...result
  };
}

async function probeVideoJsMediaUrl(mediaUrl, timeoutMs, sourceType = null) {
  const sampleDelayMs = Number(process.env.TORRENTDOCK_PROBE_SAMPLE_DELAY_MS ?? 350);
  const subtitleText = process.env.TORRENTDOCK_PROBE_SUBTITLE_TEXT || "";
  const subtitleSize = Number(process.env.TORRENTDOCK_PROBE_SUBTITLE_SIZE ?? 100);
  const subtitleOffset = Number(process.env.TORRENTDOCK_PROBE_SUBTITLE_OFFSET ?? 0);
  const probeWindow = new BrowserWindow({
    width: 960,
    height: 640,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const videoJsCss = pathToFileURL(path.join(appRoot, "node_modules", "video.js", "dist", "video-js.css")).toString();
  const videoJsScript = pathToFileURL(path.join(appRoot, "node_modules", "video.js", "dist", "video.min.js")).toString();
  const appCss = findBuiltAppCss();
  const appCssLink = appCss ? `<link rel="stylesheet" href="${pathToFileURL(appCss).toString()}">` : "";
  const htmlPath = path.join(app.getPath("temp"), "torrentdock-electron-videojs-probe.html");
  fs.writeFileSync(
    htmlPath,
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="${videoJsCss}">
  ${appCssLink}
  <style>
    html, body { width: 100%; height: 100%; margin: 0; background: #10201b; }
    body { display: grid; place-items: center; }
    .player-panel { width: 900px; height: 540px; }
    .video-surface { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <section class="player-panel" aria-label="Video player">
    <div class="video-surface video-surface-active">
      <div id="probe-host" class="torrentdock-video-js-host"></div>
    </div>
  </section>
  <script src="${videoJsScript}"></script>
</body>
</html>`,
    "utf8"
  );
  await probeWindow.loadURL(pathToFileURL(htmlPath).toString());
  const result = await probeWindow.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const host = document.getElementById("probe-host");
      const video = document.createElement("video-js");
      video.classList.add("video-js", "vjs-big-play-centered", "torrentdock-video-js");
      video.setAttribute("controls", "true");
      video.setAttribute("playsinline", "true");
      video.setAttribute("preload", "auto");
      host.appendChild(video);
      const startedAt = performance.now();
      let playResult = "not-started";
      const player = window.videojs(video, {
        autoplay: true,
        bigPlayButton: true,
        controls: true,
        fill: true,
        fluid: false,
        html5: {
          nativeTextTracks: false
        },
        persistTextTrackSettings: true,
        preload: "auto",
        responsive: true,
        sources: [{ src: ${JSON.stringify(mediaUrl)}, type: ${JSON.stringify(sourceType)} }]
      });

      const sampleFrame = () => {
        const tech = player.tech({ IWillNotUseThisInPlugins: true })?.el?.() ?? video;
        if (!tech.videoWidth || !tech.videoHeight) {
          return { sampled: false, reason: "missing-video-dimensions" };
        }

        const canvas = document.createElement("canvas");
        const width = 48;
        const height = Math.max(1, Math.round(width * tech.videoHeight / tech.videoWidth));
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          return { sampled: false, reason: "missing-canvas-context" };
        }

        try {
          context.drawImage(tech, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height).data;
          let red = 0;
          let green = 0;
          let blue = 0;
          let alpha = 0;
          let brightPixels = 0;
          let variedPixels = 0;
          const count = pixels.length / 4;

          for (let index = 0; index < pixels.length; index += 4) {
            const r = pixels[index];
            const g = pixels[index + 1];
            const b = pixels[index + 2];
            const a = pixels[index + 3];
            red += r;
            green += g;
            blue += b;
            alpha += a;
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            if (luma > 12) brightPixels += 1;
            if (Math.max(r, g, b) - Math.min(r, g, b) > 8) variedPixels += 1;
          }

          return {
            sampled: true,
            width,
            height,
            averageRed: red / count,
            averageGreen: green / count,
            averageBlue: blue / count,
            averageAlpha: alpha / count,
            brightPixelRatio: brightPixels / count,
            variedPixelRatio: variedPixels / count
          };
        } catch (error) {
          return { sampled: false, reason: error instanceof Error ? error.message : String(error) };
        }
      };

      const installSubtitle = () => {
        const rawSubtitle = ${JSON.stringify(subtitleText)};
        if (!rawSubtitle) {
          return null;
        }

        const fontPercent = ${Number.isFinite(subtitleSize) ? subtitleSize / 100 : 1};
        if (player.textTrackSettings && Number.isFinite(fontPercent)) {
          player.textTrackSettings.setValues({ fontPercent });
          player.textTrackSettings.updateDisplay();
        }

        const shiftLine = (line) => {
          const match = line.match(/^(\\s*)(\\d{2}:\\d{2}:\\d{2}\\.\\d{3})(\\s+-->\\s+)(\\d{2}:\\d{2}:\\d{2}\\.\\d{3})(.*)$/);
          if (!match) {
            return line;
          }
          const parse = (value) => {
            const [hours, minutes, seconds] = value.split(":");
            return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
          };
          const format = (value) => {
            const totalMilliseconds = Math.max(0, Math.round(value * 1000));
            const hours = Math.floor(totalMilliseconds / 3600000);
            const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
            const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
            const milliseconds = totalMilliseconds % 1000;
            return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":") + "." + String(milliseconds).padStart(3, "0");
          };
          const offset = ${Number.isFinite(subtitleOffset) ? subtitleOffset : 0};
          const start = parse(match[2]) + offset;
          const end = parse(match[4]) + offset;
          return match[1] + format(start) + match[3] + format(Math.max(start + 0.001, end)) + match[5];
        };
        const vtt = rawSubtitle.trim().startsWith("WEBVTT")
          ? rawSubtitle.split("\\n").map(shiftLine).join("\\n")
          : "WEBVTT\\n\\n" + rawSubtitle.split("\\n").map(shiftLine).join("\\n");
        const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
        const trackElement = player.addRemoteTextTrack({
          kind: "subtitles",
          src: url,
          srclang: "en",
          label: "Probe subtitles",
          default: true
        }, false);
        const track = trackElement.track;
        const show = () => {
          track.mode = "showing";
        };
        trackElement.addEventListener("load", show);
        show();
        return { url, track, trackElement };
      };

      let installedSubtitle = null;

      const finish = async (status, extra = {}) => {
        await new Promise((innerResolve) => setTimeout(innerResolve, ${Number(sampleDelayMs)}));
        const tech = player.tech({ IWillNotUseThisInPlugins: true })?.el?.() ?? video;
        const playerRect = player.el().getBoundingClientRect();
        const techRect = tech.getBoundingClientRect();
        const cueElement = player.el().querySelector(".vjs-text-track-cue > div, .vjs-text-track-cue");
        const cueStyle = cueElement ? getComputedStyle(cueElement) : null;
        resolve({
          status,
          elapsedMs: Math.round(performance.now() - startedAt),
          readyState: tech.readyState,
          networkState: tech.networkState,
          duration: Number.isFinite(player.duration()) ? player.duration() : null,
          videoWidth: tech.videoWidth,
          videoHeight: tech.videoHeight,
          currentTime: player.currentTime(),
          paused: player.paused(),
          playResult,
          playerRect: {
            width: playerRect.width,
            height: playerRect.height,
            top: playerRect.top,
            left: playerRect.left
          },
          techRect: {
            width: techRect.width,
            height: techRect.height,
            top: techRect.top,
            left: techRect.left
          },
          frameSample: sampleFrame(),
          subtitleSample: installedSubtitle ? {
            trackMode: installedSubtitle.track.mode,
            cues: installedSubtitle.track.cues ? installedSubtitle.track.cues.length : null,
            activeCues: installedSubtitle.track.activeCues ? installedSubtitle.track.activeCues.length : null,
            cueText: installedSubtitle.track.activeCues?.[0]?.text ?? null,
            cueFontSize: cueStyle?.fontSize ?? null,
            cueLineHeight: cueStyle?.lineHeight ?? null
          } : null,
          error: player.error() ?? (tech.error ? { code: tech.error.code, message: tech.error.message } : null),
          ...extra
        });
      };

      const timeout = setTimeout(() => void finish("timeout"), ${Number(timeoutMs)});
      player.on("error", () => {
        clearTimeout(timeout);
        void finish("error");
      });
      player.on("playing", () => {
        clearTimeout(timeout);
        void finish("playing");
      });
      player.ready(() => {
        installedSubtitle = installSubtitle();
        const result = player.play();
        playResult = "pending";
        if (result) {
          void result.then(
            () => { playResult = "resolved"; },
            (error) => {
              playResult = error instanceof Error ? error.name + ": " + error.message : String(error);
              clearTimeout(timeout);
              void finish("play-error");
            }
          );
        }
      });
    })
  `);
  await sleep(250);
  const pageImage = await probeWindow.webContents.capturePage();
  result.pageSample = sampleNativeImage(pageImage);
  const screenshotPath = process.env.TORRENTDOCK_PROBE_SCREENSHOT;
  if (screenshotPath) {
    fs.mkdirSync(path.dirname(path.resolve(screenshotPath)), { recursive: true });
    fs.writeFileSync(screenshotPath, pageImage.toPNG());
  }
  probeWindow.destroy();
  return result;
}

function sampleNativeImage(image) {
  const size = image.getSize();
  const bitmap = image.toBitmap();
  if (!bitmap.length || !size.width || !size.height) {
    return { sampled: false, reason: "empty-page-capture", width: size.width, height: size.height };
  }

  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let brightPixels = 0;
  let variedPixels = 0;
  let count = 0;
  const stride = 4 * 7;

  for (let index = 0; index < bitmap.length; index += stride) {
    // Electron returns BGRA bytes on Windows/Linux and RGBA on some macOS
    // surfaces. Brightness/color variation is robust enough either way.
    const b = bitmap[index];
    const g = bitmap[index + 1];
    const r = bitmap[index + 2];
    const a = bitmap[index + 3];
    red += r;
    green += g;
    blue += b;
    alpha += a;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma > 12) {
      brightPixels += 1;
    }
    if (Math.max(r, g, b) - Math.min(r, g, b) > 8) {
      variedPixels += 1;
    }
    count += 1;
  }

  return {
    sampled: true,
    width: size.width,
    height: size.height,
    averageRed: red / count,
    averageGreen: green / count,
    averageBlue: blue / count,
    averageAlpha: alpha / count,
    brightPixelRatio: brightPixels / count,
    variedPixelRatio: variedPixels / count
  };
}

function findBuiltAppCss() {
  const assetsDir = path.join(appRoot, "dist", "assets");
  if (!fs.existsSync(assetsDir)) {
    return null;
  }
  return fs.readdirSync(assetsDir)
    .filter((file) => file.endsWith(".css"))
    .map((file) => path.join(assetsDir, file))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0] ?? null;
}

async function probeMediaUrl(mediaUrl, timeoutMs) {
  const sampleDelayMs = Number(process.env.TORRENTDOCK_PROBE_SAMPLE_DELAY_MS ?? 350);
  const probeWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const htmlPath = path.join(app.getPath("temp"), "torrentdock-electron-playback-probe.html");
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, "<html><body>playback-probe</body></html>", "utf8");
  await probeWindow.loadURL(pathToFileURL(htmlPath).toString());
  const result = await probeWindow.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const video = document.createElement("video");
      const startedAt = performance.now();
      let playResult = "not-started";

      video.muted = true;
      video.preload = "auto";
      video.crossOrigin = "anonymous";
      video.src = ${JSON.stringify(mediaUrl)};
      document.body.appendChild(video);

      const sampleFrame = () => {
        if (!video.videoWidth || !video.videoHeight) {
          return { sampled: false, reason: "missing-video-dimensions" };
        }

        const canvas = document.createElement("canvas");
        const width = 48;
        const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          return { sampled: false, reason: "missing-canvas-context" };
        }

        try {
          context.drawImage(video, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height).data;
          let red = 0;
          let green = 0;
          let blue = 0;
          let alpha = 0;
          let brightPixels = 0;
          let variedPixels = 0;
          const count = pixels.length / 4;

          for (let index = 0; index < pixels.length; index += 4) {
            const r = pixels[index];
            const g = pixels[index + 1];
            const b = pixels[index + 2];
            const a = pixels[index + 3];
            red += r;
            green += g;
            blue += b;
            alpha += a;
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            if (luma > 12) {
              brightPixels += 1;
            }
            if (Math.max(r, g, b) - Math.min(r, g, b) > 8) {
              variedPixels += 1;
            }
          }

          return {
            sampled: true,
            width,
            height,
            averageRed: red / count,
            averageGreen: green / count,
            averageBlue: blue / count,
            averageAlpha: alpha / count,
            brightPixelRatio: brightPixels / count,
            variedPixelRatio: variedPixels / count
          };
        } catch (error) {
          return {
            sampled: false,
            reason: error instanceof Error ? error.message : String(error)
          };
        }
      };

      const finish = async (status, extra = {}) => {
        await new Promise((resolve) => setTimeout(resolve, ${Number(sampleDelayMs)}));
        resolve({
          status,
          elapsedMs: Math.round(performance.now() - startedAt),
          readyState: video.readyState,
          networkState: video.networkState,
          duration: Number.isFinite(video.duration) ? video.duration : null,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          currentTime: video.currentTime,
          paused: video.paused,
          playResult,
          frameSample: sampleFrame(),
          error: video.error ? { code: video.error.code, message: video.error.message } : null,
          ...extra
        });
      };

      const timeout = setTimeout(() => finish("timeout"), ${Number(timeoutMs)});
      video.addEventListener("error", () => {
        clearTimeout(timeout);
        finish("error");
      });
      video.addEventListener("loadedmetadata", async () => {
        try {
          playResult = "pending";
          await video.play();
          playResult = "resolved";
        } catch (error) {
          playResult = error instanceof Error ? error.name + ": " + error.message : String(error);
          clearTimeout(timeout);
          finish("play-error");
        }
      });
      video.addEventListener("playing", () => {
        clearTimeout(timeout);
        void finish("playing");
      });
      video.load();
    })
  `);
  probeWindow.destroy();
  return result;
}

function createRangeServer(filePath) {
  return new Promise((resolve, reject) => {
    const fileSize = fs.statSync(filePath).size;
    const server = http.createServer((request, response) => {
      const range = request.headers.range;
      const commonHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
        "Accept-Ranges": "bytes",
        "Content-Type": contentTypeForFile(filePath)
      };

      if (request.method === "OPTIONS") {
        response.writeHead(204, commonHeaders);
        response.end();
        return;
      }

      if (!range) {
        response.writeHead(200, {
          ...commonHeaders,
          "Content-Length": fileSize,
        });
        fs.createReadStream(filePath).pipe(response);
        return;
      }

      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        response.writeHead(416);
        response.end();
        return;
      }

      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : fileSize - 1;
      response.writeHead(206, {
        ...commonHeaders,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": end - start + 1
      });
      fs.createReadStream(filePath, { start, end }).pipe(response);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/${path.basename(filePath)}`,
        close: () => server.close()
      });
    });
  });
}

async function runRqbitStreamProbe() {
  const source = process.env.RQBIT_PROBE_SOURCE || defaultRqbitProbeSource;
  const timeoutMs = Number(process.env.TORRENTDOCK_PROBE_TIMEOUT_MS ?? 120000);
  const useVideoJs = process.env.TORRENTDOCK_PROBE_VIDEOJS === "1" || hasSwitch("videojs");
  console.log(`[rqbit-probe] starting source=${source}`);
  await ensureRqbitSidecar();
  console.log("[rqbit-probe] rqbit ready");

  const metadata = await rqbitRequest("/torrents?list_only=true", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain"
    },
    body: source
  }, 60000);
  const files = normalizeRqbitFiles(metadata.details?.files ?? []);
  const file = selectProbeMediaFile(files);
  console.log(`[rqbit-probe] metadata files=${files.length} selected=${file?.name ?? "none"}`);

  if (!file) {
    throw new Error("The probe torrent did not contain a playable media file.");
  }

  const addPath = `/torrents?only_files_regex=${encodeURIComponent(buildOnlyFilesRegex(file.name))}`;
  const added = await rqbitRequest(addPath, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain"
    },
    body: source
  }, 60000);
  const torrentId = added.id ?? added.details?.id;
  console.log(`[rqbit-probe] torrent id=${torrentId}`);

  if (typeof torrentId !== "number") {
    throw new Error("rqbit did not return a torrent id for the stream probe.");
  }

  await startRqbitTorrent(torrentId, timeoutMs);
  console.log("[rqbit-probe] torrent live");
  const streamUrl = `${rqbitEndpoint}/torrents/${torrentId}/stream/${file.index}`;
  const playback = useVideoJs ? await probeVideoJsMediaUrl(streamUrl, timeoutMs, contentTypeForFile(file.name)) : await probeMediaUrl(streamUrl, timeoutMs);
  console.log(`[rqbit-probe] playback status=${playback.status}`);

  void cleanupRqbitProbeTorrent(torrentId);

  return {
    status: "ok",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    source,
    torrentId,
    file,
    streamUrl,
    probePlayer: useVideoJs ? "videojs" : "html-video",
    ...playback
  };
}

async function cleanupRqbitProbeTorrent(torrentId) {
  await rqbitRequest(`/torrents/${torrentId}/pause`, { method: "POST" }, 5000).catch(() => undefined);
  await rqbitRequest(`/torrents/${torrentId}/delete`, { method: "POST" }, 5000).catch(() =>
    rqbitRequest(`/torrents/${torrentId}/forget`, { method: "POST" }, 5000).catch(() => undefined)
  );
}

function normalizeRqbitFiles(files) {
  return files.map((file, index) => ({
    ...file,
    index: typeof file.index === "number" ? file.index : index,
    name: file.name ?? (Array.isArray(file.components) ? file.components.join("/") : `file-${index}`),
    length: Number(file.length ?? 0)
  }));
}

function selectProbeMediaFile(files) {
  return files
    .filter((file) => playableExtensions.has(path.extname(file.name).toLowerCase()))
    .sort((left, right) => right.length - left.length)[0] ?? null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildOnlyFilesRegex(fileName) {
  return `^${escapeRegex(fileName)}$`;
}

async function startRqbitTorrent(torrentId, timeoutMs) {
  await rqbitRequest(`/torrents/${torrentId}/start`, { method: "POST" }).catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  let lastStats = null;

  while (Date.now() < deadline) {
    lastStats = await getRqbitStats(torrentId);
    const state = String(lastStats.state ?? "").toLowerCase();

    if (lastStats.error || state === "error") {
      throw new Error(lastStats.error || "rqbit stream probe torrent entered error state.");
    }

    if (lastStats.finished || state === "live") {
      return;
    }

    await sleep(500);
  }

  throw new Error(`rqbit stream probe did not become live in ${timeoutMs}ms. Last stats: ${JSON.stringify(lastStats)}`);
}

async function getRqbitStats(torrentId) {
  return rqbitRequest(`/torrents/${torrentId}/stats/v1`, undefined, 10000);
}

function contentTypeForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".mkv") {
    return "video/x-matroska";
  }
  if (extension === ".mp4" || extension === ".m4v") {
    return "video/mp4";
  }
  if (extension === ".webm") {
    return "video/webm";
  }
  return "application/octet-stream";
}

function registerIpc() {
  ipcMain.handle("command:ensure_rqbit_sidecar", () => ensureRqbitSidecar());
  ipcMain.handle("command:get_rqbit_endpoint", () => rqbitEndpoint);
  ipcMain.handle("command:stop_rqbit_sidecar", () => {
    stopRqbitSidecar();
  });
  ipcMain.handle("command:rqbit_api_request", (_event, args) => rqbitApiRequest(args ?? {}));
  ipcMain.handle("command:get_cursor_position", () => screen.getCursorScreenPoint());
  ipcMain.handle("command:search_movie_titles", (_event, args) => searchMovieTitles(args ?? {}));
  ipcMain.handle("command:search_torrent_source_provider", (_event, args) => searchTorrentSourceProvider(args ?? {}));
  ipcMain.handle("command:subsource_api_get", (_event, args) =>
    fetchText(`https://api.subsource.net${args.path}`, {
      headers: {
        "X-API-Key": args.apiKey,
        Accept: "application/json"
      }
    }).then((body) => ({ ok: true, status: 200, body }))
  );
  ipcMain.handle("command:subsource_download", (_event, args) =>
    fetchBytes(`https://api.subsource.net/api/v1/subtitles/${args.subtitleId}/download`, {
      headers: {
        "X-API-Key": args.apiKey,
        Accept: "application/octet-stream,application/zip,text/plain,*/*"
      }
    })
  );
  ipcMain.handle("command:open_subtitles_org_request", (_event, args) =>
    fetchText("https://api.opensubtitles.org/xml-rpc", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "User-Agent": "Popcorn Time v1"
      },
      body: args.body
    })
  );
  ipcMain.handle("command:open_subtitles_org_download", (_event, args) =>
    fetchBytes(args.url, {
      headers: {
        Accept: "text/plain,text/vtt,application/x-subrip,application/gzip,application/octet-stream,*/*",
        "User-Agent": "Popcorn Time v1"
      }
    })
  );
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#10201b",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_START_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_START_URL);
  } else {
    await mainWindow.loadFile(path.join(appRoot, "dist", "index.html"));
  }
}

registerIpc();

app.whenReady().then(async () => {
  try {
    if (isRqbitStreamProbeRun) {
      writeProbeResult(await runRqbitStreamProbe());
      app.quit();
      return;
    }

    if (isPlaybackProbeRun) {
      writeProbeResult(await runPlaybackProbe());
      app.quit();
      return;
    }

    if (isMediaProbeRun) {
      writeProbeResult(await runMediaProbe());
      app.quit();
      return;
    }

    if (isSmokeRun) {
      const endpoint = await ensureRqbitSidecar();
      writeProbeResult({
        status: "ok",
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        ffmpeg: process.versions.ffmpeg,
        rqbitEndpoint: endpoint
      });
      app.quit();
      return;
    }
  } catch (error) {
    writeProbeResult({
      status: "error",
      mode: probeMode,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null
    });
    app.exit(1);
    return;
  }

  await createWindow();
});

app.on("window-all-closed", () => {
  stopRqbitSidecar();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopRqbitSidecar();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
