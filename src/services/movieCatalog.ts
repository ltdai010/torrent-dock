import { invoke } from "@tauri-apps/api/core";

const CATALOG_RESULT_LIMIT = 8;

export type MovieTitleCandidate = {
  id: string;
  title: string;
  year?: number;
  kind: string;
  credits?: string;
  imageUrl?: string;
  searchTitle: string;
};

type ImdbSuggestionResponse = {
  d?: ImdbSuggestionItem[];
};

type ImdbSuggestionItem = {
  id?: string;
  l?: string;
  q?: string;
  qid?: string;
  s?: string;
  y?: number;
  i?: {
    imageUrl?: string;
  };
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function searchMovieTitles(query: string): Promise<MovieTitleCandidate[]> {
  const normalizedQuery = normalizeCatalogQuery(query);

  if (normalizedQuery.length < 2) {
    throw new Error("Enter at least 2 characters to find title matches.");
  }

  if (isTauriRuntime()) {
    return invoke<MovieTitleCandidate[]>("search_movie_titles", {
      query: normalizedQuery
    });
  }

  return searchImdbSuggestionsViaDevProxy(normalizedQuery);
}

export function formatMovieSearchTitle(candidate: MovieTitleCandidate) {
  return candidate.year ? `${candidate.title} ${candidate.year}` : candidate.title;
}

export function sanitizeMediaSearchTitle(value?: string | null) {
  const withoutExtension = (value ?? "").replace(/\.[a-z0-9]{2,5}$/i, " ");
  const withoutBracketTags = withoutExtension.replace(/\[[^\]]*]/g, " ").replace(/\([^)]*\)/g, " ");
  const withoutSeparators = withoutBracketTags.replace(/[._]+/g, " ");
  const withoutReleaseTokens = withoutSeparators.replace(
    /\b(?:2160p|1080p|720p|480p|4k|uhd|hdr|hdr10|dv|webrip|web-dl|webdl|web|bluray|blu-ray|brrip|dvdrip|hdtv|x264|x265|h264|h265|hevc|avc|aac|dts|truehd|atmos|remux|proper|repack|extended|unrated|yts|rarbg)\b/gi,
    " "
  );

  return withoutReleaseTokens
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

async function searchImdbSuggestionsViaDevProxy(query: string) {
  const slug = slugifyCatalogQuery(query);
  const firstCharacter = slug.charAt(0);
  const response = await fetch(`/source-proxy/imdb-suggest/suggestion/${firstCharacter}/${slug}.json`);

  if (!response.ok) {
    throw new Error(`Title lookup returned HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as ImdbSuggestionResponse;

  return toMovieCandidates(payload.d ?? []);
}

function toMovieCandidates(items: ImdbSuggestionItem[]) {
  return items
    .filter((item) => item.id?.startsWith("tt"))
    .filter((item) => item.l)
    .filter((item) => ["movie", "feature", "tvSeries", "tvMiniSeries", "tvMovie", "video"].includes(item.qid ?? item.q ?? ""))
    .slice(0, CATALOG_RESULT_LIMIT)
    .map<MovieTitleCandidate>((item) => {
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

function normalizeCatalogQuery(value: string) {
  return value.replace(/[^\p{L}\p{N}\s:'-]/gu, " ").split(/\s+/).filter(Boolean).join(" ").trim();
}

function slugifyCatalogQuery(value: string) {
  return normalizeCatalogQuery(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function formatKind(value?: string) {
  const labels: Record<string, string> = {
    feature: "movie",
    movie: "movie",
    tvSeries: "series",
    tvMiniSeries: "mini series",
    tvMovie: "tv movie",
    video: "video"
  };

  return labels[value ?? ""] ?? "title";
}
