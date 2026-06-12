import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(appRoot, "electron-ffmpeg-runtime.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const platformKey = `${process.platform}-${process.arch}`;
const runtime = manifest.platforms[platformKey];

const electronPackage = JSON.parse(fs.readFileSync(path.join(appRoot, "node_modules", "electron", "package.json"), "utf8"));
if (electronPackage.version !== manifest.electronVersion) {
  throw new Error(`Electron version mismatch. Expected ${manifest.electronVersion}, got ${electronPackage.version}.`);
}

const library = runtime?.library ?? findElectronFfmpegLibrary();
if (!library) {
  throw new Error(`Could not find Electron FFmpeg runtime for ${platformKey}.`);
}

const libraryPath = path.isAbsolute(library) ? library : path.join(appRoot, library);
const bytes = fs.readFileSync(libraryPath);
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
const relativeLibraryPath = path.relative(appRoot, libraryPath).replace(/\\/g, "/");

if (!runtime) {
  console.warn(`No Electron FFmpeg runtime manifest entry for ${platformKey}; observed ${relativeLibraryPath}.`);
  console.log(JSON.stringify({
    status: "unrecorded",
    platform: platformKey,
    electronVersion: electronPackage.version,
    library: relativeLibraryPath,
    size: bytes.length,
    sha256
  }, null, 2));
  process.exit(0);
}

if ((!runtime.size || !runtime.sha256) && runtime.allowUnpinned) {
  console.warn(`Electron FFmpeg runtime for ${platformKey} is not pinned yet; record this size and SHA-256 after macOS validation.`);
  console.log(JSON.stringify({
    status: "observed",
    platform: platformKey,
    electronVersion: electronPackage.version,
    library: relativeLibraryPath,
    size: bytes.length,
    sha256
  }, null, 2));
  process.exit(0);
}

if (bytes.length !== runtime.size) {
  throw new Error(`FFmpeg runtime size mismatch. Expected ${runtime.size}, got ${bytes.length}.`);
}

if (sha256 !== runtime.sha256) {
  throw new Error(`FFmpeg runtime SHA-256 mismatch. Expected ${runtime.sha256}, got ${sha256}.`);
}

console.log(JSON.stringify({
  status: "ok",
  platform: platformKey,
  electronVersion: electronPackage.version,
  library: runtime.library,
  size: bytes.length,
  sha256
}, null, 2));

function findElectronFfmpegLibrary() {
  const candidates = [];

  if (process.platform === "win32") {
    candidates.push("node_modules/electron/dist/ffmpeg.dll");
  } else if (process.platform === "darwin") {
    candidates.push(
      "node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib",
      "node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Libraries/libffmpeg.dylib"
    );
  } else if (process.platform === "linux") {
    candidates.push("node_modules/electron/dist/libffmpeg.so");
  }

  return candidates
    .map((candidate) => path.join(appRoot, candidate))
    .find((candidate) => fs.existsSync(candidate));
}
