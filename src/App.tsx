import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ArrowLeft,
  Captions,
  CirclePause,
  Clapperboard,
  Download,
  FileVideo,
  History,
  ListChecks,
  Loader2,
  Magnet,
  Maximize2,
  Minimize2,
  Minus,
  Play,
  Plus,
  RadioTower,
  Search,
  ShieldCheck,
  StepBack,
  StepForward,
  Trash2,
  Upload,
  Volume2,
  VolumeX
} from "lucide-react";
import {
  getTorrentDownloadProgress,
  getStreamUrl,
  getVideoStreamSrc,
  isSupportedTorrentSource,
  listLibraryTorrents,
  readTorrentFileAsText,
  removeTorrent,
  resumeTorrent,
  resolveTorrentMetadata,
  RqbitApiError,
  startTorrentDownload,
  type LibraryTorrent,
  type TorrentDownloadProgress,
  type RqbitFile
} from "./services/rqbit";
import { ensureRqbitEngineEndpoint } from "./services/rqbitEngine";
import {
  downloadOpenSubtitlesSubtitle,
  searchOpenSubtitles,
  type OpenSubtitlesCandidate
} from "./services/opensubtitles";
import { formatMovieSearchTitle, sanitizeMediaSearchTitle, searchMovieTitles, type MovieTitleCandidate } from "./services/movieCatalog";
import { downloadSubSourceSubtitle, searchSubSourceSubtitles, type SubSourceSubtitleCandidate } from "./services/subsource";
import { dedupeProviderResults, getProviderResultSource, searchTorrentSources } from "./services/torrentSources";
import type { ProviderResult, ProviderSearchError } from "./domain/torrent";
import {
  addNativeSubtitleText,
  initializeNativePlayer,
  listenNativePlayerEvents,
  loadNativePlayer,
  pauseNativePlayer,
  playNativePlayer,
  seekNativePlayer,
  selectNativeAudioTrack,
  selectNativeSubtitleTrack,
  setNativePlayerMuted,
  setNativePlayerRate,
  setNativePlayerFullscreen,
  setNativePlayerVolume,
  setNativeSubtitleDelay,
  setNativeSubtitleScale,
  setNativeSurfaceBounds,
  stopNativePlayer,
  type NativePlayerTrack,
  type PlayerCapabilities
} from "./services/nativePlayer";

type MetadataState = "idle" | "fetching" | "ready" | "starting" | "streaming" | "stopped" | "error";
type SourceSearchState = "idle" | "searching" | "ready" | "error";
type CatalogSearchState = "idle" | "searching" | "ready" | "error";
type OnlineSubtitleSearchState = "idle" | "searching" | "ready" | "loading" | "error";
type OnlineSubtitleProvider = "subsource" | "opensubtitles";
type PlaybackBackend = "native" | "html";
type CursorPosition = { x: number; y: number };
type OnlineSubtitleCandidate = {
  provider: OnlineSubtitleProvider;
  id: string;
  name: string;
  releaseName: string;
  language: string;
  format: string;
  size?: number;
  hi: boolean;
  fps?: string | null;
  isRawFile: boolean;
  raw: SubSourceSubtitleCandidate | OpenSubtitlesCandidate;
};

type TorrentSession = {
  infoHash: string;
  name: string;
  files: RqbitFile[];
  seenPeers: number;
  torrentId?: number;
};

const playableExtensions = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".ogg", ".ogm", ".ogv", ".webm"]);
const subtitleExtensions = new Set([".srt", ".vtt"]);
const subtitleShiftStepSeconds = 0.5;
const minSubtitleSizePercent = 70;
const maxSubtitleSizePercent = 180;
const defaultPlayerCapabilities: PlayerCapabilities = {
  available: false,
  backend: "html",
  platform: "browser",
  libraryPath: null,
  reason: "Native playback has not been initialized yet.",
  supportsNativeSurface: false,
  supportsEmbeddedTracks: false,
  supportsExternalSubtitles: false
};
const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];
const onlineSubtitleProviderStorageKey = "torrentdock.onlineSubtitleProvider";
const subSourceApiKeyStorageKey = "torrentdock.subSourceApiKey";
const subSourceLanguageStorageKey = "torrentdock.subSourceLanguage";
const openSubtitlesUsernameStorageKey = "torrentdock.openSubtitlesOrgUsername";
const openSubtitlesPasswordStorageKey = "torrentdock.openSubtitlesOrgPassword";
const openSubtitlesLanguageStorageKey = "torrentdock.openSubtitlesLanguage";
const onlineSubtitleLanguageOptions = [
  { value: "EN", label: "English" },
  { value: "VI", label: "Vietnamese" },
  { value: "ES", label: "Spanish" },
  { value: "FR", label: "French" },
  { value: "DE", label: "German" },
  { value: "PT", label: "Portuguese" },
  { value: "PT-BR", label: "Portuguese (Brazil)" },
  { value: "ZH-CN", label: "Chinese (Simplified)" },
  { value: "ZH-TW", label: "Chinese (Traditional)" },
  { value: "JA", label: "Japanese" },
  { value: "KO", label: "Korean" },
  { value: "TH", label: "Thai" },
  { value: "ID", label: "Indonesian" }
];
const openSubtitlesLanguageOptions = onlineSubtitleLanguageOptions.map((language) => ({
  value: language.value.toLowerCase(),
  label: language.label
}));
const subSourceLanguageOptions = [
  { value: "english", label: "English" },
  { value: "vietnamese", label: "Vietnamese" },
  { value: "spanish", label: "Spanish" },
  { value: "french", label: "French" },
  { value: "german", label: "German" },
  { value: "portuguese", label: "Portuguese" },
  { value: "chinese", label: "Chinese" },
  { value: "japanese", label: "Japanese" },
  { value: "korean", label: "Korean" },
  { value: "thai", label: "Thai" },
  { value: "indonesian", label: "Indonesian" }
];

function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatOptionalBytes(bytes?: number) {
  return typeof bytes === "number" && bytes > 0 ? formatBytes(bytes) : "size unknown";
}

function formatOptionalCount(value?: number) {
  return typeof value === "number" ? value.toLocaleString() : "unknown";
}

function getOnlineSubtitleProviderLabel(provider: OnlineSubtitleProvider) {
  const labels: Record<OnlineSubtitleProvider, string> = {
    subsource: "SubSource",
    opensubtitles: "OpenSubtitles.org"
  };

  return labels[provider];
}

function formatPercentage(value: number) {
  if (value >= 100) {
    return "100%";
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }

  return [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatSubtitleOffset(value: number) {
  if (value === 0) {
    return "0.0s";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(1)}s`;
}

function readStoredValue(key: string, fallback = "") {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
}

function getFileName(file: RqbitFile) {
  return file.components.length > 0 ? file.components[file.components.length - 1] : file.name.split("/").slice(-1)[0];
}

function isPlayable(file: RqbitFile) {
  const fileName = getFileName(file).toLowerCase();
  return Array.from(playableExtensions).some((extension) => fileName.endsWith(extension));
}

function fileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function describeMediaError(error: MediaError | null, fileName: string): string {
  const extension = fileExtension(fileName);
  const formatHint =
    ` The built-in player can only decode MP4 (H.264/AAC), WebM, and OGG. ` +
    `${extension ? `"${extension}" files` : "Files like this"} — typically MKV/AVI containers or HEVC/H.265 video with AC3/DTS audio — can't be played here.`;

  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Playback was stopped.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "Lost the connection to the local torrent stream. Keep the torrent running and try again.";
    case MediaError.MEDIA_ERR_DECODE:
      return `This video uses a codec the built-in player can't decode.${formatHint}`;
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return `This file's format isn't supported by the built-in player.${formatHint}`;
    default:
      return `The video could not be played.${formatHint}`;
  }
}

function isSubtitleFile(file: RqbitFile) {
  const fileName = getFileName(file).toLowerCase();
  return Array.from(subtitleExtensions).some((extension) => fileName.endsWith(extension));
}

function isTorrentSourceInput(value: string) {
  return isSupportedTorrentSource(value.trim());
}

function parseSubtitleTimestamp(value: string) {
  const match = value.trim().replace(",", ".").match(/^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function formatSubtitleTimestamp(value: number) {
  const totalMilliseconds = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0")
  ].join(":") + `.${String(milliseconds).padStart(3, "0")}`;
}

function shiftSubtitleTimingLine(line: string, offsetSeconds: number) {
  const match = line.match(/^(\s*)(\S+)(\s+-->\s+)(\S+)(.*)$/);

  if (!match) {
    return line;
  }

  const startSeconds = parseSubtitleTimestamp(match[2]);
  const endSeconds = parseSubtitleTimestamp(match[4]);

  if (startSeconds === null || endSeconds === null) {
    return line;
  }

  const shiftedStart = Math.max(0, startSeconds + offsetSeconds);
  const shiftedEnd = Math.max(shiftedStart + 0.001, endSeconds + offsetSeconds);

  return `${match[1]}${formatSubtitleTimestamp(shiftedStart)}${match[3]}${formatSubtitleTimestamp(shiftedEnd)}${match[5]}`;
}

function isAssSubtitle(text: string) {
  return (
    /\[script info\]/i.test(text) ||
    /\[v4\+? styles\]/i.test(text) ||
    (/\[events\]/i.test(text) && /\bdialogue\s*:/i.test(text))
  );
}

function splitWithLimit(value: string, separator: string, limit: number) {
  const parts: string[] = [];
  let rest = value;

  while (parts.length < limit - 1) {
    const index = rest.indexOf(separator);

    if (index < 0) {
      break;
    }

    parts.push(rest.slice(0, index));
    rest = rest.slice(index + 1);
  }

  parts.push(rest);
  return parts;
}

function assTimeToVtt(value: string | undefined) {
  if (!value) {
    return null;
  }

  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/);

  if (!match) {
    return null;
  }

  const hours = match[1].padStart(2, "0");
  const fraction = match[4].padEnd(3, "0").slice(0, 3);

  return `${hours}:${match[2]}:${match[3]}.${fraction}`;
}

function cleanAssText(value: string) {
  return value
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N/gi, "\n")
    .replace(/\\h/gi, " ")
    .trim();
}

function convertAssToVtt(assText: string) {
  const lines = assText.split("\n");
  let inEvents = false;
  let formatFields: string[] | null = null;
  const cues: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^\[.*\]$/.test(trimmed)) {
      inEvents = /^\[events\]$/i.test(trimmed);
      continue;
    }

    if (!inEvents) {
      continue;
    }

    if (/^format\s*:/i.test(trimmed)) {
      formatFields = trimmed
        .slice(trimmed.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      continue;
    }

    if (!/^dialogue\s*:/i.test(trimmed)) {
      continue;
    }

    const fields = formatFields ?? [
      "layer",
      "start",
      "end",
      "style",
      "name",
      "marginl",
      "marginr",
      "marginv",
      "effect",
      "text"
    ];
    const startIndex = fields.indexOf("start");
    const endIndex = fields.indexOf("end");
    const textIndex = fields.indexOf("text");

    if (startIndex < 0 || endIndex < 0 || textIndex < 0) {
      continue;
    }

    const payload = splitWithLimit(trimmed.slice(trimmed.indexOf(":") + 1), ",", fields.length);
    const start = assTimeToVtt(payload[startIndex]);
    const end = assTimeToVtt(payload[endIndex]);

    if (!start || !end) {
      continue;
    }

    const text = cleanAssText(payload[textIndex] ?? "");

    if (!text) {
      continue;
    }

    cues.push(`${start} --> ${end}\n${text}`);
  }

  return cues.join("\n\n");
}

function buildSubtitleTrackText(rawSubtitleText: string, offsetSeconds: number) {
  let normalizedText = rawSubtitleText.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();

  if (isAssSubtitle(normalizedText)) {
    normalizedText = convertAssToVtt(normalizedText);
  }

  const isWebVtt = normalizedText.toUpperCase().startsWith("WEBVTT");
  const body = isWebVtt ? normalizedText : `WEBVTT\n\n${normalizedText}`;

  return body
    .split("\n")
    .map((line) => shiftSubtitleTimingLine(line, offsetSeconds))
    .join("\n");
}

function getErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Stopped current torrent load.";
  }

  if (error instanceof RqbitApiError) {
    if (error.status === 404) {
      return "rqbit is not responding. Start Docker dev services, then retry.";
    }

    return error.message || "Torrent engine rejected the source.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  // Tauri command rejections arrive as plain strings, not Error instances.
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Something went wrong while talking to the torrent engine.";
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerPanelRef = useRef<HTMLElement | null>(null);
  const videoSurfaceRef = useRef<HTMLDivElement | null>(null);
  const playerToolbarRef = useRef<HTMLDivElement | null>(null);
  const activeLoadAbortRef = useRef<AbortController | null>(null);
  const activeTorrentIdRef = useRef<number | null>(null);
  const stoppedLoadControllersRef = useRef<WeakSet<AbortController>>(new WeakSet());
  const isNativePlaybackRef = useRef(false);
  const isPlayerFullscreenRef = useRef(false);
  const [torrentInput, setTorrentInput] = useState("");
  const [metadataState, setMetadataState] = useState<MetadataState>("idle");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [session, setSession] = useState<TorrentSession | null>(null);
  const [engineBaseUrl, setEngineBaseUrl] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [nativeCapabilities, setNativeCapabilities] = useState<PlayerCapabilities>(defaultPlayerCapabilities);
  const [playbackBackend, setPlaybackBackend] = useState<PlaybackBackend>("native");
  const [playerState, setPlayerState] = useState<"idle" | "loading" | "playing" | "paused" | "stopped" | "ended">("idle");
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [isPlayerBuffering, setIsPlayerBuffering] = useState(false);
  const [playerVolume, setPlayerVolume] = useState(100);
  const [isPlayerMuted, setIsPlayerMuted] = useState(false);
  const [playerRate, setPlayerRate] = useState(1);
  const [playerTracks, setPlayerTracks] = useState<NativePlayerTrack[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<number | null>(null);
  const [selectedSubtitleTrackId, setSelectedSubtitleTrackId] = useState<number | null>(null);
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);
  const [playerControlsVisible, setPlayerControlsVisible] = useState(true);
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<TorrentDownloadProgress | null>(null);
  const [surfaceSyncNonce, setSurfaceSyncNonce] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceSearchState, setSourceSearchState] = useState<SourceSearchState>("idle");
  const [sourceResults, setSourceResults] = useState<ProviderResult[]>([]);
  const [sourceErrors, setSourceErrors] = useState<ProviderSearchError[]>([]);
  const [sourceErrorMessage, setSourceErrorMessage] = useState<string | null>(null);
  const [selectedSourceResultId, setSelectedSourceResultId] = useState<string | null>(null);
  const [catalogSearchState, setCatalogSearchState] = useState<CatalogSearchState>("idle");
  const [catalogResults, setCatalogResults] = useState<MovieTitleCandidate[]>([]);
  const [catalogErrorMessage, setCatalogErrorMessage] = useState<string | null>(null);
  const [selectedCatalogTitle, setSelectedCatalogTitle] = useState<MovieTitleCandidate | null>(null);
  const [subtitleRawText, setSubtitleRawText] = useState<string | null>(null);
  const [subtitleFileName, setSubtitleFileName] = useState<string | null>(null);
  const [subtitleTrackUrl, setSubtitleTrackUrl] = useState<string | null>(null);
  const [subtitleOffsetSeconds, setSubtitleOffsetSeconds] = useState(0);
  const [subtitleSizePercent, setSubtitleSizePercent] = useState(100);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleLoadingFileIndex, setSubtitleLoadingFileIndex] = useState<number | null>(null);
  const [onlineSubtitleProvider, setOnlineSubtitleProvider] = useState<OnlineSubtitleProvider>(() => {
    const storedProvider = readStoredValue(onlineSubtitleProviderStorageKey, "subsource");
    return storedProvider === "opensubtitles" || storedProvider === "subsource" ? storedProvider : "subsource";
  });
  const [subSourceApiKey, setSubSourceApiKey] = useState(() => readStoredValue(subSourceApiKeyStorageKey));
  const [subSourceLanguage, setSubSourceLanguage] = useState(() => readStoredValue(subSourceLanguageStorageKey, "english"));
  const [openSubtitlesUsername, setOpenSubtitlesUsername] = useState(() => readStoredValue(openSubtitlesUsernameStorageKey));
  const [openSubtitlesPassword, setOpenSubtitlesPassword] = useState(() => readStoredValue(openSubtitlesPasswordStorageKey));
  const [openSubtitlesLanguage, setOpenSubtitlesLanguage] = useState(() => readStoredValue(openSubtitlesLanguageStorageKey, "en"));
  const [onlineSubtitleSearchState, setOnlineSubtitleSearchState] = useState<OnlineSubtitleSearchState>("idle");
  const [onlineSubtitleResults, setOnlineSubtitleResults] = useState<OnlineSubtitleCandidate[]>([]);
  const [onlineSubtitleError, setOnlineSubtitleError] = useState<string | null>(null);
  const [onlineSubtitleLoadingResultId, setOnlineSubtitleLoadingResultId] = useState<string | null>(null);
  const [activeOnlineResultId, setActiveOnlineResultId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<LibraryTorrent[]>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyBusyId, setHistoryBusyId] = useState<number | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  const playableFiles = useMemo(() => session?.files.filter(isPlayable) ?? [], [session]);
  const subtitleFiles = useMemo(() => session?.files.filter(isSubtitleFile) ?? [], [session]);
  const selectedFile = playableFiles[selectedFileIndex] ?? playableFiles[0];
  const isNativeAvailable = nativeCapabilities.available;
  const isNativePlayback = playbackBackend === "native" && isNativeAvailable;
  const audioTracks = useMemo(() => playerTracks.filter((track) => track.kind === "audio"), [playerTracks]);
  const embeddedSubtitleTracks = useMemo(() => playerTracks.filter((track) => track.kind === "subtitle"), [playerTracks]);
  const isTorrentLoading = metadataState === "fetching" || metadataState === "starting";
  const normalizedEntry = sourceQuery.trim();
  const entryIsTorrentSource = isTorrentSourceInput(normalizedEntry);
  const shouldShowCatalogStatus = catalogSearchState !== "idle" || catalogResults.length > 0;
  const shouldShowSourceStatus = sourceSearchState !== "idle" || sourceResults.length > 0 || sourceErrors.length > 0;
  const shouldShowPlayer =
    Boolean(session) ||
    metadataState === "fetching" ||
    metadataState === "starting" ||
    metadataState === "ready" ||
    metadataState === "streaming" ||
    (metadataState === "error" && torrentInput.length > 0);
  const playerPosition = isNativePlayback ? playerTime : (videoRef.current?.currentTime ?? 0);
  const rawPlayerLength = isNativePlayback ? playerDuration : (videoRef.current?.duration ?? 0);
  const playerLength = Number.isFinite(rawPlayerLength) && rawPlayerLength > 0 ? rawPlayerLength : 0;
  const displayedPlayerPosition = pendingSeekTime ?? playerPosition;
  const hasKnownPlayerLength = Number.isFinite(playerLength) && playerLength > 0;
  const playerSeekMax = Math.max(1, Math.round(hasKnownPlayerLength ? playerLength : Math.max(3600, displayedPlayerPosition + 600)));
  const progressPercent = downloadProgress?.percent ?? 0;
  const progressLabel = formatPercentage(progressPercent);
  const progressBytesLabel =
    downloadProgress && downloadProgress.totalBytes > 0
      ? `${formatBytes(downloadProgress.progressBytes)} / ${formatBytes(downloadProgress.totalBytes)}`
      : "Waiting for stats";
  const downloadSpeedLabel = streamUrl ? (downloadProgress?.downloadSpeedLabel ?? "0 B/s") : "idle";
  const subtitleStyle = { "--subtitle-size": `${subtitleSizePercent}%` } as CSSProperties;
  const selectedCatalogSearchTitle = selectedCatalogTitle?.searchTitle;
  const viewMode: "search" | "browse" | "player" = shouldShowPlayer
    ? "player"
    : selectedCatalogTitle
      ? "browse"
      : "search";

  useEffect(() => {
    isNativePlaybackRef.current = isNativePlayback;
  }, [isNativePlayback]);

  useEffect(() => {
    isPlayerFullscreenRef.current = isPlayerFullscreen;
  }, [isPlayerFullscreen]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let isMounted = true;

    void listenNativePlayerEvents({
      onState: (state) => {
        if (state === "playing" || state === "paused") {
          setPlayerState(state);
        }
      },
      onTime: (value) => {
        setPlayerTime(value);
      },
      onDuration: (value) => {
        if (Number.isFinite(value) && value > 0) {
          setPlayerDuration(value);
        } else {
          setPlayerDuration(0);
        }
      },
      onBuffering: setIsPlayerBuffering,
      onTracks: setPlayerTracks,
      onEnd: () => {
        setPlayerState("ended");
        setMetadataState((currentState) => (currentState === "streaming" ? "ready" : currentState));
      },
      onWarning: setVideoError,
      onError: (message) => {
        setVideoError(message);
        setMetadataState("ready");
      }
    }).then((unlisten) => {
      if (isMounted) {
        cleanup = unlisten;
      } else {
        unlisten();
      }
    });

    return () => {
      isMounted = false;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const selectedAudio = audioTracks.find((track) => track.selected);
    const selectedSubtitle = embeddedSubtitleTracks.find((track) => track.selected);
    setSelectedAudioTrackId(selectedAudio?.id ?? null);
    setSelectedSubtitleTrackId(selectedSubtitle?.id ?? null);
  }, [audioTracks, embeddedSubtitleTracks]);

  useEffect(() => {
    if (!isNativePlayback || !streamUrl || viewMode !== "player") {
      if (isNativeAvailable) {
        void setNativeSurfaceBounds({ x: 0, y: 0, width: 1, height: 1 }, window.devicePixelRatio || 1, false).catch(() => undefined);
      }
      return undefined;
    }

    const element = videoSurfaceRef.current;

    if (!element) {
      return undefined;
    }

    let frameId = 0;
    const syncSurface = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(viewportWidth, rect.right);
        const toolbarHeight =
          isPlayerFullscreenRef.current && playerControlsVisible ? (playerToolbarRef.current?.getBoundingClientRect().height ?? 0) + 28 : 0;
        const bottom = Math.max(top, Math.min(viewportHeight, rect.bottom) - toolbarHeight);
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        const visible =
          metadataState === "streaming" &&
          Boolean(streamUrl) &&
          width >= 16 &&
          height >= 16 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < viewportHeight &&
          rect.left < viewportWidth;

        void setNativeSurfaceBounds(
          {
            x: left,
            y: top,
            width,
            height
          },
          1,
          visible
        ).catch(setVideoError);
      });
    };

    const resizeObserver = new ResizeObserver(syncSurface);
    resizeObserver.observe(element);
    syncSurface();
    window.addEventListener("resize", syncSurface);
    window.addEventListener("scroll", syncSurface, true);
    window.visualViewport?.addEventListener("resize", syncSurface);
    window.visualViewport?.addEventListener("scroll", syncSurface);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncSurface);
      window.removeEventListener("scroll", syncSurface, true);
      window.visualViewport?.removeEventListener("resize", syncSurface);
      window.visualViewport?.removeEventListener("scroll", syncSurface);
      window.cancelAnimationFrame(frameId);
    };
  }, [isNativeAvailable, isNativePlayback, metadataState, streamUrl, viewMode, isPlayerFullscreen, playerControlsVisible, surfaceSyncNonce]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreen = document.fullscreenElement === playerPanelRef.current;
      isPlayerFullscreenRef.current = fullscreen;
      setIsPlayerFullscreen(fullscreen);
      setPlayerControlsVisible(true);
      requestSurfaceResync();
      window.setTimeout(requestSurfaceResync, 160);
      window.setTimeout(requestSurfaceResync, 420);

      if (isNativePlaybackRef.current && !fullscreen) {
        void setNativePlayerFullscreen(false).catch(() => undefined);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!isPlayerFullscreen) {
      setPlayerControlsVisible(true);
      return undefined;
    }

    let hideTimer = window.setTimeout(() => setPlayerControlsVisible(false), 2200);
    const showControls = () => {
      setPlayerControlsVisible(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setPlayerControlsVisible(false), 2200);
    };

    const panel = playerPanelRef.current;
    let lastCursor: CursorPosition | null = null;
    panel?.addEventListener("mousemove", showControls);
    panel?.addEventListener("pointerdown", showControls);
    panel?.addEventListener("focusin", showControls);
    document.addEventListener("mousemove", showControls);
    document.addEventListener("pointermove", showControls);
    document.addEventListener("keydown", showControls);
    const cursorPoll = window.setInterval(() => {
      void invoke<CursorPosition | null>("get_cursor_position")
        .then((position) => {
          if (!position) {
            return;
          }

          if (lastCursor && (lastCursor.x !== position.x || lastCursor.y !== position.y)) {
            showControls();
          }
          lastCursor = position;
        })
        .catch(() => undefined);
    }, 160);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearInterval(cursorPoll);
      panel?.removeEventListener("mousemove", showControls);
      panel?.removeEventListener("pointerdown", showControls);
      panel?.removeEventListener("focusin", showControls);
      document.removeEventListener("mousemove", showControls);
      document.removeEventListener("pointermove", showControls);
      document.removeEventListener("keydown", showControls);
    };
  }, [isPlayerFullscreen]);

  useEffect(() => {
    window.localStorage.setItem(onlineSubtitleProviderStorageKey, onlineSubtitleProvider);
  }, [onlineSubtitleProvider]);

  useEffect(() => {
    const normalizedApiKey = subSourceApiKey.trim();

    if (normalizedApiKey) {
      window.localStorage.setItem(subSourceApiKeyStorageKey, normalizedApiKey);
    } else {
      window.localStorage.removeItem(subSourceApiKeyStorageKey);
    }
  }, [subSourceApiKey]);

  useEffect(() => {
    const normalizedLanguage = subSourceLanguage.trim().toLowerCase() || "english";
    window.localStorage.setItem(subSourceLanguageStorageKey, normalizedLanguage);
  }, [subSourceLanguage]);

  useEffect(() => {
    const normalizedLanguage = openSubtitlesLanguage.trim().toLowerCase() || "en";
    window.localStorage.setItem(openSubtitlesLanguageStorageKey, normalizedLanguage);
  }, [openSubtitlesLanguage]);

  useEffect(() => {
    const normalizedUsername = openSubtitlesUsername.trim();

    if (normalizedUsername) {
      window.localStorage.setItem(openSubtitlesUsernameStorageKey, normalizedUsername);
    } else {
      window.localStorage.removeItem(openSubtitlesUsernameStorageKey);
    }
  }, [openSubtitlesUsername]);

  useEffect(() => {
    if (openSubtitlesPassword) {
      window.localStorage.setItem(openSubtitlesPasswordStorageKey, openSubtitlesPassword);
    } else {
      window.localStorage.removeItem(openSubtitlesPasswordStorageKey);
    }
  }, [openSubtitlesPassword]);

  useEffect(() => {
    setOnlineSubtitleSearchState("idle");
    setOnlineSubtitleError(null);
    setOnlineSubtitleResults([]);
    setOnlineSubtitleLoadingResultId(null);
  }, [onlineSubtitleProvider]);

  useEffect(() => {
    if (!subtitleRawText) {
      setSubtitleTrackUrl(null);
      return undefined;
    }

    const trackText = buildSubtitleTrackText(subtitleRawText, subtitleOffsetSeconds);

    if (!trackText.includes("-->")) {
      setSubtitleTrackUrl(null);
      setSubtitleError("This subtitle file has no readable cues. Try a different result.");
      return undefined;
    }

    const nextTrackUrl = URL.createObjectURL(
      new Blob([trackText], {
        type: "text/vtt"
      })
    );

    setSubtitleTrackUrl(nextTrackUrl);

    return () => {
      URL.revokeObjectURL(nextTrackUrl);
    };
  }, [subtitleOffsetSeconds, subtitleRawText]);

  useEffect(() => {
    if (!subtitleTrackUrl) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      const tracks = videoRef.current?.textTracks;

      if (!tracks) {
        return;
      }

      for (const track of Array.from(tracks)) {
        track.mode = track.kind === "subtitles" || track.kind === "captions" ? "showing" : "disabled";
      }
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [streamUrl, subtitleFileName, subtitleTrackUrl]);

  useEffect(() => {
    if (!isNativePlayback || !streamUrl || !subtitleRawText || !subtitleFileName) {
      return;
    }

    void addNativeSubtitleText(subtitleFileName, subtitleRawText).catch((error: unknown) => {
      setSubtitleError(getErrorMessage(error));
    });
  }, [isNativePlayback, streamUrl, subtitleFileName, subtitleRawText]);

  useEffect(() => {
    if (!isNativePlayback || !streamUrl) {
      return;
    }

    void setNativeSubtitleDelay(subtitleOffsetSeconds).catch((error: unknown) => {
      setSubtitleError(getErrorMessage(error));
    });
  }, [isNativePlayback, streamUrl, subtitleOffsetSeconds]);

  useEffect(() => {
    if (!isNativePlayback || !streamUrl) {
      return;
    }

    void setNativeSubtitleScale(subtitleSizePercent / 100).catch((error: unknown) => {
      setSubtitleError(getErrorMessage(error));
    });
  }, [isNativePlayback, streamUrl, subtitleSizePercent]);

  useEffect(() => {
    if (!engineBaseUrl || typeof session?.torrentId !== "number" || !streamUrl) {
      return undefined;
    }

    const controller = new AbortController();
    let isActive = true;
    const torrentId = session.torrentId;
    const activeEngineBaseUrl = engineBaseUrl;

    async function refreshProgress() {
      try {
        const progress = await getTorrentDownloadProgress(torrentId, activeEngineBaseUrl, {
          signal: controller.signal
        });

        if (isActive) {
          setDownloadProgress(progress);
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setDownloadProgress(null);
        }
      }
    }

    void refreshProgress();
    const interval = window.setInterval(() => {
      void refreshProgress();
    }, 1500);

    return () => {
      isActive = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [engineBaseUrl, session?.torrentId, streamUrl]);

  const metadataStatus = useMemo(() => {
    if (metadataState === "fetching") {
      return "Resolving metadata through the local torrent engine...";
    }

    if (metadataState === "starting") {
      return "Starting the selected file and preparing a local stream URL...";
    }

    if (metadataState === "streaming") {
      return "Local stream is ready. Use the video controls to play or seek.";
    }

    if (metadataState === "ready") {
      return "Metadata ready. Select a playable file and press play.";
    }

    if (metadataState === "error") {
      return errorMessage ?? "Could not read that link. Edit it and try again.";
    }

    if (metadataState === "stopped") {
      return "Stopped current torrent load. Pick another source when ready.";
    }

    return "Paste a magnet link or torrent URL to begin.";
  }, [errorMessage, metadataState]);

  const sourceSearchStatus = useMemo(() => {
    if (sourceSearchState === "searching") {
      if (sourceResults.length > 0) {
        return `${sourceResults.length} result${sourceResults.length === 1 ? "" : "s"} ready while other sources finish.`;
      }

      return "Searching 1337x and The Pirate Bay in parallel...";
    }

    if (sourceSearchState === "ready") {
      return `${sourceResults.length} result${sourceResults.length === 1 ? "" : "s"} ready to load.`;
    }

    if (sourceSearchState === "error") {
      return sourceErrorMessage ?? "Source search did not return a usable torrent link.";
    }

    return "Search sources, then load a result into the torrent input.";
  }, [sourceErrorMessage, sourceResults.length, sourceSearchState]);

  const catalogSearchStatus = useMemo(() => {
    if (catalogSearchState === "searching") {
      return "Finding title matches...";
    }

    if (catalogSearchState === "ready") {
      return `${catalogResults.length} title match${catalogResults.length === 1 ? "" : "es"} ready. Choose one to load source options.`;
    }

    if (catalogSearchState === "error") {
      return catalogErrorMessage ?? "Could not find title matches.";
    }

    return "Pick a title to search torrents and subtitles with a clean movie name.";
  }, [catalogErrorMessage, catalogResults.length, catalogSearchState]);

  async function searchSources(queryOverride?: string) {
    const normalizedQuery = (queryOverride ?? sourceQuery).trim();

    setSourceErrorMessage(null);
    setSourceErrors([]);

    if (normalizedQuery.length < 2) {
      setSourceSearchState("error");
      setSourceResults([]);
      setSourceErrorMessage("Enter at least 2 characters to search sources.");
      return;
    }

    try {
      setSourceSearchState("searching");
      setSourceResults([]);
      const response = await searchTorrentSources(normalizedQuery, {
        onProviderSettled: (progress) => {
          if (progress.results.length > 0) {
            setSourceResults((currentResults) => dedupeProviderResults([...currentResults, ...progress.results], normalizedQuery));
          }

          if (progress.error) {
            setSourceErrors((currentErrors) => [...currentErrors, progress.error as ProviderSearchError]);
          }
        }
      });

      setSourceResults(response.results);
      setSourceErrors(response.errors);
      setSourceSearchState(response.results.length > 0 ? "ready" : "error");

      if (response.results.length === 0) {
        setSourceErrorMessage(
          response.errors.length > 0
            ? response.errors.map((error) => `${error.providerName}: ${error.message}`).join(" ")
            : "No source results found. Try another query or paste a magnet link manually."
        );
      }
    } catch (error) {
      setSourceResults([]);
      setSourceSearchState("error");
      setSourceErrorMessage(getErrorMessage(error));
    }
  }

  async function searchCatalogTitles(queryOverride?: string) {
    const normalizedCatalogQuery = (queryOverride ?? sourceQuery).trim();

    if (isTorrentSourceInput(normalizedCatalogQuery) || normalizedCatalogQuery.length < 2) {
      setCatalogSearchState("error");
      setCatalogResults([]);
      setCatalogErrorMessage("Type a movie or show title first.");
      return;
    }

    try {
      setCatalogSearchState("searching");
      setCatalogErrorMessage(null);
      setCatalogResults([]);
      setSourceSearchState("idle");
      setSourceResults([]);
      setSourceErrors([]);
      setSourceErrorMessage(null);
      const results = await searchMovieTitles(normalizedCatalogQuery);
      setCatalogResults(results);
      setCatalogSearchState(results.length > 0 ? "ready" : "error");

      if (results.length === 0) {
        setCatalogErrorMessage("No title matches found. Try a shorter title.");
      }
    } catch (error) {
      setCatalogResults([]);
      setCatalogSearchState("error");
      setCatalogErrorMessage(getErrorMessage(error));
    }
  }

  async function chooseCatalogTitle(candidate: MovieTitleCandidate) {
    const searchTitle = formatMovieSearchTitle(candidate);

    setSelectedCatalogTitle(candidate);
    setSourceQuery(searchTitle);
    setTorrentInput(searchTitle);
    setSelectedSourceResultId(null);
    await searchSources(searchTitle);
  }

  function beginLoadRequest() {
    activeLoadAbortRef.current?.abort();
    const controller = new AbortController();
    activeLoadAbortRef.current = controller;
    return controller;
  }

  function clearLoadRequest(controller: AbortController) {
    if (activeLoadAbortRef.current === controller) {
      activeLoadAbortRef.current = null;
    }
  }

  function shouldShowStoppedLoadRequest(controller: AbortController) {
    return activeLoadAbortRef.current === controller || stoppedLoadControllersRef.current.has(controller);
  }

  function stopCurrentLoad() {
    const controller = activeLoadAbortRef.current;
    if (controller) {
      stoppedLoadControllersRef.current.add(controller);
      controller.abort();
    }

    activeLoadAbortRef.current = null;
    activeTorrentIdRef.current = null;
    if (isNativeAvailable) {
      void stopNativePlayer().catch(() => undefined);
    }
    setStreamUrl(null);
    setPlayerState("stopped");
    setPlayerTime(0);
    setPlayerDuration(0);
    setPendingSeekTime(null);
    setIsPlayerFullscreen(false);
    setPlayerTracks([]);
    setSession(null);
    setSelectedFileIndex(0);
    setMetadataState("stopped");
    setErrorMessage(null);
  }

  function stopActivePlayback() {
    activeLoadAbortRef.current?.abort();
    activeLoadAbortRef.current = null;

    if (isNativeAvailable) {
      void stopNativePlayer().catch(() => undefined);
    }

    videoRef.current?.pause();

    if (document.fullscreenElement === playerPanelRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }

    setStreamUrl(null);
    setPlayerState("stopped");
    setPlayerTime(0);
    setPlayerDuration(0);
    setPendingSeekTime(null);
    setIsPlayerFullscreen(false);
    setIsPlayerBuffering(false);
    setPlayerTracks([]);
    setDownloadProgress(null);
  }

  async function openHistory() {
    stopActivePlayback();
    setShowHistory(true);
    await loadHistory();
  }

  function closeHistory() {
    setShowHistory(false);
  }

  async function loadHistory() {
    setHistoryState("loading");
    setHistoryError(null);

    try {
      const activeEngineBaseUrl = engineBaseUrl ?? (await ensureRqbitEngineEndpoint());
      setEngineBaseUrl(activeEngineBaseUrl);
      const items = await listLibraryTorrents(activeEngineBaseUrl);
      items.sort((a, b) => b.id - a.id);
      setHistoryItems(items);
      setHistoryState("ready");
    } catch (error) {
      setHistoryItems([]);
      setHistoryState("error");
      setHistoryError(getErrorMessage(error));
    }
  }

  async function removeHistoryItem(item: LibraryTorrent, deleteFiles: boolean) {
    setHistoryBusyId(item.id);
    setHistoryError(null);

    try {
      const activeEngineBaseUrl = engineBaseUrl ?? (await ensureRqbitEngineEndpoint());

      if (session?.torrentId === item.id) {
        stopCurrentLoad();
      }

      await removeTorrent(item.id, activeEngineBaseUrl, deleteFiles);
      setHistoryItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (error) {
      setHistoryError(getErrorMessage(error));
    } finally {
      setHistoryBusyId(null);
    }
  }

  async function clearHistory() {
    if (
      historyItems.length === 0 ||
      !window.confirm(
        `Delete all ${historyItems.length} torrent${historyItems.length === 1 ? "" : "s"} and their downloaded files? This cannot be undone.`
      )
    ) {
      return;
    }

    setIsClearingHistory(true);
    setHistoryError(null);

    try {
      const activeEngineBaseUrl = engineBaseUrl ?? (await ensureRqbitEngineEndpoint());
      const items = [...historyItems];
      const activeTorrentId = session?.torrentId;

      if (typeof activeTorrentId === "number" && items.some((item) => item.id === activeTorrentId)) {
        stopCurrentLoad();
      }

      const results = await Promise.allSettled(
        items.map((item) => removeTorrent(item.id, activeEngineBaseUrl, true))
      );
      const failedIds = new Set(
        results.flatMap((result, index) => (result.status === "rejected" ? [items[index].id] : []))
      );

      setHistoryItems(items.filter((item) => failedIds.has(item.id)));

      if (failedIds.size > 0) {
        setHistoryError(
          `Deleted ${items.length - failedIds.size} of ${items.length} torrents. ${failedIds.size} could not be removed; refresh and retry.`
        );
      }
    } catch (error) {
      setHistoryError(getErrorMessage(error));
    } finally {
      setIsClearingHistory(false);
    }
  }

  function returnToTitleSearch() {
    stopActivePlayback();
    setSelectedCatalogTitle(null);
    setSelectedSourceResultId(null);
    setSourceResults([]);
    setSourceErrors([]);
    setSourceErrorMessage(null);
    setSourceSearchState("idle");
    setSession(null);
    setSelectedFileIndex(0);
    setMetadataState("idle");
    setErrorMessage(null);
    setTorrentInput("");
    removeSubtitleFile();
    setOnlineSubtitleResults([]);
    setOnlineSubtitleError(null);
    setOnlineSubtitleSearchState("idle");
  }

  function returnToSources() {
    stopActivePlayback();
    setSession(null);
    setSelectedFileIndex(0);
    setSelectedSourceResultId(null);
    setMetadataState("idle");
    setErrorMessage(null);
    removeSubtitleFile();
    setOnlineSubtitleResults([]);
    setOnlineSubtitleError(null);
    setOnlineSubtitleSearchState("idle");
  }

  function renderSourceResults() {
    return (
      <div className="source-results" aria-label="Discovered torrent sources">
        {sourceResults.length > 0 ? (
          sourceResults.map((result) => {
            const resultSource = getProviderResultSource(result);
            const isSelected = selectedSourceResultId === result.id;

            return (
              <article className={isSelected ? "source-result active" : "source-result"} key={result.id}>
                <div className="source-result-main">
                  <div className="source-result-title">
                    <h3>{result.title}</h3>
                    <span>{result.providerName}</span>
                  </div>
                  <div className="source-result-meta">
                    <span>{result.category ?? "torrent"}</span>
                    <span>{formatOptionalBytes(result.size)}</span>
                    <span>{formatOptionalCount(result.seeders)} seeds</span>
                    <span>{formatOptionalCount(result.leechers)} peers</span>
                  </div>
                </div>
                <div className="source-result-actions">
                  <button
                    type="button"
                    className="ghost-button source-load-button"
                    disabled={!resultSource || isTorrentLoading}
                    onClick={() => {
                      void loadSourceResult(result);
                    }}
                  >
                    {metadataState === "fetching" && isSelected ? (
                      <Loader2 className="spin" size={16} aria-hidden="true" />
                    ) : (
                      <Magnet size={16} aria-hidden="true" />
                    )}
                    {isSelected && metadataState === "fetching" ? "Loading" : "Load"}
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <div className="empty-files">No source results yet.</div>
        )}
      </div>
    );
  }

  function renderSelectedTitleBar(inPlayer = false) {
    const canGoBackToSources = inPlayer && sourceResults.length > 0;
    const info = (
      <>
        <span className="selected-title-poster">
          {selectedCatalogTitle?.imageUrl ? (
            <img src={selectedCatalogTitle.imageUrl} alt="" loading="lazy" />
          ) : (
            <Clapperboard size={18} aria-hidden="true" />
          )}
        </span>
        <div className="selected-title-text">
          <strong>{selectedCatalogTitle?.title ?? session?.name ?? sourceQuery ?? "Selected source"}</strong>
          <small>
            {[selectedCatalogTitle?.year, selectedCatalogTitle?.kind, selectedCatalogTitle?.credits]
              .filter(Boolean)
              .join(" - ") || "Custom source"}
          </small>
        </div>
      </>
    );

    return (
      <section className="selected-title-bar" aria-label="Selected title">
        {canGoBackToSources ? (
          <button type="button" className="selected-title-info selected-title-trigger" onClick={returnToSources} aria-label="Back to torrent list">
            {info}
          </button>
        ) : (
          <div className="selected-title-info">{info}</div>
        )}
        <div className="selected-title-actions">
          {canGoBackToSources ? (
            <button type="button" className="ghost-button" onClick={returnToSources}>
              <ArrowLeft size={16} aria-hidden="true" />
              Back to torrents
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={returnToTitleSearch}>
            <Search size={16} aria-hidden="true" />
            New search
          </button>
        </div>
      </section>
    );
  }

  function renderHistoryPage() {
    return (
      <section className="history-page" aria-label="Download history">
        <div className="history-header">
          <div>
            <h2>Download history</h2>
            <p>Torrents the engine is tracking. Remove old downloads to free disk space.</p>
          </div>
          <div className="history-header-actions">
            <button
              type="button"
              className="ghost-button danger"
              onClick={() => void clearHistory()}
              disabled={historyItems.length === 0 || isClearingHistory || historyBusyId !== null}
              title="Delete every torrent in history and remove its downloaded files"
            >
              {isClearingHistory ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <Trash2 size={16} aria-hidden="true" />
              )}
              {isClearingHistory ? "Deleting all" : "Delete all files"}
            </button>
            <button type="button" className="ghost-button" onClick={() => void loadHistory()} disabled={historyState === "loading"}>
              {historyState === "loading" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RadioTower size={16} aria-hidden="true" />}
              Refresh
            </button>
            <button type="button" className="ghost-button" onClick={closeHistory}>
              <ArrowLeft size={16} aria-hidden="true" />
              Back
            </button>
          </div>
        </div>

        {historyError ? <p className="history-error" role="alert">{historyError}</p> : null}

        {historyState === "loading" && historyItems.length === 0 ? (
          <div className="history-empty">
            <Loader2 className="spin" size={28} aria-hidden="true" />
            <p>Loading torrents from the engine…</p>
          </div>
        ) : historyItems.length === 0 ? (
          <div className="history-empty">
            <History size={28} aria-hidden="true" />
            <p>No downloads yet. Torrents you stream will show up here.</p>
          </div>
        ) : (
          <ul className="history-list">
            {historyItems.map((item) => {
              const isBusy = isClearingHistory || historyBusyId === item.id;
              const statusLabel = item.finished
                ? "Completed"
                : item.state
                  ? `${item.state} - ${formatPercentage(item.percent)}`
                  : formatPercentage(item.percent);

              return (
                <li className="history-item" key={item.id}>
                  <div className="history-item-main">
                    <FileVideo size={20} aria-hidden="true" />
                    <div className="history-item-text">
                      <strong title={item.name}>{item.name}</strong>
                      <small>
                        {formatBytes(item.progressBytes)}
                        {item.totalBytes > 0 ? ` / ${formatBytes(item.totalBytes)}` : ""} - {statusLabel}
                      </small>
                      {item.outputFolder ? <small className="history-item-path" title={item.outputFolder}>{item.outputFolder}</small> : null}
                    </div>
                  </div>
                  <div className="history-item-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={isBusy}
                      onClick={() => void removeHistoryItem(item, false)}
                      title="Remove from the engine but keep the downloaded files on disk"
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="ghost-button danger"
                      disabled={isBusy}
                      onClick={() => void removeHistoryItem(item, true)}
                      title="Remove from the engine and delete the downloaded files"
                    >
                      {isBusy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                      Delete files
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  async function loadDirectSource(source: string) {
    const normalizedSource = source.trim();

    setSourceQuery(normalizedSource);
    setTorrentInput(normalizedSource);
    setSelectedSourceResultId(null);
    setSourceSearchState("idle");
    setSourceResults([]);
    setSourceErrors([]);
    setSourceErrorMessage(null);
    setSession(null);
    setSelectedFileIndex(0);
    await startPlayback(normalizedSource);
  }

  async function submitSourceEntry() {
    if (entryIsTorrentSource) {
      await loadDirectSource(normalizedEntry);
      return;
    }

    await searchCatalogTitles(normalizedEntry);
  }

  function catchPastedSource(event: ClipboardEvent<HTMLInputElement>) {
    const pastedText = event.clipboardData.getData("text").trim();

    if (!isTorrentSourceInput(pastedText)) {
      return;
    }

    event.preventDefault();
    void loadDirectSource(pastedText);
  }

  async function loadSubtitleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const normalizedName = file.name.toLowerCase();

    if (!normalizedName.endsWith(".srt") && !normalizedName.endsWith(".vtt")) {
      setSubtitleError("Choose a .srt or .vtt subtitle file.");
      return;
    }

    try {
      const text = await file.text();
      loadSubtitleText(text, file.name);
    } catch {
      setSubtitleError("Could not read that subtitle file.");
    }
  }

  async function loadSubtitleFromTorrent(file: RqbitFile) {
    if (!engineBaseUrl || typeof session?.torrentId !== "number") {
      setSubtitleError("Start playback first, then load subtitles from this torrent.");
      return;
    }

    try {
      setSubtitleLoadingFileIndex(file.index);
      setSubtitleError(null);
      const subtitleText = await readTorrentFileAsText(engineBaseUrl, session.torrentId, file.index);
      loadSubtitleText(subtitleText, getFileName(file));
    } catch (error) {
      setSubtitleError(error instanceof Error ? error.message : "Could not load that subtitle file from the torrent.");
    } finally {
      setSubtitleLoadingFileIndex(null);
    }
  }

  async function findOnlineSubtitles() {
    const selectedProvider = onlineSubtitleProvider;

    if (selectedProvider === "subsource" && !subSourceApiKey.trim()) {
      setOnlineSubtitleSearchState("error");
      setOnlineSubtitleError("Add a SubSource API key first.");
      return;
    }

    if (selectedProvider === "opensubtitles" && (!openSubtitlesUsername.trim() || !openSubtitlesPassword)) {
      setOnlineSubtitleSearchState("error");
      setOnlineSubtitleError("Add your OpenSubtitles.org username and password first.");
      return;
    }

    if (!session && !selectedFile) {
      setOnlineSubtitleSearchState("error");
      setOnlineSubtitleError("Load torrent metadata before searching subtitles.");
      return;
    }

    try {
      setOnlineSubtitleSearchState("searching");
      setOnlineSubtitleError(null);
      setOnlineSubtitleResults([]);
      const subtitleFilmName = selectedCatalogSearchTitle || sanitizeMediaSearchTitle(session?.name);
      const subtitleFileQuery = sanitizeMediaSearchTitle(selectedFile ? getFileName(selectedFile) : undefined);

      const results =
        selectedProvider === "subsource"
          ? (await searchSubSourceSubtitles({
              apiKey: subSourceApiKey.trim(),
              filmName: subtitleFilmName,
              fileName: subtitleFileQuery,
              languages: subSourceLanguage
            })).map(toOnlineSubtitleCandidate("subsource"))
          : (await searchOpenSubtitles({
              username: openSubtitlesUsername,
              password: openSubtitlesPassword,
              filmName: subtitleFilmName,
              query: subtitleFileQuery,
              imdbId: selectedCatalogTitle?.id,
              languages: openSubtitlesLanguage
            })).map(toOnlineSubtitleCandidate("opensubtitles"));
      setOnlineSubtitleResults(results);

      if (results.length === 0) {
        setOnlineSubtitleSearchState("error");
        setOnlineSubtitleError(`No ${getOnlineSubtitleProviderLabel(selectedProvider)} subtitles matched this file.`);
        return;
      }

      setOnlineSubtitleSearchState("ready");
    } catch (error) {
      setOnlineSubtitleResults([]);
      setOnlineSubtitleSearchState("error");
      setOnlineSubtitleError(error instanceof Error ? error.message : "Could not search online subtitles.");
    }
  }

  async function loadOnlineSubtitle(candidate: OnlineSubtitleCandidate) {
    if (candidate.provider === "subsource" && !subSourceApiKey.trim()) {
      setOnlineSubtitleSearchState("error");
      setOnlineSubtitleError("Add a SubSource API key first.");
      return;
    }

    if (candidate.provider === "opensubtitles" && (!openSubtitlesUsername.trim() || !openSubtitlesPassword)) {
      setOnlineSubtitleSearchState("error");
      setOnlineSubtitleError("Add your OpenSubtitles.org username and password first.");
      return;
    }

    try {
      setOnlineSubtitleSearchState("loading");
      setOnlineSubtitleLoadingResultId(candidate.id);
      setOnlineSubtitleError(null);

      if (candidate.provider === "subsource") {
        const response = await downloadSubSourceSubtitle(candidate.raw as SubSourceSubtitleCandidate, subSourceApiKey.trim());
        loadSubtitleText(response.text, response.fileName ?? candidate.name);
      } else {
        const response = await downloadOpenSubtitlesSubtitle(candidate.raw as OpenSubtitlesCandidate, {
          username: openSubtitlesUsername,
          password: openSubtitlesPassword
        });

        loadSubtitleText(response.text, response.fileName);
      }

      setActiveOnlineResultId(candidate.id);
      setOnlineSubtitleSearchState("ready");
    } catch (error) {
      setOnlineSubtitleSearchState("error");
      setOnlineSubtitleError(error instanceof Error ? error.message : "Could not load that online subtitle.");
    } finally {
      setOnlineSubtitleLoadingResultId(null);
    }
  }

  function toOnlineSubtitleCandidate(provider: OnlineSubtitleProvider) {
    return (candidate: SubSourceSubtitleCandidate | OpenSubtitlesCandidate): OnlineSubtitleCandidate => ({
      provider,
      id: `${provider}-${candidate.id}`,
      name: candidate.name,
      releaseName: candidate.releaseName,
      language: candidate.language,
      format: candidate.format,
      size: "size" in candidate ? candidate.size : undefined,
      hi: candidate.hi,
      fps: candidate.fps,
      isRawFile: candidate.isRawFile,
      raw: candidate
    });
  }

  function loadSubtitleText(text: string, fileName: string) {
    setSubtitleRawText(text);
    setSubtitleFileName(fileName);
    setSubtitleOffsetSeconds(0);
    setSubtitleError(null);
    setActiveOnlineResultId(null);
  }

  function showSubtitleTrack(track: TextTrack) {
    track.mode = "showing";
  }

  function removeSubtitleFile() {
    setSubtitleRawText(null);
    setSubtitleFileName(null);
    setSubtitleTrackUrl(null);
    setSubtitleOffsetSeconds(0);
    setSubtitleError(null);
    setSubtitleLoadingFileIndex(null);
    setActiveOnlineResultId(null);
  }

  function shiftSubtitle(deltaSeconds: number) {
    setSubtitleOffsetSeconds((currentOffset) => Number((currentOffset + deltaSeconds).toFixed(1)));
  }

  function resetSubtitleShift() {
    setSubtitleOffsetSeconds(0);
  }

  function syncHtmlPlaybackState() {
    const video = videoRef.current;

    if (!video || isNativePlayback) {
      return;
    }

    setPlayerTime(video.currentTime || 0);
    setPlayerDuration(Number.isFinite(video.duration) ? video.duration : 0);
    setPlayerState(video.paused ? "paused" : "playing");
  }

  async function toggleTransportPlayback() {
    if (!streamUrl) {
      return;
    }

    if (isNativePlayback) {
      if (playerState === "playing") {
        await pauseNativePlayer();
        setPlayerState("paused");
      } else {
        await playNativePlayer();
        setPlayerState("playing");
      }
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      await video.play();
      setPlayerState("playing");
    } else {
      video.pause();
      setPlayerState("paused");
    }
  }

  async function seekPlayback(seconds: number) {
    const nextSeconds = Math.max(0, hasKnownPlayerLength ? Math.min(seconds, playerLength) : seconds);

    if (isNativePlayback) {
      await seekNativePlayer(nextSeconds);
    } else if (videoRef.current) {
      videoRef.current.currentTime = nextSeconds;
    }

    setPlayerTime(nextSeconds);
  }

  async function commitSeekControl(seconds: number) {
    if (!streamUrl) {
      setPendingSeekTime(null);
      return;
    }

    const nextSeconds = Math.max(0, hasKnownPlayerLength ? Math.min(seconds, playerLength) : seconds);
    setPendingSeekTime(nextSeconds);

    try {
      await seekPlayback(nextSeconds);
    } finally {
      setPendingSeekTime(null);
    }
  }

  async function changePlayerVolume(value: number) {
    const nextVolume = Math.max(0, Math.min(100, value));
    setPlayerVolume(nextVolume);

    if (isNativePlayback) {
      await setNativePlayerVolume(nextVolume);
    } else if (videoRef.current) {
      videoRef.current.volume = nextVolume / 100;
    }
  }

  async function togglePlayerMuted() {
    const nextMuted = !isPlayerMuted;
    setIsPlayerMuted(nextMuted);

    if (isNativePlayback) {
      await setNativePlayerMuted(nextMuted);
    } else if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  }

  async function changePlayerRate(value: number) {
    setPlayerRate(value);

    if (isNativePlayback) {
      await setNativePlayerRate(value);
    } else if (videoRef.current) {
      videoRef.current.playbackRate = value;
    }
  }

  function requestSurfaceResync() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setSurfaceSyncNonce((currentNonce) => currentNonce + 1);
      });
    });
  }

  async function togglePlayerFullscreen() {
    const panel = playerPanelRef.current;

    if (!panel) {
      return;
    }

    if (isNativePlayback) {
      if (document.fullscreenElement === panel) {
        await document.exitFullscreen();
        await setNativePlayerFullscreen(false);
        isPlayerFullscreenRef.current = false;
        setIsPlayerFullscreen(false);
        requestSurfaceResync();
        return;
      }

      await panel.requestFullscreen();
      isPlayerFullscreenRef.current = true;
      setIsPlayerFullscreen(true);
      requestSurfaceResync();
      return;
    }

    if (document.fullscreenElement === panel) {
      await document.exitFullscreen();
      setIsPlayerFullscreen(false);
      requestSurfaceResync();
      return;
    }

    await panel.requestFullscreen();
    setIsPlayerFullscreen(true);
    requestSurfaceResync();
  }

  async function chooseAudioTrack(trackId: number) {
    setSelectedAudioTrackId(trackId);
    await selectNativeAudioTrack(trackId);
  }

  async function chooseSubtitleTrack(trackId: number) {
    setSelectedSubtitleTrackId(trackId);
    await selectNativeSubtitleTrack(trackId);
  }

  async function pullMetadata(sourceOverride?: string) {
    const normalizedInput = (sourceOverride ?? torrentInput).trim();
    let controller: AbortController | null = null;

    activeTorrentIdRef.current = null;
    setStreamUrl(null);
    setErrorMessage(null);

    if (!normalizedInput || !isSupportedTorrentSource(normalizedInput)) {
      setMetadataState("error");
      setSession(null);
      setErrorMessage("Paste a valid magnet URI, torrent URL, or direct HTTP(S) torrent source.");
      return null;
    }

    try {
      controller = beginLoadRequest();
      setMetadataState("fetching");
      const nextEngineBaseUrl = await ensureRqbitEngineEndpoint();

      if (controller.signal.aborted) {
        throw new DOMException("Stopped current torrent load.", "AbortError");
      }

      setEngineBaseUrl(nextEngineBaseUrl);

      const response = await resolveTorrentMetadata(normalizedInput, nextEngineBaseUrl, { signal: controller.signal });

      if (controller.signal.aborted) {
        throw new DOMException("Stopped current torrent load.", "AbortError");
      }

      const files = response.details.files ?? [];
      const nextSession = {
        infoHash: response.details.info_hash,
        name: response.details.name ?? "Untitled torrent",
        files,
        seenPeers: response.seen_peers?.length ?? 0,
        torrentId: response.id ?? response.details.id ?? undefined
      };

      const nextPlayableFiles = files.filter(isPlayable);

      setSession(nextSession);
      setSelectedFileIndex(0);

      if (nextPlayableFiles.length === 0) {
        setMetadataState("error");
        setErrorMessage("Metadata loaded, but no browser-playable video file was found.");
        return nextSession;
      }

      setMetadataState("ready");
      return nextSession;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (controller && shouldShowStoppedLoadRequest(controller)) {
          setSession(null);
          setMetadataState("stopped");
          setErrorMessage(null);
        }
        return null;
      }

      setSession(null);
      setMetadataState("error");
      setErrorMessage(getErrorMessage(error));
      return null;
    } finally {
      if (controller) {
        clearLoadRequest(controller);
        stoppedLoadControllersRef.current.delete(controller);
      }
    }
  }

  async function loadSourceResult(result: ProviderResult) {
    const source = getProviderResultSource(result);

    if (!source) {
      setSourceSearchState("error");
      setSourceErrorMessage("That result did not expose a magnet or torrent URL.");
      return;
    }

    setSelectedSourceResultId(result.id);
    setTorrentInput(source);
    setSourceQuery(result.title);
    setSession(null);
    setSelectedFileIndex(0);
    await startPlayback(source);
  }

  async function startPlayback(sourceOverride?: string) {
    const normalizedInput = (sourceOverride ?? torrentInput).trim();
    const activeSession = sourceOverride ? await pullMetadata(sourceOverride) : session ?? (await pullMetadata());

    if (!activeSession) {
      return;
    }

    const fileToPlay = sourceOverride ? activeSession.files.find(isPlayable) : selectedFile ?? activeSession.files.find(isPlayable);

    if (!fileToPlay) {
      return;
    }

    const activeEngineBaseUrl = engineBaseUrl ?? (await ensureRqbitEngineEndpoint());
    let controller: AbortController | null = null;

    try {
      controller = beginLoadRequest();
      setMetadataState("starting");
      setErrorMessage(null);
      setVideoError(null);
      setEngineBaseUrl(activeEngineBaseUrl);

      let torrentId = activeSession.torrentId;
      let seenPeers = activeSession.seenPeers;
      const canResumeExistingTorrent =
        typeof torrentId === "number" && activeTorrentIdRef.current === torrentId;

      // A stopped session already owns an rqbit torrent. Resume that exact
      // handle instead of adding the magnet again, which can reinitialize the
      // bundled release sidecar and race the following /start request.
      if (!canResumeExistingTorrent) {
        const response = await startTorrentDownload(
          normalizedInput,
          [fileToPlay.name, ...subtitleFiles.map((file) => file.name)],
          activeEngineBaseUrl,
          { signal: controller.signal }
        );

        if (controller.signal.aborted) {
          throw new DOMException("Stopped current torrent load.", "AbortError");
        }

        torrentId = response.id ?? response.details.id ?? undefined;
        seenPeers = response.seen_peers?.length ?? activeSession.seenPeers;

        if (typeof torrentId !== "number") {
          throw new Error("Torrent engine did not return a streamable torrent id.");
        }
      }

      if (typeof torrentId !== "number") {
        throw new Error("Torrent session lost its engine id.");
      }

      activeTorrentIdRef.current = torrentId;
      await resumeTorrent(torrentId, activeEngineBaseUrl, { signal: controller.signal });

      if (controller.signal.aborted) {
        throw new DOMException("Stopped current torrent load.", "AbortError");
      }

      const capabilities = await initializeNativePlayer();
      setNativeCapabilities(capabilities);
      const shouldUseNativePlayback = capabilities.available;
      if (!capabilities.available) {
        setVideoError(capabilities.reason ?? "Native mpv is unavailable, using HTML playback.");
      }
      const directStreamUrl = getStreamUrl(activeEngineBaseUrl, torrentId, fileToPlay.index);
      const fallbackStreamUrl = getVideoStreamSrc(activeEngineBaseUrl, torrentId, fileToPlay.index);
      const nextUrl = shouldUseNativePlayback ? directStreamUrl : fallbackStreamUrl;

      setSession({
        ...activeSession,
        torrentId,
        seenPeers
      });
      setVideoError(null);
      setStreamUrl(nextUrl);
      setMetadataState("streaming");
      setPlayerState("loading");
      setPlayerTime(0);
      setPlayerDuration(0);

      if (shouldUseNativePlayback) {
        setPlaybackBackend("native");

        try {
          await loadNativePlayer(torrentId, fileToPlay.index, getFileName(fileToPlay), playerTime);
          await setNativePlayerVolume(playerVolume);
          await setNativePlayerMuted(isPlayerMuted);
          await setNativePlayerRate(playerRate);
          setPlayerState("playing");
          return;
        } catch (nativeError) {
          setPlaybackBackend("html");
          setStreamUrl(fallbackStreamUrl);
          setVideoError(`Native player could not start, using HTML fallback: ${getErrorMessage(nativeError)}`);
        }
      } else {
        setPlaybackBackend("html");
      }

      window.setTimeout(() => {
        void videoRef.current?.play().catch((error: unknown) => {
          if (
            error instanceof DOMException &&
            (error.name === "NotAllowedError" || error.name === "NotSupportedError" || error.name === "AbortError")
          ) {
            return;
          }

          setVideoError(getErrorMessage(error));
        });
      }, 0);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (controller && shouldShowStoppedLoadRequest(controller)) {
          setMetadataState("stopped");
          setErrorMessage(null);
        }
        return;
      }

      setMetadataState("ready");
      setVideoError(getErrorMessage(error));
      setErrorMessage(null);
    } finally {
      if (controller) {
        clearLoadRequest(controller);
        stoppedLoadControllersRef.current.delete(controller);
      }
    }
  }

  return (
    <main className={`player-app view-${viewMode}${isNativePlayback && streamUrl ? " native-playback-active" : ""}`}>
      <header className="topbar compact-topbar">
        <div>
          <p className="eyebrow">TorrentDock v1</p>
          <h1>Search or paste a magnet.</h1>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className={showHistory ? "ghost-button history-toggle active" : "ghost-button history-toggle"}
            onClick={() => {
              if (showHistory) {
                closeHistory();
              } else {
                void openHistory();
              }
            }}
          >
            <History size={16} aria-hidden="true" />
            History
          </button>
          <div className="safety-chip">
            <ShieldCheck size={18} aria-hidden="true" />
            Legal sources only
          </div>
        </div>
      </header>

      {showHistory ? renderHistoryPage() : null}

      {!showHistory && viewMode === "search" ? (
        <>
      <section className="command-panel" aria-labelledby="source-entry-title">
        <form
          className="command-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitSourceEntry();
          }}
        >
          <label htmlFor="source-query" id="source-entry-title">
            Search title or paste magnet
          </label>
          <div className="command-row">
            <input
              id="source-query"
              value={sourceQuery}
              onChange={(event) => {
                setSourceQuery(event.target.value);
                setSelectedSourceResultId(null);
                setSelectedCatalogTitle(null);
              }}
              onPaste={catchPastedSource}
              spellCheck={false}
              autoComplete="off"
            />
            <div className="command-actions">
              <button type="submit" disabled={isTorrentLoading || sourceSearchState === "searching" || catalogSearchState === "searching" || normalizedEntry.length < 2}>
                {isTorrentLoading || sourceSearchState === "searching" || catalogSearchState === "searching" ? (
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                ) : entryIsTorrentSource ? (
                  <Magnet size={18} aria-hidden="true" />
                ) : (
                  <Search size={18} aria-hidden="true" />
                )}
                {isTorrentLoading ? "Loading" : sourceSearchState === "searching" ? "Finding sources" : catalogSearchState === "searching" ? "Finding titles" : entryIsTorrentSource ? "Load" : "Search"}
              </button>
              {isTorrentLoading ? (
                <button type="button" className="stop-button" onClick={stopCurrentLoad}>
                  <CirclePause size={18} aria-hidden="true" />
                  Stop
                </button>
              ) : null}
            </div>
          </div>
          <p className="helper">Search a title, then choose a match.</p>
        </form>
      </section>

      {shouldShowCatalogStatus ? (
        <section className="discovery-panel results-panel" aria-labelledby="catalog-results-title">
          <div className={`source-status source-status-${catalogSearchState}`} aria-live="polite">
            {catalogSearchState === "searching" ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : catalogSearchState === "ready" ? (
              <Clapperboard size={18} aria-hidden="true" />
            ) : (
              <AlertTriangle size={18} aria-hidden="true" />
            )}
            <div>
              <h3>{catalogSearchState === "ready" ? "Title matches" : catalogSearchState === "searching" ? "Finding titles" : "Title lookup"}</h3>
              <p>{catalogSearchStatus}</p>
            </div>
          </div>

          <h2 className="visually-hidden" id="catalog-results-title">
            Title matches
          </h2>
          <div className="catalog-results" aria-label="Movie and show title matches">
            {catalogResults.map((result) => {
              const isSelectedCatalogTitle = selectedCatalogTitle?.id === result.id;

              return (
                <button
                  type="button"
                  className={isSelectedCatalogTitle ? "catalog-result active" : "catalog-result"}
                  key={result.id}
                  onClick={() => {
                    void chooseCatalogTitle(result);
                  }}
                >
                  <span className="catalog-poster">
                    {result.imageUrl ? <img src={result.imageUrl} alt="" loading="lazy" /> : <Clapperboard size={18} aria-hidden="true" />}
                  </span>
                  <span className="catalog-result-main">
                    <strong>{result.title}</strong>
                    <small>
                      {[result.year, result.kind, result.credits].filter(Boolean).join(" - ")}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {shouldShowSourceStatus ? (
        <section className="discovery-panel results-panel" aria-labelledby="source-results-title">
          <div className={`source-status source-status-${sourceSearchState}`} aria-live="polite">
            {sourceSearchState === "searching" ? (
              <Loader2 className="spin" size={18} aria-hidden="true" />
            ) : sourceSearchState === "ready" ? (
              <ListChecks size={18} aria-hidden="true" />
            ) : (
              <AlertTriangle size={18} aria-hidden="true" />
            )}
            <div>
              <h3>{sourceSearchState === "ready" ? "Results ready" : sourceSearchState === "searching" ? "Searching" : "Source status"}</h3>
              <p>{sourceSearchStatus}</p>
              {sourceErrors.length > 0 && sourceResults.length > 0 ? (
                <small>
                  Partial source errors: {sourceErrors.map((error) => `${error.providerName}: ${error.message}`).join(" ")}
                </small>
              ) : null}
            </div>
          </div>

          <h2 className="visually-hidden" id="source-results-title">
            Source results
          </h2>
          <div className="source-results" aria-label="Discovered torrent sources">
            {sourceResults.length > 0 ? (
              sourceResults.map((result) => {
                const resultSource = getProviderResultSource(result);
                const isSelected = selectedSourceResultId === result.id;

                return (
                  <article className={isSelected ? "source-result active" : "source-result"} key={result.id}>
                    <div className="source-result-main">
                      <div className="source-result-title">
                        <h3>{result.title}</h3>
                        <span>{result.providerName}</span>
                      </div>
                      <div className="source-result-meta">
                        <span>{result.category ?? "torrent"}</span>
                        <span>{formatOptionalBytes(result.size)}</span>
                        <span>{formatOptionalCount(result.seeders)} seeds</span>
                        <span>{formatOptionalCount(result.leechers)} peers</span>
                      </div>
                    </div>
                    <div className="source-result-actions">
                      <button
                        type="button"
                        className="ghost-button source-load-button"
                        disabled={!resultSource || isTorrentLoading}
                        onClick={() => {
                          void loadSourceResult(result);
                        }}
                      >
                        {metadataState === "fetching" && isSelected ? (
                          <Loader2 className="spin" size={16} aria-hidden="true" />
                        ) : (
                          <Magnet size={16} aria-hidden="true" />
                        )}
                        {isSelected && metadataState === "fetching" ? "Loading" : "Load"}
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="empty-files">No source results yet.</div>
            )}
          </div>
        </section>
      ) : null}
        </>
      ) : null}

      {!showHistory && viewMode === "browse" ? (
        <>
          {renderSelectedTitleBar()}
          <section className="browse-layout" aria-label="Selected title and sources">
            <div className="browse-poster">
              {selectedCatalogTitle?.imageUrl ? (
                <img src={selectedCatalogTitle.imageUrl} alt={`${selectedCatalogTitle.title} poster`} />
              ) : (
                <Clapperboard size={48} aria-hidden="true" className="browse-poster-fallback" />
              )}
            </div>

            <div className="browse-detail">
              <div className="browse-detail-header">
                <h2>
                  {selectedCatalogTitle?.title}
                  {selectedCatalogTitle?.year ? <span className="browse-year"> ({selectedCatalogTitle.year})</span> : null}
                </h2>
                <div className="browse-meta">
                  {selectedCatalogTitle?.kind ? <span>{selectedCatalogTitle.kind}</span> : null}
                  {selectedCatalogTitle?.id?.startsWith("tt") ? (
                    <a href={`https://www.imdb.com/title/${selectedCatalogTitle.id}/`} target="_blank" rel="noreferrer">
                      View on IMDb
                    </a>
                  ) : null}
                </div>
                {selectedCatalogTitle?.credits ? <p className="browse-credits">{selectedCatalogTitle.credits}</p> : null}
              </div>

              <div className="browse-sources">
                <div className={`source-status source-status-${sourceSearchState}`} aria-live="polite">
                  {sourceSearchState === "searching" ? (
                    <Loader2 className="spin" size={18} aria-hidden="true" />
                  ) : sourceSearchState === "ready" ? (
                    <ListChecks size={18} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={18} aria-hidden="true" />
                  )}
                  <div>
                    <h3>{sourceSearchState === "ready" ? "Available torrents" : sourceSearchState === "searching" ? "Finding torrents" : "Torrent sources"}</h3>
                    <p>{sourceSearchStatus}</p>
                  </div>
                </div>
                {renderSourceResults()}
              </div>
            </div>
          </section>
        </>
      ) : null}

      {!showHistory && viewMode === "player" ? (
        <>
          {renderSelectedTitleBar(true)}
        <section className="player-layout" aria-label="Torrent playback workspace">
        <div className="player-main">
        <section
          ref={playerPanelRef}
          className={isNativePlayback && streamUrl ? "player-panel native-player-panel" : "player-panel"}
          aria-label="Video player"
        >
          <div
            ref={videoSurfaceRef}
            className={[
              "video-surface",
              streamUrl ? "video-surface-active" : "",
              isNativePlayback && streamUrl ? "native-video-surface" : ""
            ].filter(Boolean).join(" ")}
          >
            {streamUrl && isNativePlayback ? (
              <div className="native-video-window" aria-label="Native video surface">
                {isPlayerBuffering ? (
                  <div className="video-center native-video-overlay">
                    <Loader2 className="spin" size={36} aria-hidden="true" />
                    <div>
                      <h2>Buffering from torrent pieces</h2>
                      <p>mpv is waiting for rqbit to make the next range available.</p>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : streamUrl ? (
              <video
                ref={videoRef}
                src={streamUrl}
                controls
                playsInline
                style={subtitleStyle}
                onPlay={() => {
                  setVideoError(null);
                  setPlayerState("playing");
                }}
                onPause={() => {
                  setPlayerState("paused");
                }}
                onLoadedMetadata={syncHtmlPlaybackState}
                onTimeUpdate={syncHtmlPlaybackState}
                onDurationChange={syncHtmlPlaybackState}
                onVolumeChange={(event) => {
                  setPlayerVolume(Math.round(event.currentTarget.volume * 100));
                  setIsPlayerMuted(event.currentTarget.muted);
                }}
                onError={(event) => {
                  setVideoError(describeMediaError(event.currentTarget.error, selectedFile ? getFileName(selectedFile) : session?.name ?? ""));
                  setStreamUrl(null);
                  setMetadataState("ready");
                }}
              >
                {subtitleTrackUrl ? (
                  <track
                    key={subtitleTrackUrl}
                    kind="subtitles"
                    src={subtitleTrackUrl}
                    srcLang="en"
                    label={subtitleFileName ?? "Custom subtitles"}
                    default
                    onLoad={(event) => showSubtitleTrack(event.currentTarget.track)}
                  />
                ) : null}
              </video>
            ) : (
              <div className="video-center">
                {metadataState === "fetching" || metadataState === "starting" ? (
                  <Loader2 className="spin" size={42} aria-hidden="true" />
                ) : (
                  <FileVideo size={46} aria-hidden="true" />
                )}
                <div>
                  <h2>{session?.name ?? "Waiting for torrent metadata"}</h2>
                  <p aria-live="polite">{metadataStatus}</p>
                </div>
              </div>
            )}
            {videoError ? (
              <div className="video-error" role="alert">
                <FileVideo size={28} aria-hidden="true" />
                <p>{videoError}</p>
              </div>
            ) : null}
          </div>

          <div
            ref={playerToolbarRef}
            className={`player-toolbar${isPlayerFullscreen && !playerControlsVisible ? " player-toolbar-hidden" : ""}`}
            aria-label="Playback controls"
            onPointerMove={() => setPlayerControlsVisible(true)}
            onFocus={() => setPlayerControlsVisible(true)}
          >
            <button
              type="button"
              className="ghost-button transport-toggle"
              disabled={!streamUrl}
              onClick={() => {
                void toggleTransportPlayback().catch((error: unknown) => setVideoError(getErrorMessage(error)));
              }}
            >
              {playerState === "playing" ? <CirclePause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
              {playerState === "playing" ? "Pause" : "Resume"}
            </button>

            <div className="volume-menu">
              <button
                type="button"
                className="ghost-button icon-control"
                aria-label={isPlayerMuted ? "Unmute" : "Mute"}
                disabled={!streamUrl}
                onClick={() => {
                  void togglePlayerMuted().catch((error: unknown) => setVideoError(getErrorMessage(error)));
                }}
              >
                {isPlayerMuted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
              </button>
              <div className="volume-popover" role="group" aria-label="Volume">
                <span>Volume</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={playerVolume}
                  disabled={!streamUrl}
                  aria-label="Volume"
                  onChange={(event) => {
                    void changePlayerVolume(Number(event.target.value)).catch((error: unknown) => setVideoError(getErrorMessage(error)));
                  }}
                />
                <strong>{playerVolume}%</strong>
              </div>
            </div>

            <button
              type="button"
              className="ghost-button icon-control"
              aria-label={isPlayerFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              disabled={!streamUrl}
              onClick={() => {
                void togglePlayerFullscreen().catch((error: unknown) => setVideoError(getErrorMessage(error)));
              }}
            >
              {isPlayerFullscreen ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
            </button>

            <label className="seek-control toolbar-seek-control">
              <span>
                {formatPlaybackTime(displayedPlayerPosition)} / {hasKnownPlayerLength ? formatPlaybackTime(playerLength) : "--:--"}
              </span>
              <input
                type="range"
                min={0}
                max={playerSeekMax}
                step={1}
                value={Math.min(Math.round(displayedPlayerPosition), playerSeekMax)}
                disabled={!streamUrl}
                onChange={(event) => {
                  setPendingSeekTime(Number(event.target.value));
                }}
                onPointerUp={(event) => {
                  void commitSeekControl(Number(event.currentTarget.value)).catch((error: unknown) => setVideoError(getErrorMessage(error)));
                }}
                onMouseUp={(event) => {
                  void commitSeekControl(Number(event.currentTarget.value)).catch((error: unknown) => setVideoError(getErrorMessage(error)));
                }}
                onTouchEnd={(event) => {
                  void commitSeekControl(Number(event.currentTarget.value)).catch((error: unknown) => setVideoError(getErrorMessage(error)));
                }}
                onKeyUp={(event) => {
                  if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                    void commitSeekControl(Number(event.currentTarget.value)).catch((error: unknown) => setVideoError(getErrorMessage(error)));
                  }
                }}
                onBlur={(event) => {
                  if (pendingSeekTime !== null) {
                    void commitSeekControl(Number(event.currentTarget.value)).catch((error: unknown) => setVideoError(getErrorMessage(error)));
                  }
                }}
              />
            </label>

            <label className="toolbar-inline-control toolbar-rate-control">
              <span>Speed</span>
              <select
                value={playerRate}
                disabled={!streamUrl}
                onChange={(event) => {
                  void changePlayerRate(Number(event.target.value)).catch((error: unknown) => setVideoError(getErrorMessage(error)));
                }}
              >
                {playbackRates.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}x
                  </option>
                ))}
              </select>
            </label>

            {isNativePlayback && audioTracks.length > 0 ? (
              <label className="toolbar-inline-control toolbar-track-control">
                <span>Audio</span>
                <select
                  value={selectedAudioTrackId ?? ""}
                  onChange={(event) => {
                    void chooseAudioTrack(Number(event.target.value)).catch((error: unknown) => setVideoError(getErrorMessage(error)));
                  }}
                >
                  {audioTracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.title}{track.language ? ` (${track.language})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {isNativePlayback && embeddedSubtitleTracks.length > 0 ? (
              <label className="toolbar-inline-control toolbar-track-control">
                <span>Subtitles</span>
                <select
                  value={selectedSubtitleTrackId ?? -1}
                  onChange={(event) => {
                    void chooseSubtitleTrack(Number(event.target.value)).catch((error: unknown) => setVideoError(getErrorMessage(error)));
                  }}
                >
                  <option value={-1}>Off</option>
                  {embeddedSubtitleTracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.title}{track.language ? ` (${track.language})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

          </div>
        </section>

        <div className="player-download-strip" aria-label="Torrent download progress">
          <div className="download-strip-heading">
            <span>{progressLabel}</span>
            <span>{downloadSpeedLabel}</span>
          </div>
          <div
            className="download-strip-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progressPercent)}
            aria-label="Torrent download completion"
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="download-strip-meta">
            <span>{progressBytesLabel}</span>
            <span>{downloadProgress ? `${downloadProgress.livePeers} live peers` : `${session?.seenPeers ?? 0} seen peers`}</span>
          </div>
        </div>

        </div>

        <aside className="metadata-panel" aria-label="Metadata and files">
          <div className="subtitle-panel">
            <div className="panel-title">
              <h2>Subtitles</h2>
              <label className="ghost-button subtitle-upload">
                <Upload size={16} aria-hidden="true" />
                Add
                <input type="file" accept=".srt,.vtt,text/vtt" onChange={loadSubtitleFile} />
              </label>
            </div>

            <div className="subtitle-state">
              <Captions size={18} aria-hidden="true" />
              <div>
                <strong>{subtitleFileName ?? "No subtitle loaded"}</strong>
                <span>{subtitleFileName ? `${formatSubtitleOffset(subtitleOffsetSeconds)} shift - ${subtitleSizePercent}% size` : "Add an .srt or .vtt file."}</span>
              </div>
            </div>

            {subtitleError ? <p className="subtitle-error">{subtitleError}</p> : null}

            <form
              className="online-subtitle-panel"
              onSubmit={(event) => {
                event.preventDefault();
                void findOnlineSubtitles();
              }}
            >
              <div className="online-subtitle-actions">
                <label className="online-provider-select">
                  Provider
                  <select
                    value={onlineSubtitleProvider}
                    onChange={(event) => setOnlineSubtitleProvider(event.target.value as OnlineSubtitleProvider)}
                  >
                    <option value="subsource">SubSource</option>
                    <option value="opensubtitles">OpenSubtitles.org</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="ghost-button online-subtitle-search-button"
                  disabled={onlineSubtitleSearchState === "searching" || onlineSubtitleSearchState === "loading" || !session}
                >
                  {onlineSubtitleSearchState === "searching" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
                  {onlineSubtitleSearchState === "searching" ? "Finding" : "Find online"}
                </button>
              </div>

              <div className={`online-subtitle-fields ${onlineSubtitleProvider}-fields`}>
                {onlineSubtitleProvider === "subsource" ? (
                  <>
                    <label>
                      SubSource API key
                      <input
                        type="password"
                        value={subSourceApiKey}
                        onChange={(event) => setSubSourceApiKey(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <label>
                      Lang
                      <select
                        value={subSourceLanguage}
                        onChange={(event) => setSubSourceLanguage(event.target.value)}
                      >
                        {subSourceLanguageOptions.map((language) => (
                          <option key={language.value} value={language.value}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      OpenSubtitles.org username
                      <input
                        type="text"
                        value={openSubtitlesUsername}
                        onChange={(event) => setOpenSubtitlesUsername(event.target.value)}
                        autoComplete="username"
                        spellCheck={false}
                      />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        value={openSubtitlesPassword}
                        onChange={(event) => setOpenSubtitlesPassword(event.target.value)}
                        autoComplete="current-password"
                        spellCheck={false}
                      />
                    </label>
                    <label>
                      Lang
                      <select
                        value={openSubtitlesLanguage}
                        onChange={(event) => setOpenSubtitlesLanguage(event.target.value)}
                      >
                        {openSubtitlesLanguageOptions.map((language) => (
                          <option key={language.value} value={language.value}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
            </form>

            <p className="online-subtitle-help">
              Need access? Create a free{" "}
              <a href="https://subsource.net/dashboard/profile" target="_blank" rel="noreferrer">
                SubSource API key
              </a>
              , an{" "}
              <a href="https://www.opensubtitles.org/en/newuser" target="_blank" rel="noreferrer">
                OpenSubtitles.org account
              </a>
              , then paste the details requested above.
            </p>
            {onlineSubtitleProvider === "opensubtitles" ? (
              <p className="online-subtitle-help">
                This uses the legacy Popcorn Time XML-RPC flow. Free OpenSubtitles.org accounts can search, but the old .org API now replaces downloads with a VIP notice; free app downloads require the newer OpenSubtitles.com REST API.
              </p>
            ) : null}

            {onlineSubtitleError ? <p className="subtitle-error">{onlineSubtitleError}</p> : null}

            {onlineSubtitleResults.length > 0 ? (
              <div className="online-subtitle-results" aria-label="Online subtitle results">
                {onlineSubtitleResults.map((result) => {
                  const isLoadingOnlineResult = onlineSubtitleLoadingResultId === result.id;
                  const isActiveOnlineResult = activeOnlineResultId === result.id;
                  const resultMeta = [
                    getOnlineSubtitleProviderLabel(result.provider),
                    result.language,
                    result.format.toUpperCase(),
                    result.isRawFile ? null : "ZIP",
                    result.size ? formatBytes(result.size) : null,
                    result.hi ? "HI" : null,
                    result.fps ? `${result.fps} fps` : null
                  ].filter(Boolean);

                  return (
                    <button
                      type="button"
                      className={isActiveOnlineResult ? "online-subtitle-result active" : "online-subtitle-result"}
                      key={result.id}
                      onClick={() => {
                        void loadOnlineSubtitle(result);
                      }}
                      disabled={onlineSubtitleSearchState === "loading" || isLoadingOnlineResult}
                    >
                      {isLoadingOnlineResult ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                      <span>
                        <strong>{result.releaseName}</strong>
                        <small>{resultMeta.join(" - ")}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {subtitleFiles.length > 0 ? (
              <div className="subtitle-source-list" aria-label="Subtitle files in this torrent">
                {subtitleFiles.map((file) => {
                  const fileName = getFileName(file);
                  const isLoadingSubtitle = subtitleLoadingFileIndex === file.index;
                  const isActiveSubtitle = subtitleFileName === fileName;

                  return (
                    <button
                      type="button"
                      className={isActiveSubtitle ? "subtitle-source active" : "subtitle-source"}
                      key={`${file.index}-${file.name}`}
                      onClick={() => {
                        void loadSubtitleFromTorrent(file);
                      }}
                      disabled={isTorrentLoading || isLoadingSubtitle}
                    >
                      {isLoadingSubtitle ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Captions size={16} aria-hidden="true" />}
                      <span>{fileName}</span>
                      <small>{formatBytes(file.length)}</small>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="subtitle-controls" aria-label="Subtitle timing">
              <button type="button" className="ghost-button" onClick={() => shiftSubtitle(-subtitleShiftStepSeconds)} disabled={!subtitleRawText}>
                <StepBack size={16} aria-hidden="true" />
                Earlier
              </button>
              <button type="button" className="ghost-button" onClick={resetSubtitleShift} disabled={!subtitleRawText || subtitleOffsetSeconds === 0}>
                0s
              </button>
              <button type="button" className="ghost-button" onClick={() => shiftSubtitle(subtitleShiftStepSeconds)} disabled={!subtitleRawText}>
                <StepForward size={16} aria-hidden="true" />
                Later
              </button>
            </div>

            <div className="subtitle-size-row">
              <button
                type="button"
                className="ghost-button"
                aria-label="Decrease subtitle size"
                onClick={() => setSubtitleSizePercent((currentSize) => Math.max(minSubtitleSizePercent, currentSize - 5))}
                disabled={!subtitleRawText || subtitleSizePercent <= minSubtitleSizePercent}
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <label>
                <span className="subtitle-size-label">
                  <span>Size</span>
                  <output>{subtitleSizePercent}%</output>
                </span>
                <input
                  type="range"
                  min={minSubtitleSizePercent}
                  max={maxSubtitleSizePercent}
                  step={5}
                  value={subtitleSizePercent}
                  onChange={(event) => setSubtitleSizePercent(Number(event.target.value))}
                  disabled={!subtitleRawText}
                />
              </label>
              <button
                type="button"
                className="ghost-button"
                aria-label="Increase subtitle size"
                onClick={() => setSubtitleSizePercent((currentSize) => Math.min(maxSubtitleSizePercent, currentSize + 5))}
                disabled={!subtitleRawText || subtitleSizePercent >= maxSubtitleSizePercent}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>

            {subtitleFileName ? (
              <button type="button" className="ghost-button subtitle-remove" onClick={removeSubtitleFile}>
                Remove subtitles
              </button>
            ) : null}
          </div>
        </aside>
        </section>
        </>
      ) : null}
    </main>
  );
}

export default App;
