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

const DEFAULT_API_BASE = "/rqbit";

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

export function isSupportedTorrentSource(source: string) {
  return source.startsWith("magnet:") || source.startsWith("http://") || source.startsWith("https://");
}

export async function resolveTorrentMetadata(source: string, apiBase?: string) {
  const response = await fetch(buildTorrentUrl(apiBase, { listOnly: true }), {
    method: "POST",
    headers: {
      "Content-Type": "text/plain"
    },
    body: source
  });

  return normalizeTorrentResponse(await parseJsonResponse<RqbitAddTorrentResponse>(response));
}

export async function startTorrentDownload(source: string, fileName: string, apiBase?: string) {
  const response = await fetch(
    buildTorrentUrl(apiBase, {
      onlyFilesRegex: `^${escapeRegex(fileName)}$`
    }),
    {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: source
    }
  );

  return normalizeTorrentResponse(await parseJsonResponse<RqbitAddTorrentResponse>(response));
}

export function getStreamUrl(apiBase: string | undefined, torrentId: number, fileIndex: number) {
  return `${apiBase ?? DEFAULT_API_BASE}/torrents/${torrentId}/stream/${fileIndex}`;
}
