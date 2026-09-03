import { invokeCommand, isDesktopRuntime } from "./desktopRuntime";

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
  finished?: boolean;
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
const RQBIT_DIRECT_BASE = "http://127.0.0.1:3030";
const DEFAULT_PROBE_DURATION_MS = 8500;
const DEFAULT_PROBE_SAMPLE_INTERVAL_MS = 1000;
const DEFAULT_PROBE_REQUEST_TIMEOUT_MS = 18000;
const TORRENT_START_TIMEOUT_MS = 30000;
const TORRENT_START_POLL_INTERVAL_MS = 250;

type RqbitHttpResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
};

type RqbitProxyResult = {
  ok: boolean;
  status: number;
  body: string;
};

function extractRqbitPath(url: string) {
  const parsed = new URL(url, RQBIT_DIRECT_BASE);
  return `${parsed.pathname}${parsed.search}`;
}

function headerValue(headers: HeadersInit | undefined, name: string) {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  }

  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
}

// In the packaged Electron app the page uses file://, so rqbit API calls go
// through the main-process bridge. In the browser dev server the Vite proxy
// handles "/rqbit", so plain fetch is used.
async function requestRqbit(url: string, init?: RequestInit): Promise<RqbitHttpResponse> {
  if (!isDesktopRuntime()) {
    return fetch(url, init);
  }

  if (init?.signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  const method = (init?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : undefined;
  const request = invokeCommand<RqbitProxyResult>("rqbit_api_request", {
    method,
    path: extractRqbitPath(url),
    body: body ?? null,
    contentType: headerValue(init?.headers, "Content-Type") ?? null
  });
  const result = init?.signal ? await withAbortSignal(request, init.signal) : await request;

  return {
    ok: result.ok,
    status: result.status,
    statusText: "",
    text: async () => result.body
  };
}

function withAbortSignal<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }

    request.then(
      (result) => {
        signal.removeEventListener("abort", abort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

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

async function parseJsonResponse<T>(response: RqbitHttpResponse): Promise<T> {
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
      files: normalizeRqbitFiles(response.details.files)
    }
  };
}

function normalizeRqbitFiles(files: RqbitFile[] | undefined): RqbitFile[] | undefined {
  return files?.map((file, index) => ({
    ...file,
    index
  }));
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
  const response = await requestRqbit(buildTorrentUrl(apiBase, { listOnly: true }), {
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
  const response = await requestRqbit(
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

// Source URL for the <video> element. Electron Chromium/FFmpeg owns playback,
// so the player receives rqbit's loopback range endpoint directly.
export function getVideoStreamSrc(apiBase: string | undefined, torrentId: number, fileIndex: number) {
  return getStreamUrl(apiBase, torrentId, fileIndex);
}

// Reads a (text) file out of the torrent stream endpoint. Used to load a
// subtitle that ships inside the torrent. Goes through the CORS-safe proxy in
// the packaged app; the <video> element keeps using getStreamUrl directly,
// since media playback does not require CORS.
export async function readTorrentFileAsText(
  apiBase: string | undefined,
  torrentId: number,
  fileIndex: number,
  options: RequestOptions = {}
): Promise<string> {
  const response = await requestRqbit(getStreamUrl(apiBase, torrentId, fileIndex), {
    signal: options.signal
  });

  if (!response.ok) {
    throw new Error("Could not read that subtitle file from the torrent. Keep the torrent running and retry.");
  }

  return response.text();
}

export async function getTorrentDownloadProgress(
  torrentId: number,
  apiBase?: string,
  options: RequestOptions = {}
): Promise<TorrentDownloadProgress> {
  const response = await requestRqbit(`${apiBase ?? DEFAULT_API_BASE}/torrents/${torrentId}/stats/v1`, {
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

export type LibraryTorrent = {
  id: number;
  name: string;
  infoHash: string;
  outputFolder: string;
  progressBytes: number;
  totalBytes: number;
  percent: number;
  finished: boolean;
  state?: string;
};

// Lists every torrent the engine currently knows about, enriched with its
// download stats. Used by the History page to clean up old downloads.
export async function listLibraryTorrents(apiBase?: string): Promise<LibraryTorrent[]> {
  const list = await listTorrents(apiBase);
  const torrents = list.torrents ?? [];

  return Promise.all(
    torrents.map(async (torrent) => {
      let progressBytes = 0;
      let totalBytes = 0;
      let finished = false;
      let state: string | undefined;

      try {
        const stats = await getTorrentStats(torrent.id, apiBase);
        progressBytes = Math.max(0, stats.progress_bytes ?? 0);
        totalBytes = Math.max(0, stats.total_bytes ?? 0);
        finished = Boolean(stats.finished);
        state = stats.state;
      } catch {
        // Stats are best-effort; still show the torrent so it can be removed.
      }

      const percent = totalBytes > 0 ? Math.min(100, Math.max(0, (progressBytes / totalBytes) * 100)) : 0;

      return {
        id: torrent.id,
        name: torrent.name,
        infoHash: torrent.info_hash,
        outputFolder: torrent.output_folder,
        progressBytes,
        totalBytes,
        percent,
        finished,
        state
      };
    })
  );
}

export async function getLibraryTorrentDetails(torrentId: number, apiBase?: string): Promise<RqbitTorrentDetails> {
  const response = await fetchWithTimeout(`${apiBase ?? DEFAULT_API_BASE}/torrents/${torrentId}`, undefined, DEFAULT_PROBE_REQUEST_TIMEOUT_MS);
  const details = await parseJsonResponse<RqbitTorrentDetails>(response);

  return {
    ...details,
    files: normalizeRqbitFiles(details.files)
  };
}

// Stops the engine from downloading/seeding a torrent without removing it, so
// it can still be resumed later (and remains visible in History).
export async function pauseTorrent(torrentId: number, apiBase?: string) {
  await postTorrentControl(torrentId, "pause", apiBase);
}

export async function resumeTorrent(torrentId: number, apiBase?: string, options: RequestOptions = {}) {
  throwIfAborted(options.signal);

  let stats = await getTorrentStats(torrentId, apiBase);
  if (isTorrentStreamReady(stats)) {
    return;
  }

  if (!isTorrentStarting(stats)) {
    try {
      await postTorrentControl(torrentId, "start", apiBase);
    } catch (error) {
      // The torrent can transition to live or initializing between the stats
      // request and /start. Both states mean rqbit is already doing the work.
      stats = await getTorrentStats(torrentId, apiBase);
      if (isTorrentStreamReady(stats)) {
        return;
      }

      if (!isTorrentStarting(stats)) {
        throw error;
      }
    }
  }

  const deadline = Date.now() + TORRENT_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    throwIfAborted(options.signal);

    stats = await getTorrentStats(torrentId, apiBase);
    const state = stats.state?.toLowerCase();

    if (stats.error || state === "error") {
      throw new RqbitApiError(stats.error ?? "Torrent engine could not resume this torrent.");
    }

    if (isTorrentStreamReady(stats)) {
      return;
    }

    await delay(TORRENT_START_POLL_INTERVAL_MS, options.signal);
  }

  throw new RqbitApiError("Torrent engine is still preparing the stream. Try Play again.");
}

function isTorrentStreamReady(stats: RqbitTorrentStatsResponse) {
  return Boolean(stats.finished) || stats.state?.toLowerCase() === "live";
}

function isTorrentStarting(stats: RqbitTorrentStatsResponse) {
  const state = stats.state?.toLowerCase();
  return state === "initializing" || state === "starting";
}

// Removes a torrent from the engine. When deleteFiles is true the downloaded
// data is removed from disk as well; otherwise the files are kept.
export async function removeTorrent(torrentId: number, apiBase: string | undefined, deleteFiles: boolean) {
  await postTorrentControl(torrentId, "pause", apiBase).catch(() => undefined);
  await postTorrentControl(torrentId, deleteFiles ? "delete" : "forget", apiBase);
}

async function postTorrentControl(torrentId: number, command: "start" | "pause" | "delete" | "forget", apiBase?: string) {
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<RqbitHttpResponse> {
  if (isDesktopRuntime()) {
    // The desktop proxy command applies its own request timeout.
    return requestRqbit(url, init);
  }

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

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Stopped current torrent load.", "AbortError");
  }
}

function delay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);

    function handleAbort() {
      window.clearTimeout(timeout);
      reject(new DOMException("Stopped current torrent load.", "AbortError"));
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}
