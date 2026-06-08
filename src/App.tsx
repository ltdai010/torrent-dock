import {
  AlertTriangle,
  CirclePause,
  Database,
  Download,
  FileSearch,
  Gauge,
  HardDrive,
  Magnet,
  Play,
  RadioTower,
  ShieldCheck,
  Upload
} from "lucide-react";
import { activeStream, providerResults, selectedFiles, torrentSummaries } from "./data/mockTorrents";
import type { TorrentStatus } from "./domain/torrent";

type Phase = {
  title: string;
  description: string;
  status: "ready" | "next" | "planned";
};

const phases: Phase[] = [
  {
    title: "Foundation",
    description: "Tauri shell, local database, settings, magnet and torrent import, metadata state.",
    status: "ready"
  },
  {
    title: "Streaming MVP",
    description: "Loopback range server, piece deadlines, libVLC playback, buffering state.",
    status: "next"
  },
  {
    title: "Download Manager",
    description: "Queueing, file priorities, bandwidth limits, seed policy, cache controls.",
    status: "planned"
  },
  {
    title: "Providers",
    description: "User-configured RSS, Torznab, legal curated sources, deduped search results.",
    status: "planned"
  }
];

const capabilities = [
  {
    icon: Magnet,
    title: "Magnet-first workflow",
    body: "Treat metadata fetch as a real state before file selection, streaming, or download."
  },
  {
    icon: Play,
    title: "Verified local streaming",
    body: "Serve media through a private localhost range server after torrent pieces verify."
  },
  {
    icon: RadioTower,
    title: "Peer discovery clarity",
    body: "Show tracker, DHT, peer, and buffering conditions without exposing raw engine noise."
  },
  {
    icon: FileSearch,
    title: "Compliant discovery",
    body: "Support user-configured feeds and APIs without bundling piracy-oriented catalogs."
  }
];

const statusLabels: Record<TorrentStatus, string> = {
  fetching_metadata: "Fetching metadata",
  queued: "Queued",
  downloading: "Downloading",
  streaming: "Streaming",
  paused: "Paused",
  seeding: "Seeding",
  completed: "Completed",
  checking: "Checking",
  error: "Error"
};

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

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function App() {
  const activeTorrent = torrentSummaries.find((torrent) => torrent.id === activeStream.torrentId);
  const totalDownloadRate = torrentSummaries.reduce((sum, torrent) => sum + torrent.downloadRate, 0);
  const totalUploadRate = torrentSummaries.reduce((sum, torrent) => sum + torrent.uploadRate, 0);
  const totalPeers = torrentSummaries.reduce((sum, torrent) => sum + torrent.peers, 0);

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">TorrentDock</p>
          <h1>Legitimate torrent streaming and downloads, designed from the protocol up.</h1>
          <p className="lede">
            A desktop-first client for magnets, torrent files, verified playback, and compliant
            provider search. This scaffold starts the product shell while the engine work follows the
            engineering spec.
          </p>
          <div className="hero-actions" aria-label="Primary documentation links">
            <a href="/techdocs/engineering-spec.md">Engineering spec</a>
            <a href="/techdocs/knowledge-exploration.md">Technology deep dive</a>
          </div>
        </div>
        <div className="status-panel" aria-label="Foundation status">
          <div className="status-row">
            <ShieldCheck size={20} aria-hidden="true" />
            <span>Legal-source defaults</span>
          </div>
          <div className="status-row">
            <Database size={20} aria-hidden="true" />
            <span>SQLite-backed library planned</span>
          </div>
          <div className="status-row">
            <Download size={20} aria-hidden="true" />
            <span>libtorrent engine target</span>
          </div>
          <div className="notice">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>No bundled piracy providers. Users control sources and seeding.</span>
          </div>
        </div>
      </section>

      <section className="workspace" aria-label="Product capabilities">
        {capabilities.map((item) => {
          const Icon = item.icon;
          return (
            <article className="capability" key={item.title}>
              <Icon size={22} aria-hidden="true" />
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          );
        })}
      </section>

      <section className="dashboard" aria-label="Torrent foundation dashboard">
        <div className="section-heading">
          <div>
            <p className="eyebrow dark">Phase 1 Interface</p>
            <h2>Typed torrent state, ready for backend wiring.</h2>
          </div>
          <div className="metrics" aria-label="Session metrics">
            <span>
              <Download size={16} aria-hidden="true" />
              {formatRate(totalDownloadRate)}
            </span>
            <span>
              <Upload size={16} aria-hidden="true" />
              {formatRate(totalUploadRate)}
            </span>
            <span>
              <RadioTower size={16} aria-hidden="true" />
              {totalPeers} peers
            </span>
          </div>
        </div>

        <div className="dashboard-grid">
          <section className="panel panel-large" aria-label="Torrent queue">
            <div className="panel-heading">
              <h3>Torrent Queue</h3>
              <button type="button">
                <Magnet size={16} aria-hidden="true" />
                Add Magnet
              </button>
            </div>
            <div className="torrent-list">
              {torrentSummaries.map((torrent) => (
                <article className="torrent-item" key={torrent.id}>
                  <div>
                    <div className="item-title">{torrent.name}</div>
                    <div className="item-meta">
                      {statusLabels[torrent.status]} · {torrent.peers} peers ·{" "}
                      {formatBytes(torrent.totalSize)}
                    </div>
                  </div>
                  <div className="progress-block" aria-label={`${torrent.name} progress`}>
                    <span>{Math.round(torrent.progress * 100)}%</span>
                    <div className="progress-track">
                      <div style={{ width: `${torrent.progress * 100}%` }} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel" aria-label="Active stream">
            <div className="panel-heading">
              <h3>Active Stream</h3>
              <span className="pill">{activeStream.health.replace(/_/g, " ")}</span>
            </div>
            <div className="stream-card">
              <Play size={30} aria-hidden="true" />
              <div>
                <div className="item-title">{activeTorrent?.name}</div>
                <p>{activeStream.fileName}</p>
              </div>
            </div>
            <dl className="stat-list">
              <div>
                <dt>Position</dt>
                <dd>{formatDuration(activeStream.playbackPositionSeconds)}</dd>
              </div>
              <div>
                <dt>Buffer</dt>
                <dd>{activeStream.bufferSeconds}s</dd>
              </div>
              <div>
                <dt>Read-ahead</dt>
                <dd>{activeStream.readAheadPieces} pieces</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-label="Selected files">
            <div className="panel-heading">
              <h3>Selected Files</h3>
              <HardDrive size={18} aria-hidden="true" />
            </div>
            <div className="file-list">
              {selectedFiles.map((file) => (
                <article className="file-item" key={`${file.torrentId}-${file.index}`}>
                  <div>
                    <div className="item-title">{file.path.split("/").slice(-1)[0]}</div>
                    <div className="item-meta">
                      {file.mediaKind} · {file.priority} · {formatBytes(file.size)}
                    </div>
                  </div>
                  <span>{Math.round(file.progress * 100)}%</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel panel-large" aria-label="Provider results">
            <div className="panel-heading">
              <h3>Provider Results</h3>
              <button type="button">
                <FileSearch size={16} aria-hidden="true" />
                Search
              </button>
            </div>
            <div className="provider-list">
              {providerResults.map((result) => (
                <article className="provider-item" key={result.id}>
                  <div>
                    <div className="item-title">{result.title}</div>
                    <div className="item-meta">
                      {result.licenseHint} · {result.category} · {formatBytes(result.size ?? 0)}
                    </div>
                  </div>
                  <div className="health">
                    <Gauge size={16} aria-hidden="true" />
                    {result.seeders ?? 0} / {result.leechers ?? 0}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="phase-board" aria-label="Implementation phases">
        <div className="section-heading">
          <h2>Build Phases</h2>
          <p>Current code slice: typed frontend state and dashboard surfaces.</p>
        </div>
        <div className="phases">
          {phases.map((phase) => (
            <article className={`phase phase-${phase.status}`} key={phase.title}>
              <span>{phase.status}</span>
              <h3>{phase.title}</h3>
              <p>{phase.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
