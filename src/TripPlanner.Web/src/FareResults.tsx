import { useMemo, useState } from "react";
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
  type FareItinerary,
  type FareSearchResult,
  type FareSegment,
} from "./operationsApi";
import type { PartySettings, PlanningParty } from "./planningApi";

type FareOption = {
  id: string;
  partyId: string;
  cacheKey: string;
  request: FareSearchResult["request"];
  itinerary: FareItinerary;
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
  const [filters, setFilters] = useState(initialFilters);
  const options = useMemo(
    () =>
      results.flatMap((result) =>
        result.response.itineraries.map((itinerary, index) => ({
          id: `${result.partyId}-${result.cacheKey}-${index}`,
          partyId: result.partyId,
          cacheKey: result.cacheKey,
          request: result.request,
          itinerary,
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
  const matching = options.filter((option) => matches(option, filters));

  return (
    <section className="fare-results" aria-label="Flight options">
      <Title3 as="h2">Flight options</Title3>
      <Text>
        These highlights are based on price and the preferences you entered.
        Itinerary-level constraint scoring will follow.
      </Text>
      <div className="fare-filters" aria-label="Filter flight options">
        <Field label="Price range" className="price-range-filter">
          <div className="price-range-sliders">
            <input
              aria-label="Minimum price slider"
              type="range"
              min={priceMinimum}
              max={priceMaximum}
              value={filters.minimumPrice || priceMinimum}
              onChange={(event) =>
                setFilters({ ...filters, minimumPrice: event.target.value })
              }
            />
            <input
              aria-label="Maximum price slider"
              type="range"
              min={priceMinimum}
              max={priceMaximum}
              value={filters.maximumPrice || priceMaximum}
              onChange={(event) =>
                setFilters({ ...filters, maximumPrice: event.target.value })
              }
            />
          </div>
          <div className="price-range-inputs">
            <Input
              aria-label="Minimum price"
              type="number"
              min={0}
              value={filters.minimumPrice}
              onChange={(_, data) =>
                setFilters({ ...filters, minimumPrice: data.value })
              }
            />
            <Input
              aria-label="Maximum price"
              type="number"
              min={0}
              value={filters.maximumPrice}
              onChange={(_, data) =>
                setFilters({ ...filters, maximumPrice: data.value })
              }
            />
          </div>
        </Field>
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
        <Button appearance="subtle" onClick={() => setFilters(initialFilters)}>
          Clear filters
        </Button>
      </div>
      {parties.map((party) => {
        const partyOptions = matching.filter(
          (option) => option.partyId === party.id,
        );
        const preferences =
          partySettings.find((settings) => settings.partyId === party.id)
            ?.preferredAirlines ?? [];
        return (
          <PartyResults
            key={party.id}
            party={party}
            options={partyOptions}
            preferredAirlines={preferences}
            tripId={tripId}
          />
        );
      })}
    </section>
  );
}

function PartyResults({
  party,
  options,
  preferredAirlines,
  tripId,
}: {
  party: PlanningParty;
  options: FareOption[];
  preferredAirlines: string[];
  tripId: string;
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
  const remainder = options.filter((option) => !highlightIds.has(option.id));

  return (
    <section
      className="party-fare-results"
      aria-label={`Options for ${party.members.map((member) => member.name).join(", ")}`}
    >
      <Title3 as="h3">
        {party.members.map((member) => member.name).join(", ") ||
          "Travel party"}
      </Title3>
      {options.length === 0 && <Text>No flights match these filters.</Text>}
      {cheapest && (
        <HighlightedFare
          title="Cheapest overall"
          option={cheapest}
          tripId={tripId}
        />
      )}
      {preferred && (
        <HighlightedFare
          title="Cheapest preferred airline"
          option={preferred}
          tripId={tripId}
          detail={differenceFromCheapest(preferred, cheapest!)}
        />
      )}
      {nonstop && (
        <HighlightedFare
          title="Cheapest nonstop flight"
          option={nonstop}
          tripId={tripId}
        />
      )}
      {remainder.length > 0 && (
        <details className="remaining-fares">
          <summary>More matching options ({remainder.length})</summary>
          <FareTable options={remainder} />
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
}: {
  title: string;
  option: FareOption;
  detail?: string;
  tripId: string;
}) {
  return (
    <article className="highlighted-fare">
      <Text weight="semibold">{title}</Text>
      <FareTable options={[option]} />
      {detail && <Text size={200}>{detail}</Text>}
      <BookingLink tripId={tripId} option={option} />
    </article>
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

function FareTable({ options }: { options: FareOption[] }) {
  return (
    <div className="preview-table-scroll">
      <table className="preview-table">
        <thead>
          <tr>
            <th>Dates</th>
            <th>Price</th>
            <th>Departure time</th>
            <th>Flight numbers</th>
            <th>Total travel time</th>
            <th>Outbound airline</th>
            <th>Return airline</th>
            <th>Arrive home</th>
            <th>Stops</th>
          </tr>
        </thead>
        <tbody>
          {options.map((option) => (
            <tr key={option.id}>
              <td>{`${option.request.departure_date} → ${option.request.return_date}`}</td>
              <td>{formatPrice(option)}</td>
              <td>
                {formatLocalTime(
                  option.itinerary.outbound?.segments.at(0)
                    ?.departure_time_local,
                )}
              </td>
              <td>{flightNumbers(option)}</td>
              <td>
                <TravelTime option={option} />
              </td>
              <td>{option.itinerary.outbound?.carrier ?? "Unknown"}</td>
              <td>{option.itinerary.inbound?.carrier ?? "Unknown"}</td>
              <td>
                {formatTime(
                  option.itinerary.inbound?.segments.at(-1)?.arrival_time_local,
                )}
              </td>
              <td>{stopLabel(stops(option))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
