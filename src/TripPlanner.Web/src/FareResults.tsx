import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router";
import {
  Button,
  Dropdown,
  Field,
  Input,
  Option,
  Text,
  Title3,
} from "@fluentui/react-components";
import {
  getBookingLinks,
  type FareEvaluation,
  type FareItinerary,
  type FareSearchResult,
  type FareSegment,
} from "./operationsApi";
import type { PartySettings, PlanningParty } from "./planningApi";
import {
  deselectFlight,
  getSelectedFlights,
  selectFlight,
  type SelectedFlight,
} from "./selectedFlightsApi";

type FareOption = {
  id: string;
  partyId: string;
  cacheKey: string;
  itineraryIndex: number;
  request: FareSearchResult["request"];
  itinerary: FareItinerary;
  evaluation: FareEvaluation;
};
type Filters = {
  minimumPrice: string;
  maximumPrice: string;
  airlines: string[];
  arrivals: string[];
  stops: string[];
};

const initialFilters: Filters = {
  minimumPrice: "",
  maximumPrice: "",
  airlines: [],
  arrivals: [],
  stops: [],
};

export default function FareResults({
  tripId,
  results,
  parties,
  partySettings,
}: {
  tripId: string;
  results: FareSearchResult[];
  parties: PlanningParty[];
  partySettings: PartySettings[];
}) {
  const [selectedFlights, setSelectedFlights] = useState<SelectedFlight[]>([]);
  const [selectionError, setSelectionError] = useState<string>();
  const [busyParty, setBusyParty] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    void getSelectedFlights(tripId, controller.signal)
      .then((flights) => {
        if (!controller.signal.aborted) setSelectedFlights(flights);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setSelectionError(
            reason instanceof Error
              ? reason.message
              : "Unable to load selected flights.",
          );
      });
    return () => controller.abort();
  }, [tripId]);
  async function changeSelection(option: FareOption, selected: boolean) {
    setBusyParty(option.partyId);
    setSelectionError(undefined);
    try {
      if (selected) {
        await deselectFlight(tripId, option.partyId);
        setSelectedFlights((flights) =>
          flights.filter((flight) => flight.partyId !== option.partyId),
        );
      } else {
        const saved = await selectFlight(
          tripId,
          option.partyId,
          option.cacheKey,
          option.itineraryIndex,
        );
        setSelectedFlights((flights) => [
          ...flights.filter((flight) => flight.partyId !== option.partyId),
          saved,
        ]);
      }
    } catch (reason) {
      setSelectionError(
        reason instanceof Error
          ? reason.message
          : "Unable to change the selected flight.",
      );
    } finally {
      setBusyParty(undefined);
    }
  }
  const [searchParams, setSearchParams] = useSearchParams();
  const filters: Filters = {
    minimumPrice: searchParams.get("minPrice") ?? "",
    maximumPrice: searchParams.get("maxPrice") ?? "",
    airlines: searchParams.getAll("airline"),
    arrivals: searchParams.getAll("arrival"),
    stops: searchParams.getAll("stops"),
  };
  function setFilters(next: Filters) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        for (const key of [
          "minPrice",
          "maxPrice",
          "airline",
          "arrival",
          "stops",
        ])
          params.delete(key);
        if (next.minimumPrice) params.set("minPrice", next.minimumPrice);
        if (next.maximumPrice) params.set("maxPrice", next.maximumPrice);
        for (const airline of next.airlines) params.append("airline", airline);
        for (const arrival of next.arrivals) params.append("arrival", arrival);
        for (const stops of next.stops) params.append("stops", stops);
        return params;
      },
      { replace: true },
    );
  }
  const options = useMemo(
    () =>
      results.flatMap((result) =>
        result.response.itineraries.map((itinerary, index) => ({
          id: `${result.partyId}-${result.cacheKey}-${index}`,
          partyId: result.partyId,
          cacheKey: result.cacheKey,
          itineraryIndex: index,
          request: result.request,
          itinerary,
          evaluation: result.evaluations?.[index] ?? {
            status: "Unverifiable" as const,
            issues: [
              {
                code: "missingData",
                message:
                  "This fare has not been checked against trip requirements.",
                constraintIds: [],
              },
            ],
          },
        })),
      ),
    [results],
  );
  const airlines = useMemo(
    () => [...new Set(options.flatMap(airlinesFor))].filter(Boolean).sort(),
    [options],
  );
  const prices = options
    .flatMap((option) => option.itinerary.price?.amount ?? [])
    .filter(Number.isFinite);
  const priceMinimum = prices.length ? Math.min(...prices) : 0;
  const priceMaximum = prices.length ? Math.max(...prices) : 0;
  const selectedMinimum = Math.max(
    priceMinimum,
    Math.min(priceMaximum, number(filters.minimumPrice) ?? priceMinimum),
  );
  const selectedMaximum = Math.max(
    priceMinimum,
    Math.min(priceMaximum, number(filters.maximumPrice) ?? priceMaximum),
  );
  const priceSpan = priceMaximum - priceMinimum || 1;
  const rangeStyle = {
    "--range-start": `${((selectedMinimum - priceMinimum) / priceSpan) * 100}%`,
    "--range-end": `${((selectedMaximum - priceMinimum) / priceSpan) * 100}%`,
  } as CSSProperties;
  const matching = options.filter((option) => matches(option, filters));

  return (
    <section className="fare-results" aria-label="Flight options">
      <Title3 as="h2">Flight options</Title3>
      <Text>
        Only flights that pass the trip's required checks appear as suggestions.
        Prices and airline preferences determine the current highlights.
      </Text>
      {selectionError && <Text role="alert">{selectionError}</Text>}
      <div className="fare-filters" aria-label="Filter flight options">
        <div className="fare-filters-heading">
          <Text weight="semibold">Filter options</Text>
          <Button
            appearance="subtle"
            onClick={() => setFilters(initialFilters)}
          >
            Clear filters
          </Button>
        </div>
        <div className="fare-filter-grid">
          <fieldset className="price-range-filter">
            <legend>Price range</legend>
            <div className="price-range-sliders" style={rangeStyle}>
              <input
                aria-label="Minimum price slider"
                type="range"
                min={priceMinimum}
                max={priceMaximum}
                value={selectedMinimum}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    minimumPrice: String(
                      Math.min(Number(event.target.value), selectedMaximum),
                    ),
                  })
                }
              />
              <input
                aria-label="Maximum price slider"
                type="range"
                min={priceMinimum}
                max={priceMaximum}
                value={selectedMaximum}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    maximumPrice: String(
                      Math.max(Number(event.target.value), selectedMinimum),
                    ),
                  })
                }
              />
            </div>
            <div className="price-range-inputs">
              <Field label="Minimum">
                <Input
                  aria-label="Minimum price"
                  type="number"
                  min={0}
                  value={filters.minimumPrice}
                  onChange={(_, data) =>
                    setFilters({ ...filters, minimumPrice: data.value })
                  }
                />
              </Field>
              <Field label="Maximum">
                <Input
                  aria-label="Maximum price"
                  type="number"
                  min={0}
                  value={filters.maximumPrice}
                  onChange={(_, data) =>
                    setFilters({ ...filters, maximumPrice: data.value })
                  }
                />
              </Field>
            </div>
          </fieldset>
          <Field label="Airline">
            <Dropdown
              multiselect
              placeholder="Any airline"
              selectedOptions={filters.airlines}
              onOptionSelect={(_, data) =>
                setFilters({ ...filters, airlines: data.selectedOptions })
              }
            >
              {airlines.map((airline) => (
                <Option key={airline} value={airline}>
                  {airline}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label="Arrival time">
            <Dropdown
              multiselect
              placeholder="Any time"
              selectedOptions={filters.arrivals}
              onOptionSelect={(_, data) =>
                setFilters({ ...filters, arrivals: data.selectedOptions })
              }
            >
              <Option value="morning">Before noon</Option>
              <Option value="afternoon">Noon–6 PM</Option>
              <Option value="evening">After 6 PM</Option>
            </Dropdown>
          </Field>
          <Field label="Stops">
            <Dropdown
              multiselect
              placeholder="Any number"
              selectedOptions={filters.stops}
              onOptionSelect={(_, data) =>
                setFilters({ ...filters, stops: data.selectedOptions })
              }
            >
              <Option value="0">Nonstop</Option>
              <Option value="1">1 stop</Option>
              <Option value="2">2 stops</Option>
            </Dropdown>
          </Field>
        </div>
      </div>
      {parties.map((party) => {
        const partyOptions = matching.filter(
          (option) => option.partyId === party.id,
        );
        const eligible = partyOptions.filter(
          (option) => option.evaluation.status === "Eligible",
        );
        const excluded = partyOptions.filter(
          (option) => option.evaluation.status !== "Eligible",
        );
        const preferences =
          partySettings.find((settings) => settings.partyId === party.id)
            ?.preferredAirlines ?? [];
        return (
          <PartyResults
            key={party.id}
            party={party}
            options={eligible}
            excluded={excluded}
            preferredAirlines={preferences}
            tripId={tripId}
            selectedFlight={selectedFlights.find(
              (flight) => flight.partyId === party.id,
            )}
            selectionBusy={busyParty === party.id}
            onChangeSelection={changeSelection}
          />
        );
      })}
    </section>
  );
}

function PartyResults({
  party,
  options,
  excluded,
  preferredAirlines,
  tripId,
  selectedFlight,
  selectionBusy,
  onChangeSelection,
}: {
  party: PlanningParty;
  options: FareOption[];
  excluded: FareOption[];
  preferredAirlines: string[];
  tripId: string;
  selectedFlight?: SelectedFlight;
  selectionBusy: boolean;
  onChangeSelection: (option: FareOption, selected: boolean) => Promise<void>;
}) {
  const cheapest = cheapestOption(options);
  const preferred = preferredAirlines.length
    ? cheapestOption(
        options.filter((option) =>
          usesPreferredAirline(option, preferredAirlines),
        ),
      )
    : undefined;
  const nonstop = cheapestOption(
    options.filter((option) => stops(option) === 0),
  );
  const highlightIds = new Set(
    [cheapest, preferred, nonstop]
      .filter((option): option is FareOption => !!option)
      .map((option) => option.id),
  );
  const remainder = options
    .filter((option) => !highlightIds.has(option.id))
    .sort((left, right) => {
      const preferenceDifference =
        Number(usesPreferredAirline(right, preferredAirlines)) -
        Number(usesPreferredAirline(left, preferredAirlines));
      return (
        preferenceDifference ||
        (left.itinerary.price?.amount ?? Infinity) -
          (right.itinerary.price?.amount ?? Infinity)
      );
    });

  return (
    <section
      className="party-fare-results"
      aria-label={`Options for ${party.members.map((member) => member.name).join(", ")}`}
    >
      <Title3 as="h3">
        {party.members.map((member) => member.name).join(", ") ||
          "Travel party"}
      </Title3>
      {options.length === 0 && (
        <Text>
          {excluded.length > 0
            ? "No flights can be recommended under the current requirements. Review the excluded options below."
            : "No flights match these filters."}
        </Text>
      )}
      {cheapest && (
        <HighlightedFare
          title="Cheapest overall"
          option={cheapest}
          tripId={tripId}
          selectedFlight={selectedFlight}
          selectionBusy={selectionBusy}
          onChangeSelection={onChangeSelection}
        />
      )}
      {preferred && (
        <HighlightedFare
          title="Cheapest preferred airline"
          option={preferred}
          tripId={tripId}
          selectedFlight={selectedFlight}
          selectionBusy={selectionBusy}
          onChangeSelection={onChangeSelection}
          detail={differenceFromCheapest(preferred, cheapest!)}
        />
      )}
      {nonstop && (
        <HighlightedFare
          title="Cheapest nonstop flight"
          option={nonstop}
          tripId={tripId}
          selectedFlight={selectedFlight}
          selectionBusy={selectionBusy}
          onChangeSelection={onChangeSelection}
        />
      )}
      {remainder.length > 0 && (
        <details className="remaining-fares">
          <summary>More matching options ({remainder.length})</summary>
          <div className="remaining-fare-list">
            {remainder.map((option) => (
              <FareCard
                key={option.id}
                option={option}
                tripId={tripId}
                selectedFlight={selectedFlight}
                selectionBusy={selectionBusy}
                onChangeSelection={onChangeSelection}
              />
            ))}
          </div>
        </details>
      )}
      {excluded.length > 0 && (
        <details className="remaining-fares excluded-fares">
          <summary>Excluded or unverified options ({excluded.length})</summary>
          <div className="remaining-fare-list">
            {excluded.map((option) => (
              <FareCard
                key={option.id}
                option={option}
                tripId={tripId}
                selectedFlight={selectedFlight}
                selectionBusy={selectionBusy}
                onChangeSelection={onChangeSelection}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function HighlightedFare({
  title,
  option,
  detail,
  tripId,
  selectedFlight,
  selectionBusy,
  onChangeSelection,
}: {
  title: string;
  option: FareOption;
  detail?: string;
  tripId: string;
  selectedFlight?: SelectedFlight;
  selectionBusy: boolean;
  onChangeSelection: (option: FareOption, selected: boolean) => Promise<void>;
}) {
  return (
    <FareCard
      option={option}
      tripId={tripId}
      selectedFlight={selectedFlight}
      selectionBusy={selectionBusy}
      onChangeSelection={onChangeSelection}
      title={title}
      detail={detail}
      highlighted
    />
  );
}

function BookingLink({
  tripId,
  option,
}: {
  tripId: string;
  option: FareOption;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const ignavId = option.itinerary.ignav_id;
  if (!ignavId) return <Text size={200}>Booking link unavailable.</Text>;
  if (url)
    return (
      <a href={url} target="_blank" rel="noreferrer">
        Book this fare
      </a>
    );
  return (
    <>
      <Button
        appearance="primary"
        size="small"
        disabled={loading}
        onClick={() => {
          setLoading(true);
          setError(undefined);
          getBookingLinks(tripId, option.cacheKey, ignavId)
            .then(firstBookingUrl)
            .then((bookingUrl) => {
              if (!bookingUrl)
                throw new Error("No booking link is available for this fare.");
              setUrl(bookingUrl);
            })
            .catch((reason: unknown) =>
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Unable to get a booking link.",
              ),
            )
            .finally(() => setLoading(false));
        }}
      >
        {loading ? "Finding booking link…" : "Book this fare"}
      </Button>
      {error && <Text role="alert">{error}</Text>}
    </>
  );
}

function FareCard({
  option,
  tripId,
  title,
  detail,
  highlighted = false,
  selectedFlight,
  selectionBusy,
  onChangeSelection,
}: {
  option: FareOption;
  tripId: string;
  title?: string;
  detail?: string;
  highlighted?: boolean;
  selectedFlight?: SelectedFlight;
  selectionBusy: boolean;
  onChangeSelection: (option: FareOption, selected: boolean) => Promise<void>;
}) {
  const isSelected = selectedFlight && sameItinerary(selectedFlight, option);
  return (
    <article
      className={`${highlighted ? "fare-card highlighted-fare" : "fare-card"}${isSelected ? " selected-fare" : ""}`}
    >
      {isSelected && <Text weight="semibold">Selected for this trip</Text>}
      {title && (
        <Text className="fare-card-category" weight="semibold" size={200}>
          {title}
        </Text>
      )}
      <div className="fare-card-heading">
        <div className="fare-card-route">
          <strong>{`${option.request.origin} → ${option.request.destination}`}</strong>
          <Text
            size={200}
          >{`${option.request.departure_date} → ${option.request.return_date}`}</Text>
        </div>
        <Text className="fare-card-price" weight="semibold">
          {formatPrice(option)}
        </Text>
      </div>
      <dl className="fare-detail-grid">
        <div>
          <dt>Departure time</dt>
          <dd>
            {formatLocalTime(
              option.itinerary.outbound?.segments.at(0)?.departure_time_local,
            )}
          </dd>
        </div>
        <div>
          <dt>Flight numbers</dt>
          <dd>{flightNumbers(option)}</dd>
        </div>
        <div>
          <dt>Total travel time</dt>
          <dd>
            <TravelTime option={option} />
          </dd>
        </div>
        <div>
          <dt>Stops</dt>
          <dd>{stopLabel(stops(option))}</dd>
        </div>
        <div>
          <dt>Outbound airline</dt>
          <dd>{option.itinerary.outbound?.carrier ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Return airline</dt>
          <dd>{option.itinerary.inbound?.carrier ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Arrive home</dt>
          <dd>
            {formatTime(
              option.itinerary.inbound?.segments.at(-1)?.arrival_time_local,
            )}
          </dd>
        </div>
      </dl>
      <div
        className={
          option.evaluation.status === "Eligible"
            ? "fare-card-footer"
            : "fare-card-footer fare-card-rejected-footer"
        }
      >
        {detail && <Text size={200}>{detail}</Text>}
        {option.evaluation.status === "Eligible" ? (
          <>
            <Button
              size="small"
              disabled={selectionBusy}
              onClick={() =>
                void onChangeSelection(option, Boolean(isSelected))
              }
            >
              {isSelected
                ? "Deselect flight"
                : selectedFlight
                  ? "Change to this flight"
                  : "Select flight"}
            </Button>
            <BookingLink tripId={tripId} option={option} />
          </>
        ) : (
          <div className="fare-validation-issues">
            <Text weight="semibold">
              {option.evaluation.status === "Rejected"
                ? "Does not meet requirements"
                : "Could not verify requirements"}
            </Text>
            <ul>
              {option.evaluation.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

function sameItinerary(selected: SelectedFlight, option: FareOption): boolean {
  if (selected.cacheKey !== option.cacheKey) return false;
  if (selected.itinerary.ignav_id && option.itinerary.ignav_id)
    return selected.itinerary.ignav_id === option.itinerary.ignav_id;
  if (selected.itineraryIndex !== option.itineraryIndex) return false;
  const route = (itinerary: FareItinerary) =>
    [itinerary.outbound, itinerary.inbound]
      .flatMap((leg) => leg?.segments ?? [])
      .map((segment) =>
        [
          segment.departure_airport,
          segment.arrival_airport,
          segment.departure_time_local,
          segment.arrival_time_local,
          segment.flight_number,
        ].join("|"),
      )
      .join(";");
  return route(selected.itinerary) === route(option.itinerary);
}

function TravelTime({ option }: { option: FareOption }) {
  const directions = [
    ["Outbound", option.itinerary.outbound],
    ["Return", option.itinerary.inbound],
  ] as const;
  return (
    <>
      {directions.map(([name, direction]) =>
        direction?.duration_minutes === undefined ? null : (
          <div key={name}>
            {`${name}: ${formatDuration(direction.duration_minutes)}`}
            {layovers(direction.segments).length > 0 && (
              <Text as="span" size={200} className="layover-detail">
                {` (${layovers(direction.segments).join(", ")})`}
              </Text>
            )}
          </div>
        ),
      )}
    </>
  );
}

function matches(option: FareOption, filters: Filters) {
  const price = option.itinerary.price?.amount;
  const minimum = number(filters.minimumPrice);
  const maximum = number(filters.maximumPrice);
  if (minimum !== undefined && (price === undefined || price < minimum))
    return false;
  if (maximum !== undefined && (price === undefined || price > maximum))
    return false;
  if (
    filters.airlines.length > 0 &&
    !filters.airlines.some((airline) => airlinesFor(option).includes(airline))
  )
    return false;
  if (
    filters.stops.length > 0 &&
    !filters.stops.includes(String(stops(option)))
  )
    return false;
  if (
    filters.arrivals.length > 0 &&
    !filters.arrivals.includes(arrivalPeriod(option))
  )
    return false;
  return true;
}

function cheapestOption(options: FareOption[]) {
  return [...options]
    .filter((option) => option.itinerary.price !== undefined)
    .sort(
      (left, right) =>
        left.itinerary.price!.amount - right.itinerary.price!.amount,
    )[0];
}

function airlinesFor(option: FareOption) {
  return [
    option.itinerary.outbound?.carrier,
    option.itinerary.inbound?.carrier,
  ].filter((carrier): carrier is string => !!carrier);
}

function usesPreferredAirline(option: FareOption, preferredAirlines: string[]) {
  const preferred = new Set(
    preferredAirlines.map((airline) => airline.toUpperCase()),
  );
  return [option.itinerary.outbound, option.itinerary.inbound].some(
    (direction) =>
      direction?.segments.some((segment) =>
        preferred.has(segment.marketing_carrier_code?.toUpperCase() ?? ""),
      ),
  );
}

function stops(option: FareOption) {
  return Math.max(
    Math.max(0, (option.itinerary.outbound?.segments.length ?? 1) - 1),
    Math.max(0, (option.itinerary.inbound?.segments.length ?? 1) - 1),
  );
}

function arrivalPeriod(option: FareOption) {
  const time = option.itinerary.inbound?.segments.at(-1)?.arrival_time_local;
  const hour = time ? Number(time.slice(11, 13)) : Number.NaN;
  if (!Number.isFinite(hour)) return "";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function differenceFromCheapest(option: FareOption, cheapest: FareOption) {
  const price = option.itinerary.price;
  const baseline = cheapest.itinerary.price;
  if (!price || !baseline || price.currency !== baseline.currency)
    return undefined;
  const difference = price.amount - baseline.amount;
  return difference === 0
    ? "Same price as the cheapest overall option."
    : `${price.currency} ${difference.toLocaleString()} more than the cheapest overall option.`;
}

function formatPrice(option: FareOption) {
  const price = option.itinerary.price;
  if (!price) return "Unavailable";
  return `${price.currency} ${price.amount.toLocaleString()}${price.status === "unverified" ? " (unverified)" : ""}`;
}

function formatLocalTime(value?: string) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatTime(value?: string) {
  return value?.replace("T", " ") ?? "Unavailable";
}

function flightNumbers(option: FareOption) {
  return (
    [option.itinerary.outbound, option.itinerary.inbound]
      .flatMap(
        (direction) =>
          direction?.segments.map((segment) =>
            [segment.marketing_carrier_code, segment.flight_number]
              .filter(Boolean)
              .join(" "),
          ) ?? [],
      )
      .filter(Boolean)
      .join(", ") || "Unavailable"
  );
}

function layovers(segments: FareSegment[]) {
  return segments.slice(0, -1).flatMap((segment, index) => {
    const next = segments[index + 1];
    const start = Date.parse(
      segment.arrival_time_utc ?? segment.arrival_time_local,
    );
    const end = Date.parse(
      next.departure_time_utc ?? next.departure_time_local,
    );
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return [];
    return [
      `${formatDuration(Math.round((end - start) / 60000))} in ${segment.arrival_airport}`,
    ];
  });
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? `${hours} hr${hours === 1 ? "" : "s"}`
    : `${hours} hr ${remainder} min`;
}

function firstBookingUrl(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const options = (response as { booking_options?: unknown }).booking_options;
  if (!Array.isArray(options)) return undefined;
  for (const option of options) {
    if (!option || typeof option !== "object") continue;
    const links = (option as { links?: unknown }).links;
    if (!Array.isArray(links)) continue;
    for (const link of links) {
      const url =
        link && typeof link === "object"
          ? (link as { url?: unknown }).url
          : undefined;
      if (typeof url === "string" && /^https:\/\//.test(url)) return url;
    }
  }
  return undefined;
}

function stopLabel(count: number) {
  return count === 0 ? "Nonstop" : `${count} stop${count === 1 ? "" : "s"}`;
}

function number(value: string) {
  return value === "" ? undefined : Number(value);
}
