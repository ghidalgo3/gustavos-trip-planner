import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  ProgressBar,
  Text,
  Title3,
} from "@fluentui/react-components";
import type { PlanningParty } from "./planningApi";
import type { PartySettings } from "./planningApi";
import FareResults from "./FareResults";
import {
  getFlightSearchResults,
  getOperations,
  startFlightSearch,
  type FareSearchResult,
  type TrackedOperation,
} from "./operationsApi";

export default function PlanningRun({
  tripId,
  parties,
  partySettings,
  disabled,
  onBeforeSearch,
}: {
  tripId: string;
  parties: PlanningParty[];
  partySettings: PartySettings[];
  disabled: boolean;
  onBeforeSearch: () => Promise<void>;
}) {
  const [operation, setOperation] = useState<TrackedOperation>();
  const [results, setResults] = useState<FareSearchResult[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [pollError, setPollError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const requestId = useRef<string | undefined>(undefined);
  const active =
    operation?.status === "pending" || operation?.status === "InProgress";

  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    let loadedResults = "";
    async function poll() {
      let delay = 3000;
      try {
        const operations = await getOperations(controller.signal, {
          type: "flightSearch",
        });
        if (controller.signal.aborted) return;
        const latest = operations.find((o) => o.resourceId === tripId);
        setOperation(latest);
        setCheckedAt(Date.now());
        setPollError(undefined);
        if (
          latest &&
          (latest.status === "Completed" || latest.status === "Failed")
        ) {
          if (latest.status === "Completed" && loadedResults !== latest.id) {
            const found = await getFlightSearchResults(
              tripId,
              controller.signal,
            );
            if (controller.signal.aborted) return;
            setResults(found);
            loadedResults = latest.id;
          }
          delay = 15000;
        } else {
          setResults([]);
          loadedResults = "";
        }
        if (!latest) delay = 15000;
      } catch (reason) {
        if (controller.signal.aborted) return;
        setPollError(
          reason instanceof Error
            ? reason.message
            : "Unable to check the flight search. Retrying…",
        );
        delay = 10000;
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, delay);
    }
    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [tripId, refresh]);

  async function plan() {
    setStarting(true);
    setError(undefined);
    requestId.current ??= crypto.randomUUID();
    try {
      await onBeforeSearch();
      const started = await startFlightSearch(tripId, requestId.current);
      setOperation(started);
      setResults([]);
      requestId.current = undefined;
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to start planning.",
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card className="planning-card" aria-label="Flight search">
      <div className="planning-section-heading">
        <Title3 as="h2">Find flights</Title3>
        <Button
          appearance="primary"
          onClick={plan}
          disabled={disabled || starting || active}
        >
          {starting ? "Starting…" : active ? "Searching flights…" : "Plan trip"}
        </Button>
      </div>
      <Text>
        Search flights using the details above. You can leave this page and
        return while the search continues.
      </Text>
      {error && <Text role="alert">{error}</Text>}
      {pollError && <Text>{pollError} Checking again shortly.</Text>}
      {operation && (
        <>
          <Text role="status">
            {active
              ? "Searching flights"
              : operation.status === "Failed"
                ? "Search finished with errors"
                : "Search complete"}
            {` · ${operation.progress.completedItems} of ${operation.progress.items} searches completed`}
            {operation.progress.failedItems > 0 &&
              ` · ${operation.progress.failedItems} failed`}
          </Text>
          {active && (
            <ProgressBar
              aria-label="Flight search progress"
              max={operation.progress.items || 1}
              value={
                operation.progress.completedItems +
                operation.progress.failedItems
              }
            />
          )}
          <Text size={200}>
            Search started {new Date(operation.createdAt).toLocaleString()}.
            Changes to this form apply to your next search.
          </Text>
        </>
      )}
      {results.length > 0 && (
        <>
          <FareResults
            tripId={tripId}
            results={results}
            parties={parties}
            partySettings={partySettings}
          />
          <Text size={200}>
            Prices last retrieved{" "}
            {new Date(results[0].fetchedAt).toLocaleString()}.{" "}
            {Date.parse(results[0].expiresAt) <= checkedAt
              ? "These results have expired. Plan again to refresh prices."
              : "Prices can change."}
          </Text>
        </>
      )}
    </Card>
  );
}
