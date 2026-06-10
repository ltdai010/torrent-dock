import { gunzipSync, unzipSync } from "fflate";

export type SubtitleArchiveResult = {
  text: string;
  fileName?: string;
};

export async function decodeSubtitleBytes(bytes: Uint8Array, fallbackFileName?: string): Promise<SubtitleArchiveResult> {
  if (isGzip(bytes)) {
    return {
      text: decodeSubtitleText(gunzipSync(bytes)),
      fileName: fallbackFileName?.replace(/\.gz$/i, "")
    };
  }

  if (isZip(bytes)) {
    return extractSubtitleFromZip(bytes);
  }

  return {
    text: decodeSubtitleText(bytes),
    fileName: fallbackFileName
  };
}

function decodeSubtitleText(bytes: Uint8Array): string {
  const encoding = detectEncoding(bytes);
  return new TextDecoder(encoding, { fatal: false }).decode(bytes);
}

function detectEncoding(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return "utf-16le";
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return "utf-16be";
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }

  // No BOM: sniff for UTF-16 by counting NUL bytes in alternating positions.
  const sampleSize = Math.min(bytes.length, 2048);
  let evenZeros = 0;
  let oddZeros = 0;

  for (let index = 0; index < sampleSize; index += 1) {
    if (bytes[index] === 0x00) {
      if (index % 2 === 0) {
        evenZeros += 1;
      } else {
        oddZeros += 1;
      }
    }
  }

  const threshold = sampleSize / 8;

  if (oddZeros > threshold && oddZeros > evenZeros * 2) {
    return "utf-16le";
  }

  if (evenZeros > threshold && evenZeros > oddZeros * 2) {
    return "utf-16be";
  }

  return "utf-8";
}

function isGzip(bytes: Uint8Array) {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function isZip(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function extractSubtitleFromZip(bytes: Uint8Array): SubtitleArchiveResult {
  const files = unzipSync(bytes);
  const subtitleFileName = Object.keys(files)
    .filter((name) => /\.(?:srt|vtt|ass|ssa)$/i.test(name))
    .sort((left, right) => scoreSubtitleFileName(right) - scoreSubtitleFileName(left))[0];

  if (!subtitleFileName) {
    throw new Error("That ZIP package does not contain a supported subtitle (.srt, .vtt, .ass, .ssa).");
  }

  return {
    text: decodeSubtitleText(files[subtitleFileName]),
    fileName: subtitleFileName.split(/[\\/]/).pop() ?? subtitleFileName
  };
}

function scoreSubtitleFileName(fileName: string) {
  const normalized = fileName.toLowerCase();
  let score = 0;

  if (normalized.endsWith(".srt")) {
    score += 20;
  } else if (normalized.endsWith(".vtt")) {
    score += 15;
  } else if (normalized.endsWith(".ass") || normalized.endsWith(".ssa")) {
    score += 5;
  }

  if (!normalized.includes("__macosx") && !normalized.startsWith(".")) {
    score += 10;
  }

  if (!normalized.includes("sample") && !normalized.includes("trailer")) {
    score += 5;
  }

  return score;
}
