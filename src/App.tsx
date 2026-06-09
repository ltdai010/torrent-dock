import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CirclePause,
  Download,
  FileVideo,
  Link,
  Loader2,
  Magnet,
  Play,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Upload
} from "lucide-react";
import {
  getStreamUrl,
  isSupportedTorrentSource,
  resolveTorrentMetadata,
  RqbitApiError,
  startTorrentDownload,
  type RqbitFile
} from "./services/rqbit";
import { ensureRqbitEngineEndpoint } from "./services/rqbitEngine";

type MetadataState = "idle" | "fetching" | "ready" | "starting" | "streaming" | "error";

type TorrentSession = {
  infoHash: string;
  name: string;
  files: RqbitFile[];
  seenPeers: number;
  torrentId?: number;
};

const defaultInput =
  "magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F&xs=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2Fbig-buck-bunny.torrent";

const playableExtensions = new Set([".avi", ".m4v", ".mkv", ".mov", ".mp4", ".ogg", ".ogm", ".ogv", ".webm"]);

function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getFileName(file: RqbitFile) {
  return file.components.length > 0 ? file.components[file.components.length - 1] : file.name.split("/").slice(-1)[0];
}

function isPlayable(file: RqbitFile) {
  const fileName = getFileName(file).toLowerCase();
  return Array.from(playableExtensions).some((extension) => fileName.endsWith(extension));
}

function getErrorMessage(error: unknown) {
  if (error instanceof RqbitApiError) {
    if (error.status === 404) {
      return "rqbit is not responding. Start Docker dev services, then retry.";
    }

    return error.message || "Torrent engine rejected the source.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while talking to the torrent engine.";
}

function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [torrentInput, setTorrentInput] = useState(defaultInput);
  const [metadataState, setMetadataState] = useState<MetadataState>("idle");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [session, setSession] = useState<TorrentSession | null>(null);
  const [engineBaseUrl, setEngineBaseUrl] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const playableFiles = useMemo(() => session?.files.filter(isPlayable) ?? [], [session]);
  const selectedFile = playableFiles[selectedFileIndex] ?? playableFiles[0];

  const metadataStatus = useMemo(() => {
    if (metadataState === "fetching") {
      return "Resolving metadata through the local torrent engine...";
    }

    if (metadataState === "starting") {
      return "Starting the selected file and preparing a local stream URL...";
    }

    if (metadataState === "streaming") {
      return "Local stream is ready. Use the video controls to play or seek.";
    }

    if (metadataState === "ready") {
      return "Metadata ready. Select a playable file and press play.";
    }

    if (metadataState === "error") {
      return errorMessage ?? "Could not read that link. Edit it and try again.";
    }

    return "Paste a magnet link or torrent URL to begin.";
  }, [errorMessage, metadataState]);

  async function pullMetadata() {
    const normalizedInput = torrentInput.trim();

    setStreamUrl(null);
    setIsPlaying(false);
    setErrorMessage(null);

    if (!normalizedInput || !isSupportedTorrentSource(normalizedInput)) {
      setMetadataState("error");
      setSession(null);
      setErrorMessage("Paste a valid magnet URI, torrent URL, or direct HTTP(S) torrent source.");
      return null;
    }

    try {
      setMetadataState("fetching");
      const nextEngineBaseUrl = await ensureRqbitEngineEndpoint();
      setEngineBaseUrl(nextEngineBaseUrl);

      const response = await resolveTorrentMetadata(normalizedInput, nextEngineBaseUrl);
      const files = response.details.files ?? [];
      const nextSession = {
        infoHash: response.details.info_hash,
        name: response.details.name ?? "Untitled torrent",
        files,
        seenPeers: response.seen_peers?.length ?? 0,
        torrentId: response.id ?? response.details.id ?? undefined
      };

      const nextPlayableFiles = files.filter(isPlayable);

      setSession(nextSession);
      setSelectedFileIndex(0);

      if (nextPlayableFiles.length === 0) {
        setMetadataState("error");
        setErrorMessage("Metadata loaded, but no browser-playable video file was found.");
        return nextSession;
      }

      setMetadataState("ready");
      return nextSession;
    } catch (error) {
      setSession(null);
      setMetadataState("error");
      setErrorMessage(getErrorMessage(error));
      return null;
    }
  }

  async function startPlayback() {
    const normalizedInput = torrentInput.trim();
    const activeSession = session ?? (await pullMetadata());
    const fileToPlay = selectedFile ?? activeSession?.files.find(isPlayable);
    const activeEngineBaseUrl = engineBaseUrl ?? (await ensureRqbitEngineEndpoint());

    if (!activeSession || !fileToPlay) {
      return;
    }

    try {
      setMetadataState("starting");
      setErrorMessage(null);
      setEngineBaseUrl(activeEngineBaseUrl);

      const response = await startTorrentDownload(normalizedInput, fileToPlay.name, activeEngineBaseUrl);
      const torrentId = response.id ?? response.details.id;

      if (typeof torrentId !== "number") {
        throw new Error("Torrent engine did not return a streamable torrent id.");
      }

      const nextUrl = getStreamUrl(activeEngineBaseUrl, torrentId, fileToPlay.index);

      setSession({
        ...activeSession,
        torrentId,
        seenPeers: response.seen_peers?.length ?? activeSession.seenPeers
      });
      setStreamUrl(nextUrl);
      setMetadataState("streaming");
      setIsPlaying(true);

      window.setTimeout(() => {
        void videoRef.current?.play().catch(() => {
          setIsPlaying(false);
        });
      }, 0);
    } catch (error) {
      setMetadataState("error");
      setErrorMessage(getErrorMessage(error));
      setIsPlaying(false);
    }
  }

  const canPlay = (metadataState === "ready" || metadataState === "streaming") && Boolean(selectedFile);
  const stateTitle =
    metadataState === "streaming"
      ? "Streaming"
      : metadataState === "ready"
        ? "Ready to play"
        : metadataState === "fetching"
          ? "Pulling data"
          : "Needs source";

  return (
    <main className="player-app">
      <header className="topbar">
        <div>
          <p className="eyebrow">TorrentDock v1</p>
          <h1>Paste a magnet or torrent link. Pull metadata. Play.</h1>
        </div>
        <div className="safety-chip">
          <ShieldCheck size={18} aria-hidden="true" />
          Legal sources only
        </div>
      </header>

      <section className="input-panel" aria-labelledby="torrent-input-title">
        <div className="input-copy">
          <h2 id="torrent-input-title">Torrent source</h2>
          <p>Use a magnet URI or direct `.torrent` URL. The app resolves metadata before playback.</p>
        </div>
        <form
          className="source-form"
          onSubmit={(event) => {
            event.preventDefault();
            void pullMetadata();
          }}
        >
          <label htmlFor="torrent-source">Magnet or torrent URL</label>
          <div className="source-row">
            <textarea
              id="torrent-source"
              value={torrentInput}
              onChange={(event) => setTorrentInput(event.target.value)}
              rows={3}
              spellCheck={false}
            />
            <button type="submit" disabled={metadataState === "fetching" || metadataState === "starting"}>
              {metadataState === "fetching" ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <Magnet size={18} aria-hidden="true" />
              )}
              Pull data
            </button>
          </div>
          <p className="helper">
            Desktop builds start rqbit as a sidecar. Docker dev still proxies the engine through `/rqbit`.
          </p>
        </form>
      </section>

      <section className="player-layout" aria-label="Torrent playback workspace">
        <section className="player-panel" aria-label="Video player">
          <div className={streamUrl ? "video-surface video-surface-active" : "video-surface"}>
            {streamUrl ? (
              <video
                ref={videoRef}
                src={streamUrl}
                controls
                playsInline
                onPause={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
              />
            ) : (
              <div className="video-center">
                {metadataState === "fetching" || metadataState === "starting" ? (
                  <Loader2 className="spin" size={42} aria-hidden="true" />
                ) : (
                  <FileVideo size={46} aria-hidden="true" />
                )}
                <div>
                  <h2>{session?.name ?? "Waiting for torrent metadata"}</h2>
                  <p aria-live="polite">{metadataStatus}</p>
                </div>
              </div>
            )}
            <div className="video-badge">
              {metadataState === "streaming" ? "Local HTTP stream" : metadataState === "ready" ? "Metadata ready" : "Engine required"}
            </div>
          </div>

          <div className="player-controls">
            <button
              type="button"
              className="play-button"
              disabled={!canPlay}
              onClick={() => {
                if (streamUrl) {
                  if (videoRef.current?.paused) {
                    void videoRef.current.play();
                  } else {
                    videoRef.current?.pause();
                  }
                  return;
                }

                void startPlayback();
              }}
            >
              {metadataState === "starting" ? (
                <Loader2 className="spin" size={20} aria-hidden="true" />
              ) : isPlaying ? (
                <CirclePause size={20} aria-hidden="true" />
              ) : (
                <Play size={20} aria-hidden="true" />
              )}
              {metadataState === "starting" ? "Starting" : isPlaying ? "Pause" : "Play"}
            </button>
            <div className="timeline" aria-label="Stream progress">
              <span>{session ? `${playableFiles.length}` : "0"}</span>
              <div>
                <span style={{ width: metadataState === "streaming" ? "38%" : metadataState === "ready" ? "18%" : "0%" }} />
              </div>
              <span>files</span>
            </div>
          </div>
        </section>

        <aside className="metadata-panel" aria-label="Metadata and files">
          <div className={`status-card status-${metadataState}`} aria-live="polite">
            {metadataState === "ready" || metadataState === "streaming" ? (
              <CheckCircle2 size={20} aria-hidden="true" />
            ) : (
              <AlertTriangle size={20} aria-hidden="true" />
            )}
            <div>
              <h2>{stateTitle}</h2>
              <p>{metadataStatus}</p>
            </div>
          </div>

          <div className="stats-grid" aria-label="Torrent health">
            <div>
              <RadioTower size={16} aria-hidden="true" />
              <span>{session?.seenPeers ?? 0}</span>
              <small>seen peers</small>
            </div>
            <div>
              <Download size={16} aria-hidden="true" />
              <span>{formatBytes(selectedFile?.length ?? 0)}</span>
              <small>selected</small>
            </div>
            <div>
              <Upload size={16} aria-hidden="true" />
              <span>{streamUrl ? "ready" : "idle"}</span>
              <small>stream</small>
            </div>
          </div>

          <div className="file-panel">
            <div className="panel-title">
              <h2>Playable files</h2>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void pullMetadata();
                }}
                disabled={metadataState === "fetching" || metadataState === "starting"}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Refresh
              </button>
            </div>
            <div className="file-options">
              {playableFiles.length > 0 ? (
                playableFiles.map((file, index) => (
                  <button
                    type="button"
                    className={index === selectedFileIndex ? "file-option active" : "file-option"}
                    key={`${file.index}-${file.name}`}
                    onClick={() => {
                      setSelectedFileIndex(index);
                      setStreamUrl(null);
                      setIsPlaying(false);
                      if (metadataState === "streaming") {
                        setMetadataState("ready");
                      }
                    }}
                    disabled={metadataState === "fetching" || metadataState === "starting"}
                  >
                    <span>{getFileName(file)}</span>
                    <small>
                      {formatBytes(file.length)} · index {file.index}
                    </small>
                  </button>
                ))
              ) : (
                <div className="empty-files">Pull metadata to show playable files.</div>
              )}
            </div>
          </div>

          <div className="compliance-note">
            <Link size={17} aria-hidden="true" />
            <span>This UI accepts user-provided sources. It does not bundle torrent indexes or media catalogs.</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

export default App;
