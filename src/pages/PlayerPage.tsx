import type { CSSProperties, ChangeEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, FileVideo, Loader2 } from "lucide-react";
import { AppSlider } from "../components/AppControls";
import { SubtitlePanel } from "../components/SubtitlePanel";
import { Button, Card, Flex, Grid, Heading, Progress, Text } from "../components/ui";
import type {
  LanguageOption,
  ActiveSubtitleTrack,
  LoadedSubtitleTrack,
  MetadataState,
  OnlineSubtitleCandidate,
  OnlineSubtitleProvider,
  OnlineSubtitleSearchState,
  PlayerShortcutFeedback,
  TorrentSession
} from "../domain/appTypes";
import type { RqbitFile, TorrentDownloadProgress } from "../services/rqbit";
import type { MovieTitleCandidate } from "../services/movieCatalog";
import type { ProviderResult } from "../domain/torrent";
import "./PlayerPage.css";

type PlayerPageProps = {
  activeSubtitleTracks: ActiveSubtitleTrack[];
  activeSubtitleSourceIds: Set<string>;
  findOnlineSubtitles: () => void;
  formatBytes: (bytes: number) => string;
  formatSubtitleLanguage: (language?: string) => string | null;
  formatSubtitleOffset: (value: number) => string;
  getFileName: (file: RqbitFile) => string;
  getOnlineSubtitleProviderLabel: (provider: OnlineSubtitleProvider) => string;
  getTorrentSubtitleSourceId: (file: RqbitFile) => string;
  isTorrentLoading: boolean;
  loadOnlineSubtitle: (candidate: OnlineSubtitleCandidate) => void;
  loadSubtitleFile: (event: ChangeEvent<HTMLInputElement>) => void;
  loadSubtitleFromTorrent: (file: RqbitFile) => void;
  makeSubtitleTrackPrimary: (trackId: string) => void;
  metadataState: MetadataState;
  metadataStatus: string;
  onlineSubtitleError: string | null;
  onlineSubtitleLoadingResultId: string | null;
  onlineSubtitleResults: OnlineSubtitleCandidate[];
  onlineSubtitleSearchState: OnlineSubtitleSearchState;
  openSubtitlesLanguage: string;
  openSubtitlesLanguageOptions: LanguageOption[];
  openSubtitlesPassword: string;
  openSubtitlesUsername: string;
  playerPanelRef: RefObject<HTMLElement>;
  playerShortcutFeedback: PlayerShortcutFeedback | null;
  progressBytesLabel: string;
  progressLabel: string;
  removeSubtitleFile: () => void;
  removeSubtitleTrack: (trackId: string) => void;
  resetSubtitleTrackShift: (trackId: string) => void;
  returnToSources: () => void;
  selectedCatalogTitle: MovieTitleCandidate | null;
  session: TorrentSession | null;
  setOpenSubtitlesLanguage: (language: string) => void;
  setSubSourceLanguage: (language: string) => void;
  setSubtitleTextScale: (value: number) => void;
  shiftSubtitleTrack: (trackId: string, deltaSeconds: number) => void;
  sourceQuery: string;
  sourceResults: ProviderResult[];
  streamUrl: string | null;
  subtitleError: string | null;
  subtitleFiles: RqbitFile[];
  subtitleLoadingFileIndex: number | null;
  subtitleOverlayRoot: HTMLElement | null;
  subtitleShiftStepSeconds: number;
  subtitleTracks: LoadedSubtitleTrack[];
  subtitleTextScale: number;
  subSourceApiKey: string;
  subSourceLanguage: string;
  subSourceLanguageOptions: LanguageOption[];
  toggleSubtitleTrackVisibility: (trackId: string) => void;
  videoError: string | null;
  videoJsHostRef: RefObject<HTMLDivElement>;
  downloadProgress: TorrentDownloadProgress | null;
  downloadSpeedLabel: string;
  progressPercent: number;
};

export function PlayerPage({
  activeSubtitleTracks,
  activeSubtitleSourceIds,
  findOnlineSubtitles,
  formatBytes,
  formatSubtitleLanguage,
  formatSubtitleOffset,
  getFileName,
  getOnlineSubtitleProviderLabel,
  getTorrentSubtitleSourceId,
  isTorrentLoading,
  loadOnlineSubtitle,
  loadSubtitleFile,
  loadSubtitleFromTorrent,
  makeSubtitleTrackPrimary,
  metadataState,
  metadataStatus,
  onlineSubtitleError,
  onlineSubtitleLoadingResultId,
  onlineSubtitleResults,
  onlineSubtitleSearchState,
  openSubtitlesLanguage,
  openSubtitlesLanguageOptions,
  openSubtitlesPassword,
  openSubtitlesUsername,
  playerPanelRef,
  playerShortcutFeedback,
  progressBytesLabel,
  progressLabel,
  removeSubtitleFile,
  removeSubtitleTrack,
  resetSubtitleTrackShift,
  returnToSources,
  selectedCatalogTitle,
  session,
  setOpenSubtitlesLanguage,
  setSubSourceLanguage,
  setSubtitleTextScale,
  shiftSubtitleTrack,
  sourceQuery,
  sourceResults,
  streamUrl,
  subtitleError,
  subtitleFiles,
  subtitleLoadingFileIndex,
  subtitleOverlayRoot,
  subtitleShiftStepSeconds,
  subtitleTracks,
  subtitleTextScale,
  subSourceApiKey,
  subSourceLanguage,
  subSourceLanguageOptions,
  toggleSubtitleTrackVisibility,
  videoError,
  videoJsHostRef,
  downloadProgress,
  downloadSpeedLabel,
  progressPercent
}: PlayerPageProps) {
  const canReturnToSources = sourceResults.length > 0;
  const subtitleOverlayStyle = { "--subtitle-text-scale": subtitleTextScale } as CSSProperties;
  const subtitleOverlay = streamUrl && activeSubtitleTracks.length > 0 ? (
    <div className="subtitle-overlay" style={subtitleOverlayStyle} aria-live="off" aria-label="Active subtitles">
      {activeSubtitleTracks.map((track) => (
        <p className={track.isPrimary ? "subtitle-overlay-line primary" : "subtitle-overlay-line secondary"} key={track.id}>
          {track.text}
        </p>
      ))}
    </div>
  ) : null;

  return (
    <>
      {canReturnToSources ? (
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Text as="p" size="2" color="gray">
            {selectedCatalogTitle?.title ?? session?.name ?? sourceQuery ?? "Selected source"}
          </Text>
          <Button type="button" variant="surface" color="gray" onClick={returnToSources}>
            <ArrowLeft size={16} aria-hidden="true" />
            Back to torrents
          </Button>
        </Flex>
      ) : null}
      <Grid asChild columns={{ initial: "1", md: "minmax(0, 1fr) minmax(330px, 0.36fr)" }} gap="4" align="start">
        <section aria-label="Torrent playback workspace">
          <Flex direction="column" gap="3">
            <section ref={playerPanelRef} className="player-panel" aria-label="Video player">
              <div className={["video-surface", streamUrl ? "video-surface-active" : ""].filter(Boolean).join(" ")}>
                {streamUrl ? (
                  <div key={streamUrl} ref={videoJsHostRef} className="torrentdock-video-js-host" aria-label="Chromium FFmpeg video player" />
                ) : (
                  <Flex width="min(560px, 100%)" direction={{ initial: "column", md: "row" }} gap="4" align="center" justify="center" className="video-center">
                    {metadataState === "fetching" || metadataState === "starting" ? (
                      <Loader2 className="spin" size={42} aria-hidden="true" />
                    ) : (
                      <FileVideo size={46} aria-hidden="true" />
                    )}
                    <div>
                      <Heading as="h2" size="5">{session?.name ?? "Waiting for torrent metadata"}</Heading>
                      <Text as="p" color="gray" aria-live="polite">{metadataStatus}</Text>
                    </div>
                  </Flex>
                )}
                {subtitleOverlay && subtitleOverlayRoot ? createPortal(subtitleOverlay, subtitleOverlayRoot) : subtitleOverlay}
                {streamUrl && playerShortcutFeedback ? (
                  <div className="player-shortcut-feedback" key={playerShortcutFeedback.id} aria-hidden="true">
                    {playerShortcutFeedback.label}
                  </div>
                ) : null}
                {videoError ? (
                  <div className="video-error" role="alert">
                    <FileVideo size={28} aria-hidden="true" />
                    <Text as="p" color="red">{videoError}</Text>
                  </div>
                ) : null}
                {streamUrl && subtitleTracks.length > 0 ? (
                  <div className="video-subtitle-controls" aria-label="Subtitle display controls">
                    <div className="video-subtitle-controls-header">
                      <span>Subtitles</span>
                      <AppSlider
                        label="Size"
                        min={0.75}
                        max={1.7}
                        step={0.05}
                        value={subtitleTextScale}
                        onChange={setSubtitleTextScale}
                      />
                      <Button type="button" size="1" variant="surface" color="gray" onClick={() => setSubtitleTextScale(1)}>
                        100%
                      </Button>
                    </div>
                    <div className="video-subtitle-track-toggles">
                      {subtitleTracks.map((track, index) => (
                        <Button
                          type="button"
                          size="1"
                          variant={track.isVisible ? "soft" : "surface"}
                          color={track.isVisible ? "red" : "gray"}
                          key={track.id}
                          onClick={() => toggleSubtitleTrackVisibility(track.id)}
                          aria-pressed={track.isVisible}
                        >
                          {index === 0 ? "Primary" : `Track ${index + 1}`}
                          {track.language ? ` - ${track.language}` : ""}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <Card>
              <Flex asChild direction="column" gap="2">
                <section aria-label="Torrent download progress">
                  <Flex align="center" justify="between" gap="3" wrap="wrap">
                    <Text as="span" size="2" weight="bold">{progressLabel}</Text>
                    <Text as="span" size="2" color="gray">{downloadSpeedLabel}</Text>
                  </Flex>
                  <Progress value={progressPercent} color="red" aria-label="Torrent download completion" />
                  <Flex align="center" justify="between" gap="3" wrap="wrap">
                    <Text as="span" size="1" color="gray">{progressBytesLabel}</Text>
                    <Text as="span" size="1" color="gray">{downloadProgress ? `${downloadProgress.livePeers} live peers` : `${session?.seenPeers ?? 0} seen peers`}</Text>
                  </Flex>
                </section>
              </Flex>
            </Card>
          </Flex>

          <Card asChild>
            <aside aria-label="Metadata and files">
              <SubtitlePanel
                activeSubtitleSourceIds={activeSubtitleSourceIds}
                canSearchOnlineSubtitles={Boolean(session)}
                findOnlineSubtitles={findOnlineSubtitles}
                formatBytes={formatBytes}
                formatSubtitleLanguage={formatSubtitleLanguage}
                formatSubtitleOffset={formatSubtitleOffset}
                getFileName={getFileName}
                getTorrentSubtitleSourceId={getTorrentSubtitleSourceId}
                isTorrentLoading={isTorrentLoading}
                loadOnlineSubtitle={loadOnlineSubtitle}
                loadSubtitleFile={loadSubtitleFile}
                loadSubtitleFromTorrent={loadSubtitleFromTorrent}
                makeSubtitleTrackPrimary={makeSubtitleTrackPrimary}
                onlineSubtitleError={onlineSubtitleError}
                onlineSubtitleLoadingResultId={onlineSubtitleLoadingResultId}
                onlineSubtitleResults={onlineSubtitleResults}
                onlineSubtitleSearchState={onlineSubtitleSearchState}
                openSubtitlesLanguage={openSubtitlesLanguage}
                openSubtitlesLanguageOptions={openSubtitlesLanguageOptions}
                openSubtitlesPassword={openSubtitlesPassword}
                openSubtitlesUsername={openSubtitlesUsername}
                removeSubtitleFile={removeSubtitleFile}
                removeSubtitleTrack={removeSubtitleTrack}
                resetSubtitleTrackShift={resetSubtitleTrackShift}
                setSubtitleTextScale={setSubtitleTextScale}
                setOpenSubtitlesLanguage={setOpenSubtitlesLanguage}
                setSubSourceLanguage={setSubSourceLanguage}
                shiftSubtitleTrack={shiftSubtitleTrack}
                subtitleError={subtitleError}
                subtitleFiles={subtitleFiles}
                subtitleLoadingFileIndex={subtitleLoadingFileIndex}
                subtitleShiftStepSeconds={subtitleShiftStepSeconds}
                subtitleTracks={subtitleTracks}
                subtitleTextScale={subtitleTextScale}
                subSourceApiKey={subSourceApiKey}
                subSourceLanguage={subSourceLanguage}
                subSourceLanguageOptions={subSourceLanguageOptions}
                toggleSubtitleTrackVisibility={toggleSubtitleTrackVisibility}
              />
            </aside>
          </Card>
        </section>
      </Grid>
    </>
  );
}
