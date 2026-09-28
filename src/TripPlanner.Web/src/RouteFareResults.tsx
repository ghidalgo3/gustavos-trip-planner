import { Fragment, useEffect, useState } from "react";
import {
  Button,
  Card,
  Divider,
  Field,
  Input,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Select,
  Text,
  Title3,
} from "@fluentui/react-components";
import { useSearchParams } from "react-router";
import FlightInformation from "./FlightInformation";
import {
  airportLabel,
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
import type { PlanningParty } from "./planningApi";

type IndexedItinerary = { index: number; itinerary: FareItinerary };
type LegChoice = {
  key: string;
  leg: FareLeg;
  representative: IndexedItinerary;
};

function localDate(value?: string): string {
  return value?.slice(0, 10) ?? "";
}

function legKey(leg?: FareLeg): string {
  return JSON.stringify(
    leg?.segments.map((segment) => [
      segment.departure_airport,
      segment.arrival_airport,
      segment.departure_time_utc ?? segment.departure_time_local,
      segment.arrival_time_utc ?? segment.arrival_time_local,
      segment.marketing_carrier_code,
      segment.flight_number,
    ]) ?? [],
  );
}

function legName(leg: FareLeg, index: number, cities: AirportCities): string {
  const first = leg.segments[0];
  const last = leg.segments.at(-1);
  if (!first || !last) return `Flight ${index + 1}`;
  return `${airportLabel(first.departure_airport, cities)} → ${airportLabel(last.arrival_airport, cities)}`;
}

function tripStart(itinerary: FareItinerary): string {
  return localDate(itinerary.legs?.[0]?.segments[0]?.departure_time_local);
}

function returnFlightStart(itinerary: FareItinerary): string {
  return localDate(itinerary.legs?.at(-1)?.segments[0]?.departure_time_local);
}

export function JourneyLegs({
  legs,
  booking,
  cities = {},
  purchasedLegs,
  onPurchaseChange,
  purchaseBusy = false,
}: {
  legs: FareLeg[];
  booking?: { tripId: string; cacheKey: string; itinerary: FareItinerary };
  cities?: AirportCities;
  purchasedLegs?: boolean[];
  onPurchaseChange?: (index: number, purchased: boolean) => void;
  purchaseBusy?: boolean;
}) {
  return (
    <div className="journey-legs">
      {legs.map((leg, index) => {
        const nights = index > 0 ? stayNights(legs[index - 1], leg) : null;
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
              title={`Flight ${index + 1}`}
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
}: {
  tripId: string;
  results: FareSearchResult[];
  parties: PlanningParty[];
}) {
  const [selected, setSelected] = useState<SelectedFlight[]>([]);
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
    void getSelectedFlights(tripId, controller.signal)
      .then((flights) => {
        if (!controller.signal.aborted) setSelected(flights);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(String(reason));
      });
    return () => controller.abort();
  }, [tripId]);

  async function choose(result: FareSearchResult, index: number | null) {
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
        );
        setSelected((flights) => [
          ...flights.filter((flight) => flight.partyId !== result.partyId),
          saved,
        ]);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save itinerary.",
      );
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
  partyName,
  selected,
  cities,
  busy,
  onChoose,
  onPurchaseChange,
}: {
  tripId: string;
  result: FareSearchResult;
  partyName: string;
  selected?: SelectedFlight;
  cities: AirportCities;
  busy: boolean;
  onChoose: (index: number | null) => Promise<void>;
  onPurchaseChange: (index: number, purchased: boolean) => Promise<void>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [chosen, setChosen] = useState<string[]>([]);
  const minimum = searchParams.get("routeMinPrice") ?? "";
  const maximum = searchParams.get("routeMaxPrice") ?? "";
  const startDate = searchParams.get("routeStartDate") ?? "";
  const endDate = searchParams.get("routeEndDate") ?? "";
  const options = result.response.itineraries
    .map((itinerary, index) => ({ itinerary, index }))
    .filter((item) => item.itinerary.legs?.length);
  const currencies = [
    ...new Set(
      options
        .map((item) => item.itinerary.price?.currency)
        .filter((currency): currency is string => Boolean(currency)),
    ),
  ];
  const currency = searchParams.get("routeCurrency") || currencies[0] || "";
  const startDates = [
    ...new Set(
      options.map((item) => tripStart(item.itinerary)).filter(Boolean),
    ),
  ].sort();
  const endDates = [
    ...new Set(
      options.map((item) => returnFlightStart(item.itinerary)).filter(Boolean),
    ),
  ].sort();
  const filtered = options.filter(({ itinerary }) => {
    const price = itinerary.price;
    return (
      (!currency || price?.currency === currency) &&
      (!minimum ||
        (price?.amount != null && price.amount >= Number(minimum))) &&
      (!maximum ||
        (price?.amount != null && price.amount <= Number(maximum))) &&
      (!startDate || tripStart(itinerary) === startDate) &&
      (!endDate || returnFlightStart(itinerary) === endDate)
    );
  });
  const matches = filtered.filter(({ itinerary }) =>
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
  const changeFilter = (name: string, value: string) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    });
  };
  return (
    <section
      className="route-visits"
      aria-label={`${partyName} flight choices`}
    >
      <Title3 as="h3">{partyName}</Title3>
      {selected && (
        <div className="route-saved-choice">
          <Text weight="semibold">
            Selected itinerary · {priceLabel(selected.itinerary.price)}
          </Text>
          <Text size={200}>
            You can build another route below and save it to replace this
            choice.
          </Text>
          <Button
            size="small"
            disabled={busy}
            onClick={() => void onChoose(null)}
          >
            Deselect itinerary
          </Button>
        </div>
      )}
      <div className="route-filters" aria-label="Itinerary filters">
        {currencies.length > 1 && (
          <Field label="Price currency">
            <Select
              value={currency}
              onChange={(_, data) => changeFilter("routeCurrency", data.value)}
            >
              {currencies.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={`Minimum total price${currency ? ` (${currency})` : ""}`}>
          <Input
            type="number"
            min={0}
            value={minimum}
            onChange={(_, data) => changeFilter("routeMinPrice", data.value)}
          />
        </Field>
        <Field label={`Maximum total price${currency ? ` (${currency})` : ""}`}>
          <Input
            type="number"
            min={0}
            value={maximum}
            onChange={(_, data) => changeFilter("routeMaxPrice", data.value)}
          />
        </Field>
        <Field label="Trip start date">
          <Select
            value={startDate}
            onChange={(_, data) => changeFilter("routeStartDate", data.value)}
          >
            <option value="">Any date</option>
            {startDates.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Return flight date">
          <Select
            value={endDate}
            onChange={(_, data) => changeFilter("routeEndDate", data.value)}
          >
            <option value="">Any date</option>
            {endDates.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {chosen.length > 0 && (
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <MenuButton appearance="subtle">Edit flights</MenuButton>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {chosen.map((key, index) => {
                const leg = options.find(
                  (item) => legKey(item.itinerary.legs?.[index]) === key,
                )?.itinerary.legs?.[index];
                return (
                  <MenuItem
                    key={index}
                    onClick={() => setChosen(chosen.slice(0, index))}
                  >
                    Flight {index + 1}:{" "}
                    {leg ? legName(leg, index, cities) : "Unknown flight"}
                  </MenuItem>
                );
              })}
            </MenuList>
          </MenuPopover>
        </Menu>
      )}
      {filtered.length === 0 && (
        <Text role="status">
          No complete routes match these price and date filters. Clear a filter
          to see more options.
        </Text>
      )}
      {filtered.length > 0 && matches.length === 0 && (
        <Text role="status">
          No complete route remains with these filters and flight choices.
          Change an earlier flight or a filter.
        </Text>
      )}
      {!complete && matches.length > 0 && (
        <>
          <Title3 as="h4">
            Flight {step + 1} of {legCount}: choose{" "}
            {choices[0] ? legName(choices[0].leg, step, cities) : "a flight"}
          </Title3>
          {step === legCount - 1 && (
            <Text size={200}>
              All compatible return airlines are shown below. An earlier flight
              or paired fare can limit the available returns; use Edit flights
              to change it.
            </Text>
          )}
          {choices
            .slice(0, step === legCount - 1 ? choices.length : 3)
            .map((choice, index) => renderChoice(choice, index))}
          {step !== legCount - 1 && choices.length > 3 && (
            <details>
              <summary>More flight options ({choices.length - 3})</summary>
              {choices
                .slice(3)
                .map((choice, index) => renderChoice(choice, index + 3))}
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
            cities={cities}
            booking={{
              tripId,
              cacheKey: result.cacheKey,
              itinerary: best.itinerary,
            }}
            purchasedLegs={
              selected?.cacheKey === result.cacheKey &&
              selected.itineraryIndex === best.index
                ? (selected.purchasedLegs ?? [])
                : undefined
            }
            onPurchaseChange={
              selected?.cacheKey === result.cacheKey &&
              selected.itineraryIndex === best.index
                ? (index, purchased) => void onPurchaseChange(index, purchased)
                : undefined
            }
            purchaseBusy={busy}
          />
          <Button
            appearance="primary"
            disabled={
              busy ||
              (selected?.cacheKey === result.cacheKey &&
                selected.itineraryIndex === best.index)
            }
            onClick={() => void onChoose(best.index)}
          >
            {selected?.cacheKey === result.cacheKey &&
            selected.itineraryIndex === best.index
              ? "Itinerary selected"
              : "Save complete itinerary"}
          </Button>
        </Card>
      )}
    </section>
  );

  function renderChoice(choice: LegChoice, index: number) {
    const candidate = choice.representative.itinerary;
    const airline =
      choice.leg.carrier ||
      choice.leg.segments[0]?.operating_carrier_name ||
      choice.leg.segments[0]?.marketing_carrier_code ||
      "Airline unavailable";
    return (
      <FlightInformation
        key={choice.key}
        leg={choice.leg}
        cities={cities}
        title={`Option ${index + 1} · ${airline}${index === 0 ? " · Cheapest complete route" : candidate.preferredAirlineSegments ? " · Preferred airline route" : candidate.stops === 0 ? " · Nonstop route" : ""}`}
        summary={`Complete trip from ${priceLabel(candidate.price)}. This flight may share a booking with another leg.`}
        actions={
          <>
            <Button
              appearance="primary"
              onClick={() => setChosen([...chosen, choice.key])}
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
