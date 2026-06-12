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

if (!runtime) {
  throw new Error(`No Electron FFmpeg runtime manifest entry for ${platformKey}.`);
}

const electronPackage = JSON.parse(fs.readFileSync(path.join(appRoot, "node_modules", "electron", "package.json"), "utf8"));
if (electronPackage.version !== manifest.electronVersion) {
  throw new Error(`Electron version mismatch. Expected ${manifest.electronVersion}, got ${electronPackage.version}.`);
}

const libraryPath = path.join(appRoot, runtime.library);
const bytes = fs.readFileSync(libraryPath);
const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

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
