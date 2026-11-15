import { useTripResourceVersion } from "../../api/tripDocumentStore";
import { BookingOptionsSkeleton } from "./FlightSkeletons";
import FlightPriceStatus from "./FlightPriceStatus";
import {
  restoreFlightResults,
  restoredFlightKeys,
  selectedFlightLegs,
} from "./restoreFlightResults";
import { useFlightChoiceConfirmation } from "./useFlightChoiceConfirmation";
import { partialFlightBookings } from "./flightChoiceBookings";
import {
  bookingPriceDescription,
  bookingPriceBadge,
  type BookingPrice,
} from "./flightBookingPrice";
import FlightRouteGrid from "./FlightRouteGrid";
import type { PlannedVisit } from "./planningApi";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  presentFlightFare,
  type FlightFare,
  type FlightNode,
  type FlightRouteResult,
} from "./flightRouteGraph";
import {
  Badge,
  Button,
  Card,
  Divider,
  Text,
  Title3,
  Switch,
} from "@fluentui/react-components";
import FlightInformation from "./FlightInformation";
import FlightLegTabs from "./FlightLegTabs";
import {
  airportLabel,
  flightNumbers,
  legKey,
  legRoute,
  sameItineraryFlights,
  priceLabel,
  isVerifiedPrice,
  stayNights,
  type AirportCities,
} from "./flightFormatting";
import { flightAirportCodes, useAirportCities } from "./airportCities";
import {
  getBookingLinks,
  type FareItinerary,
  type FareLeg,
  type FareSearchResult,
} from "../../api/operationsApi";
import {
  deselectFlight,
  getSelectedFlights,
  selectFlight,
  setFlightPurchases,
  type SelectedFlight,
  type FlightChoiceProgress,
  type FlightChoiceBooking,
  getChoiceBookingLinks,
} from "./selectedFlightsApi";
import type { PartySettings, PlanningParty } from "./planningApi";

type IndexedItinerary = { index: number; itinerary: FareItinerary };
const emptyChoices: (string | null)[] = [];
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
  readOnly = false,
  cheapestRoute = false,
  preferredAirlines = [],
  renderBooking,
}: {
  legs: FareLeg[];
  booking?: { tripId: string; cacheKey: string; itinerary: FareItinerary };
  itinerary?: FareItinerary;
  cities?: AirportCities;
  purchasedLegs?: boolean[];
  onPurchaseChange?: (index: number, purchased: boolean) => void;
  purchaseBusy?: boolean;
  readOnly?: boolean;
  cheapestRoute?: boolean;
  preferredAirlines?: string[];
  renderBooking?: (index: number) => ReactNode;
}) {
  return (
    <div className="journey-legs">
      {legs.map((leg, index) => {
        const nights = index > 0 ? stayNights(legs[index - 1], leg) : null;
        const fare = itinerary ?? booking?.itinerary;
        const legBooking = fare?.bookingOffers?.find((offer) =>
          offer.legIndexes.includes(index),
        );
        const displayFare = presentFlightFare(
          legBooking?.price
            ? { price: legBooking.price, legIndexes: legBooking.legIndexes }
            : undefined,
          index,
          legs.map(legKey),
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
              price={
                legBooking
                  ? displayFare.price
                  : index === 0
                    ? fare?.price
                    : undefined
              }
              summary={
                legBooking && !displayFare.price ? displayFare.label : undefined
              }
              priceContext={
                legBooking?.price
                  ? displayFare.label
                  : fare?.price
                    ? "Trip total"
                    : undefined
              }
              purchased={
                renderBooking
                  ? undefined
                  : (purchasedLegs?.[index] ??
                    (purchasedLegs ? false : undefined))
              }
              onPurchasedChange={
                onPurchaseChange
                  ? (value) => {
                      if (!readOnly) onPurchaseChange(index, value);
                    }
                  : undefined
              }
              purchaseBusy={purchaseBusy || readOnly}
              actions={
                renderBooking
                  ? renderBooking(index)
                  : booking && (
                      <RouteBookingLinks
                        tripId={booking.tripId}
                        cacheKey={booking.cacheKey}
                        itinerary={booking.itinerary}
                        legIndex={index}
                        disabled={readOnly}
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
  choiceProgress = {},
  onChangeChoices,
  visits = [],
  returnDate,
  showGrid = false,
  searching = false,
  readOnly = false,
  searchAction,
}: {
  tripId: string;
  results: FareSearchResult[];
  parties: PlanningParty[];
  partySettings?: PartySettings[];
  savedChoices?: Record<string, (string | null)[]>;
  choiceProgress?: Record<string, FlightChoiceProgress>;
  onChangeChoices?: (
    partyId: string,
    keys: (string | null)[],
    purchasedOfferIds?: string[],
  ) => Promise<boolean>;
  visits?: PlannedVisit[];
  returnDate?: string | null;
  showGrid?: boolean;
  searching?: boolean;
  readOnly?: boolean;
  searchAction?: ReactNode;
}) {
  const selectedVersion = useTripResourceVersion(`/trips/${tripId}/flights`);
  const [selected, setSelected] = useState<SelectedFlight[]>([]);
  const selectionMutation = useRef(0);
  const [busyParty, setBusyParty] = useState<string>();
  const [error, setError] = useState<string>();
  const effectiveChoices = useMemo(
    () =>
      showGrid
        ? restoredFlightKeys(savedChoices, selected, visits.length + 1)
        : savedChoices,
    [showGrid, savedChoices, selected, visits.length],
  );
  const displayResults = useMemo(
    () =>
      showGrid
        ? restoreFlightResults(
            results,
            choiceProgress,
            selected,
            effectiveChoices,
            visits.length + 1,
          )
        : results,
    [
      showGrid,
      results,
      choiceProgress,
      selected,
      effectiveChoices,
      visits.length,
    ],
  );
  const cities = useAirportCities(
    flightAirportCodes(
      displayResults.flatMap((result) => [
        ...result.response.itineraries.flatMap(
          (itinerary) => itinerary.legs ?? [],
        ),
        ...(result.response.flights ?? []).map((flight) => flight.leg),
      ]),
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
  }, [tripId, selectedVersion]);

  async function choose(result: FlightRouteResult, index: number | null) {
    if (readOnly) return false;
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
    result: FlightRouteResult,
    legIndex: number,
    purchased: boolean,
  ) {
    if (readOnly) return;
    const current = selected.find(
      (flight) => flight.partyId === result.partyId,
    );
    if (!current) return;
    const count = selectedFlightLegs(current).length;
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

  const emptyParties = parties.filter(
    (party) => !displayResults.some((result) => result.partyId === party.id),
  );

  return (
    <div className="route-visits">
      {!showGrid && (
        <Text>
          Choose one flight at a time. Every option shown can still complete a
          route that fits your required stays. The price shown is for the
          complete route, not for the individual flight.
        </Text>
      )}
      {error && <Text role="alert">{error}</Text>}
      {showGrid &&
        emptyParties.map((party, index) => (
          <section key={party.id} className="route-visits">
            <FlightRouteGrid
              visits={visits}
              returnDate={returnDate}
              cities={cities}
              searching={searching}
              chosen={[]}
              readOnly={readOnly}
              busy={false}
              onChoose={() => {}}
              preferredAirlines={[]}
              searchAction={index === 0 ? searchAction : undefined}
            />
          </section>
        ))}
      {displayResults.map((result, index) => (
        <RoutePartyResults
          key={result.partyId}
          tripId={tripId}
          result={result}
          visits={visits}
          returnDate={returnDate}
          showGrid={showGrid}
          readOnly={readOnly}
          searching={searching}
          searchAction={
            emptyParties.length === 0 && index === 0 ? searchAction : undefined
          }
          savedChoices={effectiveChoices[result.partyId] ?? emptyChoices}
          progress={choiceProgress[result.partyId]}
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
  visits,
  returnDate,
  showGrid,
  searching,
  savedChoices,
  progress,
  onChangeChoices,
  partyName,
  selected,
  cities,
  preferredAirlines,
  busy,
  onChoose,
  onPurchaseChange,
  readOnly = false,
  searchAction,
}: {
  tripId: string;
  result: FlightRouteResult;
  visits: PlannedVisit[];
  returnDate?: string | null;
  showGrid: boolean;
  searching: boolean;
  savedChoices: (string | null)[];
  progress?: FlightChoiceProgress;
  onChangeChoices?: (
    partyId: string,
    keys: (string | null)[],
    purchasedOfferIds?: string[],
  ) => Promise<boolean>;
  partyName: string;
  selected?: SelectedFlight;
  cities: AirportCities;
  preferredAirlines: string[];
  busy: boolean;
  onChoose: (index: number | null) => Promise<boolean>;
  onPurchaseChange: (index: number, purchased: boolean) => Promise<void>;
  readOnly?: boolean;
  searchAction?: ReactNode;
}) {
  const [localChosen, setLocalChosen] =
    useState<(string | null)[]>(savedChoices);
  const chosen = readOnly || onChangeChoices ? savedChoices : localChosen;
  const { confirm, dialog } = useFlightChoiceConfirmation();
  const [choiceBusy, setChoiceBusy] = useState(false);
  const [choiceError, setChoiceError] = useState<string>();
  async function changePurchases(ids: string[]) {
    if (readOnly || !onChangeChoices) return;
    setChoiceBusy(true);
    setChoiceError(undefined);
    try {
      if (!(await onChangeChoices(result.partyId, chosen, ids)))
        throw new Error(
          "Could not save the purchase status. Please try again.",
        );
    } catch (reason) {
      setChoiceError(
        reason instanceof Error
          ? reason.message
          : "Could not save purchase status.",
      );
    } finally {
      setChoiceBusy(false);
    }
  }
  async function changeChosen(keys: (string | null)[]) {
    if (readOnly) return false;
    const previous = keys.some(Boolean)
      ? chosen
      : [...chosen, ...(progress?.unmatchedFlights ?? []).map(legKey)];
    if (
      previous.some((key, index) => key && key !== keys[index]) &&
      !(await confirm(previous, keys))
    )
      return false;
    setChoiceError(undefined);
    if (!onChangeChoices) {
      setLocalChosen(keys);
      return true;
    }
    setChoiceBusy(true);
    try {
      const saved = await onChangeChoices(result.partyId, keys);
      setChoiceError(
        saved ? undefined : "Could not save this flight. Please try again.",
      );
      return saved;
    } catch (reason) {
      setChoiceError(
        reason instanceof Error
          ? reason.message
          : "Could not save this flight. Please try again.",
      );
      return false;
    } finally {
      setChoiceBusy(false);
    }
  }
  async function restartChoices() {
    if (readOnly) return;
    if (!(await confirm(chosen, []))) return;
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
    chosen.every(
      (key, index) => !key || legKey(itinerary.legs?.[index]) === key,
    ),
  );
  const step =
    chosen.findIndex((key) => !key) < 0
      ? chosen.length
      : chosen.findIndex((key) => !key);
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
  const best = !showGrid && complete ? matches[0] : undefined;
  const bestIsSelected = Boolean(
    selected &&
    best &&
    sameItineraryFlights(selected.itinerary, best.itinerary),
  );
  const tabRoutes = Array.from({ length: legCount }, (_, index) => {
    const leg = chosen[index]
      ? options.find(
          (option) => legKey(option.itinerary.legs?.[index]) === chosen[index],
        )?.itinerary.legs?.[index]
      : matches[0]?.itinerary.legs?.[index];
    return legRoute(leg);
  });
  const cheapestRoute = options
    .filter((option) => isVerifiedPrice(option.itinerary.price))
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
      {dialog}
      {!showGrid && <Title3 as="h3">{partyName}</Title3>}
      {showGrid && Boolean(progress?.unmatchedFlights?.length) && (
        <div className="flight-retained-review" role="status">
          <Text weight="semibold">
            Review saved flights after changing stops
          </Text>
          <Text>
            These flights no longer fit the current stops or dates. They are
            retained here and excluded from your current route. Clearing
            selections removes them from this trip; it does not cancel tickets.
          </Text>
          <ul>
            {progress!.unmatchedFlights!.map((leg) => (
              <li key={legKey(leg)}>
                {flightNumbers(leg)} · {legRoute(leg)} ·{" "}
                {leg.segments[0]?.departure_time_local?.slice(0, 10)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {showGrid ? (
        <FlightRouteGrid
          result={result}
          visits={visits}
          returnDate={returnDate}
          cities={cities}
          searching={searching}
          chosen={chosen}
          readOnly={readOnly}
          busy={choiceBusy || busy}
          retainedFlightCount={progress?.unmatchedFlights?.length ?? 0}
          onChoose={(keys) => void changeChosen(keys)}
          preferredAirlines={preferredAirlines}
          searchAction={searchAction}
          renderCardActions={(node, isSelected, fares) => (
            <GridFlightBookingActions
              key={`${node.id}:${fares.get(node.id)?.ignavId ?? "saved"}`}
              node={node}
              isSelected={isSelected}
              chosen={chosen}
              quote={fares.get(node.id)}
              currency={fares.values().next().value?.price.currency}
              tripId={tripId}
              partyId={result.partyId}
              progress={progress}
              savedItinerary={selected}
              readOnly={readOnly}
              busy={choiceBusy || busy}
              onPurchase={onChangeChoices ? changePurchases : undefined}
              onSavedPurchase={onPurchaseChange}
            />
          )}
        />
      ) : (
        <FlightLegTabs
          legCount={legCount}
          chosen={chosen}
          step={step}
          label={partyName}
          routes={tabRoutes}
          busy={choiceBusy || readOnly}
          onRevisit={(index) => void changeChosen(chosen.slice(0, index))}
        />
      )}
      {choiceError && <Text role="alert">{choiceError}</Text>}
      {choiceBusy && <Text role="status">Saving flight choice…</Text>}
      {!showGrid && selected && (
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
      {!showGrid && options.length === 0 && (
        <Text role="status">No complete routes are available yet.</Text>
      )}
      {!showGrid && options.length > 0 && matches.length === 0 && (
        <Text role="status">
          No complete route remains with these flight choices. Change an earlier
          flight.
        </Text>
      )}
      {!showGrid && !complete && matches.length > 0 && (
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
            readOnly={readOnly}
            cheapestRoute={best.index === cheapestRoute?.index}
          />
          <div className="route-result-actions">
            <Button
              appearance="primary"
              disabled={readOnly || busy || bestIsSelected}
              onClick={() => void onChoose(best.index)}
            >
              {bestIsSelected
                ? "Itinerary selected"
                : "Save complete itinerary"}
            </Button>
            <Button
              disabled={readOnly || busy || choiceBusy}
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
              disabled={readOnly || choiceBusy}
              onClick={() => {
                const keys = [...chosen];
                keys[step] = choice.key;
                void changeChosen(keys);
              }}
            >
              Choose flight {step + 1}
            </Button>
            <RouteBookingLinks
              tripId={tripId}
              cacheKey={result.cacheKey}
              itinerary={candidate}
              legIndex={step}
              disabled={readOnly}
            />
          </>
        }
      />
    );
  }
}

function GridFlightBookingActions({
  node,
  isSelected,
  chosen,
  quote,
  currency,
  tripId,
  partyId,
  progress,
  savedItinerary,
  busy,
  readOnly = false,
  onPurchase,
  onSavedPurchase,
}: {
  node: FlightNode;
  isSelected: boolean;
  chosen: (string | null)[];
  quote?: FlightFare;
  currency?: string;
  tripId: string;
  partyId: string;
  progress?: FlightChoiceProgress;
  savedItinerary?: SelectedFlight;
  busy: boolean;
  readOnly?: boolean;
  onPurchase?: (ids: string[]) => Promise<void>;
  onSavedPurchase: (index: number, purchased: boolean) => Promise<void>;
}) {
  const index = node.legIndex;
  const matches = isSelected
    ? (progress?.bookings?.filter(
        (booking) =>
          booking.legIndexes.includes(index) &&
          booking.legIndexes.every(
            (leg, i) => chosen[leg] === booking.legKeys[i],
          ),
      ) ?? [])
    : [];
  const booking =
    matches.find((booking) =>
      progress?.purchasedOfferIds?.includes(booking.ignavId),
    ) ??
    (quote
      ? matches.find((booking) => booking.ignavId === quote.ignavId)
      : undefined) ??
    (isSelected
      ? partialFlightBookings(progress, chosen, currency).get(index)
      : undefined);
  // Older complete itineraries still own their booking/purchase state until choices are saved.
  const savedLeg = savedItinerary
    ? selectedFlightLegs(savedItinerary)[index]
    : undefined;
  if (
    !booking &&
    !progress &&
    savedItinerary &&
    isSelected &&
    savedLeg &&
    legKey(savedLeg) === legKey(node.leg)
  ) {
    return (
      <div className="route-booking-links">
        <RouteBookingLinks
          tripId={tripId}
          cacheKey={savedItinerary.cacheKey}
          itinerary={savedItinerary.itinerary}
          legIndex={index}
          buttonLabel="Booking Link"
          disabled={busy || readOnly}
        />
        <Switch
          label="Booked"
          checked={savedItinerary.purchasedLegs?.[index] ?? false}
          disabled={busy || readOnly}
          onChange={(_, data) => void onSavedPurchase(index, data.checked)}
        />
      </div>
    );
  }
  return (
    <ChoiceBookingActions
      key={booking?.ignavId ?? "pending"}
      tripId={tripId}
      partyId={partyId}
      index={index}
      booking={booking}
      progress={progress}
      busy={busy}
      readOnly={readOnly}
      onPurchase={onPurchase}
      bundled={(quote?.legIndexes.length ?? node.bookingLegCount) > 1}
      isSelected={isSelected}
    />
  );
}

function ChoiceBookingActions({
  tripId,
  partyId,
  index,
  booking,
  progress,
  busy,
  readOnly = false,
  onPurchase,
  bundled,
  isSelected = true,
}: {
  tripId: string;
  partyId: string;
  index: number;
  booking?: FlightChoiceBooking;
  progress?: FlightChoiceProgress;
  busy: boolean;
  readOnly?: boolean;
  onPurchase?: (ids: string[]) => Promise<void>;
  bundled?: boolean;
  isSelected?: boolean;
}) {
  const purchased =
    !!booking && !!progress?.purchasedOfferIds?.includes(booking.ignavId);
  const paired = booking ? booking.legIndexes.length > 1 : bundled;
  return (
    <div className="route-booking-links">
      {booking ? (
        <RouteBookingLinks
          tripId={tripId}
          cacheKey=""
          itinerary={{ bookingOffers: [booking] }}
          legIndex={index}
          loadLinks={(id) => getChoiceBookingLinks(tripId, partyId, id)}
          wholeBooking
          buttonLabel="Booking Link"
          disabled={busy || readOnly}
        />
      ) : (
        <>
          <Button
            disabled
            title={
              !isSelected
                ? "Select this flight to manage its booking."
                : undefined
            }
          >
            Booking Link
          </Button>
          {isSelected && (
            <Text size={200}>
              {paired
                ? "Select both outbound and return flights to manage this booking."
                : "Booking details will appear after this flight selection is saved."}
            </Text>
          )}
        </>
      )}
      {paired && booking && (
        <Text size={200}>
          Shared booking for flights{" "}
          {booking.legIndexes.map((leg) => leg + 1).join(" + ")}.
        </Text>
      )}
      {isSelected && (
        <Switch
          label="Booked"
          checked={purchased}
          disabled={readOnly || busy || !booking || !onPurchase}
          onChange={(_, data) => {
            if (readOnly || !booking || !onPurchase) return;
            const ids = (progress?.purchasedOfferIds ?? []).filter(
              (id) => id !== booking.ignavId,
            );
            void onPurchase(data.checked ? [...ids, booking.ignavId] : ids);
          }}
        />
      )}
    </div>
  );
}

type BookingOption = {
  leg_indexes?: number[];
  legs?: string[];
  links?: {
    provider_name?: string;
    provider_type?: string;
    fare_name?: string;
    price?: BookingPrice;
    url?: string;
  }[];
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
  loadLinks,
  buttonLabel = "Airline booking options",
  disabled = false,
  wholeBooking = false,
}: {
  tripId: string;
  cacheKey: string;
  itinerary: FareItinerary;
  legIndex: number;
  loadLinks?: (id: string) => Promise<unknown>;
  buttonLabel?: string;
  disabled?: boolean;
  wholeBooking?: boolean;
}) {
  const [links, setLinks] = useState<
    {
      key: string;
      url: string;
      label: string;
      priceDescription: string;
      priceTotal: string;
      price?: BookingPrice;
      priceDifference?: string;
    }[]
  >();
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
          const response = (await (loadLinks
            ? loadLinks(offer.ignavId)
            : getBookingLinks(tripId, cacheKey, offer.ignavId))) as {
            booking_options?: BookingOption[];
          };
          return (response.booking_options ?? []).flatMap((option) => {
            const covered = [
              ...new Set(
                (
                  option.leg_indexes ??
                  option.legs?.flatMap((leg) =>
                    leg === "outbound" ? [0] : leg === "inbound" ? [1] : [],
                  ) ??
                  (offer.legIndexes.length === 1 ? [0] : [])
                )
                  .map((index) => offer.legIndexes[index])
                  .filter((index): index is number => index != null),
              ),
            ];
            if (
              !covered.length ||
              (!wholeBooking && !covered.includes(legIndex))
            )
              return [];
            const sameFlights =
              covered.length === offer.legIndexes.length &&
              offer.legIndexes.every((index) => covered.includes(index));
            return (option.links ?? []).flatMap((link) => {
              if (link.provider_type !== "airline") return [];
              const url = airlineUrl(link.url);
              const label = `${link.provider_name || "Airline"} · ${link.fare_name?.trim() || "Fare name unavailable"}${
                !sameFlights
                  ? ` · flight${covered.length > 1 ? "s" : ""} ${covered.map((index) => index + 1).join(", ")} only`
                  : covered.length > 1
                    ? ` · also covers flight${covered.length > 2 ? "s" : ""} ${covered
                        .filter((index) => index !== legIndex)
                        .map((index) => index + 1)
                        .join(", ")}`
                    : ""
              }`;
              const priceDescription = bookingPriceDescription(
                link.price,
                offer.price,
                sameFlights,
              );
              return url
                ? [
                    {
                      key: JSON.stringify([
                        url,
                        label,
                        priceDescription,
                        offer.ignavId,
                      ]),
                      url,
                      label,
                      priceDescription,
                      priceTotal: priceLabel(link.price),
                      price: link.price,
                      priceDifference: bookingPriceBadge(
                        link.price,
                        offer.price,
                        sameFlights,
                      ),
                    },
                  ]
                : [];
            });
          });
        }),
      );
      const unique = [
        ...new Map(groups.flat().map((link) => [link.key, link])).values(),
      ];
      setLinks(unique.length ? unique : undefined);
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
          <a
            className="route-booking-option"
            key={link.key}
            href={link.url}
            target="_blank"
            rel="noreferrer"
          >
            <span className="route-booking-option-heading">
              <span>Book on {link.label}</span>
              <FlightPriceStatus price={link.price} />
              {link.priceDifference && (
                <Badge
                  appearance="tint"
                  color="informative"
                  title={link.priceDescription}
                  aria-label={link.priceDescription}
                >
                  {link.priceDifference}
                </Badge>
              )}
            </span>
            <span>
              {link.priceDifference ? link.priceTotal : link.priceDescription}
            </span>
          </a>
        ))
      ) : (
        <Button
          disabled={disabled || busy || offers.length === 0}
          onClick={() => void load()}
        >
          {busy ? "Finding airline links…" : buttonLabel}
        </Button>
      )}
      {busy && <BookingOptionsSkeleton />}
      {offers.length === 0 && (
        <Text size={200}>
          No airline booking offer is available for this flight.
        </Text>
      )}
      {error && <Text role="status">{error}</Text>}
    </div>
  );
}
