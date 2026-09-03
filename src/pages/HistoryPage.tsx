import { FileVideo, History, Loader2, Play, RadioTower, Trash2 } from "lucide-react";
import { AppPageHeader } from "../components/AppControls";
import { Button, Callout, Card, Flex, Text } from "../components/ui";
import type { LibraryTorrent } from "../services/rqbit";

type HistoryPageProps = {
  historyError: string | null;
  historyItems: LibraryTorrent[];
  historyState: "idle" | "loading" | "ready" | "error";
  historyBusyId: number | null;
  isClearingHistory: boolean;
  formatBytes: (bytes: number) => string;
  formatPercentage: (value: number) => string;
  onClearHistory: () => void;
  onLoadHistory: () => void;
  onOpenHistoryItem: (item: LibraryTorrent) => void;
  onRemoveHistoryItem: (item: LibraryTorrent, deleteFiles: boolean) => void;
};

export function HistoryPage({
  historyError,
  historyItems,
  historyState,
  historyBusyId,
  isClearingHistory,
  formatBytes,
  formatPercentage,
  onClearHistory,
  onLoadHistory,
  onOpenHistoryItem,
  onRemoveHistoryItem
}: HistoryPageProps) {
  return (
    <Card asChild>
      <section aria-label="Download history">
        <Flex direction="column" gap="4">
          <AppPageHeader
            title="Download history"
            description="Torrents the engine is tracking. Remove old downloads to free disk space."
            actions={
              <>
                <Button
                  type="button"
                  variant="surface"
                  color="red"
                  onClick={onClearHistory}
                  disabled={historyItems.length === 0 || isClearingHistory || historyBusyId !== null}
                  title="Delete every torrent in history and remove its downloaded files"
                >
                  {isClearingHistory ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                  {isClearingHistory ? "Deleting all" : "Delete all files"}
                </Button>
                <Button type="button" variant="surface" color="gray" onClick={onLoadHistory} disabled={historyState === "loading"}>
                  {historyState === "loading" ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <RadioTower size={16} aria-hidden="true" />}
                  Refresh
                </Button>
              </>
            }
          />

          {historyError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Text>{historyError}</Callout.Text>
            </Callout.Root>
          ) : null}

          {historyState === "loading" && historyItems.length === 0 ? (
            <Flex direction="column" align="center" gap="2">
              <Loader2 className="spin" size={28} aria-hidden="true" />
              <Text as="p" color="gray">Loading torrents from the engine...</Text>
            </Flex>
          ) : historyItems.length === 0 ? (
            <Flex direction="column" align="center" gap="2">
              <History size={28} aria-hidden="true" />
              <Text as="p" color="gray">No downloads yet. Torrents you stream will show up here.</Text>
            </Flex>
          ) : (
            <Flex asChild direction="column" gap="2">
              <ul>
                {historyItems.map((item) => {
                  const isBusy = isClearingHistory || historyBusyId === item.id;
                  const statusLabel = item.finished
                    ? "Completed"
                    : item.state
                      ? `${item.state} - ${formatPercentage(item.percent)}`
                      : formatPercentage(item.percent);

                  return (
                    <li key={item.id}>
                      <Card>
                        <Flex gap="3" align="center" justify="between" wrap="wrap">
                          <Flex gap="3" align="center" flexGrow="1">
                            <FileVideo size={20} aria-hidden="true" />
                            <Flex direction="column" gap="1" flexGrow="1">
                              <Text as="div" weight="bold" title={item.name}>{item.name}</Text>
                              <Text as="span" size="1" color="gray">
                                {formatBytes(item.progressBytes)}
                                {item.totalBytes > 0 ? ` / ${formatBytes(item.totalBytes)}` : ""} - {statusLabel}
                              </Text>
                              {item.outputFolder ? <Text as="span" size="1" color="gray" title={item.outputFolder}>{item.outputFolder}</Text> : null}
                            </Flex>
                          </Flex>
                          <Flex gap="2" align="center" justify="end" wrap="wrap">
                            <Button
                              type="button"
                              color="red"
                              disabled={isBusy}
                              onClick={() => onOpenHistoryItem(item)}
                              title="Open this torrent again"
                            >
                              {historyBusyId === item.id && !isClearingHistory ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                              Play
                            </Button>
                            <Button
                              type="button"
                              variant="surface"
                              color="gray"
                              disabled={isBusy}
                              onClick={() => onRemoveHistoryItem(item, false)}
                              title="Remove from the engine but keep the downloaded files on disk"
                            >
                              Remove
                            </Button>
                            <Button
                              type="button"
                              variant="surface"
                              color="red"
                              disabled={isBusy}
                              onClick={() => onRemoveHistoryItem(item, true)}
                              title="Remove from the engine and delete the downloaded files"
                            >
                              {isBusy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                              Delete files
                            </Button>
                          </Flex>
                        </Flex>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </Flex>
          )}
        </Flex>
      </section>
    </Card>
  );
}
