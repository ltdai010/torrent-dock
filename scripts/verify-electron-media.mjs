import { spawn } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const fixtureDir = path.join(appRoot, "tmp", "media-probe");
const electronBin = process.platform === "win32"
  ? path.join(appRoot, "node_modules", "electron", "dist", "electron.exe")
  : path.join(appRoot, "node_modules", ".bin", "electron");

const fixtures = [
  {
    id: "mkv_h264",
    url: "https://filesamples.com/samples/video/mkv/sample_640x360.mkv",
    fileName: "sample_640x360.mkv"
  },
  {
    id: "mp4_hevc",
    url: "https://test-videos.co.uk/vids/jellyfish/mp4/h265/360/Jellyfish_360_10s_1MB.mp4",
    fileName: "jellyfish_h265_360_1mb.mp4"
  },
  {
    id: "mkv_eac3",
    url: "https://samples.ffmpeg.org/A-codecs/AC3/eac3/sample-eac3.mkv",
    fileName: "sample-eac3.mkv"
  }
];

fs.mkdirSync(fixtureDir, { recursive: true });

for (const fixture of fixtures) {
  fixture.filePath = path.join(fixtureDir, fixture.fileName);
  await ensureFixture(fixture);
}

const results = [];

for (const fixture of fixtures) {
  const result = await runPlaybackProbe(fixture.filePath);
  results.push({
    id: fixture.id,
    player: result.probePlayer,
    status: result.status,
    duration: result.duration,
    videoWidth: result.videoWidth,
    videoHeight: result.videoHeight,
    frameSample: summarizeSample(result.frameSample),
    pageSample: summarizeSample(result.pageSample),
    error: result.error
  });

  if (
    result.status !== "playing" ||
    result.videoWidth <= 0 ||
    result.videoHeight <= 0 ||
    result.error ||
    !hasVisiblePixels(result.pageSample)
  ) {
    console.error(JSON.stringify({ fixture: fixture.id, result }, null, 2));
    throw new Error(`Electron Chromium/FFmpeg Video.js playback probe failed for ${fixture.id}.`);
  }
}

console.log(JSON.stringify({ status: "ok", results }, null, 2));

async function ensureFixture(fixture) {
  if (fs.existsSync(fixture.filePath) && fs.statSync(fixture.filePath).size > 0) {
    return;
  }

  console.log(`Downloading ${fixture.id} fixture...`);
  await download(fixture.url, fixture.filePath);
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
        response.resume();
        if (!response.headers.location || redirects > 5) {
          reject(new Error(`Could not follow redirect for ${url}.`));
          return;
        }

        const nextUrl = new URL(response.headers.location, url).toString();
        download(nextUrl, destination, redirects + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed for ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

function runPlaybackProbe(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronBin, [".", "--playback-probe", "--http"], {
      cwd: appRoot,
      env: {
        ...process.env,
        MEDIA_PROBE_FILE: filePath,
        TORRENTDOCK_PROBE_VIDEOJS: "1"
      },
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Electron playback probe exited with ${code}.\n${stderr}`));
        return;
      }

      try {
        resolve(parseJsonFromOutput(stdout));
      } catch (error) {
        reject(new Error(`Could not parse playback probe output: ${error}\n${stdout}\n${stderr}`));
      }
    });
  });
}

function summarizeSample(sample) {
  if (!sample) {
    return null;
  }

  return {
    sampled: sample.sampled,
    brightPixelRatio: sample.brightPixelRatio,
    variedPixelRatio: sample.variedPixelRatio,
    reason: sample.reason
  };
}

function hasVisiblePixels(sample) {
  return Boolean(
    sample?.sampled &&
    sample.averageAlpha > 0 &&
    (sample.brightPixelRatio > 0.05 || sample.variedPixelRatio > 0.05)
  );
}

function parseJsonFromOutput(output) {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("no JSON object found");
  }

  return JSON.parse(output.slice(start, end + 1));
}
