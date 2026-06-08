export type TorrentInput =
  | { type: "magnet"; uri: string }
  | { type: "torrentFile"; path: string }
  | { type: "url"; url: string };

export type TorrentStatus =
  | "fetching_metadata"
  | "queued"
  | "downloading"
  | "streaming"
  | "paused"
  | "seeding"
  | "completed"
  | "checking"
  | "error";

export type MediaKind =
  | "video"
  | "audio"
  | "subtitle"
  | "archive"
  | "executable"
  | "disk_image"
  | "unknown";

export type FilePriority = "skip" | "low" | "normal" | "high" | "stream";

export type TorrentFile = {
  torrentId: string;
  index: number;
  path: string;
  size: number;
  progress: number;
  priority: FilePriority;
  mediaKind: MediaKind;
};

export type TorrentSummary = {
  id: string;
  infoHashV1?: string;
  infoHashV2?: string;
  name: string;
  status: TorrentStatus;
  progress: number;
  downloadRate: number;
  uploadRate: number;
  peers: number;
  seeds?: number;
  selectedFileCount: number;
  totalFileCount: number;
  totalSize: number;
  downloadedBytes: number;
  uploadedBytes: number;
  errorMessage?: string;
};

export type ProviderResult = {
  id: string;
  providerId: string;
  title: string;
  sourceUrl: string;
  magnetUri?: string;
  torrentUrl?: string;
  infoHashV1?: string;
  infoHashV2?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  category?: string;
  licenseHint?: string;
};

export type StreamHealth =
  | "ready"
  | "buffering_missing_pieces"
  | "buffering_no_peers"
  | "buffering_slow_peers"
  | "buffering_checking"
  | "error";

export type StreamSession = {
  torrentId: string;
  fileIndex: number;
  fileName: string;
  health: StreamHealth;
  bufferSeconds: number;
  playbackPositionSeconds: number;
  readAheadPieces: number;
};
