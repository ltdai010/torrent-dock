import { invokeCommand, isDesktopRuntime } from "./desktopRuntime";

const WEB_DEV_RQBIT_BASE_URL = "/rqbit";

export async function ensureRqbitEngineEndpoint() {
  if (!isDesktopRuntime()) {
    return WEB_DEV_RQBIT_BASE_URL;
  }

  return invokeCommand<string>("ensure_rqbit_sidecar");
}
