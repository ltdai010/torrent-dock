import type { ProviderResult, StreamSession, TorrentFile, TorrentSummary } from "../domain/torrent";

export const torrentSummaries: TorrentSummary[] = [
  {
    id: "linux-iso-2026",
    infoHashV1: "9f5f4c7d02a8e1bdfb0d0e7fd4d4ad7f0c7e9a10",
    name: "LibreOS 2026 Desktop ISO",
    status: "downloading",
    progress: 0.64,
    downloadRate: 8_400_000,
    uploadRate: 880_000,
    peers: 42,
    seeds: 19,
    selectedFileCount: 1,
    totalFileCount: 3,
    totalSize: 4_700_000_000,
    downloadedBytes: 3_008_000_000,
    uploadedBytes: 420_000_000
  },
  {
    id: "cc-space-film",
    infoHashV1: "e03ec1fdc28f72a6ef2c3a90dcd24a884e987125",
    name: "Creative Commons Space Documentary",
    status: "streaming",
    progress: 0.31,
    downloadRate: 5_900_000,
    uploadRate: 210_000,
    peers: 15,
    seeds: 7,
    selectedFileCount: 2,
    totalFileCount: 5,
    totalSize: 1_850_000_000,
    downloadedBytes: 573_500_000,
    uploadedBytes: 66_000_000
  },
  {
    id: "public-game-build",
    infoHashV1: "ad88e21c876f2c2ac93de57ef15e4b40565dfe44",
    name: "Open Arena Build 1.4.0",
    status: "fetching_metadata",
    progress: 0,
    downloadRate: 0,
    uploadRate: 0,
    peers: 3,
    seeds: 1,
    selectedFileCount: 0,
    totalFileCount: 0,
    totalSize: 0,
    downloadedBytes: 0,
    uploadedBytes: 0
  }
];

export const selectedFiles: TorrentFile[] = [
  {
    torrentId: "cc-space-film",
    index: 0,
    path: "Creative Commons Space Documentary/feature-1080p.mkv",
    size: 1_720_000_000,
    progress: 0.34,
    priority: "stream",
    mediaKind: "video"
  },
  {
    torrentId: "cc-space-film",
    index: 1,
    path: "Creative Commons Space Documentary/subtitles/en.srt",
    size: 94_000,
    progress: 1,
    priority: "high",
    mediaKind: "subtitle"
  },
  {
    torrentId: "cc-space-film",
    index: 2,
    path: "Creative Commons Space Documentary/poster.jpg",
    size: 1_500_000,
    progress: 0,
    priority: "skip",
    mediaKind: "unknown"
  }
];

export const activeStream: StreamSession = {
  torrentId: "cc-space-film",
  fileIndex: 0,
  fileName: "feature-1080p.mkv",
  health: "buffering_missing_pieces",
  bufferSeconds: 24,
  playbackPositionSeconds: 612,
  readAheadPieces: 18
};

export const providerResults: ProviderResult[] = [
  {
    id: "linux-feed-libreos",
    providerId: "legal-samples",
    providerName: "Legal samples",
    title: "LibreOS 2026 Desktop ISO",
    sourceUrl: "https://example.org/libreos/releases/2026",
    infoHashV1: "9f5f4c7d02a8e1bdfb0d0e7fd4d4ad7f0c7e9a10",
    size: 4_700_000_000,
    seeders: 19,
    leechers: 23,
    category: "software",
    licenseHint: "Open-source distribution"
  },
  {
    id: "cc-feed-space-film",
    providerId: "legal-samples",
    providerName: "Legal samples",
    title: "Creative Commons Space Documentary",
    sourceUrl: "https://example.org/films/space-documentary",
    infoHashV1: "e03ec1fdc28f72a6ef2c3a90dcd24a884e987125",
    size: 1_850_000_000,
    seeders: 7,
    leechers: 8,
    category: "video",
    licenseHint: "Creative Commons"
  }
];
