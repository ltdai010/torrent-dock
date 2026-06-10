import { invoke } from "@tauri-apps/api/core";
import { decodeSubtitleBytes } from "./subtitleArchives";

const OPEN_SUBTITLES_XML_RPC_PROXY = "/source-proxy/opensubtitles-org";
const OPEN_SUBTITLES_DOWNLOAD_PROXY = "/source-proxy/opensubtitles-download";
const OPEN_SUBTITLES_DOWNLOAD_BASE = "https://dl.opensubtitles.org";
const OPEN_SUBTITLES_USER_AGENT = "Popcorn Time v1";
const OPEN_SUBTITLES_RESULT_LIMIT = 30;

function buildDirectDownloadUrls(fileId: string, subtitleId?: string, subDownloadLink?: string) {
  const urls: string[] = [];
  const id = encodeURIComponent(fileId);

  // Free, non-VIP website download endpoints addressed by the subtitle file id.
  // These keep working for anonymous/free users even though the XML-RPC
  // DownloadSubtitles call and account-signed SubDownloadLink return the VIP stub.
  urls.push(`${OPEN_SUBTITLES_DOWNLOAD_BASE}/en/download/subencoding-utf8/file/${id}`);
  urls.push(`${OPEN_SUBTITLES_DOWNLOAD_BASE}/en/download/file/${id}.gz`);
  urls.push(`${OPEN_SUBTITLES_DOWNLOAD_BASE}/en/download/file/${id}`);

  if (subtitleId) {
    urls.push(`${OPEN_SUBTITLES_DOWNLOAD_BASE}/en/download/sub/${encodeURIComponent(subtitleId)}`);
  }

  // Lowest priority: the account-signed link from the API (often VIP-walled).
  if (subDownloadLink) {
    urls.push(subDownloadLink);
  }

  return urls;
}

type XmlRpcValue = string | number | boolean | XmlRpcValue[] | { [key: string]: XmlRpcValue } | null;

type OpenSubtitlesOrgResponse = {
  status?: string;
  token?: string;
  data?: XmlRpcValue;
};

type OpenSubtitlesOrgSubtitle = {
  IDSubtitleFile?: string;
  IDSubtitle?: string;
  SubFileName?: string;
  MovieReleaseName?: string;
  SubDownloadLink?: string;
  LanguageName?: string;
  ISO639?: string;
  SubFormat?: string;
  SubHearingImpaired?: string;
  SubFPS?: string;
  SubSize?: string;
  SubDownloadsCnt?: string;
};

export type OpenSubtitlesCandidate = {
  id: string;
  name: string;
  releaseName: string;
  language: string;
  format: string;
  size?: number;
  downloads?: number;
  hi: boolean;
  fps?: string | null;
  fileId: string;
  downloadUrls: string[];
  token: string;
  isRawFile: boolean;
  source: "org-xml-rpc";
};

type SearchOpenSubtitlesOptions = {
  username: string;
  password: string;
  query?: string;
  filmName?: string;
  imdbId?: string;
  languages?: string;
  signal?: AbortSignal;
};

type OpenSubtitlesCredentials = {
  username: string;
  password: string;
  signal?: AbortSignal;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function searchOpenSubtitles(options: SearchOpenSubtitlesOptions): Promise<OpenSubtitlesCandidate[]> {
  const token = await login(options.username, options.password, options.signal);
  const query = options.query?.trim() || options.filmName?.trim();
  const criteria: Record<string, string> = {
    sublanguageid: normalizeLanguages(options.languages)
  };
  const imdbId = options.imdbId?.replace(/^tt/i, "").replace(/\D/g, "");

  if (imdbId) {
    criteria.imdbid = imdbId;
  }

  if (query) {
    criteria.query = query;
  }

  const payload = await callXmlRpc(
    "SearchSubtitles",
    [
      token,
      [criteria],
      {
        limit: OPEN_SUBTITLES_RESULT_LIMIT
      }
    ],
    options.signal
  );
  assertSuccessfulResponse(payload, "OpenSubtitles.org search failed.");

  return toSubtitleRows(payload.data)
    .map((subtitle, index) => toSubtitleCandidate(subtitle, token, index))
    .filter((candidate): candidate is OpenSubtitlesCandidate => Boolean(candidate));
}

export async function downloadOpenSubtitlesSubtitle(candidate: OpenSubtitlesCandidate, credentials: OpenSubtitlesCredentials) {
  const directErrors: string[] = [];

  for (const downloadUrl of candidate.downloadUrls) {
    const result = await tryDirectDownloadSubtitle(candidate, downloadUrl, credentials.signal);

    if ("text" in result) {
      return result;
    }

    directErrors.push(result.message);
  }

  // Last resort: the XML-RPC DownloadSubtitles call. For free/non-VIP accounts
  // this normally returns the VIP placeholder, but we still try it so VIP users
  // and edge cases keep working.
  const token = candidate.token || (await login(credentials.username, credentials.password, credentials.signal));
  const payload = await callXmlRpc("DownloadSubtitles", [token, [candidate.fileId]], credentials.signal);
  assertSuccessfulResponse(payload, "OpenSubtitles.org download failed.");
  const downloadRows = toObjectRows(payload.data);
  const encodedSubtitle = downloadRows
    .map((row) => getString(row.data))
    .find(Boolean);

  if (!encodedSubtitle) {
    throw new Error("OpenSubtitles.org did not return subtitle data.");
  }

  const bytes = decodeBase64(encodedSubtitle);
  const subtitle = await decodeSubtitleBytes(bytes, candidate.name);

  if (isVipPlaceholder(subtitle.text)) {
    throw new Error(
      "OpenSubtitles.org only returned the VIP placeholder for this subtitle. Try another result or use SubSource."
    );
  }

  return {
    text: subtitle.text,
    fileName: subtitle.fileName ?? candidate.name,
    token
  };
}

async function tryDirectDownloadSubtitle(candidate: OpenSubtitlesCandidate, downloadUrl: string, signal?: AbortSignal) {
  try {
    const bytes = await downloadDirectSubtitleBytes(downloadUrl, signal);
    const subtitle = await decodeSubtitleBytes(bytes, candidate.name);

    if (isVipPlaceholder(subtitle.text)) {
      throw new Error("VIP placeholder");
    }

    if (!subtitle.text.trim()) {
      throw new Error("empty subtitle");
    }

    return {
      text: subtitle.text,
      fileName: subtitle.fileName ?? candidate.name,
      token: candidate.token
    };
  } catch (error) {
    return error instanceof Error ? error : new Error("download failed");
  }
}

async function login(username: string, password: string, signal?: AbortSignal) {
  const normalizedUsername = username.trim();

  if (!normalizedUsername || !password) {
    throw new Error("Add your OpenSubtitles.org username and password first.");
  }

  const payload = await callXmlRpc("LogIn", [normalizedUsername, password, "en", OPEN_SUBTITLES_USER_AGENT], signal);
  assertSuccessfulResponse(payload, "OpenSubtitles.org login failed.");
  const token = getString(payload.token);

  if (!token) {
    throw new Error("OpenSubtitles.org accepted the request but did not return a login token.");
  }

  return token;
}

async function callXmlRpc(methodName: string, parameters: XmlRpcValue[], signal?: AbortSignal) {
  const body = buildMethodCall(methodName, parameters);
  const xml = isTauriRuntime()
    ? await invoke<string>("open_subtitles_org_request", { body })
    : await postXmlRpcViaDevProxy(body, signal);

  return parseMethodResponse(xml);
}

async function downloadDirectSubtitleBytes(downloadUrl: string, signal?: AbortSignal) {
  if (isTauriRuntime()) {
    return new Uint8Array(await invoke<number[]>("open_subtitles_org_download", { url: downloadUrl }));
  }

  return downloadDirectSubtitleBytesViaDevProxy(downloadUrl, signal);
}

async function downloadDirectSubtitleBytesViaDevProxy(downloadUrl: string, signal?: AbortSignal) {
  const url = new URL(downloadUrl);
  const response = await fetch(`${OPEN_SUBTITLES_DOWNLOAD_PROXY}${url.pathname}${url.search}`, {
    headers: {
      Accept: "text/plain,text/vtt,application/x-subrip,application/gzip,application/octet-stream,*/*"
    },
    signal
  });

  if (!response.ok) {
    throw new Error(`direct SubDownloadLink returned HTTP ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function postXmlRpcViaDevProxy(body: string, signal?: AbortSignal) {
  const response = await fetch(OPEN_SUBTITLES_XML_RPC_PROXY, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml"
    },
    body,
    signal
  });
  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(responseBody || `OpenSubtitles.org returned HTTP ${response.status}.`);
  }

  return responseBody;
}

function buildMethodCall(methodName: string, parameters: XmlRpcValue[]) {
  return `<?xml version="1.0" encoding="utf-8"?><methodCall><methodName>${escapeXml(methodName)}</methodName><params>${parameters
    .map((parameter) => `<param>${serializeValue(parameter)}</param>`)
    .join("")}</params></methodCall>`;
}

function serializeValue(value: XmlRpcValue): string {
  if (value === null) {
    return "<value><nil/></value>";
  }

  if (Array.isArray(value)) {
    return `<value><array><data>${value.map(serializeValue).join("")}</data></array></value>`;
  }

  if (typeof value === "object") {
    return `<value><struct>${Object.entries(value)
      .map(([name, memberValue]) => `<member><name>${escapeXml(name)}</name>${serializeValue(memberValue)}</member>`)
      .join("")}</struct></value>`;
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? `<value><int>${value}</int></value>` : `<value><double>${value}</double></value>`;
  }

  if (typeof value === "boolean") {
    return `<value><boolean>${value ? "1" : "0"}</boolean></value>`;
  }

  return `<value><string>${escapeXml(value)}</string></value>`;
}

function parseMethodResponse(xml: string): OpenSubtitlesOrgResponse {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  const parserError = document.querySelector("parsererror");

  if (parserError) {
    throw new Error("OpenSubtitles.org returned malformed XML.");
  }

  const faultValue = document.querySelector("methodResponse > fault > value");

  if (faultValue) {
    const fault = parseValue(faultValue);
    throw new Error(getString(isObject(fault) ? fault.faultString : fault) || "OpenSubtitles.org returned an XML-RPC fault.");
  }

  const responseValue = document.querySelector("methodResponse > params > param > value");
  const parsed = responseValue ? parseValue(responseValue) : null;

  return isObject(parsed) ? (parsed as OpenSubtitlesOrgResponse) : {};
}

function parseValue(valueElement: Element): XmlRpcValue {
  const typedElement = Array.from(valueElement.children)[0];

  if (!typedElement) {
    return valueElement.textContent ?? "";
  }

  switch (typedElement.tagName.toLowerCase()) {
    case "string":
    case "datetime.iso8601":
    case "base64":
      return typedElement.textContent ?? "";
    case "int":
    case "i4":
    case "double":
      return Number(typedElement.textContent ?? 0);
    case "boolean":
      return typedElement.textContent === "1";
    case "nil":
      return null;
    case "array": {
      const data = getDirectChild(typedElement, "data");
      return data ? getDirectChildren(data, "value").map(parseValue) : [];
    }
    case "struct": {
      return Object.fromEntries(
        getDirectChildren(typedElement, "member").map((member) => {
          const name = getDirectChild(member, "name")?.textContent ?? "";
          const value = getDirectChild(member, "value");
          return [name, value ? parseValue(value) : null];
        })
      );
    }
    default:
      return typedElement.textContent ?? "";
  }
}

function toSubtitleRows(value?: XmlRpcValue) {
  return toObjectRows(value).map((row) => row as OpenSubtitlesOrgSubtitle);
}

function toObjectRows(value?: XmlRpcValue) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isObject);
}

function toSubtitleCandidate(subtitle: OpenSubtitlesOrgSubtitle, token: string, index: number): OpenSubtitlesCandidate | null {
  const fileId = getString(subtitle.IDSubtitleFile);

  if (!fileId) {
    return null;
  }

  const name = getString(subtitle.SubFileName) || `OpenSubtitles-${fileId}.srt`;
  const releaseName = getString(subtitle.MovieReleaseName) || name;

  return {
    id: `${fileId}-${index}`,
    name,
    releaseName,
    language: getString(subtitle.LanguageName) || getString(subtitle.ISO639) || "unknown",
    format: normalizeFormat(getString(subtitle.SubFormat) || name),
    size: getPositiveNumber(subtitle.SubSize),
    downloads: getPositiveNumber(subtitle.SubDownloadsCnt),
    hi: getString(subtitle.SubHearingImpaired) === "1",
    fps: getString(subtitle.SubFPS) || null,
    fileId,
    downloadUrls: buildDirectDownloadUrls(fileId, getString(subtitle.IDSubtitle), getString(subtitle.SubDownloadLink)),
    token,
    isRawFile: false,
    source: "org-xml-rpc"
  };
}

function assertSuccessfulResponse(payload: OpenSubtitlesOrgResponse, fallback: string) {
  const status = getString(payload.status);

  if (!status.startsWith("200")) {
    throw new Error(status || fallback);
  }
}

function decodeBase64(value: string) {
  const normalized = value.replace(/\s+/g, "");
  const binary = window.atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isVipPlaceholder(text: string) {
  return /become\s+opensubtitles\.org\s+vip\s+member|osdb\.link\/vip/i.test(text);
}

function normalizeLanguages(value?: string) {
  const languageMap: Record<string, string> = {
    en: "eng",
    vi: "vie",
    es: "spa",
    fr: "fre",
    de: "ger",
    pt: "por",
    "pt-br": "pob",
    zh: "chi",
    "zh-cn": "chi",
    "zh-tw": "zht",
    ja: "jpn",
    ko: "kor",
    th: "tha",
    id: "ind"
  };
  const normalized = value?.trim().toLowerCase() || "en";

  return languageMap[normalized] ?? normalized;
}

function normalizeFormat(value?: string) {
  const normalized = value?.toLowerCase() ?? "";
  return normalized.includes("vtt") ? "vtt" : "srt";
}

function getPositiveNumber(value?: XmlRpcValue) {
  const number = Number(getString(value));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function getString(value?: XmlRpcValue) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function isObject(value: XmlRpcValue | undefined): value is { [key: string]: XmlRpcValue } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getDirectChild(element: Element, tagName: string) {
  return Array.from(element.children).find((child) => child.tagName.toLowerCase() === tagName.toLowerCase());
}

function getDirectChildren(element: Element, tagName: string) {
  return Array.from(element.children).filter((child) => child.tagName.toLowerCase() === tagName.toLowerCase());
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}
