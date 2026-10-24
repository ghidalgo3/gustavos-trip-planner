import type { FlightRouteResult } from "./flightRouteGraph";
import { legKey } from "./flightFormatting";
import type {
  FlightChoiceProgress,
  SelectedFlight,
} from "./selectedFlightsApi";

export function restoredFlightKeys(
  choices: Record<string, (string | null)[]>,
  selected: SelectedFlight[],
): Record<string, (string | null)[]> {
  return {
    ...Object.fromEntries(
      selected.map((flight) => [
        flight.partyId,
        (flight.itinerary.legs ?? []).map(legKey),
      ]),
    ),
    ...choices,
  };
}

export function restoreFlightResults(
  results: FlightRouteResult[],
  choices: Record<string, FlightChoiceProgress>,
  selected: SelectedFlight[],
  keys: Record<string, (string | null)[]>,
  legCount: number,
): FlightRouteResult[] {
  const restored = new Map(results.map((result) => [result.partyId, result]));
  for (const [partyId, chosen] of Object.entries(keys)) {
    const selection = selected.find((flight) => flight.partyId === partyId);
    // An explicitly cleared choice takes precedence over an older complete itinerary.
    const saved =
      choices[partyId]?.flights ??
      (selection?.itinerary.legs ?? []).map((leg, legIndex) => ({
        leg,
        legIndex,
      }));
    const flights = saved.filter(
      ({ legIndex, leg }) =>
        legIndex >= 0 &&
        legIndex < legCount &&
        chosen[legIndex] === legKey(leg),
    );
    if (flights.length === 0) continue;
    const result = restored.get(partyId) ?? {
      partyId,
      savedOnly: true,
      cacheKey: selection?.cacheKey ?? "",
      response: { itineraries: [] },
      evaluations: [],
    };
    const merged = [...(result.response.flights ?? [])];
    for (const flight of flights) {
      if (
        !merged.some(
          (option) =>
            option.legIndex === flight.legIndex &&
            legKey(option.leg) === legKey(flight.leg),
        )
      ) {
        // Retained legs are displayable even without a currently validated complete route.
        // Append to preserve all server-provided connection indexes; never invent edges.
        merged.push({ ...flight, bookingLegCount: 1 });
      }
    }
    restored.set(partyId, {
      ...result,
      response: { ...result.response, flights: merged },
    });
  }
  return [...restored.values()];
}
