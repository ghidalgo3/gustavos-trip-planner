import { useEffect, useMemo, useState } from "react";
import FlightInformation from "./FlightInformation";
import {
  airportLabel,
  legUsesPreferredAirline,
  priceLabel,
  type AirportCities,
} from "./flightFormatting";
import { flightAirportCodes, useAirportCities } from "./airportCities";
import { Button, Text, Title3 } from "@fluentui/react-components";
import {
  getBookingLinks,
  type FareEvaluation,
  type FareItinerary,
  type FareSearchResult,
  type FareLeg,
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
  const cities = useAirportCities(
    flightAirportCodes(
      options.flatMap((option) =>
        [option.itinerary.outbound, option.itinerary.inbound].filter(
          (leg): leg is FareLeg => Boolean(leg),
        ),
      ),
    ),
  );
  return (
    <section className="fare-results" aria-label="Flight options">
      <Title3 as="h2">Flight options</Title3>
      <Text>
        Only flights that pass the trip's required checks appear as suggestions.
        Prices and airline preferences determine the current highlights.
      </Text>
      {selectionError && <Text role="alert">{selectionError}</Text>}
      {parties.map((party) => {
        const partyOptions = options.filter(
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
            preferredAirport={
              partySettings.find((settings) => settings.partyId === party.id)
                ?.preferredAirport
            }
            tripId={tripId}
            cities={cities}
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
  preferredAirport,
  tripId,
  cities,
  selectedFlight,
  selectionBusy,
  onChangeSelection,
}: {
  party: PlanningParty;
  options: FareOption[];
  excluded: FareOption[];
  preferredAirlines: string[];
  preferredAirport?: string | null;
  tripId: string;
  cities: AirportCities;
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
        Number(right.request.origin === preferredAirport) -
          Number(left.request.origin === preferredAirport) ||
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
            : "No flight options are available yet."}
        </Text>
      )}
      {cheapest && (
        <HighlightedFare
          title="Cheapest overall"
          option={cheapest}
          tripId={tripId}
          cities={cities}
          preferredAirlines={preferredAirlines}
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
          cities={cities}
          preferredAirlines={preferredAirlines}
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
          cities={cities}
          preferredAirlines={preferredAirlines}
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
                cities={cities}
                preferredAirlines={preferredAirlines}
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
                cities={cities}
                preferredAirlines={preferredAirlines}
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
  cities,
  preferredAirlines,
  selectedFlight,
  selectionBusy,
  onChangeSelection,
}: {
  title: string;
  option: FareOption;
  detail?: string;
  tripId: string;
  cities: AirportCities;
  preferredAirlines: string[];
  selectedFlight?: SelectedFlight;
  selectionBusy: boolean;
  onChangeSelection: (option: FareOption, selected: boolean) => Promise<void>;
}) {
  return (
    <FareCard
      option={option}
      tripId={tripId}
      cities={cities}
      preferredAirlines={preferredAirlines}
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
  cities,
  preferredAirlines,
  title,
  detail,
  highlighted = false,
  selectedFlight,
  selectionBusy,
  onChangeSelection,
}: {
  option: FareOption;
  tripId: string;
  cities: AirportCities;
  preferredAirlines: string[];
  title?: string;
  detail?: string;
  highlighted?: boolean;
  selectedFlight?: SelectedFlight;
  selectionBusy: boolean;
  onChangeSelection: (option: FareOption, selected: boolean) => Promise<void>;
}) {
  const isSelected = selectedFlight && sameItinerary(selectedFlight, option);
  const outbound = option.itinerary.outbound;
  const inbound = option.itinerary.inbound;
  const origin =
    outbound?.segments[0]?.departure_airport ?? option.request.origin;
  const destination =
    outbound?.segments.at(-1)?.arrival_airport ?? option.request.destination;
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
          <strong>{`${airportLabel(origin, cities)} → ${airportLabel(destination, cities)}`}</strong>
          <Text
            size={200}
          >{`${option.request.departure_date} → ${option.request.return_date}`}</Text>
        </div>
        <Text className="fare-card-price" weight="semibold">
          {formatPrice(option)}
        </Text>
      </div>
      <div className="round-trip-flight-legs">
        {outbound && (
          <FlightInformation
            leg={outbound}
            cities={cities}
            preferredAirlines={preferredAirlines}
            price={option.itinerary.price}
            priceContext="Round-trip total"
            timeOnly
          />
        )}
        {inbound && (
          <FlightInformation
            leg={inbound}
            cities={cities}
            preferredAirlines={preferredAirlines}
            price={option.itinerary.price}
            priceContext="Round-trip total"
            timeOnly
          />
        )}
      </div>
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

function cheapestOption(options: FareOption[]) {
  return [...options]
    .filter((option) => option.itinerary.price !== undefined)
    .sort(
      (left, right) =>
        left.itinerary.price!.amount - right.itinerary.price!.amount,
    )[0];
}

function usesPreferredAirline(option: FareOption, preferredAirlines: string[]) {
  return [option.itinerary.outbound, option.itinerary.inbound].some(
    (direction) =>
      direction && legUsesPreferredAirline(direction, preferredAirlines),
  );
}

function stops(option: FareOption) {
  return Math.max(
    Math.max(0, (option.itinerary.outbound?.segments.length ?? 1) - 1),
    Math.max(0, (option.itinerary.inbound?.segments.length ?? 1) - 1),
  );
}

function differenceFromCheapest(option: FareOption, cheapest: FareOption) {
  const price = option.itinerary.price;
  const baseline = cheapest.itinerary.price;
  if (!price || !baseline || price.currency !== baseline.currency)
    return undefined;
  const difference = price.amount - baseline.amount;
  return difference === 0
    ? "Same price as the cheapest overall option."
    : `${priceLabel({ amount: difference, currency: price.currency })} more than the cheapest overall option.`;
}

function formatPrice(option: FareOption) {
  const price = option.itinerary.price;
  if (!price) return "Unavailable";
  return `${priceLabel(price)}${price.status === "unverified" ? " (unverified)" : ""}`;
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
