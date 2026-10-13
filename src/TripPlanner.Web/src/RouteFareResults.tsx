import { Fragment, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Divider,
  Text,
  Title3,
} from "@fluentui/react-components";
import FlightInformation from "./FlightInformation";
import FlightLegTabs from "./FlightLegTabs";
import {
  airportLabel,
  legKey,
  legRoute,
  sameItineraryFlights,
  priceLabel,
  stayNights,
  type AirportCities,
} from "./flightFormatting";
import { flightAirportCodes, useAirportCities } from "./airportCities";
import {
  getBookingLinks,
  type FareItinerary,
  type FareLeg,
  type FareSearchResult,
} from "./operationsApi";
import {
  deselectFlight,
  getSelectedFlights,
  selectFlight,
  setFlightPurchases,
  type SelectedFlight,
} from "./selectedFlightsApi";
import type { PartySettings, PlanningParty } from "./planningApi";

type IndexedItinerary = { index: number; itinerary: FareItinerary };
const emptyChoices: string[] = [];
type LegChoice = {
  key: string;
  leg: FareLeg;
  representative: IndexedItinerary;
};

function legName(leg: FareLeg, index: number, cities: AirportCities): string {
  const first = leg.segments[0];
  const last = leg.segments.at(-1);
  if (!first || !last) return `Flight ${index + 1}`;
  return `${airportLabel(first.departure_airport, cities)} → ${airportLabel(last.arrival_airport, cities)}`;
}

export function JourneyLegs({
  legs,
  booking,
  itinerary,
  cities = {},
  purchasedLegs,
  onPurchaseChange,
  purchaseBusy = false,
  cheapestRoute = false,
  preferredAirlines = [],
}: {
  legs: FareLeg[];
  booking?: { tripId: string; cacheKey: string; itinerary: FareItinerary };
  itinerary?: FareItinerary;
  cities?: AirportCities;
  purchasedLegs?: boolean[];
  onPurchaseChange?: (index: number, purchased: boolean) => void;
  purchaseBusy?: boolean;
  cheapestRoute?: boolean;
  preferredAirlines?: string[];
}) {
  return (
    <div className="journey-legs">
      {legs.map((leg, index) => {
        const nights = index > 0 ? stayNights(legs[index - 1], leg) : null;
        const fare = itinerary ?? booking?.itinerary;
        const legBooking = fare?.bookingOffers?.find((offer) =>
          offer.legIndexes.includes(index),
        );
        return (
          <Fragment key={index}>
            {index > 0 && (
              <Divider>
                {nights == null
                  ? "Stay between flights"
                  : `${nights} night stay`}
              </Divider>
            )}
            <FlightInformation
              leg={leg}
              cities={cities}
              preferredAirlines={preferredAirlines}
              badge={
                cheapestRoute
                  ? "This flight is on the cheapest route"
                  : undefined
              }
              price={legBooking?.price ?? fare?.price}
              priceContext={
                legBooking?.price
                  ? legBooking.legIndexes.length > 1
                    ? "Paired fare"
                    : undefined
                  : fare?.price
                    ? "Trip total"
                    : undefined
              }
              purchased={
                purchasedLegs?.[index] ?? (purchasedLegs ? false : undefined)
              }
              onPurchasedChange={
                onPurchaseChange
                  ? (value) => onPurchaseChange(index, value)
                  : undefined
              }
              purchaseBusy={purchaseBusy}
              actions={
                booking && (
                  <RouteBookingLinks
                    tripId={booking.tripId}
                    cacheKey={booking.cacheKey}
                    itinerary={booking.itinerary}
                    legIndex={index}
                  />
                )
              }
            />
          </Fragment>
        );
      })}
    </div>
  );
}

export default function RouteFareResults({
  tripId,
  results,
  parties,
  partySettings = [],
  savedChoices = {},
  onChangeChoices,
}: {
  tripId: string;
  results: FareSearchResult[];
  parties: PlanningParty[];
  partySettings?: PartySettings[];
  savedChoices?: Record<string, string[]>;
  onChangeChoices?: (partyId: string, keys: string[]) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<SelectedFlight[]>([]);
  const selectionMutation = useRef(0);
  const [busyParty, setBusyParty] = useState<string>();
  const [error, setError] = useState<string>();
  const cities = useAirportCities(
    flightAirportCodes(
      results.flatMap((result) =>
        result.response.itineraries.flatMap(
          (itinerary) => itinerary.legs ?? [],
        ),
      ),
    ),
  );
  useEffect(() => {
    const controller = new AbortController();
    const version = selectionMutation.current;
    void getSelectedFlights(tripId, controller.signal)
      .then((flights) => {
        if (!controller.signal.aborted && version === selectionMutation.current)
          setSelected(flights);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(String(reason));
      });
    return () => controller.abort();
  }, [tripId]);

  async function choose(result: FareSearchResult, index: number | null) {
    selectionMutation.current += 1;
    setBusyParty(result.partyId);
    setError(undefined);
    try {
      if (index == null) {
        await deselectFlight(tripId, result.partyId);
        setSelected((flights) =>
          flights.filter((flight) => flight.partyId !== result.partyId),
        );
      } else {
        const saved = await selectFlight(
          tripId,
          result.partyId,
          result.cacheKey,
          index,
          result.response.itineraries[index],
        );
        setSelected((flights) => [
          ...flights.filter((flight) => flight.partyId !== result.partyId),
          saved,
        ]);
      }
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save itinerary.",
      );
      return false;
    } finally {
      setBusyParty(undefined);
    }
  }

  async function changePurchase(
    result: FareSearchResult,
    legIndex: number,
    purchased: boolean,
  ) {
    const current = selected.find(
      (flight) => flight.partyId === result.partyId,
    );
    if (!current) return;
    const count = current.itinerary.legs?.length ?? 0;
    const statuses = Array.from(
      { length: count },
      (_, index) => current.purchasedLegs?.[index] ?? false,
    );
    statuses[legIndex] = purchased;
    setBusyParty(result.partyId);
    setError(undefined);
    try {
      const saved = await setFlightPurchases(
        tripId,
        current.partyId,
        current.cacheKey,
        current.itineraryIndex,
        statuses,
      );
      setSelected((flights) => [
        ...flights.filter((flight) => flight.partyId !== current.partyId),
        saved,
      ]);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save purchase status.",
      );
    } finally {
      setBusyParty(undefined);
    }
  }

  return (
    <div className="route-visits">
      <Text>
        Choose one flight at a time. Every option shown can still complete a
        route that fits your required stays. The price shown is for the complete
        route, not for the individual flight.
      </Text>
      {error && <Text role="alert">{error}</Text>}
      {results.map((result) => (
        <RoutePartyResults
          key={`${result.partyId}:${result.cacheKey}`}
          tripId={tripId}
          result={result}
          savedChoices={savedChoices[result.partyId] ?? emptyChoices}
          onChangeChoices={onChangeChoices}
          partyName={
            parties
              .find((party) => party.id === result.partyId)
              ?.members.map((member) => member.name)
              .join(", ") || "Travel party"
          }
          selected={selected.find(
            (flight) => flight.partyId === result.partyId,
          )}
          cities={cities}
          preferredAirlines={
            partySettings.find(
              (settings) => settings.partyId === result.partyId,
            )?.preferredAirlines ?? []
          }
          busy={busyParty === result.partyId}
          onChoose={(index) => choose(result, index)}
          onPurchaseChange={(index, purchased) =>
            changePurchase(result, index, purchased)
          }
        />
      ))}
    </div>
  );
}

function RoutePartyResults({
  tripId,
  result,
  savedChoices,
  onChangeChoices,
  partyName,
  selected,
  cities,
  preferredAirlines,
  busy,
  onChoose,
  onPurchaseChange,
}: {
  tripId: string;
  result: FareSearchResult;
  savedChoices: string[];
  onChangeChoices?: (partyId: string, keys: string[]) => Promise<boolean>;
  partyName: string;
  selected?: SelectedFlight;
  cities: AirportCities;
  preferredAirlines: string[];
  busy: boolean;
  onChoose: (index: number | null) => Promise<boolean>;
  onPurchaseChange: (index: number, purchased: boolean) => Promise<void>;
}) {
  const [localChosen, setLocalChosen] = useState<string[]>(savedChoices);
  const chosen = onChangeChoices ? savedChoices : localChosen;
  const [choiceBusy, setChoiceBusy] = useState(false);
  const [choiceError, setChoiceError] = useState<string>();
  async function changeChosen(keys: string[]) {
    if (!onChangeChoices) {
      setLocalChosen(keys);
      return;
    }
    setChoiceBusy(true);
    try {
      const saved = await onChangeChoices(result.partyId, keys);
      setChoiceError(
        saved ? undefined : "Could not save this flight. Please try again.",
      );
    } catch (reason) {
      setChoiceError(
        reason instanceof Error
          ? reason.message
          : "Could not save this flight. Please try again.",
      );
    } finally {
      setChoiceBusy(false);
    }
  }
  async function restartChoices() {
    setChoiceBusy(true);
    setChoiceError(undefined);
    try {
      if (!(await onChoose(null))) return;
      if (onChangeChoices) {
        const cleared = await onChangeChoices(result.partyId, []);
        if (!cleared) throw new Error("Could not restart flight choices.");
      } else {
        setLocalChosen([]);
      }
    } catch (reason) {
      setChoiceError(
        reason instanceof Error
          ? reason.message
          : "Could not restart flight choices.",
      );
    } finally {
      setChoiceBusy(false);
    }
  }
  const options = result.response.itineraries
    .map((itinerary, index) => ({ itinerary, index }))
    .filter((item) => item.itinerary.legs?.length);
  const matches = options.filter(({ itinerary }) =>
    chosen.every((key, index) => legKey(itinerary.legs?.[index]) === key),
  );
  const step = chosen.length;
  const legCount = options[0]?.itinerary.legs?.length ?? 0;
  const complete = step === legCount && legCount > 0;
  const choices = (() => {
    const byLeg = new Map<string, LegChoice>();
    if (complete) return [];
    for (const candidate of matches) {
      const leg = candidate.itinerary.legs?.[step];
      if (!leg) continue;
      const key = legKey(leg);
      if (!byLeg.has(key))
        byLeg.set(key, { key, leg, representative: candidate });
    }
    return [...byLeg.values()];
  })();
  const best = complete ? matches[0] : undefined;
  const bestIsSelected = Boolean(
    selected &&
    best &&
    sameItineraryFlights(selected.itinerary, best.itinerary),
  );
  const tabRoutes = Array.from({ length: legCount }, (_, index) => {
    const leg =
      index < chosen.length
        ? options.find(
            (option) =>
              legKey(option.itinerary.legs?.[index]) === chosen[index],
          )?.itinerary.legs?.[index]
        : matches[0]?.itinerary.legs?.[index];
    return legRoute(leg);
  });
  const cheapestRoute = options
    .filter((option) => Number.isFinite(option.itinerary.price?.amount))
    .sort((left, right) => {
      const leftPrice = left.itinerary.price!;
      const rightPrice = right.itinerary.price!;
      return (
        leftPrice.currency.localeCompare(rightPrice.currency) ||
        leftPrice.amount - rightPrice.amount
      );
    })[0];
  return (
    <section
      className="route-visits"
      aria-label={`${partyName} flight choices`}
    >
      <Title3 as="h3">{partyName}</Title3>
      <FlightLegTabs
        legCount={legCount}
        step={step}
        label={partyName}
        routes={tabRoutes}
        busy={choiceBusy}
        onRevisit={(index) => void changeChosen(chosen.slice(0, index))}
      />
      {choiceError && <Text role="alert">{choiceError}</Text>}
      {choiceBusy && <Text role="status">Saving flight choice…</Text>}
      {selected && (
        <div className="route-saved-choice">
          <Text weight="semibold">
            Selected itinerary · {priceLabel(selected.itinerary.price)}
          </Text>
          <Text size={200}>
            You can build another route below and save it to replace this
            choice.
          </Text>
        </div>
      )}
      {options.length === 0 && (
        <Text role="status">No complete routes are available yet.</Text>
      )}
      {options.length > 0 && matches.length === 0 && (
        <Text role="status">
          No complete route remains with these flight choices. Change an earlier
          flight.
        </Text>
      )}
      {!complete && matches.length > 0 && (
        <>
          <Title3 as="h4">
            Choose{" "}
            {choices[0] ? legName(choices[0].leg, step, cities) : "a flight"}
          </Title3>
          {step === legCount - 1 && (
            <Text size={200}>
              All compatible return airlines are shown below. An earlier flight
              or paired fare can limit the available returns; use an earlier
              flight tab to change it.
            </Text>
          )}
          {choices
            .slice(0, step === legCount - 1 ? choices.length : 3)
            .map(renderChoice)}
          {step !== legCount - 1 && choices.length > 3 && (
            <details>
              <summary>More flight options ({choices.length - 3})</summary>
              {choices.slice(3).map(renderChoice)}
            </details>
          )}
        </>
      )}
      {best && (
        <Card className="route-result" aria-label="Completed itinerary">
          <Title3 as="h4">Your route is ready</Title3>
          <Text>
            Complete trip from {priceLabel(best.itinerary.price)} ·{" "}
            {best.itinerary.stops ?? 0} total stops ·{" "}
            {best.itinerary.bookingOffers?.length ?? 0} booking offer(s)
          </Text>
          <Text size={200}>
            The booking price and available seats can change. Each airline
            booking option is shown with the flight it covers.
          </Text>
          <JourneyLegs
            legs={best.itinerary.legs ?? []}
            itinerary={best.itinerary}
            cities={cities}
            preferredAirlines={preferredAirlines}
            booking={{
              tripId,
              cacheKey: result.cacheKey,
              itinerary: best.itinerary,
            }}
            purchasedLegs={
              bestIsSelected ? (selected?.purchasedLegs ?? []) : undefined
            }
            onPurchaseChange={
              bestIsSelected
                ? (index, purchased) => void onPurchaseChange(index, purchased)
                : undefined
            }
            purchaseBusy={busy}
            cheapestRoute={best.index === cheapestRoute?.index}
          />
          <div className="route-result-actions">
            <Button
              appearance="primary"
              disabled={busy || bestIsSelected}
              onClick={() => void onChoose(best.index)}
            >
              {bestIsSelected
                ? "Itinerary selected"
                : "Save complete itinerary"}
            </Button>
            <Button
              disabled={busy || choiceBusy}
              onClick={() => void restartChoices()}
            >
              {selected ? "Deselect itinerary" : "Start over"}
            </Button>
          </div>
        </Card>
      )}
    </section>
  );

  function renderChoice(choice: LegChoice) {
    const candidate = choice.representative.itinerary;
    return (
      <FlightInformation
        key={choice.key}
        leg={choice.leg}
        cities={cities}
        preferredAirlines={preferredAirlines}
        badge={
          choice.key === legKey(cheapestRoute?.itinerary.legs?.[step])
            ? "This flight is on the cheapest route"
            : undefined
        }
        summary={`Complete trip from ${priceLabel(candidate.price)}. This flight may share a booking with another leg.`}
        price={
          candidate.bookingOffers?.find((offer) =>
            offer.legIndexes.includes(step),
          )?.price ?? candidate.price
        }
        priceContext={
          candidate.bookingOffers?.some(
            (offer) => offer.legIndexes.includes(step) && offer.price,
          )
            ? "Flight fare"
            : "Trip total"
        }
        actions={
          <>
            <Button
              appearance="primary"
              disabled={choiceBusy}
              onClick={() => void changeChosen([...chosen, choice.key])}
            >
              Choose flight {step + 1}
            </Button>
            <RouteBookingLinks
              tripId={tripId}
              cacheKey={result.cacheKey}
              itinerary={candidate}
              legIndex={step}
            />
          </>
        }
      />
    );
  }
}

type BookingOption = {
  leg_indexes?: number[];
  links?: { provider_name?: string; provider_type?: string; url?: string }[];
};

function airlineUrl(raw?: string): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (
    !value ||
    (/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith("https:"))
  )
    return null;
  try {
    const url = new URL(
      value.startsWith("https:")
        ? value
        : value.startsWith("//")
          ? `https:${value}`
          : `https://${value}`,
    );
    return url.protocol === "https:" &&
      url.hostname.includes(".") &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function RouteBookingLinks({
  tripId,
  cacheKey,
  itinerary,
  legIndex,
}: {
  tripId: string;
  cacheKey: string;
  itinerary: FareItinerary;
  legIndex: number;
}) {
  const [links, setLinks] = useState<{ url: string; label: string }[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const offers = (itinerary.bookingOffers ?? []).filter((offer) =>
    offer.legIndexes.includes(legIndex),
  );
  async function load() {
    setBusy(true);
    setError(undefined);
    try {
      const groups = await Promise.all(
        offers.map(async (offer) => {
          const response = (await getBookingLinks(
            tripId,
            cacheKey,
            offer.ignavId,
          )) as { booking_options?: BookingOption[] };
          return (response.booking_options ?? []).flatMap((option) => {
            const covered = (
              option.leg_indexes ?? (offer.legIndexes.length === 1 ? [0] : [])
            )
              .map((index) => offer.legIndexes[index])
              .filter((index): index is number => index != null);
            if (!covered.includes(legIndex)) return [];
            return (option.links ?? []).flatMap((link) => {
              if (link.provider_type !== "airline") return [];
              const url = airlineUrl(link.url);
              return url
                ? [
                    {
                      url,
                      label: `${link.provider_name || "Airline"}${
                        covered.length > 1
                          ? ` · also covers flight${covered.length > 2 ? "s" : ""} ${covered
                              .filter((index) => index !== legIndex)
                              .map((index) => index + 1)
                              .join(", ")}`
                          : ""
                      }`,
                    },
                  ]
                : [];
            });
          });
        }),
      );
      const unique = [
        ...new Map(groups.flat().map((link) => [link.url, link])).values(),
      ];
      setLinks(unique);
      if (!unique.length)
        setError(
          "No airline-direct booking link is available for this flight.",
        );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load airline booking options.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="route-booking-links">
      {links ? (
        links.map((link) => (
          <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
            Book on {link.label}
          </a>
        ))
      ) : (
        <Button
          disabled={busy || offers.length === 0}
          onClick={() => void load()}
        >
          {busy ? "Finding airline links…" : "Airline booking options"}
        </Button>
      )}
      {offers.length === 0 && (
        <Text size={200}>
          No airline booking offer is available for this flight.
        </Text>
      )}
      {error && <Text role="status">{error}</Text>}
    </div>
  );
}
