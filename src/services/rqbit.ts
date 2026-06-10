export type RqbitFile = {
  index: number;
  name: string;
  components: string[];
  length: number;
  included: boolean;
};

export type RqbitTorrentDetails = {
  id?: number | null;
  info_hash: string;
  name?: string | null;
  files?: RqbitFile[];
  stats?: unknown;
};

export type RqbitAddTorrentResponse = {
  id?: number | null;
  details: RqbitTorrentDetails;
  output_folder: string;
  seen_peers?: string[] | null;
};

type RqbitTorrentListResponse = {
  torrents: Array<{
    id: number;
    info_hash: string;
    name: string;
    output_folder: string;
  }>;
};

type RqbitTorrentStatsResponse = {
  state?: string;
  error?: string | null;
  progress_bytes?: number;
  total_bytes?: number;
  live?: {
    snapshot?: {
      fetched_bytes?: number;
      peer_stats?: {
        live?: number;
        queued?: number;
        connecting?: number;
        seen?: number;
        dead?: number;
      };
    };
    download_speed?: {
      mbps?: number;
      human_readable?: string;
    };
  };
};

export type PeerProbeResult = {
  elapsedMs: number;
  livePeers: number;
  connectingPeers: number;
  queuedPeers: number;
  seenPeers: number;
  deadPeers: number;
  message?: string;
};

export type TorrentDownloadProgress = {
  state?: string;
  progressBytes: number;
  totalBytes: number;
  percent: number;
  downloadSpeedLabel: string;
  downloadSpeedMbps?: number;
  livePeers: number;
  connectingPeers: number;
  queuedPeers: number;
  seenPeers: number;
};

export class RqbitApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "RqbitApiError";
  }
}

type AddTorrentOptions = {
  listOnly?: boolean;
  onlyFilesRegex?: string;
};

type RequestOptions = {
  signal?: AbortSignal;
};

type PeerProbeOptions = {
  maxDurationMs?: number;
  sampleIntervalMs?: number;
  requestTimeoutMs?: number;
};

const DEFAULT_API_BASE = "/rqbit";
const DEFAULT_PROBE_DURATION_MS = 8500;
const DEFAULT_PROBE_SAMPLE_INTERVAL_MS = 1000;
const DEFAULT_PROBE_REQUEST_TIMEOUT_MS = 18000;

function buildTorrentUrl(apiBase = DEFAULT_API_BASE, options: AddTorrentOptions = {}) {
  const params = new URLSearchParams();

  if (options.listOnly) {
    params.set("list_only", "true");
  }

  if (options.onlyFilesRegex) {
    params.set("only_files_regex", options.onlyFilesRegex);
  }

  const query = params.toString();
  return `${apiBase}/torrents${query ? `?${query}` : ""}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const bodyText = await response.text();

  if (!response.ok) {
    throw new RqbitApiError(bodyText || response.statusText, response.status);
  }

  return bodyText ? (JSON.parse(bodyText) as T) : ({} as T);
}

function normalizeTorrentResponse(response: RqbitAddTorrentResponse): RqbitAddTorrentResponse {
  return {
    ...response,
    details: {
      ...response.details,
      files: response.details.files?.map((file, index) => ({
        ...file,
        index
      }))
    }
  };
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildOnlyFilesRegex(fileNames: string | string[]) {
  const uniqueFileNames = Array.from(new Set(Array.isArray(fileNames) ? fileNames : [fileNames])).filter(Boolean);

  if (uniqueFileNames.length === 1) {
    return `^${escapeRegex(uniqueFileNames[0])}$`;
  }

  return `^(?:${uniqueFileNames.map(escapeRegex).join("|")})$`;
}

export function isSupportedTorrentSource(source: string) {
  return source.startsWith("magnet:") || source.startsWith("http://") || source.startsWith("https://");
}

export async function resolveTorrentMetadata(source: string, apiBase?: string, options: RequestOptions = {}) {
  const response = await fetch(buildTorrentUrl(apiBase, { listOnly: true }), {
    method: "POST",
    headers: {
      "Content-Type": "text/plain"
    },
    signal: options.signal,
    body: source
  });

  return normalizeTorrentResponse(await parseJsonResponse<RqbitAddTorrentResponse>(response));
}

export async function startTorrentDownload(source: string, fileNames: string | string[], apiBase?: string, options: RequestOptions = {}) {
  const response = await fetch(
    buildTorrentUrl(apiBase, {
      onlyFilesRegex: buildOnlyFilesRegex(fileNames)
    }),
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      signal: options.signal,
      body: source
    }
  );

  return normalizeTorrentResponse(await parseJsonResponse<RqbitAddTorrentResponse>(response));
}

export async function probeTorrentPeerConnectivity(
  source: string,
  apiBase?: string,
  options: PeerProbeOptions = {}
): Promise<PeerProbeResult> {
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_PROBE_DURATION_MS;
  const sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_PROBE_SAMPLE_INTERVAL_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_PROBE_REQUEST_TIMEOUT_MS;
  const torrentsBefore = await listTorrents(apiBase, requestTimeoutMs);
  const started = await startTorrentPeerProbe(source, apiBase, requestTimeoutMs);
  const infoHash = started.details.info_hash.toLowerCase();
  const existingTorrent = torrentsBefore.torrents.find((torrent) => torrent.info_hash.toLowerCase() === infoHash);
  const torrentId = existingTorrent?.id ?? started.id ?? started.details.id ?? null;
  let createdProbeTorrent = false;

  try {
    if (typeof torrentId !== "number") {
      throw new Error("Torrent engine did not return a probe id.");
    }

    createdProbeTorrent = !existingTorrent;
    const startedAt = performance.now();
    let bestPeerStats = getPeerStats(await getTorrentStats(torrentId, apiBase, requestTimeoutMs));

    while (performance.now() - startedAt < maxDurationMs) {
      await delay(sampleIntervalMs);
      const nextPeerStats = getPeerStats(await getTorrentStats(torrentId, apiBase, requestTimeoutMs));
      bestPeerStats = {
        live: Math.max(bestPeerStats.live, nextPeerStats.live),
        connecting: Math.max(bestPeerStats.connecting, nextPeerStats.connecting),
        queued: Math.max(bestPeerStats.queued, nextPeerStats.queued),
        seen: Math.max(bestPeerStats.seen, nextPeerStats.seen),
        dead: Math.max(bestPeerStats.dead, nextPeerStats.dead)
      };

      if (bestPeerStats.live > 0) {
        break;
      }
    }

    const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));

    return {
      elapsedMs,
      livePeers: bestPeerStats.live,
      connectingPeers: bestPeerStats.connecting,
      queuedPeers: bestPeerStats.queued,
      seenPeers: bestPeerStats.seen,
      deadPeers: bestPeerStats.dead,
      message: existingTorrent ? "Checked from an existing torrent session." : "Checked from a temporary peer probe."
    };
  } finally {
    if (createdProbeTorrent && typeof torrentId === "number") {
      await stopAndDeleteTorrent(torrentId, apiBase);
    }
  }
}

export function getStreamUrl(apiBase: string | undefined, torrentId: number, fileIndex: number) {
  return `${apiBase ?? DEFAULT_API_BASE}/torrents/${torrentId}/stream/${fileIndex}`;
}

export async function getTorrentDownloadProgress(
  torrentId: number,
  apiBase?: string,
  options: RequestOptions = {}
): Promise<TorrentDownloadProgress> {
  const response = await fetch(`${apiBase ?? DEFAULT_API_BASE}/torrents/${torrentId}/stats/v1`, {
    signal: options.signal
  });
  const stats = await parseJsonResponse<RqbitTorrentStatsResponse>(response);
  const peerStats = getPeerStats(stats);
  const progressBytes = Math.max(0, stats.progress_bytes ?? stats.live?.snapshot?.fetched_bytes ?? 0);
  const totalBytes = Math.max(0, stats.total_bytes ?? 0);
  const percent = totalBytes > 0 ? Math.min(100, Math.max(0, (progressBytes / totalBytes) * 100)) : 0;
  const downloadSpeedMbps = stats.live?.download_speed?.mbps;

  return {
    state: stats.state,
    progressBytes,
    totalBytes,
    percent,
    downloadSpeedLabel: stats.live?.download_speed?.human_readable ?? formatDownloadSpeed(downloadSpeedMbps),
    downloadSpeedMbps,
    livePeers: peerStats.live,
    connectingPeers: peerStats.connecting,
    queuedPeers: peerStats.queued,
    seenPeers: peerStats.seen
  };
}

async function startTorrentPeerProbe(source: string, apiBase: string | undefined, timeoutMs: number) {
  const response = await fetchWithTimeout(
    buildTorrentUrl(apiBase),
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: source
    },
    timeoutMs
  );

  return normalizeTorrentResponse(await parseJsonResponse<RqbitAddTorrentResponse>(response));
}

async function listTorrents(apiBase?: string, timeoutMs = DEFAULT_PROBE_REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(`${apiBase ?? DEFAULT_API_BASE}/torrents`, undefined, timeoutMs);

  return parseJsonResponse<RqbitTorrentListResponse>(response);
}

async function getTorrentStats(torrentId: number, apiBase?: string, timeoutMs = DEFAULT_PROBE_REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(`${apiBase ?? DEFAULT_API_BASE}/torrents/${torrentId}/stats/v1`, undefined, timeoutMs);

  return parseJsonResponse<RqbitTorrentStatsResponse>(response);
}

async function stopAndDeleteTorrent(torrentId: number, apiBase?: string) {
  await postTorrentControl(torrentId, "pause", apiBase).catch(() => undefined);
  await postTorrentControl(torrentId, "delete", apiBase).catch(() => postTorrentControl(torrentId, "forget", apiBase));
}

async function postTorrentControl(torrentId: number, command: "pause" | "delete" | "forget", apiBase?: string) {
  const response = await fetchWithTimeout(
    `${apiBase ?? DEFAULT_API_BASE}/torrents/${torrentId}/${command}`,
    {
      method: "POST"
    },
    DEFAULT_PROBE_REQUEST_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new RqbitApiError(await response.text(), response.status);
  }
}

function getPeerStats(stats: RqbitTorrentStatsResponse) {
  const peerStats = stats.live?.snapshot?.peer_stats;

  return {
    live: peerStats?.live ?? 0,
    connecting: peerStats?.connecting ?? 0,
    queued: peerStats?.queued ?? 0,
    seen: peerStats?.seen ?? 0,
    dead: peerStats?.dead ?? 0
  };
}

function formatDownloadSpeed(mbps?: number) {
  if (typeof mbps !== "number" || !Number.isFinite(mbps) || mbps <= 0) {
    return "0 B/s";
  }

  if (mbps >= 1) {
    return `${mbps.toFixed(mbps >= 10 ? 0 : 1)} MB/s`;
  }

  return `${Math.max(1, Math.round(mbps * 1024))} KB/s`;
}

async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RqbitApiError("Peer check timed out while talking to the torrent engine.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}
