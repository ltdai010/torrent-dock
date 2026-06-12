import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binariesDir = join(repoRoot, "resources", "binaries");
const releaseApiUrl = "https://api.github.com/repos/ikatson/rqbit/releases/latest";

const assetByTarget = {
  "aarch64-apple-darwin": "rqbit-osx-universal",
  "aarch64-unknown-linux-gnu": "rqbit-linux-arm64",
  "universal-apple-darwin": "rqbit-osx-universal",
  "x86_64-apple-darwin": "rqbit-osx-universal",
  "x86_64-pc-windows-msvc": "rqbit.exe",
  "x86_64-unknown-linux-gnu": "rqbit-linux-amd64"
};

const hostTargetByPlatform = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc"
};

function getRequestedTargetTriple() {
  const targetIndex = process.argv.findIndex((arg) => arg === "--target" || arg === "-t");
  if (targetIndex !== -1) {
    return process.argv[targetIndex + 1];
  }

  const targetArg = process.argv.find((arg) => arg.startsWith("--target=") || arg.startsWith("-t="));
  if (targetArg) {
    return targetArg.slice(targetArg.indexOf("=") + 1);
  }

  const positionalTarget = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  return process.env.npm_config_target || process.env.TORRENTDOCK_TARGET || positionalTarget;
}

function getHostTargetTriple() {
  try {
    return execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
  } catch {
    return hostTargetByPlatform[`${process.platform}-${process.arch}`];
  }
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "torrentdock-sidecar-prepare"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function getOutputNames(targetTriple) {
  const extension = targetTriple.includes("windows") ? ".exe" : "";

  if (targetTriple === "universal-apple-darwin") {
    return [
      "rqbit-universal-apple-darwin",
      "rqbit-aarch64-apple-darwin",
      "rqbit-x86_64-apple-darwin"
    ];
  }

  return [`rqbit-${targetTriple}${extension}`];
}

const targetTriple = getRequestedTargetTriple() || getHostTargetTriple();
const assetName = assetByTarget[targetTriple];

if (!targetTriple || !assetName) {
  throw new Error(`Unsupported rqbit sidecar target: ${targetTriple || "unknown"}`);
}

const release = await fetch(releaseApiUrl, {
  headers: {
    "Accept": "application/vnd.github+json",
    "User-Agent": "torrentdock-sidecar-prepare"
  }
}).then((response) => {
  if (!response.ok) {
    throw new Error(`Failed to fetch latest rqbit release: ${response.status} ${response.statusText}`);
  }

  return response.json();
});

const asset = release.assets?.find((candidate) => candidate.name === assetName);

if (!asset?.browser_download_url) {
  throw new Error(`Could not find rqbit release asset ${assetName}`);
}

await mkdir(binariesDir, { recursive: true });

const outputNames = getOutputNames(targetTriple);
const destination = join(binariesDir, outputNames[0]);
const temporaryDestination = `${destination}.download`;

await rm(temporaryDestination, { force: true });
await download(asset.browser_download_url, temporaryDestination);
await rename(temporaryDestination, destination);

for (const outputName of outputNames.slice(1)) {
  await copyFile(destination, join(binariesDir, outputName));
}

if (!targetTriple.includes("windows")) {
  for (const outputName of outputNames) {
    await chmod(join(binariesDir, outputName), 0o755);
  }
}

console.log(`Prepared rqbit sidecar ${release.tag_name} for ${targetTriple}`);
for (const outputName of outputNames) {
  console.log(join(binariesDir, outputName));
}
