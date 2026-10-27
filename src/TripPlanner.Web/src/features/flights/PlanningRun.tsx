import { useTripResourceVersion } from "../../api/tripSnapshot";
import type { PlannedVisit } from "./planningApi";
import { trackBehavior } from "../../telemetry/telemetry";
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
import FirstLegResults from "./FirstLegResults";
import FareResults from "./FareResults";
import {
  getFlightSearchResults,
  getOperations,
  startFlightSearch,
  FlightSearchValidationError,
  type FlightSearchIssue,
  type FareSearchResult,
  type TrackedOperation,
} from "../../api/operationsApi";
import {
  getFlightChoices,
  setFlightChoices,
  type FlightChoiceProgress,
} from "./selectedFlightsApi";

export default function PlanningRun({
  tripId,
  parties,
  partySettings,
  constraints,
  currentAiPrompt,
  multiCity = false,
  visitCount = 0,
  visits = [],
  returnDate,
  disabled,
  readOnly = false,
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
  multiCity?: boolean;
  visitCount?: number;
  visits?: PlannedVisit[];
  returnDate?: string | null;
  disabled: boolean;
  readOnly?: boolean;
  hasUnsavedChanges: boolean;
  savedVersion: number;
  onBeforeSearch: () => Promise<void>;
  onReviewRequirements: (constraintId?: string) => void;
}) {
  const choicesVersion = useTripResourceVersion(
    `/trips/${tripId}/flights/choices`,
  );
  const showGrid = multiCity && visits.length > 0;
  const [operation, setOperation] = useState<TrackedOperation>();
  const [results, setResults] = useState<FareSearchResult[]>([]);
  const [resultsKey, setResultsKey] = useState("");
  const [flightChoices, setFlightChoicesState] = useState<
    Record<string, FlightChoiceProgress>
  >({});
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [issues, setIssues] = useState<FlightSearchIssue[]>([]);
  const [pollError, setPollError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const requestId = useRef<string | undefined>(undefined);
  const choiceMutation = useRef(0);
  const active =
    operation?.status === "pending" || operation?.status === "InProgress";
  const currentResults =
    resultsKey === `${tripId}:${savedVersion}` ? results : [];

  useEffect(() => {
    if (!multiCity) return;
    const controller = new AbortController();
    const version = choiceMutation.current;
    void getFlightChoices(tripId, controller.signal)
      .then((saved) => {
        if (!controller.signal.aborted && version === choiceMutation.current)
          setFlightChoicesState(
            Object.fromEntries(saved.map((choice) => [choice.partyId, choice])),
          );
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load flight choices.",
          );
      });
    return () => controller.abort();
  }, [tripId, multiCity, readOnly, choicesVersion]);

  async function saveFlightChoices(
    partyId: string,
    legKeys: (string | null)[],
    purchasedOfferIds?: string[],
  ): Promise<boolean> {
    if (readOnly) return false;
    choiceMutation.current += 1;
    const previous = flightChoices[partyId];
    setFlightChoicesState((current) => ({
      ...current,
      [partyId]: {
        ...previous,
        partyId,
        legKeys,
        purchasedOfferIds: purchasedOfferIds ?? previous?.purchasedOfferIds,
        nextOrigins: nextOriginFromKey(
          legKeys
            .slice(
              0,
              legKeys.findIndex((key) => !key) < 0
                ? legKeys.length
                : legKeys.findIndex((key) => !key),
            )
            .at(-1),
        ),
      },
    }));
    try {
      const saved = await setFlightChoices(
        tripId,
        partyId,
        legKeys,
        purchasedOfferIds,
      );
      if (!Array.isArray(saved.legKeys) || !Array.isArray(saved.nextOrigins))
        throw new Error("The server returned an invalid flight choice.");
      if (saved.legKeys.some(Boolean)) trackBehavior("flight_choices_saved");
      setFlightChoicesState((previous) => ({
        ...previous,
        [partyId]: saved,
      }));
      setRefresh((value) => value + 1);
      setError(undefined);
      return true;
    } catch (reason) {
      setFlightChoicesState((current) => ({
        ...current,
        [partyId]: previous ?? { partyId, legKeys: [], nextOrigins: [] },
      }));
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save flight choices.",
      );
      throw reason;
    }
  }

  useEffect(() => {
    if (readOnly) return;
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
        // Saved offers can be restored without a live operation or fresh cache.
        const resultVersion = latest?.id ?? "saved";
        if (
          loadedResults !== resultVersion ||
          latest?.status === "InProgress" ||
          latest?.status === "pending"
        ) {
          const found = await getFlightSearchResults(tripId, controller.signal);
          if (controller.signal.aborted) return;
          setResults(found);
          setResultsKey(`${tripId}:${savedVersion}`);
          loadedResults = resultVersion;
        }
        if (
          !latest ||
          latest.status === "Completed" ||
          latest.status === "Failed"
        )
          delay = 15000;
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (reason instanceof FlightSearchValidationError) {
          setResults([]);
          setIssues(reason.issues);
          setOperation(undefined);
          setPollError(undefined);
          delay = 15000;
        } else {
          setPollError(
            reason instanceof Error
              ? reason.message
              : "Unable to check the flight search. Retrying…",
          );
          delay = 10000;
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, delay);
    }
    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [tripId, refresh, savedVersion, readOnly]);

  async function plan() {
    if (readOnly) return;
    trackBehavior("flight_search_started");
    setStarting(true);
    setError(undefined);
    setIssues([]);
    requestId.current ??= crypto.randomUUID();
    try {
      await onBeforeSearch();
      const started = await startFlightSearch(tripId, requestId.current);
      trackBehavior("flight_search_queued");
      setOperation(started);
      requestId.current = undefined;
      setRefresh((value) => value + 1);
    } catch (reason) {
      trackBehavior("flight_search_rejected");
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
    <Card
      id="flight-search"
      className="planning-card"
      aria-label="Flight search"
    >
      <div className="planning-section-heading">
        <Title3 as="h2">Find flights</Title3>
        <Button
          appearance="primary"
          onClick={plan}
          disabled={readOnly || disabled || starting || active}
        >
          {readOnly
            ? "Find flights"
            : starting
              ? "Starting…"
              : active
                ? "Searching flights…"
                : "Find flights"}
        </Button>
      </div>
      <Text>
        Search flights using your trip destinations and travelers. You can leave
        this page and return while the search continues.
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
            Review trip details
          </Button>
        </div>
      )}
      {pollError && !readOnly && issues.length === 0 && (
        <Text>{pollError} Checking again shortly.</Text>
      )}
      {operation && issues.length === 0 && (
        <>
          <Text role="status">
            {readOnly
              ? "Last saved search status"
              : active
                ? "Searching flights"
                : operation.status === "Failed"
                  ? "Search finished with errors"
                  : "Search complete"}
            {` · ${operation.progress.completedItems} of ${operation.progress.items} searches completed`}
            {operation.progress.failedItems > 0 &&
              ` · ${operation.progress.failedItems} failed`}
          </Text>
          {active && !readOnly && (
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
            Changes to your trip apply to your next search.
          </Text>
        </>
      )}
      {hasUnsavedChanges && currentResults.length > 0 && (
        <Text>Save planning details to refresh these flight options.</Text>
      )}
      {!hasUnsavedChanges && (currentResults.length > 0 || showGrid) && (
        <>
          {showGrid ||
          currentResults.some(
            (r) =>
              r.request.searchKind === "itinerary" &&
              r.response.itineraries.length > 0,
          ) ? (
            <RouteFareResults
              tripId={tripId}
              results={currentResults}
              visits={visits}
              returnDate={returnDate}
              showGrid={showGrid}
              searching={!readOnly && Boolean(active || starting)}
              readOnly={readOnly}
              parties={parties}
              partySettings={partySettings}
              savedChoices={Object.fromEntries(
                Object.entries(flightChoices).map(([partyId, choice]) => [
                  partyId,
                  choice.legKeys,
                ]),
              )}
              onChangeChoices={readOnly ? undefined : saveFlightChoices}
              choiceProgress={flightChoices}
            />
          ) : multiCity ? (
            <FirstLegResults
              results={currentResults}
              parties={parties}
              partySettings={partySettings}
              choices={flightChoices}
              legCount={visitCount + 1}
              searching={active}
              onChoose={saveFlightChoices}
            />
          ) : (
            <FareResults
              tripId={tripId}
              results={currentResults}
              parties={parties}
              partySettings={partySettings}
            />
          )}
          {currentResults.length > 0 && (
            <Text size={200}>
              Prices last retrieved{" "}
              {new Date(currentResults[0].fetchedAt).toLocaleString()}.{" "}
              {Date.parse(currentResults[0].expiresAt) <= checkedAt
                ? Object.values(flightChoices).some((choice) =>
                    choice.legKeys.some(Boolean),
                  )
                  ? "Saved flight quotes are retained. Search again to refresh unselected flights. Airline prices can change."
                  : "These results have expired. Plan again to refresh prices."
                : "Prices can change."}
            </Text>
          )}
        </>
      )}
    </Card>
  );
}

function nextOriginFromKey(key?: string | null): string[] {
  if (!key) return [];
  try {
    const segments: unknown = JSON.parse(key);
    if (!Array.isArray(segments)) return [];
    const last: unknown = segments.at(-1);
    return Array.isArray(last) && typeof last[1] === "string" ? [last[1]] : [];
  } catch {
    return [];
  }
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
