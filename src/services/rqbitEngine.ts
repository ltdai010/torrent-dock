import { invoke } from "@tauri-apps/api/core";

const WEB_DEV_RQBIT_BASE_URL = "/rqbit";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function ensureRqbitEngineEndpoint() {
  if (!isTauriRuntime()) {
    return WEB_DEV_RQBIT_BASE_URL;
  }

  return invoke<string>("ensure_rqbit_sidecar");
}
