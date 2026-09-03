import type { ChangeEvent, ReactNode } from "react";
import { Captions, CheckCircle2, Download, Eye, EyeOff, Loader2, Search, StepBack, StepForward, Trash2, Upload } from "lucide-react";
import type { LanguageOption, LoadedSubtitleTrack, OnlineSubtitleCandidate, OnlineSubtitleSearchState } from "../domain/appTypes";
import type { RqbitFile } from "../services/rqbit";
import { AppIconButton, AppSelect, AppSlider } from "./AppControls";
import { Badge, Button, Card, Flex, Grid, Heading, Text } from "./ui";
import "./SubtitlePanel.css";

type SubtitlePanelProps = {
  activeSubtitleSourceIds: Set<string>;
  formatBytes: (bytes: number) => string;
  formatSubtitleLanguage: (language?: string) => string | null;
  formatSubtitleOffset: (value: number) => string;
  getTorrentSubtitleSourceId: (file: RqbitFile) => string;
  findOnlineSubtitles: () => void;
  isTorrentLoading: boolean;
  loadSubtitleFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onlineSubtitleError: string | null;
  onlineSubtitleLoadingResultId: string | null;
  onlineSubtitleResults: OnlineSubtitleCandidate[];
  onlineSubtitleSearchState: OnlineSubtitleSearchState;
  openSubtitlesLanguage: string;
  openSubtitlesLanguageOptions: LanguageOption[];
  openSubtitlesPassword: string;
  openSubtitlesUsername: string;
  removeSubtitleFile: () => void;
  removeSubtitleTrack: (trackId: string) => void;
  resetSubtitleTrackShift: (trackId: string) => void;
  setOpenSubtitlesLanguage: (language: string) => void;
  setSubSourceLanguage: (language: string) => void;
  setSubtitleTextScale: (value: number) => void;
  shiftSubtitleTrack: (trackId: string, deltaSeconds: number) => void;
  subtitleError: string | null;
  subtitleFiles: RqbitFile[];
  subtitleLoadingFileIndex: number | null;
  subtitleShiftStepSeconds: number;
  subtitleTracks: LoadedSubtitleTrack[];
  subtitleTextScale: number;
  subSourceApiKey: string;
  subSourceLanguage: string;
  subSourceLanguageOptions: LanguageOption[];
  makeSubtitleTrackPrimary: (trackId: string) => void;
  loadOnlineSubtitle: (candidate: OnlineSubtitleCandidate) => void;
  loadSubtitleFromTorrent: (file: RqbitFile) => void;
  toggleSubtitleTrackVisibility: (trackId: string) => void;
  getFileName: (file: RqbitFile) => string;
  canSearchOnlineSubtitles: boolean;
};

function SubtitleSectionHeader({
  title,
  meta,
  actions
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <Flex align="start" justify="between" gap="3" wrap="wrap">
      <Flex direction="column" gap="1">
        <Heading as="h3" size="3">{title}</Heading>
        {meta ? <Text as="span" size="1" color="gray" weight="bold">{meta}</Text> : null}
      </Flex>
      {actions}
    </Flex>
  );
}

export function SubtitlePanel({
  activeSubtitleSourceIds,
  formatBytes,
  formatSubtitleLanguage,
  formatSubtitleOffset,
  getTorrentSubtitleSourceId,
  findOnlineSubtitles,
  isTorrentLoading,
  loadSubtitleFile,
  onlineSubtitleError,
  onlineSubtitleLoadingResultId,
  onlineSubtitleResults,
  onlineSubtitleSearchState,
  openSubtitlesLanguage,
  openSubtitlesLanguageOptions,
  openSubtitlesPassword,
  openSubtitlesUsername,
  removeSubtitleFile,
  removeSubtitleTrack,
  resetSubtitleTrackShift,
  setOpenSubtitlesLanguage,
  setSubSourceLanguage,
  setSubtitleTextScale,
  shiftSubtitleTrack,
  subtitleError,
  subtitleFiles,
  subtitleLoadingFileIndex,
  subtitleShiftStepSeconds,
  subtitleTracks,
  subtitleTextScale,
  subSourceApiKey,
  subSourceLanguage,
  subSourceLanguageOptions,
  makeSubtitleTrackPrimary,
  loadOnlineSubtitle,
  loadSubtitleFromTorrent,
  toggleSubtitleTrackVisibility,
  getFileName,
  canSearchOnlineSubtitles
}: SubtitlePanelProps) {
  return (
    <Flex direction="column" gap="3">
      <Flex align="center" justify="between" gap="2" wrap="wrap">
        <Heading as="h2" size="4">Subtitles</Heading>
        <Button asChild variant="surface" color="gray" className="subtitle-upload">
          <label>
            <Upload size={16} aria-hidden="true" />
            Upload files
            <input type="file" accept=".srt,.vtt,text/vtt" multiple onChange={loadSubtitleFile} />
          </label>
        </Button>
      </Flex>

      {subtitleError ? <Text as="p" color="red" weight="bold">{subtitleError}</Text> : null}

      <Card>
        <Flex asChild direction="column" gap="3">
          <section aria-label="Loaded subtitle tracks">
        <SubtitleSectionHeader
          title="Loaded tracks"
          meta={`${subtitleTracks.length} active`}
          actions={subtitleTracks.length > 0 ? (
            <Button type="button" variant="surface" color="gray" onClick={removeSubtitleFile}>
              Remove all
            </Button>
          ) : null}
        />

        {subtitleTracks.length > 0 ? (
          <Flex direction="column" gap="2" aria-label="Loaded subtitles">
            {subtitleTracks.map((track, index) => {
              const subtitleLanguage = formatSubtitleLanguage(track.language);

              return (
                <Card key={track.id} variant={track.isVisible ? "surface" : "classic"}>
                  <Flex direction="column" gap="3">
                    <Flex gap="2" align="start" justify="between" wrap="wrap">
                      <Flex gap="2" align="start" flexGrow="1">
                        <Captions size={16} aria-hidden="true" />
                        <Flex direction="column" gap="2" flexGrow="1">
                          <Text as="span" weight="bold" wrap="wrap">{track.fileName}</Text>
                          <Flex gap="1" align="center" wrap="wrap">
                            <Badge color="red" variant={index === 0 ? "solid" : "soft"}>{index === 0 ? "Primary" : `Track ${index + 1}`}</Badge>
                            <Badge color={track.isVisible ? "red" : "gray"} variant="soft">
                              {track.isVisible ? "Visible" : "Hidden"}
                            </Badge>
                            <Badge color={subtitleLanguage ? "blue" : "gray"} variant="soft">
                              {subtitleLanguage ?? "Language unknown"}
                            </Badge>
                            <Badge color="gray" variant="surface">{track.sourceLabel}</Badge>
                          </Flex>
                        </Flex>
                      </Flex>
                      <AppIconButton type="button" variant="surface" color="red" onClick={() => removeSubtitleTrack(track.id)} label={`Remove ${track.fileName}`}>
                        <Trash2 size={15} aria-hidden="true" />
                      </AppIconButton>
                    </Flex>
                    <Flex gap="2" align="center" justify="between" wrap="wrap">
                      <Flex gap="2" align="center" wrap="wrap">
                        {index > 0 ? (
                          <Button type="button" size="1" variant="surface" color="gray" onClick={() => makeSubtitleTrackPrimary(track.id)}>
                            Make primary
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="1"
                          variant={track.isVisible ? "surface" : "soft"}
                          color={track.isVisible ? "gray" : "red"}
                          onClick={() => toggleSubtitleTrackVisibility(track.id)}
                          aria-pressed={track.isVisible}
                          aria-label={`${track.isVisible ? "Hide" : "Show"} ${track.fileName}`}
                        >
                          {track.isVisible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                          {track.isVisible ? "Hide" : "Show"}
                        </Button>
                      </Flex>
                      <Flex gap="1" align="center" aria-label={`${track.fileName} timing`}>
                        <AppIconButton type="button" size="1" variant="surface" color="gray" onClick={() => shiftSubtitleTrack(track.id, -subtitleShiftStepSeconds)} label={`Show ${track.fileName} earlier`}>
                          <StepBack size={14} aria-hidden="true" />
                        </AppIconButton>
                        <Button
                          type="button"
                          size="1"
                          variant="surface"
                          color="gray"
                          onClick={() => resetSubtitleTrackShift(track.id)}
                          disabled={track.offsetSeconds === 0}
                          aria-label={`Reset ${track.fileName} timing shift`}
                        >
                          {formatSubtitleOffset(track.offsetSeconds)}
                        </Button>
                        <AppIconButton type="button" size="1" variant="surface" color="gray" onClick={() => shiftSubtitleTrack(track.id, subtitleShiftStepSeconds)} label={`Show ${track.fileName} later`}>
                          <StepForward size={14} aria-hidden="true" />
                        </AppIconButton>
                      </Flex>
                    </Flex>
                  </Flex>
                </Card>
              );
            })}
          </Flex>
        ) : (
          <Flex direction="column" align="center" gap="2">
            <Captions size={18} aria-hidden="true" />
            <Text as="p" color="gray">No loaded subtitles</Text>
          </Flex>
        )}
          </section>
        </Flex>
      </Card>

      <Card>
        <Flex
          asChild
          direction="column"
          gap="3"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              findOnlineSubtitles();
            }}
          >
        <SubtitleSectionHeader title="Online search" meta="All configured providers" />

        <Grid columns={{ initial: "1", sm: "2" }} gap="2" aria-label="Configured subtitle providers">
          <Card>
            <Flex align="center" justify="between" gap="2" wrap="wrap">
            <Badge color={subSourceApiKey.trim() ? "red" : "gray"} variant="soft">SubSource</Badge>
            <Text as="span" size="1">{subSourceApiKey.trim() ? subSourceLanguage : "missing key"}</Text>
            </Flex>
          </Card>
          <Card>
            <Flex align="center" justify="between" gap="2" wrap="wrap">
            <Badge color={openSubtitlesUsername.trim() && openSubtitlesPassword ? "red" : "gray"} variant="soft">OpenSubtitles.org</Badge>
            <Text as="span" size="1">{openSubtitlesUsername.trim() && openSubtitlesPassword ? openSubtitlesLanguage : "missing account"}</Text>
            </Flex>
          </Card>
        </Grid>

        <Flex direction="column" gap="2">
          <AppSelect
            label="SubSource language"
            value={subSourceLanguage}
            options={subSourceLanguageOptions}
            onChange={setSubSourceLanguage}
          />
          <AppSelect
            label="OpenSubtitles language"
            value={openSubtitlesLanguage}
            options={openSubtitlesLanguageOptions}
            onChange={setOpenSubtitlesLanguage}
          />
        </Flex>

        <AppSlider
          label="Text size"
          min={0.75}
          max={1.7}
          step={0.05}
          value={subtitleTextScale}
          valueLabel={`${Math.round(subtitleTextScale * 100)}%`}
          onChange={setSubtitleTextScale}
        />

        <Flex justify="end">
          <Button
            type="submit"
            color="red"
            disabled={onlineSubtitleSearchState === "searching" || onlineSubtitleSearchState === "loading" || !canSearchOnlineSubtitles}
          >
            {onlineSubtitleSearchState === "searching" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
            Search providers
          </Button>
        </Flex>
          </form>
        </Flex>
      </Card>

      {onlineSubtitleError ? <Text as="p" color="red" weight="bold">{onlineSubtitleError}</Text> : null}

      {onlineSubtitleResults.length > 0 ? (
        <Card>
          <Flex asChild direction="column" gap="3">
            <section aria-label="Online subtitle results">
          <SubtitleSectionHeader title="Online results" meta={`${onlineSubtitleResults.length} found`} />
          <Flex direction="column" gap="2" maxHeight="var(--subtitle-list-max-height)" overflow="auto">
            {onlineSubtitleResults.map((result) => {
              const isLoadingOnlineResult = onlineSubtitleLoadingResultId === result.id;
              const isActiveOnlineResult = activeSubtitleSourceIds.has(result.id);
              const resultMeta = [
                result.language,
                result.format.toUpperCase(),
                result.isRawFile ? null : "ZIP",
                result.size ? formatBytes(result.size) : null,
                result.hi ? "HI" : null,
                result.fps ? `${result.fps} fps` : null
              ].filter(Boolean);

              return (
                <Card key={result.id}>
                  <Flex gap="3" align="center" justify="between" wrap="wrap">
                    <Flex direction="column" gap="1" flexGrow="1">
                      <Text as="div" weight="bold">{result.releaseName}</Text>
                      <Text as="span" size="1" color="gray">{resultMeta.join(" - ")}</Text>
                    </Flex>
                    <Button
                      type="button"
                      variant={isActiveOnlineResult ? "soft" : "surface"}
                      color={isActiveOnlineResult ? "red" : "gray"}
                      onClick={() => loadOnlineSubtitle(result)}
                      aria-pressed={isActiveOnlineResult}
                      disabled={onlineSubtitleSearchState === "loading" || isLoadingOnlineResult}
                    >
                      {isLoadingOnlineResult ? (
                        <Loader2 className="spin" size={16} aria-hidden="true" />
                      ) : isActiveOnlineResult ? (
                        <CheckCircle2 size={16} aria-hidden="true" />
                      ) : (
                        <Download size={16} aria-hidden="true" />
                      )}
                      {isActiveOnlineResult ? "Loaded" : "Add"}
                    </Button>
                  </Flex>
                </Card>
              );
            })}
          </Flex>
            </section>
          </Flex>
        </Card>
      ) : null}

      {subtitleFiles.length > 0 ? (
        <Card>
          <Flex asChild direction="column" gap="3">
            <section aria-label="Subtitle files in this torrent">
          <SubtitleSectionHeader title="In torrent" meta={`${subtitleFiles.length} file${subtitleFiles.length === 1 ? "" : "s"}`} />
          <Flex direction="column" gap="2">
            {subtitleFiles.map((file) => {
              const fileName = getFileName(file);
              const isLoadingSubtitle = subtitleLoadingFileIndex === file.index;
              const isActiveSubtitle = activeSubtitleSourceIds.has(getTorrentSubtitleSourceId(file));

              return (
                <Card key={`${file.index}-${file.name}`}>
                  <Flex gap="3" align="center" justify="between" wrap="wrap">
                    <Flex gap="2" align="center" flexGrow="1">
                      <Captions size={16} aria-hidden="true" />
                      <Flex direction="column" gap="1" flexGrow="1">
                        <Text as="span" weight="bold">{fileName}</Text>
                        <Text as="span" size="1" color="gray">{formatBytes(file.length)}</Text>
                      </Flex>
                    </Flex>
                    <Button
                      type="button"
                      variant={isActiveSubtitle ? "soft" : "surface"}
                      color={isActiveSubtitle ? "red" : "gray"}
                      onClick={() => loadSubtitleFromTorrent(file)}
                      aria-pressed={isActiveSubtitle}
                      disabled={isTorrentLoading || isLoadingSubtitle}
                    >
                      {isLoadingSubtitle ? (
                        <Loader2 className="spin" size={16} aria-hidden="true" />
                      ) : isActiveSubtitle ? (
                        <CheckCircle2 size={16} aria-hidden="true" />
                      ) : (
                        <Captions size={16} aria-hidden="true" />
                      )}
                      {isActiveSubtitle ? "Loaded" : "Add"}
                    </Button>
                  </Flex>
                </Card>
              );
            })}
          </Flex>
            </section>
          </Flex>
        </Card>
      ) : null}
    </Flex>
  );
}
