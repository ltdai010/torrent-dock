import React from "react";
import ReactDOM from "react-dom/client";
import {
  AlertTriangle,
  Database,
  Download,
  FileSearch,
  Magnet,
  Play,
  RadioTower,
  ShieldCheck
} from "lucide-react";
import "./styles.css";

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

function App() {
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

      <section className="phase-board" aria-label="Implementation phases">
        <div className="section-heading">
          <h2>Build Phases</h2>
          <p>First code slice: app shell and docs foundation.</p>
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
