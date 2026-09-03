import { AlertTriangle, Clapperboard, ListChecks, Loader2, Search } from "lucide-react";
import type { ReactNode } from "react";
import { SourceResults } from "../components/SourceResults";
import { Badge, Button, Callout, Card, Flex, Grid, Heading, Text } from "../components/ui";
import type { CatalogSearchState, LocalTorrentMatch, MetadataState, SourceSearchState, TorrentSession } from "../domain/appTypes";
import type { ProviderResult, ProviderSearchError } from "../domain/torrent";
import type { MovieTitleCandidate } from "../services/movieCatalog";
import "./SearchPage.css";

type SearchPageProps = {
  catalogResults: MovieTitleCandidate[];
  catalogSearchState: CatalogSearchState;
  catalogSearchStatus: string;
  chooseCatalogTitle: (candidate: MovieTitleCandidate) => void;
  formatOptionalBytes: (bytes?: number) => string;
  formatOptionalCount: (value?: number) => string;
  isTorrentLoading: boolean;
  loadSourceResult: (result: ProviderResult) => void;
  metadataState: MetadataState;
  selectedCatalogTitle: MovieTitleCandidate | null;
  selectedSourceResultId: string | null;
  session: TorrentSession | null;
  shouldShowCatalogStatus: boolean;
  shouldShowSourceStatus: boolean;
  sourceErrors: ProviderSearchError[];
  sourceResults: ProviderResult[];
  sourceResultLocalMatches: Map<string, LocalTorrentMatch>;
  sourceSearchState: SourceSearchState;
  sourceSearchStatus: string;
};

function statusColor(state: CatalogSearchState | SourceSearchState) {
  return state === "error" ? "red" : state === "searching" ? "amber" : "gray";
}

function SearchStatus({
  icon,
  title,
  message,
  state,
  children
}: {
  icon: ReactNode;
  title: ReactNode;
  message: ReactNode;
  state: CatalogSearchState | SourceSearchState;
  children?: ReactNode;
}) {
  if (state === "ready") {
    return (
      <Flex align="center" justify="between" gap="3" wrap="wrap" aria-live="polite">
        <Flex direction="column" gap="1">
          <Heading as="h2" size="4">{title}</Heading>
          <Text as="span" size="2" color="gray">{message}</Text>
        </Flex>
        {children ? <div>{children}</div> : null}
      </Flex>
    );
  }

  return (
    <Callout.Root color={statusColor(state)} variant="surface" aria-live="polite">
      <Callout.Icon>{icon}</Callout.Icon>
      <Callout.Text>
        <Text as="span" weight="bold">{title}</Text>
        <br />
        <Text as="span" size="2" color="gray">{message}</Text>
        {children ? (
          <>
            <br />
            {children}
          </>
        ) : null}
      </Callout.Text>
    </Callout.Root>
  );
}

export function SearchPage({
  catalogResults,
  catalogSearchState,
  catalogSearchStatus,
  chooseCatalogTitle,
  formatOptionalBytes,
  formatOptionalCount,
  isTorrentLoading,
  loadSourceResult,
  metadataState,
  selectedCatalogTitle,
  selectedSourceResultId,
  session,
  shouldShowCatalogStatus,
  shouldShowSourceStatus,
  sourceErrors,
  sourceResults,
  sourceResultLocalMatches,
  sourceSearchState,
  sourceSearchStatus
}: SearchPageProps) {
  if (selectedCatalogTitle) {
    return (
      <Grid asChild columns={{ initial: "1", sm: "124px minmax(0, 1fr)" }} gap="4" align="start">
        <section aria-label="Selected title and sources">
          <div className="browse-poster">
            {selectedCatalogTitle.imageUrl ? (
              <img src={selectedCatalogTitle.imageUrl} alt={`${selectedCatalogTitle.title} poster`} />
            ) : (
              <Clapperboard size={48} aria-hidden="true" />
            )}
          </div>

          <Flex direction="column" gap="3">
            <Flex direction="column" gap="3">
              <Heading as="h2" size="5">
                {selectedCatalogTitle.title}
                {selectedCatalogTitle.year ? ` (${selectedCatalogTitle.year})` : null}
              </Heading>
              <Flex gap="2" align="center" wrap="wrap">
                {selectedCatalogTitle.kind ? <Badge color="blue" variant="soft">{selectedCatalogTitle.kind}</Badge> : null}
                {selectedCatalogTitle.id?.startsWith("tt") ? (
                  <a href={`https://www.imdb.com/title/${selectedCatalogTitle.id}/`} target="_blank" rel="noreferrer">
                    View on IMDb
                  </a>
                ) : null}
              </Flex>
              {selectedCatalogTitle.credits ? <Text as="p" color="gray">{selectedCatalogTitle.credits}</Text> : null}
            </Flex>

            <SearchStatus
              state={sourceSearchState}
              icon={sourceSearchState === "searching" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : sourceSearchState === "ready" ? <ListChecks size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
              title={sourceSearchState === "ready" ? "Available torrents" : sourceSearchState === "searching" ? "Finding torrents" : "Torrent sources"}
              message={sourceSearchStatus}
            />
            <SourceResults
              metadataState={metadataState}
              selectedSourceResultId={selectedSourceResultId}
              session={session}
              sourceResults={sourceResults}
              sourceResultLocalMatches={sourceResultLocalMatches}
              isTorrentLoading={isTorrentLoading}
              formatOptionalBytes={formatOptionalBytes}
              formatOptionalCount={formatOptionalCount}
              onLoadSourceResult={loadSourceResult}
            />
          </Flex>
        </section>
      </Grid>
    );
  }

  if (!shouldShowCatalogStatus && !shouldShowSourceStatus) {
    return (
      <Flex asChild minHeight="calc(100dvh - 160px)" align="center" justify="center" p="9">
        <section aria-label="Search start">
          <Flex direction="column" align="center" gap="2">
            <Search size={34} aria-hidden="true" />
            <Text as="p" color="gray" align="center">Search for a movie, show, or magnet link from the top bar.</Text>
          </Flex>
        </section>
      </Flex>
    );
  }

  return (
    <>
      {shouldShowCatalogStatus ? (
        <section aria-labelledby="catalog-results-title">
          <Flex direction="column" gap="3">
          <SearchStatus
            state={catalogSearchState}
            icon={catalogSearchState === "searching" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : catalogSearchState === "ready" ? <Clapperboard size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
            title={catalogSearchState === "ready" ? "Title matches" : catalogSearchState === "searching" ? "Finding titles" : "Title lookup"}
            message={catalogSearchStatus}
          />

          <Heading as="h2" className="visually-hidden" id="catalog-results-title">
            Title matches
          </Heading>
          <Flex direction="column" gap="2" aria-label="Movie and show title matches">
            {catalogResults.map((result) => (
              <Card key={result.id}>
                <Flex gap="3" align="start" justify="between" wrap="wrap">
                  <Flex gap="3" align="start" flexGrow="1">
                    <span className="catalog-poster">
                      {result.imageUrl ? <img src={result.imageUrl} alt="" loading="lazy" /> : <Clapperboard size={18} aria-hidden="true" />}
                    </span>
                    <Flex direction="column" gap="1" flexGrow="1">
                      <Text as="div" weight="bold">{result.title}</Text>
                      <Text as="span" size="1" color="gray">{[result.year, result.kind, result.credits].filter(Boolean).join(" - ")}</Text>
                    </Flex>
                  </Flex>
                  <Button type="button" color="red" variant="surface" onClick={() => chooseCatalogTitle(result)}>
                    Select
                  </Button>
                </Flex>
              </Card>
            ))}
          </Flex>
          </Flex>
        </section>
      ) : null}

      {shouldShowSourceStatus ? (
        <section aria-labelledby="source-results-title">
          <Flex direction="column" gap="3">
          <SearchStatus
            state={sourceSearchState}
            icon={sourceSearchState === "searching" ? <Loader2 className="spin" size={18} aria-hidden="true" /> : sourceSearchState === "ready" ? <ListChecks size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
            title={sourceSearchState === "ready" ? "Results ready" : sourceSearchState === "searching" ? "Searching" : "Source status"}
            message={sourceSearchStatus}
          >
            {sourceErrors.length > 0 && sourceResults.length > 0 ? (
              <Text as="span" size="1">Partial source errors: {sourceErrors.map((error) => `${error.providerName}: ${error.message}`).join(" ")}</Text>
            ) : null}
          </SearchStatus>

          <Heading as="h2" className="visually-hidden" id="source-results-title">
            Source results
          </Heading>
          <SourceResults
            metadataState={metadataState}
            selectedSourceResultId={selectedSourceResultId}
            session={session}
            sourceResults={sourceResults}
            sourceResultLocalMatches={sourceResultLocalMatches}
            isTorrentLoading={isTorrentLoading}
            formatOptionalBytes={formatOptionalBytes}
            formatOptionalCount={formatOptionalCount}
            onLoadSourceResult={loadSourceResult}
          />
          </Flex>
        </section>
      ) : null}
    </>
  );
}
