type ElectronBridge = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(event: string, handler: (payload: T) => void) => () => void;
};

declare global {
  interface Window {
    torrentDock?: ElectronBridge;
  }
}

export type UnlistenFn = () => void;

export function isElectronRuntime() {
  return typeof window !== "undefined" && Boolean(window.torrentDock);
}

export function isDesktopRuntime() {
  return isElectronRuntime();
}

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  if (isElectronRuntime()) {
    return window.torrentDock!.invoke<T>(command, args);
  }

  throw new Error("TorrentDock desktop commands require the Electron runtime.");
}

export async function listenCommand<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (isElectronRuntime()) {
    return window.torrentDock!.listen(event, handler);
  }

  throw new Error(`TorrentDock desktop event '${event}' requires the Electron runtime.`);
}
