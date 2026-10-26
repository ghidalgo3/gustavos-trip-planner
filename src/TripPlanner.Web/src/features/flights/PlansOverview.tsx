import { useTripResourceVersion } from "../../api/tripSnapshot";
import { SelectedFlightsSkeleton } from "./FlightSkeletons";
import { useEffect, useState } from "react";
import { Button, Card, Text, Title2, Title3 } from "@fluentui/react-components";
import type { Trip } from "../../api/api";
import {
  getTripFlightPlanningData,
  type PartySettings,
  type PlanningParty,
} from "./planningApi";
import { JourneyLegs } from "./RouteFareResults";
import { priceLabel } from "./flightFormatting";
import { flightAirportCodes, useAirportCities } from "./airportCities";
import type { FareItinerary, FareLeg } from "../../api/operationsApi";
import PartySelector from "../party/PartySelector";
import {
  deselectFlight,
  getSelectedFlights,
  setFlightPurchases,
  type SelectedFlight,
} from "./selectedFlightsApi";

function displayLegs(itinerary: FareItinerary): FareLeg[] {
  const legs =
    itinerary.legs ??
    [itinerary.outbound, itinerary.inbound].filter((leg): leg is FareLeg =>
      Boolean(leg),
    );
  return legs.every((leg) =>
    leg.segments.every(
      (segment) => segment.departure_airport && segment.arrival_airport,
    ),
  )
    ? legs
    : [];
}

export default function PlansOverview({
  trip,
  userId,
  onFindFlights,
  readOnly = false,
}: {
  trip: Trip;
  userId: string;
  onFindFlights: () => void;
  readOnly?: boolean;
}) {
  const snapshotVersion = useTripResourceVersion(`/trips/${trip.id}/flights`);
  const [flights, setFlights] = useState<SelectedFlight[]>([]);
  const [parties, setParties] = useState<PlanningParty[]>([]);
  const [partySettings, setPartySettings] = useState<PartySettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyParty, setBusyParty] = useState<string>();
  const [error, setError] = useState<string>();
  const cities = useAirportCities(
    flightAirportCodes(
      flights.flatMap((flight) => displayLegs(flight.itinerary)),
    ),
  );
  async function refreshParties() {
    const planning = await getTripFlightPlanningData(trip.id);
    setParties(planning.parties);
    setPartySettings(planning.document?.parties ?? []);
  }
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getSelectedFlights(trip.id, controller.signal),
      getTripFlightPlanningData(trip.id, controller.signal),
    ])
      .then(([selected, planning]) => {
        if (controller.signal.aborted) return;
        setFlights(selected);
        setParties(planning.parties);
        setPartySettings(planning.document?.parties ?? []);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load the trip plan.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [trip.id, userId, snapshotVersion]);

  async function remove(partyId: string) {
    setBusyParty(partyId);
    setError(undefined);
    try {
      await deselectFlight(trip.id, partyId);
      setFlights((selected) =>
        selected.filter((flight) => flight.partyId !== partyId),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to deselect the flight.",
      );
    } finally {
      setBusyParty(undefined);
    }
  }

  async function changePurchase(
    flight: SelectedFlight,
    index: number,
    purchased: boolean,
  ) {
    const count = displayLegs(flight.itinerary).length;
    const statuses = Array.from(
      { length: count },
      (_, position) => flight.purchasedLegs?.[position] ?? false,
    );
    statuses[index] = purchased;
    setBusyParty(flight.partyId);
    setError(undefined);
    try {
      const saved = await setFlightPurchases(
        trip.id,
        flight.partyId,
        flight.cacheKey,
        flight.itineraryIndex,
        statuses,
      );
      setFlights((current) =>
        current.map((item) => (item.partyId === flight.partyId ? saved : item)),
      );
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
    <section className="plans-overview" aria-label="Trip overview">
      <Title2 as="h2">Trip overview</Title2>
      <Text>
        {trip.description ||
          "Keep your chosen flights and plans together here."}
      </Text>
      {error && <Text role="alert">{error}</Text>}
      {!loading && parties.length > 0 && (
        <div className="trip-people">
          {readOnly ? (
            <Card className="planning-card">
              <Title3 as="h3">Travelers</Title3>
              <Text>
                {parties
                  .flatMap((party) =>
                    party.members.map((member) => member.name),
                  )
                  .join(", ")}
              </Text>
            </Card>
          ) : (
            parties
              .filter((party) =>
                party.members.some((member) => member.id === trip.ownerUserId),
              )
              .map((party, index) => (
                <PartySelector
                  key={party.id}
                  userId={userId}
                  tripId={trip.id}
                  party={party}
                  index={index}
                  onChanged={refreshParties}
                />
              ))
          )}
        </div>
      )}
      {loading ? (
        <SelectedFlightsSkeleton />
      ) : flights.length === 0 ? (
        <Card className="planning-card">
          <Title3 as="h3">No flight selected yet</Title3>
          <Text>
            Choose an itinerary on the Flights tab to add it to this plan.
          </Text>
          {!readOnly && (
            <Button appearance="primary" onClick={onFindFlights}>
              Find flights
            </Button>
          )}
        </Card>
      ) : (
        flights.map((flight) => {
          const party = parties.find((item) => item.id === flight.partyId);
          const travelers =
            party?.members.map((member) => member.name).join(", ") ||
            "Travel party";
          const amount = flight.itinerary.price;
          const partyChanged =
            party && party.members.length !== flight.request.adults;
          return (
            <Card
              className="planning-card selected-flight-overview"
              key={flight.partyId}
            >
              <Title3 as="h3">{travelers}</Title3>
              {displayLegs(flight.itinerary).length > 0 ? (
                <JourneyLegs
                  legs={displayLegs(flight.itinerary)}
                  itinerary={flight.itinerary}
                  cities={cities}
                  preferredAirlines={
                    partySettings.find(
                      (settings) => settings.partyId === flight.partyId,
                    )?.preferredAirlines ?? []
                  }
                  purchasedLegs={flight.purchasedLegs ?? []}
                  onPurchaseChange={
                    readOnly
                      ? undefined
                      : (index, purchased) =>
                          void changePurchase(flight, index, purchased)
                  }
                  purchaseBusy={busyParty === flight.partyId}
                  booking={
                    readOnly
                      ? undefined
                      : {
                          tripId: trip.id,
                          cacheKey: flight.cacheKey,
                          itinerary: flight.itinerary,
                        }
                  }
                />
              ) : (
                <>
                  <Text weight="semibold">
                    {flight.request.origin} → {flight.request.destination} →{" "}
                    {flight.request.origin}
                  </Text>
                  <Text>
                    Depart {flight.request.departure_date} · Return flight{" "}
                    {flight.request.return_date}
                  </Text>
                </>
              )}
              {amount && <Text>Price when selected: {priceLabel(amount)}</Text>}
              <Text size={200}>Flight numbers: {flightNumbers(flight)}</Text>
              <Text size={200}>
                Selected {new Date(flight.selectedAt).toLocaleString()}. This is
                a saved choice, not a booking.
              </Text>
              {partyChanged && (
                <Text role="alert">
                  The party changed since this flight was selected. Choose a new
                  flight for the current travelers.
                </Text>
              )}
              {!readOnly && (
                <div className="selected-flight-actions">
                  <Button onClick={onFindFlights}>Change flight</Button>
                  <Button
                    disabled={busyParty === flight.partyId}
                    onClick={() => void remove(flight.partyId)}
                  >
                    Deselect flight
                  </Button>
                </div>
              )}
            </Card>
          );
        })
      )}
    </section>
  );
}

function flightNumbers(flight: SelectedFlight) {
  const segments = [
    ...(flight.itinerary.legs?.flatMap((leg) => leg.segments) ?? []),
    ...(flight.itinerary.outbound?.segments ?? []),
    ...(flight.itinerary.inbound?.segments ?? []),
  ];
  return segments
    .map((segment) => segment.flight_number || "Unknown")
    .join(", ");
}
