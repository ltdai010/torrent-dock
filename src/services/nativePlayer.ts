import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PlayerCapabilities = {
  available: boolean;
  backend: "mpv" | "html" | string;
  platform: string;
  libraryPath?: string | null;
  reason?: string | null;
  supportsNativeSurface: boolean;
  supportsEmbeddedTracks: boolean;
  supportsExternalSubtitles: boolean;
};

export type NativePlayerTrack = {
  id: number;
  kind: "audio" | "subtitle";
  title: string;
  language?: string | null;
  selected: boolean;
};

export type NativePlayerSurfaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NativePlayerEventHandlers = {
  onState?: (state: string) => void;
  onTime?: (value: number) => void;
  onDuration?: (value: number) => void;
  onBuffering?: (buffering: boolean) => void;
  onTracks?: (tracks: NativePlayerTrack[]) => void;
  onVideoParams?: (params: unknown) => void;
  onAudioParams?: (params: unknown) => void;
  onSeekComplete?: () => void;
  onEnd?: () => void;
  onWarning?: (message: string) => void;
  onError?: (message: string) => void;
};

type ValuePayload = { value: number };
type StatePayload = { state: string };
type BufferingPayload = { buffering: boolean };
type TracksPayload = { tracks: NativePlayerTrack[] };
type MessagePayload = { message: string };

export function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function initializeNativePlayer() {
  if (!isTauriRuntime()) {
    return htmlCapabilities("Browser development uses the HTML media element.");
  }

  return invoke<PlayerCapabilities>("player_initialize").catch((error: unknown) => htmlCapabilities(String(error)));
}

export async function getNativePlayerCapabilities() {
  if (!isTauriRuntime()) {
    return htmlCapabilities("Browser development uses the HTML media element.");
  }

  return invoke<PlayerCapabilities>("player_get_capabilities").catch((error: unknown) => htmlCapabilities(String(error)));
}

export function loadNativePlayer(torrentId: number, fileIndex: number, title: string, startPosition = 0) {
  return invoke<void>("player_load", { torrentId, fileIndex, title, startPosition });
}

export function playNativePlayer() {
  return invoke<void>("player_play");
}

export function pauseNativePlayer() {
  return invoke<void>("player_pause");
}

export function stopNativePlayer() {
  return invoke<void>("player_stop");
}

export function seekNativePlayer(seconds: number) {
  return invoke<void>("player_seek", { seconds });
}

export function setNativePlayerVolume(value: number) {
  return invoke<void>("player_set_volume", { value });
}

export function setNativePlayerMuted(value: boolean) {
  return invoke<void>("player_set_muted", { value });
}

export function setNativePlayerRate(value: number) {
  return invoke<void>("player_set_rate", { value });
}

export function setNativePlayerFullscreen(value: boolean) {
  return invoke<void>("player_set_fullscreen", { value });
}

export function selectNativeAudioTrack(trackId: number) {
  return invoke<void>("player_select_audio", { trackId });
}

export function selectNativeSubtitleTrack(trackId: number) {
  return invoke<void>("player_select_subtitle", { trackId });
}

export function addNativeSubtitleText(name: string, content: string) {
  return invoke<void>("player_add_subtitle_text", { name, content });
}

export function setNativeSubtitleDelay(seconds: number) {
  return invoke<void>("player_set_subtitle_delay", { seconds });
}

export function setNativeSubtitleScale(value: number) {
  return invoke<void>("player_set_subtitle_scale", { value });
}

export function setNativeSurfaceBounds(rect: NativePlayerSurfaceBounds, scaleFactor: number, visible: boolean) {
  return invoke<void>("player_set_surface_bounds", { rect, scaleFactor, visible });
}

export async function listenNativePlayerEvents(handlers: NativePlayerEventHandlers) {
  if (!isTauriRuntime()) {
    return () => undefined;
  }

  const unlisteners = await Promise.all<UnlistenFn>([
    listen<StatePayload>("player://state", (event) => handlers.onState?.(event.payload.state)),
    listen<ValuePayload>("player://time", (event) => handlers.onTime?.(event.payload.value)),
    listen<ValuePayload>("player://duration", (event) => handlers.onDuration?.(event.payload.value)),
    listen<BufferingPayload>("player://buffering", (event) => handlers.onBuffering?.(event.payload.buffering)),
    listen<TracksPayload>("player://tracks", (event) => handlers.onTracks?.(event.payload.tracks)),
    listen<unknown>("player://video-params", (event) => handlers.onVideoParams?.(event.payload)),
    listen<unknown>("player://audio-params", (event) => handlers.onAudioParams?.(event.payload)),
    listen("player://seek-complete", () => handlers.onSeekComplete?.()),
    listen("player://end", () => handlers.onEnd?.()),
    listen<MessagePayload>("player://warning", (event) => handlers.onWarning?.(event.payload.message)),
    listen<MessagePayload>("player://error", (event) => handlers.onError?.(event.payload.message))
  ]);

  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}

function htmlCapabilities(reason: string): PlayerCapabilities {
  return {
    available: false,
    backend: "html",
    platform: "browser",
    libraryPath: null,
    reason,
    supportsNativeSurface: false,
    supportsEmbeddedTracks: false,
    supportsExternalSubtitles: false
  };
}
