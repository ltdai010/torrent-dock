import { useMemo, useState } from "react";
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
import { selectedFiles, torrentSummaries } from "./data/mockTorrents";
import type { TorrentFile } from "./domain/torrent";

type MetadataState = "idle" | "fetching" | "ready" | "error";

const defaultInput =
  "magnet:?xt=urn:btih:e03ec1fdc28f72a6ef2c3a90dcd24a884e987125&dn=Creative%20Commons%20Space%20Documentary";

function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatRate(bytesPerSecond: number) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function getFileName(file: TorrentFile) {
  return file.path.split("/").slice(-1)[0];
}

function App() {
  const [torrentInput, setTorrentInput] = useState(defaultInput);
  const [metadataState, setMetadataState] = useState<MetadataState>("ready");
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const activeTorrent = torrentSummaries.find((torrent) => torrent.id === "cc-space-film");
  const playableFiles = selectedFiles.filter((file) => file.mediaKind === "video");
  const selectedFile = playableFiles[selectedFileIndex] ?? playableFiles[0];

  const metadataStatus = useMemo(() => {
    if (metadataState === "fetching") {
      return "Fetching metadata from trackers, DHT, and peers...";
    }

    if (metadataState === "ready") {
      return "Metadata ready. Select a file and press play.";
    }

    if (metadataState === "error") {
      return "Could not read that link. Edit it and try again.";
    }

    return "Paste a magnet link or torrent URL to begin.";
  }, [metadataState]);

  function pullMetadata() {
    const normalizedInput = torrentInput.trim();

    if (!normalizedInput) {
      setMetadataState("error");
      setIsPlaying(false);
      return;
    }

    setMetadataState("fetching");
    setIsPlaying(false);

    window.setTimeout(() => {
      setMetadataState(normalizedInput.includes("magnet:") || normalizedInput.startsWith("http") ? "ready" : "error");
    }, 700);
  }

  const canPlay = metadataState === "ready" && Boolean(selectedFile);

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
          <p>Use a magnet URI or direct `.torrent` URL. The first app version focuses on this single path.</p>
        </div>
        <form
          className="source-form"
          onSubmit={(event) => {
            event.preventDefault();
            pullMetadata();
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
            <button type="submit" disabled={metadataState === "fetching"}>
              {metadataState === "fetching" ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <Magnet size={18} aria-hidden="true" />
              )}
              Pull data
            </button>
          </div>
          <p className="helper">
            TorrentDock will fetch metadata first. Playback starts only after a playable file is known.
          </p>
        </form>
      </section>

      <section className="player-layout" aria-label="Torrent playback workspace">
        <section className="player-panel" aria-label="Video player">
          <div className="video-surface">
            <div className="video-center">
              {metadataState === "fetching" ? (
                <Loader2 className="spin" size={42} aria-hidden="true" />
              ) : (
                <FileVideo size={46} aria-hidden="true" />
              )}
              <div>
                <h2>{metadataState === "ready" ? activeTorrent?.name : "Waiting for torrent metadata"}</h2>
                <p aria-live="polite">{metadataStatus}</p>
              </div>
            </div>
            <div className="video-badge">
              {metadataState === "ready" ? "Local stream preview" : "Metadata required"}
            </div>
          </div>

          <div className="player-controls">
            <button type="button" className="play-button" disabled={!canPlay} onClick={() => setIsPlaying((value) => !value)}>
              {isPlaying ? <CirclePause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
              {isPlaying ? "Pause" : "Play"}
            </button>
            <div className="timeline" aria-label="Playback progress">
              <span>10:12</span>
              <div>
                <span style={{ width: isPlaying ? "38%" : "22%" }} />
              </div>
              <span>48:00</span>
            </div>
          </div>
        </section>

        <aside className="metadata-panel" aria-label="Metadata and files">
          <div className={`status-card status-${metadataState}`} aria-live="polite">
            {metadataState === "ready" ? <CheckCircle2 size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}
            <div>
              <h2>{metadataState === "ready" ? "Ready to play" : metadataState === "fetching" ? "Pulling data" : "Needs source"}</h2>
              <p>{metadataStatus}</p>
            </div>
          </div>

          <div className="stats-grid" aria-label="Torrent health">
            <div>
              <RadioTower size={16} aria-hidden="true" />
              <span>{activeTorrent?.peers ?? 0}</span>
              <small>peers</small>
            </div>
            <div>
              <Download size={16} aria-hidden="true" />
              <span>{formatRate(activeTorrent?.downloadRate ?? 0)}</span>
              <small>down</small>
            </div>
            <div>
              <Upload size={16} aria-hidden="true" />
              <span>{formatRate(activeTorrent?.uploadRate ?? 0)}</span>
              <small>up</small>
            </div>
          </div>

          <div className="file-panel">
            <div className="panel-title">
              <h2>Playable files</h2>
              <button type="button" className="ghost-button" onClick={pullMetadata}>
                <RefreshCw size={16} aria-hidden="true" />
                Refresh
              </button>
            </div>
            <div className="file-options">
              {playableFiles.map((file, index) => (
                <button
                  type="button"
                  className={index === selectedFileIndex ? "file-option active" : "file-option"}
                  key={`${file.torrentId}-${file.index}`}
                  onClick={() => setSelectedFileIndex(index)}
                  disabled={metadataState !== "ready"}
                >
                  <span>{getFileName(file)}</span>
                  <small>
                    {formatBytes(file.size)} · {Math.round(file.progress * 100)}%
                  </small>
                </button>
              ))}
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
