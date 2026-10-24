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
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  flightNodeId,
  presentFlightFare,
  type FlightFare,
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
                  ? (value) => onPurchaseChange(index, value)
                  : undefined
              }
              purchaseBusy={purchaseBusy}
              actions={
                renderBooking
                  ? renderBooking(index)
                  : booking && (
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
  choiceProgress = {},
  onChangeChoices,
  visits = [],
  showGrid = false,
  searching = false,
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
  showGrid?: boolean;
  searching?: boolean;
}) {
  const [selected, setSelected] = useState<SelectedFlight[]>([]);
  const selectionMutation = useRef(0);
  const [busyParty, setBusyParty] = useState<string>();
  const [error, setError] = useState<string>();
  const cities = useAirportCities(
    flightAirportCodes(
      results.flatMap((result) => [
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
      {!showGrid && (
        <Text>
          Choose one flight at a time. Every option shown can still complete a
          route that fits your required stays. The price shown is for the
          complete route, not for the individual flight.
        </Text>
      )}
      {error && <Text role="alert">{error}</Text>}
      {showGrid &&
        parties
          .filter(
            (party) => !results.some((result) => result.partyId === party.id),
          )
          .map((party) => (
            <section key={party.id} className="route-visits">
              <Title3 as="h3">
                {party.members.map((member) => member.name).join(", ") ||
                  "Travel party"}
              </Title3>
              <FlightRouteGrid
                visits={visits}
                cities={cities}
                searching={searching}
                chosen={[]}
                busy={false}
                onChoose={() => {}}
                preferredAirlines={[]}
              />
            </section>
          ))}
      {results.map((result) => (
        <RoutePartyResults
          key={result.partyId}
          tripId={tripId}
          result={result}
          visits={visits}
          showGrid={showGrid}
          searching={searching}
          savedChoices={savedChoices[result.partyId] ?? emptyChoices}
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
}: {
  tripId: string;
  result: FareSearchResult;
  visits: PlannedVisit[];
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
}) {
  const [localChosen, setLocalChosen] =
    useState<(string | null)[]>(savedChoices);
  const chosen = onChangeChoices ? savedChoices : localChosen;
  const { confirm, dialog } = useFlightChoiceConfirmation();
  const [gridReview, setGridReview] = useState<{
    keys: string[];
    price?: FareItinerary["price"];
  }>();
  const [choiceBusy, setChoiceBusy] = useState(false);
  const [choiceError, setChoiceError] = useState<string>();
  async function changePurchases(ids: string[]) {
    if (!onChangeChoices) return;
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
    if (
      chosen.some((key, index) => key && key !== keys[index]) &&
      !(await confirm(chosen, keys))
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
  function editGrid() {
    setGridReview(undefined);
  }
  async function chooseGrid(keys: (string | null)[]) {
    if (await changeChosen(keys)) editGrid();
  }
  function reviewGrid(keys: string[], price?: FareItinerary["price"]) {
    setGridReview({ keys, price });
  }
  async function restartChoices() {
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
      editGrid();
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
  const reviewingChosen =
    gridReview &&
    chosen.length === gridReview.keys.length &&
    gridReview.keys.every((key, index) => chosen[index] === key);
  const gridReady =
    reviewingChosen &&
    (!onChangeChoices ||
      !result.response.choiceKeys ||
      JSON.stringify(result.response.choiceKeys) ===
        JSON.stringify(gridReview.keys));
  const best = showGrid
    ? gridReady
      ? options.find(
          ({ itinerary }) =>
            itinerary.legs?.length === gridReview.keys.length &&
            gridReview.keys.every(
              (key, index) => legKey(itinerary.legs?.[index]) === key,
            ) &&
            (!gridReview.price ||
              (itinerary.price?.currency === gridReview.price.currency &&
                Math.round(itinerary.price.amount * 100) <=
                  Math.round(gridReview.price.amount * 100))),
        )
      : undefined
    : complete
      ? matches[0]
      : undefined;
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
      {dialog}
      <Title3 as="h3">{partyName}</Title3>
      {showGrid ? (
        <FlightRouteGrid
          result={result}
          visits={visits}
          cities={cities}
          searching={searching}
          chosen={chosen}
          busy={choiceBusy || busy}
          onChoose={(keys) => void chooseGrid(keys)}
          onReview={(keys, price) => void reviewGrid(keys, price)}
          onFilterChange={() => editGrid()}
          preferredAirlines={preferredAirlines}
          renderSelections={(fares) =>
            !best &&
            chosen.some(Boolean) && (
              <SelectedGridFlights
                result={result}
                chosen={chosen}
                visits={visits}
                cities={cities}
                preferredAirlines={preferredAirlines}
                fares={fares}
                tripId={tripId}
                progress={progress}
                busy={choiceBusy || busy}
                onPurchase={onChangeChoices ? changePurchases : undefined}
              />
            )
          }
        />
      ) : (
        <FlightLegTabs
          legCount={legCount}
          chosen={chosen}
          step={step}
          label={partyName}
          routes={tabRoutes}
          busy={choiceBusy}
          onRevisit={(index) => void changeChosen(chosen.slice(0, index))}
        />
      )}
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
      {showGrid && reviewingChosen && !best && (
        <Text role="status">
          {gridReady
            ? "These flights are no longer available at the displayed total. Review your selections again."
            : "Preparing your selected flights for review…"}
        </Text>
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
            renderBooking={
              showGrid && progress
                ? (index) => (
                    <ChoiceBookingActions
                      key={
                        best.itinerary.bookingOffers?.find((offer) =>
                          offer.legIndexes.includes(index),
                        )?.ignavId
                      }
                      tripId={tripId}
                      partyId={result.partyId}
                      index={index}
                      booking={progress.bookings?.find(
                        (booking) =>
                          booking.ignavId ===
                          best.itinerary.bookingOffers?.find((offer) =>
                            offer.legIndexes.includes(index),
                          )?.ignavId,
                      )}
                      progress={progress}
                      busy={choiceBusy || busy}
                      onPurchase={changePurchases}
                    />
                  )
                : undefined
            }
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
            />
          </>
        }
      />
    );
  }
}

// Keep the original leg indexes: a return flight can be selected before the
// outbound, and a partial selection does not imply a stay between its cards.
const SelectedGridFlights = memo(function SelectedGridFlights({
  result,
  chosen,
  visits,
  cities,
  preferredAirlines,
  fares,
  tripId,
  progress,
  busy,
  onPurchase,
}: {
  result: FareSearchResult;
  chosen: (string | null)[];
  visits: PlannedVisit[];
  cities: AirportCities;
  preferredAirlines: string[];
  fares: ReadonlyMap<string, FlightFare>;
  tripId: string;
  progress?: FlightChoiceProgress;
  busy: boolean;
  onPurchase?: (ids: string[]) => Promise<void>;
}) {
  const partialBookings = partialFlightBookings(
    progress,
    chosen,
    fares.values().next().value?.price.currency,
  );
  return (
    <section className="route-visits" aria-label="Selected flights">
      <Title3 as="h4">Selected flights</Title3>
      {chosen.map((key, index) => {
        if (!key) return null;
        const flight = result.response.flights?.find(
          (option) => option.legIndex === index && legKey(option.leg) === key,
        );
        const itinerary = result.response.itineraries.find(
          (option) => legKey(option.legs?.[index]) === key,
        );
        const leg = flight?.leg ?? itinerary?.legs?.[index];
        const quote = fares.get(flightNodeId(index, key));
        const matches =
          progress?.bookings?.filter(
            (booking) =>
              booking.legIndexes.includes(index) &&
              booking.legIndexes.every(
                (leg, i) => chosen[leg] === booking.legKeys[i],
              ),
          ) ?? [];
        const booking =
          matches.find((booking) =>
            progress?.purchasedOfferIds?.includes(booking.ignavId),
          ) ??
          (quote
            ? matches.find((booking) => booking.ignavId === quote.ignavId)
            : partialBookings.get(index));
        const fare = presentFlightFare(booking ?? quote, index, chosen);
        const destination =
          index === visits.length
            ? "Return home"
            : (visits[index]?.location?.label ??
              visits[index]?.location?.code ??
              "Destination");
        const label = `Flight ${index + 1}: ${destination}`;
        return (
          <div
            className="route-visits"
            role="group"
            aria-label={label}
            key={`${index}:${key}`}
          >
            <Text weight="semibold">{label}</Text>
            {leg ? (
              <FlightInformation
                leg={leg}
                cities={cities}
                preferredAirlines={preferredAirlines}
                price={fare.price}
                priceContext={fare.label}
                summary={!fare.price ? fare.label : undefined}
                actions={
                  <ChoiceBookingActions
                    key={booking?.ignavId ?? quote?.ignavId ?? "pending"}
                    tripId={tripId}
                    partyId={result.partyId}
                    index={index}
                    booking={booking}
                    progress={progress}
                    busy={busy}
                    onPurchase={onPurchase}
                    bundled={quote?.legIndexes.length === 2}
                  />
                }
              />
            ) : (
              <Text>
                Selected flight details are not available in these results.
              </Text>
            )}
          </div>
        );
      })}
    </section>
  );
});

function ChoiceBookingActions({
  tripId,
  partyId,
  index,
  booking,
  progress,
  busy,
  onPurchase,
  bundled,
}: {
  tripId: string;
  partyId: string;
  index: number;
  booking?: FlightChoiceBooking;
  progress?: FlightChoiceProgress;
  busy: boolean;
  onPurchase?: (ids: string[]) => Promise<void>;
  bundled?: boolean;
}) {
  const purchased =
    !!booking && !!progress?.purchasedOfferIds?.includes(booking.ignavId);
  if (booking && booking.legIndexes[0] !== index) {
    return (
      <Text size={200}>
        Booking and purchase status are shared with flight{" "}
        {booking.legIndexes[0] + 1}.{" "}
        {purchased ? "Purchased." : "Not purchased."}
      </Text>
    );
  }
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
          buttonLabel={
            paired ? "Request round-trip booking link" : "Request booking link"
          }
          disabled={busy}
        />
      ) : (
        <>
          <Button disabled>Request booking link</Button>
          <Text size={200}>
            {paired
              ? "Select both outbound and return flights to book or mark this fare purchased."
              : "Booking details will appear after this flight selection is saved."}
          </Text>
        </>
      )}
      <Switch
        label={paired ? "Purchased outbound + return" : "Purchased"}
        checked={purchased}
        disabled={busy || !booking || !onPurchase}
        onChange={(_, data) => {
          if (!booking || !onPurchase) return;
          const ids = (progress?.purchasedOfferIds ?? []).filter(
            (id) => id !== booking.ignavId,
          );
          void onPurchase(data.checked ? [...ids, booking.ignavId] : ids);
        }}
      />
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
      {offers.length === 0 && (
        <Text size={200}>
          No airline booking offer is available for this flight.
        </Text>
      )}
      {error && <Text role="status">{error}</Text>}
    </div>
  );
}
