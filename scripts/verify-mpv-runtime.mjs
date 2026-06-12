import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "src-tauri", "mpv-runtime.json");
const strict = process.argv.includes("--strict");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let hasError = false;

for (const runtime of manifest.runtimes) {
  const files = runtime.files ?? [];

  for (const file of files) {
    const absolutePath = path.join(root, "src-tauri", file.path);

    if (!existsSync(absolutePath)) {
      const message = `mpv runtime missing for ${runtime.platform}: ${file.path}`;
      if (strict || file.required) {
        console.error(message);
        hasError = true;
      } else {
        console.warn(message);
      }
      continue;
    }

    if (!file.sha256 || file.sha256.startsWith("TODO")) {
      console.warn(`No pinned checksum for ${file.path}`);
      continue;
    }

    const digest = createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
    if (digest.toLowerCase() !== file.sha256.toLowerCase()) {
      console.error(`Checksum mismatch for ${file.path}: expected ${file.sha256}, got ${digest}`);
      hasError = true;
    }
  }
}

if (hasError) {
  process.exit(1);
}

console.log("mpv runtime manifest verified.");
