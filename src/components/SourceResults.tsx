import { CheckCircle2, Loader2, Magnet } from "lucide-react";
import type { LocalTorrentMatch, MetadataState, TorrentSession } from "../domain/appTypes";
import type { ProviderResult } from "../domain/torrent";
import { getProviderResultSource } from "../services/torrentSources";
import { Badge, Button, Card, Flex, Heading, Text } from "./ui";

type SourceResultsProps = {
  metadataState: MetadataState;
  selectedSourceResultId: string | null;
  session: TorrentSession | null;
  sourceResults: ProviderResult[];
  sourceResultLocalMatches: Map<string, LocalTorrentMatch>;
  isTorrentLoading: boolean;
  formatOptionalBytes: (bytes?: number) => string;
  formatOptionalCount: (value?: number) => string;
  onLoadSourceResult: (result: ProviderResult) => void;
};

export function SourceResults({
  metadataState,
  selectedSourceResultId,
  session,
  sourceResults,
  sourceResultLocalMatches,
  isTorrentLoading,
  formatOptionalBytes,
  formatOptionalCount,
  onLoadSourceResult
}: SourceResultsProps) {
  return (
    <Flex direction="column" gap="3" aria-label="Discovered torrent sources">
      {sourceResults.length > 0 ? (
        sourceResults.map((result) => {
          const resultSource = getProviderResultSource(result);
          const isSelected = selectedSourceResultId === result.id;
          const isLoaded = isSelected && Boolean(session) && (metadataState === "ready" || metadataState === "streaming" || metadataState === "stopped");
          const isLoadingSelected = isSelected && metadataState === "fetching";
          const localMatch = sourceResultLocalMatches.get(result.id);
          const localLabel = localMatch?.isCurrent
            ? "Now playing"
            : localMatch?.finished
              ? "Downloaded"
              : localMatch
                ? `${Math.round(localMatch.percent)}% local`
                : null;
          const healthLabel = typeof result.seeders === "number"
            ? result.seeders >= 100
              ? "High seeds"
              : result.seeders >= 20
                ? "Good seeds"
                : result.seeders > 0
                  ? "Low seeds"
                  : "No seeds"
            : null;
          const resultInfoHash = result.infoHashV1 ?? result.infoHashV2;

          return (
            <Card key={result.id} variant={isSelected ? "surface" : "classic"}>
              <Flex gap="3" align="start" justify="between" wrap="wrap">
                <Flex direction="column" gap="2" flexGrow="1">
                  <Flex gap="2" align="start" justify="between" wrap="wrap">
                    <Heading as="h3" size="3">{result.title}</Heading>
                    <Flex gap="1" align="center" wrap="wrap">
                      {localLabel ? <Badge color="red" variant="soft">{localLabel}</Badge> : null}
                      {isLoaded ? <Badge color="red">Loaded</Badge> : null}
                      {isLoadingSelected ? <Badge color="amber" variant="soft">Loading</Badge> : null}
                      <Badge color="blue" variant="soft">{result.providerName}</Badge>
                    </Flex>
                  </Flex>
                  <Flex gap="3" align="center" wrap="wrap">
                    <Text as="span" size="2" color="gray">{result.category ?? "torrent"}</Text>
                    <Text as="span" size="2" color="gray">{formatOptionalBytes(result.size)}</Text>
                    <Text as="span" size="2" color="gray">{formatOptionalCount(result.seeders)} seeds</Text>
                    <Text as="span" size="2" color="gray">{formatOptionalCount(result.leechers)} peers</Text>
                    {healthLabel ? <Text as="span" size="2" color="gray">{healthLabel}</Text> : null}
                    {resultInfoHash ? <Text as="span" size="2" color="gray">hash {resultInfoHash.slice(0, 8)}</Text> : null}
                    {result.licenseHint ? <Text as="span" size="2" color="gray">{result.licenseHint}</Text> : null}
                  </Flex>
                  {localMatch ? (
                    <Text as="div" size="1" weight="bold" color="gray" title={localMatch.outputFolder}>
                      Local: {localMatch.name}
                    </Text>
                  ) : null}
                </Flex>
                <Button
                  type="button"
                  variant={isLoaded ? "soft" : "surface"}
                  color={isLoaded ? "red" : "gray"}
                  disabled={!resultSource || isTorrentLoading || isLoaded}
                  onClick={() => onLoadSourceResult(result)}
                >
                  {isLoadingSelected ? (
                    <Loader2 className="spin" size={16} aria-hidden="true" />
                  ) : isLoaded ? (
                    <CheckCircle2 size={16} aria-hidden="true" />
                  ) : (
                    <Magnet size={16} aria-hidden="true" />
                  )}
                  {isLoadingSelected ? "Loading" : isLoaded ? "Loaded" : "Load"}
                </Button>
              </Flex>
            </Card>
          );
        })
      ) : (
        <Text as="p" color="gray" align="center">No source results yet.</Text>
      )}
    </Flex>
  );
}
