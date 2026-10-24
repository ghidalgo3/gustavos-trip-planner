import type {
  SelectedFlight,
  FlightChoiceProgress,
} from "../flights/selectedFlightsApi";
import type { FareLeg } from "../../api/operationsApi";
import type { AirportCities } from "../flights/flightFormatting";
import { legKey } from "../flights/flightFormatting";

export function selectedLegs(
  flights: SelectedFlight[],
  choices: FlightChoiceProgress[] = [],
): FareLeg[] {
  const partial = choices.filter((choice) => choice.legKeys.some(Boolean));
  const parties = new Set(partial.map((choice) => choice.partyId));
  const legs = [
    ...partial.flatMap((choice) =>
      (choice.flights ?? [])
        .filter(
          (flight) => choice.legKeys[flight.legIndex] === legKey(flight.leg),
        )
        .map((flight) => flight.leg),
    ),
    ...flights
      .filter((flight) => !parties.has(flight.partyId))
      .flatMap(
        ({ itinerary }) =>
          itinerary.legs ??
          [itinerary.outbound, itinerary.inbound].filter(
            (leg): leg is FareLeg => Boolean(leg),
          ),
      ),
  ];
  return [...new Map(legs.map((leg) => [legKey(leg), leg])).values()];
}
function cityKey(city: string) {
  return city
    .split(",")[0]
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
export type FlightStop = {
  city: string | null;
  arrivalDate?: string | null;
  departureDate?: string | null;
  arrivalFlexibilityDays?: number;
  departureFlexibilityDays?: number;
};
function withinDate(
  date: string | undefined,
  target: string | null | undefined,
  flexibility = 0,
) {
  if (!target) return true;
  if (!date) return false;
  const difference =
    Math.abs(
      Date.parse(`${date.slice(0, 10)}T00:00:00Z`) -
        Date.parse(`${target}T00:00:00Z`),
    ) / 86400000;
  return difference <= flexibility;
}
export function matchingFlightLegs(
  from: FlightStop,
  to: FlightStop,
  legs: FareLeg[],
  cities: AirportCities,
) {
  return legs.filter((leg) => {
    const first = leg.segments[0],
      last = leg.segments.at(-1);
    if (!first || !last) return false;
    const origin = cities[first.departure_airport],
      destination = cities[last.arrival_airport];
    return (
      origin &&
      destination &&
      from.city &&
      to.city &&
      cityKey(origin) === cityKey(from.city) &&
      cityKey(destination) === cityKey(to.city) &&
      withinDate(
        first.departure_time_local,
        from.departureDate,
        from.departureFlexibilityDays,
      ) &&
      withinDate(
        last.arrival_time_local,
        to.arrivalDate,
        to.arrivalFlexibilityDays,
      )
    );
  });
}
