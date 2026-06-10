import { decodeSubtitleBytes } from "./subtitleArchives";

const SUBSOURCE_API_BASE = import.meta.env.DEV ? "/source-proxy/subsource-api" : "https://api.subsource.net";
const SUBSOURCE_RESULT_LIMIT = 24;

type SubSourceSearchResponse = {
  data?: SubSourceMovie[];
  items?: SubSourceMovie[];
};

type SubSourceSubtitlesResponse = {
  data?: SubSourceSubtitle[];
  items?: SubSourceSubtitle[];
};

type SubSourceMovie = {
  movieId?: number;
  id?: number;
  title?: string;
  name?: string;
  releaseYear?: number;
  year?: number;
  type?: string;
};

type SubSourceSubtitle = {
  subtitleId?: number;
  id?: number;
  language?: string;
  releaseInfo?: string[] | string;
  hearingImpaired?: boolean;
  downloads?: number;
  format?: string;
  extension?: string;
  fileType?: string;
};

export type SubSourceSubtitleCandidate = {
  id: string;
  name: string;
  releaseName: string;
  language: string;
  format: string;
  downloads?: number;
  hi: boolean;
  fps?: string | null;
  subtitleId: number;
  isRawFile: boolean;
};

type SearchSubSourceSubtitlesOptions = {
  apiKey: string;
  filmName?: string;
  fileName?: string;
  languages?: string;
  signal?: AbortSignal;
};

export async function searchSubSourceSubtitles(options: SearchSubSourceSubtitlesOptions): Promise<SubSourceSubtitleCandidate[]> {
  const apiKey = getSubSourceApiKey(options.apiKey);
  const titleQuery = normalizeSearchTitle(options.filmName || options.fileName);

  if (!titleQuery) {
    throw new Error("Load or choose a movie title before searching SubSource.");
  }

  const { title, year } = splitTitleYear(titleQuery);
  const movies = await searchMovies(title, year, apiKey, options.signal);

  if (movies.length === 0) {
    return [];
  }

  const language = normalizeLanguage(options.languages);
  const fileName = options.fileName ?? options.filmName ?? "";
  const subtitleGroups = await Promise.all(
    movies.slice(0, 5).map(async (movie) => {
      const movieId = getMovieId(movie);

      if (typeof movieId !== "number") {
        return [];
      }

      return searchSubtitlesForMovie(movieId, language, apiKey, options.signal);
    })
  );

  return dedupeSubSourceCandidates(
    subtitleGroups
    .flat()
    .map(toSubtitleCandidate)
    .filter((candidate): candidate is SubSourceSubtitleCandidate => Boolean(candidate))
  )
    .sort((left, right) => scoreCandidate(right, fileName) - scoreCandidate(left, fileName))
    .slice(0, SUBSOURCE_RESULT_LIMIT);
}

export async function downloadSubSourceSubtitle(candidate: SubSourceSubtitleCandidate, apiKey: string, signal?: AbortSignal) {
  const response = await fetch(`${SUBSOURCE_API_BASE}/api/v1/subtitles/${candidate.subtitleId}/download`, {
    headers: buildHeaders(getSubSourceApiKey(apiKey), "application/octet-stream,application/zip,text/plain,*/*"),
    signal
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Could not download that subtitle from SubSource."));
  }

  return decodeSubtitleBytes(new Uint8Array(await response.arrayBuffer()), candidate.name);
}

async function searchMovies(title: string, year: number | undefined, apiKey: string, signal?: AbortSignal) {
  const params = new URLSearchParams({
    searchType: "text",
    q: title
  });

  if (year) {
    params.set("year", String(year));
  }

  const response = await fetch(`${SUBSOURCE_API_BASE}/api/v1/movies/search?${params.toString()}`, {
    headers: buildHeaders(apiKey),
    signal
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "SubSource did not return title matches."));
  }

  const payload = (await response.json()) as SubSourceSearchResponse | SubSourceMovie[];
  return Array.isArray(payload) ? payload : payload.data ?? payload.items ?? [];
}

async function searchSubtitlesForMovie(movieId: number, language: string, apiKey: string, signal?: AbortSignal) {
  const params = new URLSearchParams({
    movieId: String(movieId),
    language
  });
  const response = await fetch(`${SUBSOURCE_API_BASE}/api/v1/subtitles?${params.toString()}`, {
    headers: buildHeaders(apiKey),
    signal
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "SubSource did not return subtitles for this title."));
  }

  const payload = (await response.json()) as SubSourceSubtitlesResponse | SubSourceSubtitle[];
  return Array.isArray(payload) ? payload : payload.data ?? payload.items ?? [];
}

function toSubtitleCandidate(subtitle: SubSourceSubtitle): SubSourceSubtitleCandidate | null {
  const subtitleId = subtitle.subtitleId ?? subtitle.id;

  if (typeof subtitleId !== "number") {
    return null;
  }

  const releaseName = formatReleaseInfo(subtitle.releaseInfo) || "SubSource result";
  const format = normalizeFormat(subtitle.format ?? subtitle.extension ?? subtitle.fileType ?? releaseName);

  return {
    id: String(subtitleId),
    name: `${releaseName}.${format === "zip" ? "zip" : "srt"}`,
    releaseName,
    language: subtitle.language ?? "unknown",
    format,
    downloads: subtitle.downloads,
    hi: Boolean(subtitle.hearingImpaired),
    fps: null,
    subtitleId,
    isRawFile: format !== "zip"
  };
}

function buildHeaders(apiKey: string, accept = "application/json") {
  return {
    Accept: accept,
    "X-API-Key": apiKey
  };
}

function getSubSourceApiKey(apiKey?: string) {
  const normalizedApiKey = apiKey?.trim() ?? "";

  if (!normalizedApiKey) {
    throw new Error("Add a SubSource API key first.");
  }

  return normalizedApiKey;
}

function getMovieId(movie: SubSourceMovie) {
  return movie.movieId ?? movie.id;
}

function formatReleaseInfo(value?: string[] | string) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(" ");
  }

  return value ?? "";
}

function normalizeFormat(value?: string) {
  const normalized = value?.toLowerCase() ?? "";

  if (normalized.includes("zip")) {
    return "zip";
  }

  if (normalized.includes("vtt")) {
    return "vtt";
  }

  return "srt";
}

function normalizeLanguage(value?: string) {
  const normalized = value?.trim().toLowerCase() || "english";
  const labels: Record<string, string> = {
    en: "english",
    vi: "vietnamese",
    es: "spanish",
    fr: "french",
    de: "german",
    pt: "portuguese",
    "pt-br": "portuguese",
    zh: "chinese",
    "zh-cn": "chinese",
    "zh-tw": "chinese",
    ja: "japanese",
    ko: "korean",
    th: "thai",
    id: "indonesian"
  };

  return labels[normalized] ?? normalized;
}

function normalizeSearchTitle(value?: string) {
  return (value ?? "")
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/[._]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function splitTitleYear(value: string) {
  const yearMatch = value.match(/\b((?:19|20)\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  const title = value.replace(/\b(?:19|20)\d{2}\b/, " ").split(/\s+/).filter(Boolean).join(" ");

  return {
    title: title || value,
    year
  };
}

function scoreCandidate(candidate: SubSourceSubtitleCandidate, fileName: string) {
  const haystack = `${candidate.name} ${candidate.releaseName}`.toLowerCase();
  const tokens = normalizeSearchTitle(fileName)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 2);
  const tokenScore = tokens.reduce((score, token) => score + (haystack.includes(token) ? 4 : 0), 0);
  const downloadScore = Math.log10((candidate.downloads ?? 0) + 1);
  const hiPenalty = candidate.hi ? -1 : 0;

  return tokenScore + downloadScore + hiPenalty;
}

export function dedupeSubSourceCandidates(candidates: SubSourceSubtitleCandidate[]) {
  const uniqueById = new Map<number, SubSourceSubtitleCandidate>();

  for (const candidate of candidates) {
    const existing = uniqueById.get(candidate.subtitleId);

    if (!existing || (candidate.downloads ?? 0) > (existing.downloads ?? 0)) {
      uniqueById.set(candidate.subtitleId, candidate);
    }
  }

  const uniqueByRelease = new Map<string, SubSourceSubtitleCandidate>();

  for (const candidate of uniqueById.values()) {
    const key = [
      normalizeDuplicateKey(candidate.releaseName),
      candidate.language.toLowerCase(),
      candidate.format.toLowerCase(),
      candidate.hi ? "hi" : "standard"
    ].join("|");
    const existing = uniqueByRelease.get(key);

    if (!existing || (candidate.downloads ?? 0) > (existing.downloads ?? 0)) {
      uniqueByRelease.set(key, candidate);
    }
  }

  return Array.from(uniqueByRelease.values());
}

function normalizeDuplicateKey(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(?:subtitle|subtitles|srt|zip)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

async function getErrorMessage(response: Response, fallback: string) {
  const body = await response.text().catch(() => "");

  if (!body) {
    return fallback;
  }

  try {
    const payload = JSON.parse(body) as { message?: string; error?: string };
    return payload.message ?? payload.error ?? fallback;
  } catch {
    return body.slice(0, 180);
  }
}
