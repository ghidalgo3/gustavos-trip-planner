import { expect, test } from "vitest";
import type { FareLeg } from "../../api/operationsApi";
import { legKey } from "./flightFormatting";
import type { FlightRouteResult } from "./flightRouteGraph";
import type { SelectedFlight } from "./selectedFlightsApi";
import {
  restoreFlightResults,
  restoredFlightKeys,
} from "./restoreFlightResults";

const leg = (number: string): FareLeg => ({
  segments: [
    {
      departure_airport: "ATL",
      arrival_airport: "BOS",
      departure_time_local: "2030-05-01T10:00:00",
      arrival_time_local: "2030-05-01T12:00:00",
      flight_number: number,
    },
  ],
});

test("merges retained selections without duplicating flights or changing validated connection indexes", () => {
  const current = leg("1"),
    saved = leg("2");
  const result: FlightRouteResult = {
    partyId: "party",
    cacheKey: "cache",
    response: {
      itineraries: [],
      flights: [
        { legIndex: 0, leg: current, bookingLegCount: 1 },
        { legIndex: 1, leg: current, bookingLegCount: 1 },
      ],
      flightConnections: [{ fromFlightIndex: 0, toFlightIndex: 1 }],
    },
    evaluations: [],
  };
  const choices = {
    party: {
      partyId: "party",
      legKeys: [legKey(saved), legKey(current)],
      nextOrigins: [],
      flights: [
        { legIndex: 0, leg: saved },
        { legIndex: 1, leg: current },
      ],
    },
  };
  const restored = restoreFlightResults(
    [result],
    choices,
    [],
    { party: choices.party.legKeys },
    2,
  )[0];
  expect(restored.response.flights).toHaveLength(3);
  expect(restored.response.flights?.slice(0, 2)).toEqual(
    result.response.flights,
  );
  expect(restored.response.flightConnections).toEqual(
    result.response.flightConnections,
  );
  expect(restored.response.itineraries).toEqual([]);
  expect(result.response.flights).toHaveLength(2);
});

test("an explicitly cleared choice cannot resurrect a previous complete itinerary", () => {
  const selected = [
    { partyId: "party", itinerary: { legs: [leg("1")] } },
  ] as SelectedFlight[];
  expect(restoredFlightKeys({}, selected)).toEqual({
    party: [legKey(leg("1"))],
  });
  const keys = restoredFlightKeys({ party: [] }, selected);
  expect(keys).toEqual({ party: [] });
  expect(restoreFlightResults([], {}, selected, keys, 2)).toEqual([]);
});

test("an old complete route cannot flash in the wrong columns while reconciled choices load", () => {
  const selected = [
    { partyId: "party", itinerary: { legs: [leg("outbound"), leg("return")] } },
  ] as SelectedFlight[];
  expect(restoredFlightKeys({}, selected, 3)).toEqual({});
  const reconciled = {
    party: [legKey(leg("outbound")), null, legKey(leg("return"))],
  };
  expect(restoredFlightKeys(reconciled, selected, 3)).toEqual(reconciled);
});

test("restores a remapped return under the new return column without inventing connections", () => {
  const home = leg("return");
  const keys = [null, null, null, null, null, legKey(home)];
  const restored = restoreFlightResults(
    [],
    {
      party: {
        partyId: "party",
        legKeys: keys,
        nextOrigins: [],
        flights: [{ legIndex: 5, leg: home }],
      },
    },
    [],
    { party: keys },
    6,
  )[0];
  expect(restored.response.flights).toEqual([
    { legIndex: 5, leg: home, bookingLegCount: 1 },
  ]);
  expect(restored.response.itineraries).toEqual([]);
  expect(restored.response.flightConnections).toBeUndefined();
});

test("retains a review view when none of the saved flights fit the changed route", () => {
  const choices = {
    party: {
      partyId: "party",
      legKeys: [],
      nextOrigins: [],
      flights: [],
      unmatchedFlights: [leg("old")],
    },
  };
  const restored = restoreFlightResults([], choices, [], { party: [] }, 3);
  expect(restored).toHaveLength(1);
  expect(restored[0].savedOnly).toBe(true);
  expect(restored[0].response.flights).toEqual([]);
});
