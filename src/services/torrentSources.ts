import type { ProviderResult, ProviderSearchError, ProviderSearchResponse } from "../domain/torrent";
import { invokeCommand, isDesktopRuntime } from "./desktopRuntime";

const SEARCH_LIMIT_PER_PROVIDER = 8;
const SOURCE_SCAN_LIMIT_PER_PROVIDER = 24;
const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce"
];

const SOURCE_PROVIDERS = [
  { providerId: "1337x", providerName: "1337x" },
  { providerId: "the-pirate-bay", providerName: "The Pirate Bay" }
] as const;

const RELEASE_TOKEN_PATTERN =
  /\b(?:2160p|1080p|720p|480p|4k|uhd|hdr|hdr10|dv|webrip|web-dl|webdl|bluray|blu-ray|brrip|dvdrip|hdtv|x264|x265|h264|h265|hevc|avc|aac|dts|truehd|atmos|remux|proper|repack|extended|unrated|yify|yts|rarbg)\b/gi;
const YEAR_TOKEN_PATTERN = /^(?:19|20)\d{2}$/;

type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

export type TorrentSourceProviderProgress = {
  providerId: SourceProvider["providerId"];
  providerName: SourceProvider["providerName"];
  results: ProviderResult[];
  error?: ProviderSearchError;
};

type SearchTorrentSourcesOptions = {
  onProviderSettled?: (progress: TorrentSourceProviderProgress) => void;
};

type TpbApiResult = {
  id: string;
  name: string;
  info_hash: string;
  leechers: string;
  seeders: string;
  size: string;
  category: string;
};

type Parsed1337xRow = {
  sourceUrl: string;
  originalUrl: string;
  title: string;
  category?: string;
  seeders?: number;
  leechers?: number;
  size?: number;
};

type SearchMatchProfile = {
  normalizedQuery: string;
  tokens: string[];
  titleTokens: string[];
  yearTokens: string[];
};

export function getProviderResultSource(result: ProviderResult) {
  return result.magnetUri ?? result.torrentUrl ?? null;
}

export function dedupeProviderResults(results: ProviderResult[], query = "") {
  return sortProviderResults(dedupeResults(results), query);
}

export async function searchTorrentSources(
  query: string,
  options: SearchTorrentSourcesOptions = {}
): Promise<ProviderSearchResponse> {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length < 2) {
    throw new Error("Enter at least 2 characters to search sources.");
  }

  if (isDesktopRuntime()) {
    return searchViaDesktop(trimmedQuery, options.onProviderSettled);
  }

  return searchViaDevProxy(trimmedQuery, options.onProviderSettled);
}

async function searchViaDesktop(
  query: string,
  onProviderSettled?: SearchTorrentSourcesOptions["onProviderSettled"]
): Promise<ProviderSearchResponse> {
  return runProviderTasks(
    SOURCE_PROVIDERS.map((provider) => ({
      ...provider,
      run: () =>
        invokeCommand<ProviderResult[]>("search_torrent_source_provider", {
          query,
          providerId: provider.providerId
        })
    })),
    query,
    onProviderSettled
  );
}

async function searchViaDevProxy(
  query: string,
  onProviderSettled?: SearchTorrentSourcesOptions["onProviderSettled"]
): Promise<ProviderSearchResponse> {
  return runProviderTasks(
    SOURCE_PROVIDERS.map((provider) => ({
      ...provider,
      run: () => (provider.providerId === "1337x" ? search1337xViaDevProxy(query) : searchThePirateBayViaDevProxy(query))
    })),
    query,
    onProviderSettled
  );
}

async function runProviderTasks(
  tasks: Array<SourceProvider & { run: () => Promise<ProviderResult[]> }>,
  query: string,
  onProviderSettled?: SearchTorrentSourcesOptions["onProviderSettled"]
): Promise<ProviderSearchResponse> {
  const errors: ProviderSearchError[] = [];
  const results: ProviderResult[] = [];

  await Promise.all(
    tasks.map(async (task) => {
      try {
        const providerResults = sortProviderResults(dedupeResults(await task.run()), query).slice(0, SEARCH_LIMIT_PER_PROVIDER);
        results.push(...providerResults);
        onProviderSettled?.({
          providerId: task.providerId,
          providerName: task.providerName,
          results: providerResults
        });
      } catch (error) {
        const providerSearchError = providerError(task.providerId, task.providerName, error);
        errors.push(providerSearchError);
        onProviderSettled?.({
          providerId: task.providerId,
          providerName: task.providerName,
          results: [],
          error: providerSearchError
        });
      }
    })
  );

  return {
    results: sortProviderResults(dedupeResults(results), query),
    errors
  };
}

async function search1337xViaDevProxy(query: string) {
  const bases = ["/source-proxy/1337x", "/source-proxy/1377x"];
  const searches = new Map(
    bases.map((base) => [
      base,
      search1337xBaseViaDevProxy(base, query)
        .then((results) => ({ base, results }))
        .catch((error: unknown) => ({ base, results: [] as ProviderResult[], error }))
    ])
  );
  let lastError = "1337x did not return usable results.";

  while (searches.size > 0) {
    const settled = await Promise.race(searches.values());
    searches.delete(settled.base);

    if (settled.results.length > 0) {
      return settled.results;
    }

    lastError = "error" in settled ? getErrorMessage(settled.error) : `${settled.base} returned no usable results.`;
  }

  throw new Error(lastError);
}

async function search1337xBaseViaDevProxy(base: string, query: string) {
  const response = await fetch(`${base}/sort-search/${encodeURIComponent(query)}/seeders/desc/1/`);

  if (!response.ok) {
    throw new Error(`${base} returned HTTP ${response.status}.`);
  }

  const html = await response.text();
  const document = new DOMParser().parseFromString(html, "text/html");
  const rows = Array.from(document.querySelectorAll("tbody tr")).slice(0, SOURCE_SCAN_LIMIT_PER_PROVIDER);
  const parsedRows = rows
    .map<Parsed1337xRow | null>((row) => {
      const torrentAnchor = Array.from(row.querySelectorAll<HTMLAnchorElement>("td.coll-1.name a")).find((anchor) =>
        anchor.getAttribute("href")?.startsWith("/torrent/")
      );

      if (!torrentAnchor) {
        return null;
      }

      const categoryAnchor = Array.from(row.querySelectorAll<HTMLAnchorElement>("td.coll-1.name a")).find((anchor) =>
        anchor.getAttribute("href")?.startsWith("/sub/")
      );
      const title = normalizeText(torrentAnchor.textContent ?? "");
      const category = categoryAnchor ? categoryFrom1337xPath(categoryAnchor.getAttribute("href") ?? "") : undefined;

      if (!title || isAdultResult(category, title)) {
        return null;
      }

      const href = torrentAnchor.getAttribute("href") ?? "";
      const sourceUrl = `${base}${href}`;

      return {
        sourceUrl,
        originalUrl: href,
        title,
        category,
        seeders: parseOptionalInt(row.querySelector("td.coll-2.seeds")?.textContent),
        leechers: parseOptionalInt(row.querySelector("td.coll-3.leeches")?.textContent),
        size: parseSize(row.querySelector("td.coll-4.size")?.textContent ?? "")
      };
    })
    .filter(isDefined);

  return Promise.all(
    parsedRows.map(async (row) => {
      const magnetUri = await fetch1337xMagnet(row.sourceUrl).catch(() => undefined);
      const infoHashV1 = magnetUri ? extractBtih(magnetUri) : undefined;

      return {
        id: `1337x-${idFromSourcePath(row.originalUrl) ?? slugify(row.title)}`,
        providerId: "1337x",
        providerName: "1337x",
        title: row.title,
        sourceUrl: row.sourceUrl,
        magnetUri,
        infoHashV1,
        size: row.size,
        seeders: row.seeders,
        leechers: row.leechers,
        category: row.category
      };
    })
  );
}

async function fetch1337xMagnet(sourceUrl: string) {
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`1337x result returned HTTP ${response.status}.`);
  }

  const html = await response.text();
  const document = new DOMParser().parseFromString(html, "text/html");
  const magnetHref = document.querySelector<HTMLAnchorElement>('a[href^="magnet:"]')?.href;

  return magnetHref ?? extractMagnetFromText(html);
}

async function searchThePirateBayViaDevProxy(query: string) {
  const response = await fetch(`/source-proxy/apibay/q.php?q=${encodeURIComponent(query)}&cat=0`);

  if (!response.ok) {
    throw new Error(`The Pirate Bay returned HTTP ${response.status}.`);
  }

  const apiResults = (await response.json()) as TpbApiResult[];

  return apiResults
    .filter((result) => result.id !== "0")
    .filter((result) => result.info_hash.trim().length > 0)
    .filter((result) => !result.category.startsWith("5"))
    .slice(0, SOURCE_SCAN_LIMIT_PER_PROVIDER)
    .map<ProviderResult>((result) => {
      const title = normalizeText(result.name);
      const infoHash = result.info_hash.trim().toUpperCase();

      return {
        id: `the-pirate-bay-${result.id}`,
        providerId: "the-pirate-bay",
        providerName: "The Pirate Bay",
        title,
        sourceUrl: `https://thepiratebay.org/description.php?id=${result.id}`,
        magnetUri: buildMagnet(infoHash, title),
        infoHashV1: infoHash,
        size: parseOptionalInt(result.size),
        seeders: parseOptionalInt(result.seeders),
        leechers: parseOptionalInt(result.leechers),
        category: tpbCategoryLabel(result.category)
      };
    });
}

function buildMagnet(infoHash: string, title: string) {
  const params = new URLSearchParams({
    xt: `urn:btih:${infoHash}`,
    dn: title
  });

  DEFAULT_TRACKERS.forEach((tracker) => params.append("tr", tracker));

  return `magnet:?${params.toString()}`;
}

function providerError(providerId: string, providerName: string, error: unknown): ProviderSearchError {
  return {
    providerId,
    providerName,
    message: getErrorMessage(error)
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Source search failed.";
}

function normalizeText(value: string) {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/[\[\](){}]/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(RELEASE_TOKEN_PATTERN, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function buildSearchMatchProfile(query: string): SearchMatchProfile {
  const normalizedQuery = normalizeSearchText(query);
  const tokens = normalizedQuery ? normalizedQuery.split(" ") : [];

  return {
    normalizedQuery,
    tokens,
    titleTokens: tokens.filter((token) => !YEAR_TOKEN_PATTERN.test(token)),
    yearTokens: tokens.filter((token) => YEAR_TOKEN_PATTERN.test(token))
  };
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}

function parseOptionalInt(value: string | null | undefined) {
  const parsed = Number.parseInt((value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSize(value: string) {
  const match = normalizeText(value).match(/^([\d.,]+)\s*(b|kb|kib|mb|mib|gb|gib|tb|tib)\b/i);

  if (!match) {
    return undefined;
  }

  const amount = Number.parseFloat(match[1].replace(/,/g, ""));
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === "b"
      ? 1
      : unit === "kb" || unit === "kib"
        ? 1024
        : unit === "mb" || unit === "mib"
          ? 1024 ** 2
          : unit === "gb" || unit === "gib"
            ? 1024 ** 3
            : 1024 ** 4;

  return Math.round(amount * multiplier);
}

function categoryFrom1337xPath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .slice(1, 3)
    .map((part) => part.replace(/-/g, " "))
    .join(" / ");
}

function tpbCategoryLabel(category: string) {
  const labels: Record<string, string> = {
    "101": "audio / music",
    "102": "audio / audiobook",
    "103": "audio / sound clip",
    "104": "audio / flac",
    "199": "audio / other",
    "201": "video / movie",
    "202": "video / movie dvdr",
    "203": "video / music video",
    "204": "video / clip",
    "205": "video / tv",
    "206": "video / handheld",
    "207": "video / hd movie",
    "208": "video / hd tv",
    "209": "video / 3d",
    "299": "video / other",
    "301": "apps / windows",
    "302": "apps / mac",
    "303": "apps / unix",
    "304": "apps / handheld",
    "305": "apps / ios",
    "306": "apps / android",
    "399": "apps / other",
    "401": "games / pc",
    "402": "games / mac",
    "403": "games / psx",
    "404": "games / xbox",
    "405": "games / wii",
    "406": "games / handheld",
    "407": "games / ios",
    "408": "games / android",
    "499": "games / other",
    "601": "other / ebooks",
    "602": "other / comics",
    "603": "other / pictures",
    "604": "other / covers",
    "605": "other / physibles",
    "699": "other"
  };

  return labels[category];
}

function extractBtih(magnet: string) {
  const params = new URLSearchParams(magnet.replace(/^magnet:\?/, ""));
  const exactTopic = params.get("xt");

  return exactTopic?.startsWith("urn:btih:") ? exactTopic.replace(/^urn:btih:/, "").toUpperCase() : undefined;
}

function extractMagnetFromText(value: string) {
  const match = value.match(/magnet:\?[^"'<\s]+/);

  return match?.[0].replace(/&amp;/g, "&");
}

function idFromSourcePath(path: string) {
  return path.split("/").filter(Boolean).find((part, index, parts) => parts[index - 1] === "torrent");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56);
}

function dedupeResults(results: ProviderResult[]) {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = result.infoHashV1 ?? result.magnetUri ?? `${result.providerId}:${result.sourceUrl}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sortProviderResults(results: ProviderResult[], query = "") {
  const matchProfile = buildSearchMatchProfile(query);

  return [...results].sort((left, right) => {
    const matchDelta = getTitleMatchScore(right.title, matchProfile) - getTitleMatchScore(left.title, matchProfile);

    if (matchDelta !== 0) {
      return matchDelta;
    }

    const seedDelta = (right.seeders ?? -1) - (left.seeders ?? -1);

    if (seedDelta !== 0) {
      return seedDelta;
    }

    const peerDelta = (right.leechers ?? -1) - (left.leechers ?? -1);

    if (peerDelta !== 0) {
      return peerDelta;
    }

    return left.title.localeCompare(right.title);
  });
}

function getTitleMatchScore(title: string, matchProfile: SearchMatchProfile) {
  if (!matchProfile.normalizedQuery || matchProfile.tokens.length === 0) {
    return 0;
  }

  const normalizedTitle = normalizeSearchText(title);

  if (!normalizedTitle) {
    return 0;
  }

  const titleTokens = normalizedTitle.split(" ");
  const titleTokenSet = new Set(titleTokens);
  const matchedTitleTokens = matchProfile.titleTokens.filter((token) => titleTokenSet.has(token)).length;
  const titleTokenCoverage =
    matchProfile.titleTokens.length > 0 ? matchedTitleTokens / matchProfile.titleTokens.length : 1;
  let score = 0;

  if (normalizedTitle === matchProfile.normalizedQuery) {
    score += 1200;
  }

  if (normalizedTitle.startsWith(matchProfile.normalizedQuery)) {
    score += 800;
  } else if (normalizedTitle.includes(` ${matchProfile.normalizedQuery} `)) {
    score += 600;
  } else if (normalizedTitle.includes(matchProfile.normalizedQuery)) {
    score += 450;
  }

  score += Math.round(titleTokenCoverage * 700);
  score += matchedTitleTokens * 80;

  if (matchedTitleTokens === matchProfile.titleTokens.length && matchProfile.titleTokens.length > 0) {
    score += 350;
  }

  for (const yearToken of matchProfile.yearTokens) {
    score += titleTokenSet.has(yearToken) ? 300 : -300;
  }

  const firstQueryToken = matchProfile.titleTokens[0];

  if (firstQueryToken) {
    const firstTokenIndex = titleTokens.indexOf(firstQueryToken);

    if (firstTokenIndex === 0) {
      score += 160;
    } else if (firstTokenIndex > 0) {
      score -= Math.min(160, firstTokenIndex * 30);
    } else {
      score -= 180;
    }
  }

  const extraTokenCount = Math.max(0, titleTokens.length - matchProfile.tokens.length);
  score -= Math.min(120, extraTokenCount * 6);

  return score;
}

function isAdultResult(category: string | undefined, title: string) {
  const normalizedCategory = category?.toLowerCase() ?? "";
  const normalizedTitle = title.toLowerCase();

  return (
    normalizedCategory.includes("xxx") ||
    normalizedCategory.includes("adult") ||
    normalizedTitle.includes(" xxx") ||
    normalizedTitle.startsWith("xxx ") ||
    normalizedTitle.endsWith(" xxx")
  );
}
