import type { OpenSubtitlesCandidate } from "../services/opensubtitles";
import type { RqbitFile } from "../services/rqbit";
import type { SubSourceSubtitleCandidate } from "../services/subsource";

export type MetadataState = "idle" | "fetching" | "ready" | "starting" | "streaming" | "stopped" | "error";
export type SourceSearchState = "idle" | "searching" | "ready" | "error";
export type CatalogSearchState = "idle" | "searching" | "ready" | "error";
export type OnlineSubtitleSearchState = "idle" | "searching" | "ready" | "loading" | "error";
export type OnlineSubtitleProvider = "subsource" | "opensubtitles";

export type OnlineSubtitleCandidate = {
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

export type LocalTorrentMatch = {
  id?: number;
  name: string;
  outputFolder?: string;
  progressBytes: number;
  totalBytes: number;
  percent: number;
  finished: boolean;
  state?: string;
  isCurrent: boolean;
  matchReason: "hash" | "title";
};

export type LoadedSubtitleTrack = {
  id: string;
  sourceId: string;
  sourceLabel: string;
  language?: string;
  fileName: string;
  rawText: string;
  offsetSeconds: number;
  isVisible: boolean;
};

export type PersistedSubtitleTrack = Pick<
  LoadedSubtitleTrack,
  "sourceId" | "sourceLabel" | "language" | "fileName" | "rawText" | "offsetSeconds" | "isVisible"
>;

export type ParsedSubtitleCue = {
  start: number;
  end: number;
  text: string;
};

export type ParsedSubtitleTrack = {
  id: string;
  sourceId: string;
  sourceLabel: string;
  language?: string;
  fileName: string;
  offsetSeconds: number;
  cues: ParsedSubtitleCue[];
};

export type ActiveSubtitleTrack = {
  id: string;
  fileName: string;
  sourceLabel: string;
  text: string;
  isPrimary: boolean;
};

export type PlayerShortcutFeedback = {
  id: number;
  label: string;
};

export type TorrentSession = {
  infoHash: string;
  name: string;
  files: RqbitFile[];
  seenPeers: number;
  torrentId?: number;
};

export type LanguageOption = {
  value: string;
  label: string;
};
