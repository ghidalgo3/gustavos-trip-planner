import { useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  ProgressBar,
  Text,
  Title3,
} from "@fluentui/react-components";
import type {
  PlanningConstraint,
  PlanningParty,
  PartySettings,
} from "./planningApi";
import RouteFareResults from "./RouteFareResults";
import FareResults from "./FareResults";
import {
  getFlightSearchResults,
  getOperations,
  startFlightSearch,
  FlightSearchValidationError,
  type FlightSearchIssue,
  type FareSearchResult,
  type TrackedOperation,
} from "./operationsApi";

export default function PlanningRun({
  tripId,
  parties,
  partySettings,
  constraints,
  currentAiPrompt,
  disabled,
  hasUnsavedChanges,
  savedVersion,
  onBeforeSearch,
  onReviewRequirements,
}: {
  tripId: string;
  parties: PlanningParty[];
  partySettings: PartySettings[];
  constraints: PlanningConstraint[];
  currentAiPrompt?: string | null;
  disabled: boolean;
  hasUnsavedChanges: boolean;
  savedVersion: number;
  onBeforeSearch: () => Promise<void>;
  onReviewRequirements: (constraintId?: string) => void;
}) {
  const [operation, setOperation] = useState<TrackedOperation>();
  const [results, setResults] = useState<FareSearchResult[]>([]);
  const [resultsKey, setResultsKey] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [issues, setIssues] = useState<FlightSearchIssue[]>([]);
  const [pollError, setPollError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const requestId = useRef<string | undefined>(undefined);
  const active =
    operation?.status === "pending" || operation?.status === "InProgress";
  const currentResults =
    resultsKey === `${tripId}:${savedVersion}` ? results : [];

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
            setResultsKey(`${tripId}:${savedVersion}`);
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
        setResults([]);
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
  }, [tripId, refresh, savedVersion]);

  async function plan() {
    setStarting(true);
    setError(undefined);
    setIssues([]);
    requestId.current ??= crypto.randomUUID();
    try {
      await onBeforeSearch();
      const started = await startFlightSearch(tripId, requestId.current);
      setOperation(started);
      setResults([]);
      requestId.current = undefined;
      setRefresh((value) => value + 1);
    } catch (reason) {
      if (reason instanceof FlightSearchValidationError)
        setIssues(reason.issues);
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
          {starting
            ? "Starting…"
            : active
              ? "Searching flights…"
              : "Find flights"}
        </Button>
      </div>
      <Text>
        Search flights using the details above. You can leave this page and
        return while the search continues.
      </Text>
      {error && <Text role="alert">{error}</Text>}
      {issues.length > 0 && (
        <div className="planning-conflict" aria-label="Planning conflicts">
          {issues.map((issue, index) => (
            <div key={index}>
              <Text weight="semibold">{issue.message}</Text>
              {issue.constraintIds.length > 0 && (
                <ul>
                  {issue.constraintIds.map((id) => {
                    const position = constraints.findIndex(
                      (constraint) => constraint.id === id,
                    );
                    return position < 0 ? null : (
                      <li key={id}>
                        {describeRequirement(
                          constraints[position],
                          position,
                          currentAiPrompt,
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
          <Button
            onClick={() => onReviewRequirements(issues[0]?.constraintIds[0])}
          >
            Review requirements
          </Button>
        </div>
      )}
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
      {hasUnsavedChanges && currentResults.length > 0 && (
        <Text>Save planning details to refresh these flight options.</Text>
      )}
      {!hasUnsavedChanges && currentResults.length > 0 && (
        <>
          {currentResults.some((r) => r.request.searchKind === "itinerary") ? (
            <RouteFareResults
              tripId={tripId}
              results={currentResults}
              parties={parties}
            />
          ) : (
            <FareResults
              tripId={tripId}
              results={currentResults}
              parties={parties}
              partySettings={partySettings}
            />
          )}
          <Text size={200}>
            Prices last retrieved{" "}
            {new Date(currentResults[0].fetchedAt).toLocaleString()}.{" "}
            {Date.parse(currentResults[0].expiresAt) <= checkedAt
              ? "These results have expired. Plan again to refresh prices."
              : "Prices can change."}
          </Text>
        </>
      )}
    </Card>
  );
}

function describeRequirement(
  constraint: PlanningConstraint,
  index: number,
  currentAiPrompt?: string | null,
): string {
  const prefix = `Requirement ${index + 1}: `;
  const source =
    constraint.originalInput &&
    currentAiPrompt &&
    constraint.originalInput !== currentAiPrompt
      ? " (from an earlier trip description)"
      : "";
  if (
    constraint.type === "departureWindow" ||
    constraint.type === "returnHomeWindow"
  ) {
    const kind =
      constraint.type === "departureWindow" ? "Leave home" : "Return flight";
    return `${prefix}${kind}, ${dateRange(constraint.window?.earliest, constraint.window?.latest)}${source}`;
  }
  if (constraint.type === "presence")
    return `${prefix}Required destination stay, ${dateRange(constraint.startDate, constraint.endDate)}${source}`;
  return `${prefix}${constraint.type}${source}`;
}

function dateRange(start?: string | null, end?: string | null): string {
  if (!start || !end) return "dates incomplete";
  const format = (date: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));
  return start === end ? format(start) : `${format(start)}–${format(end)}`;
}
