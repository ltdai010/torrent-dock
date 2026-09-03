import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent } from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";
import {
  Captions,
  CirclePause,
  History,
  Loader2,
  Magnet,
  Search,
  Settings,
} from "lucide-react";
import {
  getLibraryTorrentDetails,
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
import { AppHeaderSearch, AppTopBar } from "./components/AppControls";
import { SettingsDialog } from "./components/SettingsDialog";
import { Button } from "./components/ui";
import { HistoryPage } from "./pages/HistoryPage";
import { PlayerPage } from "./pages/PlayerPage";
import { SearchPage } from "./pages/SearchPage";
import type {
  ActiveSubtitleTrack,
  CatalogSearchState,
  LanguageOption,
  LocalTorrentMatch,
  LoadedSubtitleTrack,
  MetadataState,
  OnlineSubtitleCandidate,
  OnlineSubtitleProvider,
  OnlineSubtitleSearchState,
  ParsedSubtitleCue,
  ParsedSubtitleTrack,
  PersistedSubtitleTrack,
  PlayerShortcutFeedback,
  SourceSearchState,
  TorrentSession
} from "./domain/appTypes";
import "./App.css";

const playableExtensions = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".ogg", ".ogm", ".ogv", ".webm"]);
const subtitleExtensions = new Set([".srt", ".vtt"]);
const subtitleShiftStepSeconds = 0.5;
const playerSeekStepSeconds = 10;
const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 2];
const subSourceApiKeyStorageKey = "torrentdock.subSourceApiKey";
const subSourceLanguageStorageKey = "torrentdock.subSourceLanguage";
const openSubtitlesUsernameStorageKey = "torrentdock.openSubtitlesOrgUsername";
const openSubtitlesPasswordStorageKey = "torrentdock.openSubtitlesOrgPassword";
const openSubtitlesLanguageStorageKey = "torrentdock.openSubtitlesLanguage";
const subtitleTracksStorageKeyPrefix = "torrentdock.subtitleTracks.";
const subtitleTextScaleStorageKey = "torrentdock.subtitleTextScale";
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
const subtitleLanguageHints = [
  { pattern: /(?:^|[._\-\s()[\]])(?:en|eng|english)(?:$|[._\-\s()[\]])/i, label: "English" },
  { pattern: /(?:^|[._\-\s()[\]])(?:vi|vie|vietnamese|vietnam)(?:$|[._\-\s()[\]])/i, label: "Vietnamese" },
  { pattern: /(?:^|[._\-\s()[\]])(?:es|spa|spanish)(?:$|[._\-\s()[\]])/i, label: "Spanish" },
  { pattern: /(?:^|[._\-\s()[\]])(?:fr|fre|fra|french)(?:$|[._\-\s()[\]])/i, label: "French" },
  { pattern: /(?:^|[._\-\s()[\]])(?:de|ger|deu|german)(?:$|[._\-\s()[\]])/i, label: "German" },
  { pattern: /(?:^|[._\-\s()[\]])(?:pt|por|portuguese)(?:$|[._\-\s()[\]])/i, label: "Portuguese" },
  { pattern: /(?:^|[._\-\s()[\]])(?:zh|chi|zho|chinese|chs|cht)(?:$|[._\-\s()[\]])/i, label: "Chinese" },
  { pattern: /(?:^|[._\-\s()[\]])(?:ja|jpn|japanese)(?:$|[._\-\s()[\]])/i, label: "Japanese" },
  { pattern: /(?:^|[._\-\s()[\]])(?:ko|kor|korean)(?:$|[._\-\s()[\]])/i, label: "Korean" },
  { pattern: /(?:^|[._\-\s()[\]])(?:th|tha|thai)(?:$|[._\-\s()[\]])/i, label: "Thai" },
  { pattern: /(?:^|[._\-\s()[\]])(?:id|ind|indonesian)(?:$|[._\-\s()[\]])/i, label: "Indonesian" }
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

function formatSubtitleLanguage(language?: string) {
  if (!language) {
    return null;
  }

  const normalizedLanguage = language.trim();
  if (!normalizedLanguage) {
    return null;
  }

  const knownLanguage = [...onlineSubtitleLanguageOptions, ...subSourceLanguageOptions].find(
    (option) => option.value.toLowerCase() === normalizedLanguage.toLowerCase() || option.label.toLowerCase() === normalizedLanguage.toLowerCase()
  );

  if (knownLanguage) {
    return knownLanguage.label;
  }

  return normalizedLanguage
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function inferSubtitleLanguageFromFileName(fileName: string) {
  return subtitleLanguageHints.find((hint) => hint.pattern.test(fileName))?.label;
}

function normalizeLibraryMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getResultInfoHash(result: ProviderResult) {
  if (result.infoHashV1) {
    return result.infoHashV1.toLowerCase();
  }

  if (result.infoHashV2) {
    return result.infoHashV2.toLowerCase();
  }

  const magnetHash = result.magnetUri?.match(/btih:([a-z0-9]+)/i)?.[1];
  return magnetHash?.toLowerCase() ?? null;
}

function getSourceResultLocalMatch(
  result: ProviderResult,
  historyItems: LibraryTorrent[],
  currentSession: TorrentSession | null
): LocalTorrentMatch | null {
  const resultInfoHash = getResultInfoHash(result);
  const currentInfoHash = currentSession?.infoHash.toLowerCase();
  const exactHashMatch = resultInfoHash
    ? historyItems.find((item) => item.infoHash.toLowerCase() === resultInfoHash)
    : undefined;

  if (exactHashMatch) {
    return {
      id: exactHashMatch.id,
      name: exactHashMatch.name,
      outputFolder: exactHashMatch.outputFolder,
      progressBytes: exactHashMatch.progressBytes,
      totalBytes: exactHashMatch.totalBytes,
      percent: exactHashMatch.percent,
      finished: exactHashMatch.finished,
      state: exactHashMatch.state,
      isCurrent: currentInfoHash === resultInfoHash,
      matchReason: "hash"
    };
  }

  const normalizedResultTitle = normalizeLibraryMatchText(result.title);
  if (normalizedResultTitle.length < 8) {
    return null;
  }

  const titleMatch = historyItems.find((item) => {
    const normalizedLocalTitle = normalizeLibraryMatchText(item.name);
    return (
      normalizedLocalTitle.length >= 8 &&
      (normalizedLocalTitle === normalizedResultTitle ||
        normalizedLocalTitle.includes(normalizedResultTitle) ||
        normalizedResultTitle.includes(normalizedLocalTitle))
    );
  });

  if (!titleMatch) {
    return null;
  }

  return {
    id: titleMatch.id,
    name: titleMatch.name,
    outputFolder: titleMatch.outputFolder,
    progressBytes: titleMatch.progressBytes,
    totalBytes: titleMatch.totalBytes,
    percent: titleMatch.percent,
    finished: titleMatch.finished,
    state: titleMatch.state,
    isCurrent: Boolean(currentInfoHash && titleMatch.infoHash.toLowerCase() === currentInfoHash),
    matchReason: "title"
  };
}

function getSubtitleTracksStorageKey(activeSession: TorrentSession | null, fileToPlay: RqbitFile | undefined) {
  if (!activeSession || !fileToPlay) {
    return null;
  }

  return `${subtitleTracksStorageKeyPrefix}${activeSession.infoHash}:${fileToPlay.index}:${fileToPlay.name}`;
}

function parsePersistedSubtitleTracks(value: string | null): LoadedSubtitleTrack[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((track): LoadedSubtitleTrack[] => {
      if (
        typeof track !== "object" ||
        track === null ||
        !("sourceId" in track) ||
        !("sourceLabel" in track) ||
        !("fileName" in track) ||
        !("rawText" in track)
      ) {
        return [];
      }

      const candidate = track as Partial<PersistedSubtitleTrack>;
      if (
        typeof candidate.sourceId !== "string" ||
        typeof candidate.sourceLabel !== "string" ||
        typeof candidate.fileName !== "string" ||
        typeof candidate.rawText !== "string"
      ) {
        return [];
      }

      return [
        {
          id: createSubtitleTrackId(candidate.sourceId),
          sourceId: candidate.sourceId,
          sourceLabel: candidate.sourceLabel,
          language: typeof candidate.language === "string" ? candidate.language : inferSubtitleLanguageFromFileName(candidate.fileName),
          fileName: candidate.fileName,
          rawText: candidate.rawText,
          offsetSeconds: typeof candidate.offsetSeconds === "number" ? candidate.offsetSeconds : 0,
          isVisible: typeof candidate.isVisible === "boolean" ? candidate.isVisible : true
        }
      ];
    });
  } catch {
    return [];
  }
}

function serializeSubtitleTracks(tracks: LoadedSubtitleTrack[]) {
  const persistedTracks: PersistedSubtitleTrack[] = tracks.map((track) => ({
    sourceId: track.sourceId,
    sourceLabel: track.sourceLabel,
    language: track.language,
    fileName: track.fileName,
    rawText: track.rawText,
    offsetSeconds: track.offsetSeconds,
    isVisible: track.isVisible
  }));

  return JSON.stringify(persistedTracks);
}

function formatPercentage(value: number) {
  if (value >= 100) {
    return "100%";
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
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

function readStoredNumber(key: string, fallback: number) {
  const value = Number(readStoredValue(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
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

function getVideoJsMimeType(fileName: string) {
  switch (fileExtension(fileName)) {
    case ".mp4":
    case ".m4v":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".ogg":
    case ".ogm":
    case ".ogv":
      return "video/ogg";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    default:
      return undefined;
  }
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

function decodeSubtitleEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'");
}

function cleanSubtitleCueText(value: string) {
  return decodeSubtitleEntities(value)
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseSubtitleCueTiming(line: string) {
  const [startValue, endValueWithSettings] = line.split("-->");
  const endValue = endValueWithSettings?.trim().split(/\s+/)[0];

  if (!startValue || !endValue) {
    return null;
  }

  const start = parseSubtitleTimestamp(startValue);
  const end = parseSubtitleTimestamp(endValue);

  if (start === null || end === null || end <= start) {
    return null;
  }

  return { start, end };
}

function parseSubtitleCues(rawSubtitleText: string, offsetSeconds: number) {
  const trackText = buildSubtitleTrackText(rawSubtitleText, offsetSeconds);

  if (!trackText.includes("-->")) {
    return [];
  }

  return trackText
    .split(/\n{2,}/)
    .flatMap((block): ParsedSubtitleCue[] => {
      const lines = block
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));

      if (timingIndex < 0) {
        return [];
      }

      const timing = parseSubtitleCueTiming(lines[timingIndex]);
      const text = cleanSubtitleCueText(lines.slice(timingIndex + 1).join("\n"));

      if (!timing || !text) {
        return [];
      }

      return [
        {
          start: timing.start,
          end: timing.end,
          text
        }
      ];
    });
}

function createSubtitleTrackId(sourceId: string) {
  return `${sourceId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function getTorrentSubtitleSourceId(file: RqbitFile) {
  return `torrent:${file.index}`;
}

function isKeyboardShortcutTargetEditable(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, button, a, [contenteditable]"));
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

  // Desktop command rejections can arrive as plain strings, not Error instances.
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Something went wrong while talking to the torrent engine.";
}

function App() {
  const videoJsHostRef = useRef<HTMLDivElement | null>(null);
  const videoJsPlayerRef = useRef<Player | null>(null);
  const playerPanelRef = useRef<HTMLElement | null>(null);
  const activeLoadAbortRef = useRef<AbortController | null>(null);
  const activeTorrentIdRef = useRef<number | null>(null);
  const stoppedLoadControllersRef = useRef<WeakSet<AbortController>>(new WeakSet());
  const shortcutFeedbackTimeoutRef = useRef<number | null>(null);
  const [torrentInput, setTorrentInput] = useState("");
  const [metadataState, setMetadataState] = useState<MetadataState>("idle");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [session, setSession] = useState<TorrentSession | null>(null);
  const [engineBaseUrl, setEngineBaseUrl] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [playerState, setPlayerState] = useState<"idle" | "loading" | "playing" | "paused" | "stopped" | "ended">("idle");
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(100);
  const [isPlayerMuted, setIsPlayerMuted] = useState(false);
  const [playerRate, setPlayerRate] = useState(1);
  const [downloadProgress, setDownloadProgress] = useState<TorrentDownloadProgress | null>(null);
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
  const [subtitleTracks, setSubtitleTracks] = useState<LoadedSubtitleTrack[]>([]);
  const [loadedSubtitleTracksStorageKey, setLoadedSubtitleTracksStorageKey] = useState<string | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleLoadingFileIndex, setSubtitleLoadingFileIndex] = useState<number | null>(null);
  const [videoJsOverlayRoot, setVideoJsOverlayRoot] = useState<HTMLElement | null>(null);
  const [playerShortcutFeedback, setPlayerShortcutFeedback] = useState<PlayerShortcutFeedback | null>(null);
  const [subtitleTextScale, setSubtitleTextScale] = useState(() => Math.min(1.7, Math.max(0.75, readStoredNumber(subtitleTextScaleStorageKey, 1))));
  const [subSourceApiKey, setSubSourceApiKey] = useState(() => readStoredValue(subSourceApiKeyStorageKey));
  const [subSourceLanguage, setSubSourceLanguage] = useState(() => readStoredValue(subSourceLanguageStorageKey, "english"));
  const [openSubtitlesUsername, setOpenSubtitlesUsername] = useState(() => readStoredValue(openSubtitlesUsernameStorageKey));
  const [openSubtitlesPassword, setOpenSubtitlesPassword] = useState(() => readStoredValue(openSubtitlesPasswordStorageKey));
  const [openSubtitlesLanguage, setOpenSubtitlesLanguage] = useState(() => readStoredValue(openSubtitlesLanguageStorageKey, "en"));
  const [onlineSubtitleSearchState, setOnlineSubtitleSearchState] = useState<OnlineSubtitleSearchState>("idle");
  const [onlineSubtitleResults, setOnlineSubtitleResults] = useState<OnlineSubtitleCandidate[]>([]);
  const [onlineSubtitleError, setOnlineSubtitleError] = useState<string | null>(null);
  const [onlineSubtitleLoadingResultId, setOnlineSubtitleLoadingResultId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [historyItems, setHistoryItems] = useState<LibraryTorrent[]>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyBusyId, setHistoryBusyId] = useState<number | null>(null);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  const playableFiles = useMemo(() => session?.files.filter(isPlayable) ?? [], [session]);
  const subtitleFiles = useMemo(() => session?.files.filter(isSubtitleFile) ?? [], [session]);
  const selectedFile = playableFiles[selectedFileIndex] ?? playableFiles[0];
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
  const progressPercent = downloadProgress?.percent ?? 0;
  const progressLabel = formatPercentage(progressPercent);
  const progressBytesLabel =
    downloadProgress && downloadProgress.totalBytes > 0
      ? `${formatBytes(downloadProgress.progressBytes)} / ${formatBytes(downloadProgress.totalBytes)}`
      : "Waiting for stats";
  const downloadSpeedLabel = streamUrl ? (downloadProgress?.downloadSpeedLabel ?? "0 B/s") : "idle";
  const selectedCatalogSearchTitle = selectedCatalogTitle?.searchTitle;
  const subtitleTracksStorageKey = useMemo(() => getSubtitleTracksStorageKey(session, selectedFile), [session, selectedFile]);
  const sourceResultLocalMatches = useMemo(
    () =>
      new Map(
        sourceResults.flatMap((result) => {
          const match = getSourceResultLocalMatch(result, historyItems, session);
          return match ? [[result.id, match] as const] : [];
        })
      ),
    [historyItems, session, sourceResults]
  );
  const activeSubtitleSourceIds = useMemo(() => new Set(subtitleTracks.map((track) => track.sourceId)), [subtitleTracks]);
  const parsedSubtitleTracks = useMemo<ParsedSubtitleTrack[]>(
    () =>
      subtitleTracks.flatMap((track) => {
        if (!track.isVisible) {
          return [];
        }

        const cues = parseSubtitleCues(track.rawText, track.offsetSeconds);

        if (cues.length === 0) {
          return [];
        }

        return [
          {
            id: track.id,
            sourceId: track.sourceId,
            sourceLabel: track.sourceLabel,
            language: track.language,
            fileName: track.fileName,
            offsetSeconds: track.offsetSeconds,
            cues
          }
        ];
      }),
    [subtitleTracks]
  );
  const activeSubtitleTracks = useMemo<ActiveSubtitleTrack[]>(
    () =>
      parsedSubtitleTracks.flatMap((track, index) => {
        const text = track.cues
          .filter((cue) => playerTime >= cue.start && playerTime <= cue.end)
          .map((cue) => cue.text)
          .join("\n");

        if (!text) {
          return [];
        }

        return [
          {
            id: track.id,
            fileName: track.fileName,
            sourceLabel: track.sourceLabel,
            text,
            isPrimary: index === 0
          }
        ];
      }),
    [parsedSubtitleTracks, playerTime]
  );
  const viewMode: "search" | "browse" | "player" = shouldShowPlayer
    ? "player"
    : selectedCatalogTitle
      ? "browse"
      : "search";
  useEffect(() => {
    if (!subtitleTracksStorageKey) {
      setLoadedSubtitleTracksStorageKey(null);
      setSubtitleTracks([]);
      return;
    }

    setSubtitleTracks(parsePersistedSubtitleTracks(window.localStorage.getItem(subtitleTracksStorageKey)));
    setLoadedSubtitleTracksStorageKey(subtitleTracksStorageKey);
    setSubtitleError(null);
  }, [subtitleTracksStorageKey]);

  useEffect(() => {
    if (!subtitleTracksStorageKey || loadedSubtitleTracksStorageKey !== subtitleTracksStorageKey) {
      return;
    }

    if (subtitleTracks.length === 0) {
      window.localStorage.removeItem(subtitleTracksStorageKey);
      return;
    }

    window.localStorage.setItem(subtitleTracksStorageKey, serializeSubtitleTracks(subtitleTracks));
  }, [loadedSubtitleTracksStorageKey, subtitleTracks, subtitleTracksStorageKey]);

  useEffect(() => {
    setSubtitleTracks((currentTracks) => {
      let changed = false;
      const nextTracks = currentTracks.map((track) => {
        if (track.language) {
          return track;
        }

        const inferredLanguage = inferSubtitleLanguageFromFileName(track.fileName);
        if (!inferredLanguage) {
          return track;
        }

        changed = true;
        return {
          ...track,
          language: inferredLanguage
        };
      });

      return changed ? nextTracks : currentTracks;
    });
  }, [subtitleTracks]);

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
    window.localStorage.setItem(subtitleTextScaleStorageKey, String(subtitleTextScale));
  }, [subtitleTextScale]);

  useEffect(() => {
    void loadHistory({ silent: true });
  }, []);

  useEffect(() => {
    return () => {
      if (shortcutFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(shortcutFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const host = videoJsHostRef.current;

    if (!streamUrl || !host) {
      return undefined;
    }

    host.innerHTML = "";
    const video = document.createElement("video-js");
    video.classList.add("video-js", "vjs-big-play-centered", "torrentdock-video-js");
    video.setAttribute("controls", "true");
    video.setAttribute("playsinline", "true");
    video.setAttribute("preload", "auto");
    host.appendChild(video);

    const fileName = selectedFile ? getFileName(selectedFile) : session?.name ?? "";
    const source = {
      src: streamUrl,
      type: getVideoJsMimeType(fileName)
    };
    const player = videojs(video, {
      autoplay: true,
      bigPlayButton: true,
      controls: true,
      fill: true,
      fluid: false,
      html5: {
        nativeTextTracks: false
      },
      persistTextTrackSettings: true,
      playbackRates,
      preload: "auto",
      responsive: true,
      sources: [source]
    });
    videoJsPlayerRef.current = player;
    const playerElement = player.el();
    setVideoJsOverlayRoot(playerElement instanceof HTMLElement ? playerElement : null);

    const syncPlayer = () => syncHtmlPlaybackState();
    const syncVolume = () => {
      const volume = player.volume();
      const muted = player.muted();
      setPlayerVolume(Math.round((typeof volume === "number" ? volume : 0) * 100));
      setIsPlayerMuted(Boolean(muted));
    };
    const syncRate = () => {
      const rate = player.playbackRate();
      if (typeof rate === "number") {
        setPlayerRate(rate);
      }
    };
    const handleError = () => {
      const tech = player.tech({ IWillNotUseThisInPlugins: true })?.el() as HTMLVideoElement | undefined;
      const mediaError = tech?.error ?? null;
      const videoJsError = player.error();
      setVideoError(videoJsError?.message || describeMediaError(mediaError, selectedFile ? getFileName(selectedFile) : session?.name ?? ""));
      setStreamUrl(null);
      setMetadataState("ready");
    };

    player.on("play", syncPlayer);
    player.on("pause", syncPlayer);
    player.on("timeupdate", syncPlayer);
    player.on("loadedmetadata", syncPlayer);
    player.on("durationchange", syncPlayer);
    player.on("volumechange", syncVolume);
    player.on("ratechange", syncRate);
    player.on("error", handleError);

    player.ready(() => {
      player.volume(playerVolume / 100);
      player.muted(isPlayerMuted);
      player.playbackRate(playerRate);
      const playResult = player.play();
      if (playResult) {
        void playResult.catch((error: unknown) => {
          if (
            error instanceof DOMException &&
            (error.name === "NotAllowedError" || error.name === "NotSupportedError" || error.name === "AbortError")
          ) {
            return;
          }

          setVideoError(getErrorMessage(error));
        });
      }
    });

    return () => {
      player.dispose();
      if (videoJsPlayerRef.current === player) {
        videoJsPlayerRef.current = null;
      }
      setVideoJsOverlayRoot(null);
      host.innerHTML = "";
    };
  }, [selectedFile, session?.name, streamUrl]);

  useEffect(() => {
    if (!streamUrl) {
      return undefined;
    }

    const handleKeyboardShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isKeyboardShortcutTargetEditable(event.target)
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        seekPlayerBy(-playerSeekStepSeconds);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        seekPlayerBy(playerSeekStepSeconds);
        return;
      }

      if (event.code === "Space" || event.key === " " || event.key === "Spacebar") {
        if (event.repeat) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        togglePlayerPlayback();
      }
    };

    window.addEventListener("keydown", handleKeyboardShortcut, { capture: true });

    return () => {
      window.removeEventListener("keydown", handleKeyboardShortcut, { capture: true });
    };
  }, [streamUrl]);

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
    videoJsPlayerRef.current?.pause();
    setStreamUrl(null);
    setPlayerState("stopped");
    setPlayerTime(0);
    setPlayerDuration(0);
    setSession(null);
    setSelectedFileIndex(0);
    setMetadataState("stopped");
    setErrorMessage(null);
  }

  function stopActivePlayback() {
    activeLoadAbortRef.current?.abort();
    activeLoadAbortRef.current = null;

    videoJsPlayerRef.current?.pause();

    if (document.fullscreenElement === playerPanelRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }

    setStreamUrl(null);
    setPlayerState("stopped");
    setPlayerTime(0);
    setPlayerDuration(0);
    setDownloadProgress(null);
  }

  async function openHistory() {
    stopActivePlayback();
    setShowSettings(false);
    setShowHistory(true);
    await loadHistory();
  }

  function closeHistory() {
    setShowHistory(false);
  }

  function openSettings() {
    setShowSettings(true);
  }

  function closeSettings() {
    setShowSettings(false);
  }

  async function loadHistory(options: { silent?: boolean } = {}) {
    if (!options.silent) {
      setHistoryState("loading");
      setHistoryError(null);
    }

    try {
      const activeEngineBaseUrl = engineBaseUrl ?? (await ensureRqbitEngineEndpoint());
      setEngineBaseUrl(activeEngineBaseUrl);
      const items = await listLibraryTorrents(activeEngineBaseUrl);
      items.sort((a, b) => b.id - a.id);
      setHistoryItems(items);
      if (!options.silent) {
        setHistoryState("ready");
      }
    } catch (error) {
      if (!options.silent) {
        setHistoryItems([]);
        setHistoryState("error");
        setHistoryError(getErrorMessage(error));
      }
    }
  }

  async function openHistoryItem(item: LibraryTorrent) {
    setHistoryBusyId(item.id);
    setHistoryError(null);

    try {
      const activeEngineBaseUrl = engineBaseUrl ?? (await ensureRqbitEngineEndpoint());
      setEngineBaseUrl(activeEngineBaseUrl);

      const details = await getLibraryTorrentDetails(item.id, activeEngineBaseUrl);
      const files = details.files ?? [];
      const playableHistoryFiles = files.filter(isPlayable);
      const includedPlayableHistoryFiles = playableHistoryFiles.filter((file) => file.included);
      const fileToPlay = includedPlayableHistoryFiles[0] ?? playableHistoryFiles[0];

      if (!fileToPlay) {
        setHistoryError("That history item has no browser-playable video file.");
        return;
      }

      const nextSession: TorrentSession = {
        infoHash: details.info_hash || item.infoHash,
        name: details.name ?? item.name,
        files,
        seenPeers: 0,
        torrentId: item.id
      };
      const selectedPlayableIndex = Math.max(0, playableHistoryFiles.findIndex((file) => file.index === fileToPlay.index));

      setShowHistory(false);
      setSelectedCatalogTitle(null);
      setSelectedSourceResultId(null);
      setSourceResults([]);
      setSourceErrors([]);
      setSourceErrorMessage(null);
      setSourceSearchState("idle");
      setSourceQuery(nextSession.name);
      setTorrentInput("");
      removeSubtitleFile();
      setOnlineSubtitleResults([]);
      setOnlineSubtitleError(null);
      setOnlineSubtitleSearchState("idle");
      setSession(nextSession);
      setSelectedFileIndex(selectedPlayableIndex);
      await startHistoryPlayback(nextSession, fileToPlay, activeEngineBaseUrl);
    } catch (error) {
      setHistoryError(getErrorMessage(error));
    } finally {
      setHistoryBusyId(null);
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
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    const skippedFiles: string[] = [];

    for (const file of files) {
      const normalizedName = file.name.toLowerCase();

      if (!normalizedName.endsWith(".srt") && !normalizedName.endsWith(".vtt")) {
        skippedFiles.push(file.name);
        continue;
      }

      try {
        const text = await file.text();
        const wasAdded = addSubtitleTrack(text, file.name, {
          sourceId: `local:${file.name}:${file.size}:${file.lastModified}`,
          sourceLabel: "Uploaded"
        });

        if (!wasAdded) {
          skippedFiles.push(file.name);
        }
      } catch {
        skippedFiles.push(file.name);
      }
    }

    if (skippedFiles.length > 0) {
      setSubtitleError(`Skipped ${skippedFiles.length} subtitle file${skippedFiles.length === 1 ? "" : "s"} that could not be loaded.`);
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
      addSubtitleTrack(subtitleText, getFileName(file), {
        sourceId: getTorrentSubtitleSourceId(file),
        sourceLabel: "Torrent file"
      });
    } catch (error) {
      setSubtitleError(error instanceof Error ? error.message : "Could not load that subtitle file from the torrent.");
    } finally {
      setSubtitleLoadingFileIndex(null);
    }
  }

  async function findOnlineSubtitles() {
    if (!session && !selectedFile) {
      setOnlineSubtitleSearchState("error");
      setOnlineSubtitleError("Load torrent metadata before searching subtitles.");
      return;
    }

    const configuredProviders: Array<{
      provider: OnlineSubtitleProvider;
      label: string;
      search: () => Promise<OnlineSubtitleCandidate[]>;
    }> = [];
    const subtitleFilmName = selectedCatalogSearchTitle || sanitizeMediaSearchTitle(session?.name);
    const subtitleFileQuery = sanitizeMediaSearchTitle(selectedFile ? getFileName(selectedFile) : undefined);

    if (subSourceApiKey.trim()) {
      configuredProviders.push({
        provider: "subsource",
        label: "SubSource",
        search: async () =>
          (await searchSubSourceSubtitles({
            apiKey: subSourceApiKey.trim(),
            filmName: subtitleFilmName,
            fileName: subtitleFileQuery,
            languages: subSourceLanguage
          })).map(toOnlineSubtitleCandidate("subsource"))
      });
    }

    if (openSubtitlesUsername.trim() && openSubtitlesPassword) {
      configuredProviders.push({
        provider: "opensubtitles",
        label: "OpenSubtitles.org",
        search: async () =>
          (await searchOpenSubtitles({
            username: openSubtitlesUsername,
            password: openSubtitlesPassword,
            filmName: subtitleFilmName,
            query: subtitleFileQuery,
            imdbId: selectedCatalogTitle?.id,
            languages: openSubtitlesLanguage
          })).map(toOnlineSubtitleCandidate("opensubtitles"))
      });
    }

    if (configuredProviders.length === 0) {
      setOnlineSubtitleSearchState("error");
      setOnlineSubtitleError("Configure at least one subtitle provider in Settings.");
      return;
    }

    try {
      setOnlineSubtitleSearchState("searching");
      setOnlineSubtitleError(null);
      setOnlineSubtitleResults([]);
      const settledResults = await Promise.allSettled(configuredProviders.map((provider) => provider.search()));
      const results = settledResults.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
      const failedProviderMessages = settledResults.flatMap((result, index) =>
        result.status === "rejected"
          ? [`${configuredProviders[index].label}: ${result.reason instanceof Error ? result.reason.message : "search failed"}`]
          : []
      );

      setOnlineSubtitleResults(results);

      if (results.length === 0) {
        setOnlineSubtitleSearchState("error");
        setOnlineSubtitleError(
          failedProviderMessages.length > 0
            ? failedProviderMessages.join(" ")
            : "No configured subtitle provider matched this file."
        );
        return;
      }

      if (failedProviderMessages.length > 0) {
        setOnlineSubtitleError(`Partial subtitle provider errors: ${failedProviderMessages.join(" ")}`);
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
        if (
          !addSubtitleTrack(response.text, response.fileName ?? candidate.name, {
            sourceId: candidate.id,
            sourceLabel: getOnlineSubtitleProviderLabel(candidate.provider),
            language: candidate.language
          })
        ) {
          setOnlineSubtitleSearchState("error");
          return;
        }
      } else {
        const response = await downloadOpenSubtitlesSubtitle(candidate.raw as OpenSubtitlesCandidate, {
          username: openSubtitlesUsername,
          password: openSubtitlesPassword
        });

        if (
          !addSubtitleTrack(response.text, response.fileName, {
            sourceId: candidate.id,
            sourceLabel: getOnlineSubtitleProviderLabel(candidate.provider),
            language: candidate.language
          })
        ) {
          setOnlineSubtitleSearchState("error");
          return;
        }
      }

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

  function addSubtitleTrack(text: string, fileName: string, source: { sourceId: string; sourceLabel: string; language?: string }) {
    const cues = parseSubtitleCues(text, 0);

    if (cues.length === 0) {
      setSubtitleError(`${fileName} has no readable cues. Try a different result.`);
      return false;
    }

    setSubtitleTracks((currentTracks) => {
      const existingTrack = currentTracks.find((track) => track.sourceId === source.sourceId);
      const nextTrack = {
        id: existingTrack?.id ?? createSubtitleTrackId(source.sourceId),
        sourceId: source.sourceId,
        sourceLabel: source.sourceLabel,
        language: source.language ?? inferSubtitleLanguageFromFileName(fileName),
        fileName,
        rawText: text,
        offsetSeconds: existingTrack?.offsetSeconds ?? 0,
        isVisible: existingTrack?.isVisible ?? true
      };

      return [...currentTracks.filter((track) => track.sourceId !== source.sourceId), nextTrack];
    });
    setSubtitleError(null);
    return true;
  }

  function removeSubtitleFile() {
    setSubtitleTracks([]);
    setSubtitleError(null);
    setSubtitleLoadingFileIndex(null);
  }

  function removeSubtitleTrack(trackId: string) {
    const nextTracks = subtitleTracks.filter((track) => track.id !== trackId);
    setSubtitleTracks(nextTracks);
    setSubtitleError(null);
  }

  function makeSubtitleTrackPrimary(trackId: string) {
    setSubtitleTracks((currentTracks) => {
      const selectedTrack = currentTracks.find((track) => track.id === trackId);

      if (!selectedTrack) {
        return currentTracks;
      }

      return [selectedTrack, ...currentTracks.filter((track) => track.id !== trackId)];
    });
  }

  function toggleSubtitleTrackVisibility(trackId: string) {
    setSubtitleTracks((currentTracks) =>
      currentTracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              isVisible: !track.isVisible
            }
          : track
      )
    );
  }

  function shiftSubtitleTrack(trackId: string, deltaSeconds: number) {
    setSubtitleTracks((currentTracks) =>
      currentTracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              offsetSeconds: Number((track.offsetSeconds + deltaSeconds).toFixed(1))
            }
          : track
      )
    );
  }

  function resetSubtitleTrackShift(trackId: string) {
    setSubtitleTracks((currentTracks) =>
      currentTracks.map((track) =>
        track.id === trackId
          ? {
              ...track,
              offsetSeconds: 0
            }
          : track
      )
    );
  }

  function showPlayerShortcutFeedback(label: string) {
    if (shortcutFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(shortcutFeedbackTimeoutRef.current);
    }

    setPlayerShortcutFeedback({
      id: Date.now(),
      label
    });
    shortcutFeedbackTimeoutRef.current = window.setTimeout(() => {
      setPlayerShortcutFeedback(null);
      shortcutFeedbackTimeoutRef.current = null;
    }, 650);
  }

  function syncHtmlPlaybackState() {
    const videoJsPlayer = videoJsPlayerRef.current;
    if (videoJsPlayer) {
      const currentTime = videoJsPlayer.currentTime();
      const duration = videoJsPlayer.duration();
      setPlayerTime(typeof currentTime === "number" ? currentTime : 0);
      setPlayerDuration(typeof duration === "number" && Number.isFinite(duration) ? duration : 0);
      setPlayerState(videoJsPlayer.paused() ? "paused" : "playing");
    }
  }

  function seekPlayerBy(deltaSeconds: number) {
    const videoJsPlayer = videoJsPlayerRef.current;

    if (!videoJsPlayer) {
      return;
    }

    const currentTime = videoJsPlayer.currentTime();
    const duration = videoJsPlayer.duration();

    if (typeof currentTime !== "number" || !Number.isFinite(currentTime)) {
      return;
    }

    const upperBound = typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
    const nextTime = Math.min(Math.max(0, currentTime + deltaSeconds), upperBound);
    videoJsPlayer.currentTime(nextTime);
    setPlayerTime(nextTime);
    showPlayerShortcutFeedback(deltaSeconds > 0 ? `+${playerSeekStepSeconds}s` : `-${playerSeekStepSeconds}s`);
  }

  function togglePlayerPlayback() {
    const videoJsPlayer = videoJsPlayerRef.current;

    if (!videoJsPlayer) {
      return;
    }

    if (!videoJsPlayer.paused()) {
      videoJsPlayer.pause();
      syncHtmlPlaybackState();
      showPlayerShortcutFeedback("Pause");
      return;
    }

    showPlayerShortcutFeedback("Play");
    const playResult = videoJsPlayer.play();
    if (playResult) {
      void playResult.catch((error: unknown) => {
        if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) {
          return;
        }

        setVideoError(getErrorMessage(error));
      });
    }

    syncHtmlPlaybackState();
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

  async function startHistoryPlayback(activeSession: TorrentSession, fileToPlay: RqbitFile, activeEngineBaseUrl?: string) {
    const torrentId = activeSession.torrentId;

    if (typeof torrentId !== "number") {
      setVideoError("That history item is missing its torrent id.");
      return;
    }

    const playbackEngineBaseUrl = activeEngineBaseUrl ?? engineBaseUrl ?? (await ensureRqbitEngineEndpoint());
    let controller: AbortController | null = null;

    try {
      controller = beginLoadRequest();
      setMetadataState("starting");
      setErrorMessage(null);
      setVideoError(null);
      setStreamUrl(null);
      setEngineBaseUrl(playbackEngineBaseUrl);

      activeTorrentIdRef.current = torrentId;
      await resumeTorrent(torrentId, playbackEngineBaseUrl, { signal: controller.signal });

      if (controller.signal.aborted) {
        throw new DOMException("Stopped current torrent load.", "AbortError");
      }

      const nextUrl = getVideoStreamSrc(playbackEngineBaseUrl, torrentId, fileToPlay.index);

      setSession(activeSession);
      setVideoError(null);
      setStreamUrl(nextUrl);
      setMetadataState("streaming");
      setPlayerState("loading");
      setPlayerTime(0);
      setPlayerDuration(0);
      setDownloadProgress(null);
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

      const nextUrl = getVideoStreamSrc(activeEngineBaseUrl, torrentId, fileToPlay.index);

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

      // The Video.js lifecycle effect owns autoplay once the host is rendered.
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
    <main className={`player-app view-${viewMode}`}>
      <AppTopBar
        title="TorrentDock"
        search={
          <AppHeaderSearch
            id="source-query"
            label="Search title or paste magnet"
            value={sourceQuery}
            onChange={(value) => {
              setSourceQuery(value);
              setSelectedSourceResultId(null);
              setSelectedCatalogTitle(null);
            }}
            onPaste={catchPastedSource}
            onSubmit={() => void submitSourceEntry()}
            disabled={isTorrentLoading || sourceSearchState === "searching" || catalogSearchState === "searching" || normalizedEntry.length < 2}
            icon={
              isTorrentLoading || sourceSearchState === "searching" || catalogSearchState === "searching" ? (
                <Loader2 className="spin" size={17} aria-hidden="true" />
              ) : entryIsTorrentSource ? (
                <Magnet size={17} aria-hidden="true" />
              ) : (
                <Search size={17} aria-hidden="true" />
              )
            }
            actionLabel={isTorrentLoading ? "Loading" : sourceSearchState === "searching" ? "Finding" : catalogSearchState === "searching" ? "Finding" : entryIsTorrentSource ? "Load" : "Search"}
            secondaryAction={isTorrentLoading ? (
              <Button type="button" color="red" variant="surface" onClick={stopCurrentLoad}>
                <CirclePause size={17} aria-hidden="true" />
                Stop
              </Button>
            ) : null}
          />
        }
        actions={
          <>
          <Button
            type="button"
            variant={showSettings ? "soft" : "surface"}
            color="gray"
            onClick={() => {
              if (showSettings) {
                closeSettings();
              } else {
                openSettings();
              }
            }}
          >
            <Settings size={16} aria-hidden="true" />
            Settings
          </Button>
          <Button
            type="button"
            variant={showHistory ? "soft" : "surface"}
            color="gray"
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
          </Button>
          </>
        }
      />

      {showHistory ? (
        <HistoryPage
          historyBusyId={historyBusyId}
          historyError={historyError}
          historyItems={historyItems}
          historyState={historyState}
          isClearingHistory={isClearingHistory}
          formatBytes={formatBytes}
          formatPercentage={formatPercentage}
          onClearHistory={() => void clearHistory()}
          onLoadHistory={() => void loadHistory()}
          onOpenHistoryItem={(item) => void openHistoryItem(item)}
          onRemoveHistoryItem={(item, deleteFiles) => void removeHistoryItem(item, deleteFiles)}
        />
      ) : null}

      {showSettings ? (
        <SettingsDialog
          openSubtitlesLanguage={openSubtitlesLanguage}
          openSubtitlesLanguageOptions={openSubtitlesLanguageOptions}
          openSubtitlesPassword={openSubtitlesPassword}
          openSubtitlesUsername={openSubtitlesUsername}
          subSourceApiKey={subSourceApiKey}
          subSourceLanguage={subSourceLanguage}
          subSourceLanguageOptions={subSourceLanguageOptions}
          subtitleTextScale={subtitleTextScale}
          onCloseSettings={closeSettings}
          onOpenSubtitlesLanguageChange={setOpenSubtitlesLanguage}
          onOpenSubtitlesPasswordChange={setOpenSubtitlesPassword}
          onOpenSubtitlesUsernameChange={setOpenSubtitlesUsername}
          onSubSourceApiKeyChange={setSubSourceApiKey}
          onSubSourceLanguageChange={setSubSourceLanguage}
          onSubtitleTextScaleChange={setSubtitleTextScale}
        />
      ) : null}

      {!showHistory && (viewMode === "search" || viewMode === "browse") ? (
        <SearchPage
          catalogResults={catalogResults}
          catalogSearchState={catalogSearchState}
          catalogSearchStatus={catalogSearchStatus}
          chooseCatalogTitle={(candidate) => void chooseCatalogTitle(candidate)}
          formatOptionalBytes={formatOptionalBytes}
          formatOptionalCount={formatOptionalCount}
          isTorrentLoading={isTorrentLoading}
          loadSourceResult={(result) => void loadSourceResult(result)}
          metadataState={metadataState}
          selectedCatalogTitle={selectedCatalogTitle}
          selectedSourceResultId={selectedSourceResultId}
          session={session}
          shouldShowCatalogStatus={shouldShowCatalogStatus}
          shouldShowSourceStatus={shouldShowSourceStatus}
          sourceErrors={sourceErrors}
          sourceResults={sourceResults}
          sourceResultLocalMatches={sourceResultLocalMatches}
          sourceSearchState={sourceSearchState}
          sourceSearchStatus={sourceSearchStatus}
        />
      ) : null}

      {!showHistory && viewMode === "player" ? (
        <PlayerPage
          activeSubtitleTracks={activeSubtitleTracks}
          activeSubtitleSourceIds={activeSubtitleSourceIds}
          downloadProgress={downloadProgress}
          downloadSpeedLabel={downloadSpeedLabel}
          findOnlineSubtitles={() => void findOnlineSubtitles()}
          formatBytes={formatBytes}
          formatSubtitleLanguage={formatSubtitleLanguage}
          formatSubtitleOffset={formatSubtitleOffset}
          getFileName={getFileName}
          getOnlineSubtitleProviderLabel={getOnlineSubtitleProviderLabel}
          getTorrentSubtitleSourceId={getTorrentSubtitleSourceId}
          isTorrentLoading={isTorrentLoading}
          loadOnlineSubtitle={(candidate) => void loadOnlineSubtitle(candidate)}
          loadSubtitleFile={loadSubtitleFile}
          loadSubtitleFromTorrent={(file) => void loadSubtitleFromTorrent(file)}
          makeSubtitleTrackPrimary={makeSubtitleTrackPrimary}
          metadataState={metadataState}
          metadataStatus={metadataStatus}
          onlineSubtitleError={onlineSubtitleError}
          onlineSubtitleLoadingResultId={onlineSubtitleLoadingResultId}
          onlineSubtitleResults={onlineSubtitleResults}
          onlineSubtitleSearchState={onlineSubtitleSearchState}
          openSubtitlesLanguage={openSubtitlesLanguage}
          openSubtitlesLanguageOptions={openSubtitlesLanguageOptions}
          openSubtitlesPassword={openSubtitlesPassword}
          openSubtitlesUsername={openSubtitlesUsername}
          playerPanelRef={playerPanelRef}
          playerShortcutFeedback={playerShortcutFeedback}
          progressBytesLabel={progressBytesLabel}
          progressLabel={progressLabel}
          progressPercent={progressPercent}
          removeSubtitleFile={removeSubtitleFile}
          removeSubtitleTrack={removeSubtitleTrack}
          resetSubtitleTrackShift={resetSubtitleTrackShift}
          returnToSources={returnToSources}
          selectedCatalogTitle={selectedCatalogTitle}
          session={session}
          setOpenSubtitlesLanguage={setOpenSubtitlesLanguage}
          setSubSourceLanguage={setSubSourceLanguage}
          shiftSubtitleTrack={shiftSubtitleTrack}
          sourceQuery={sourceQuery}
          sourceResults={sourceResults}
          streamUrl={streamUrl}
          subtitleError={subtitleError}
          subtitleFiles={subtitleFiles}
          subtitleLoadingFileIndex={subtitleLoadingFileIndex}
          subtitleOverlayRoot={videoJsOverlayRoot}
          subtitleShiftStepSeconds={subtitleShiftStepSeconds}
          subtitleTracks={subtitleTracks}
          subSourceApiKey={subSourceApiKey}
          subSourceLanguage={subSourceLanguage}
          subSourceLanguageOptions={subSourceLanguageOptions}
          subtitleTextScale={subtitleTextScale}
          setSubtitleTextScale={setSubtitleTextScale}
          toggleSubtitleTrackVisibility={toggleSubtitleTrackVisibility}
          videoError={videoError}
          videoJsHostRef={videoJsHostRef}
        />
      ) : null}
    </main>
  );
}

export default App;
