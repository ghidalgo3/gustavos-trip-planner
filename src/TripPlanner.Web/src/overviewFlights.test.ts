import { expect, test } from "vitest";
import { matchingFlightLegs, selectedLegs } from "./overviewFlights";
import type { FareLeg } from "./operationsApi";
import { flightNumbers, legKey } from "./flightFormatting";

const outbound: FareLeg = {
  segments: [
    {
      departure_airport: "JFK",
      arrival_airport: "LHR",
      departure_time_local: "2027-06-09T21:00",
      arrival_time_local: "2027-06-10T09:00",
    },
    {
      departure_airport: "LHR",
      arrival_airport: "CDG",
      departure_time_local: "2027-06-10T11:00",
      arrival_time_local: "2027-06-10T13:00",
    },
  ],
};
const inbound: FareLeg = {
  segments: [
    {
      departure_airport: "CDG",
      arrival_airport: "JFK",
      departure_time_local: "2027-06-14T11:00",
      arrival_time_local: "2027-06-14T13:00",
    },
  ],
};
const cities = { JFK: "New York", LHR: "London", CDG: "Paris" };
test("home flight cards match complete legs, including overnight arrivals and layovers", () => {
  expect(
    matchingFlightLegs(
      { city: "New York, NY" },
      { city: "Paris", arrivalDate: "2027-06-10" },
      [outbound, inbound],
      cities,
    ),
  ).toEqual([outbound]);
  expect(
    matchingFlightLegs(
      { city: "Paris", departureDate: "2027-06-14" },
      { city: "New York" },
      [outbound, inbound],
      cities,
    ),
  ).toEqual([inbound]);
});
test("repeated stays do not display a flight from a different visit, and an unknown home cannot match", () => {
  expect(
    matchingFlightLegs(
      { city: "New York" },
      { city: "Paris", arrivalDate: "2027-07-10" },
      [outbound],
      cities,
    ),
  ).toEqual([]);
  expect(
    matchingFlightLegs({ city: null }, { city: "Paris" }, [outbound], cities),
  ).toEqual([]);
});

test("destination flexibility allows selected flights to appear for their planned stay", () => {
  expect(
    matchingFlightLegs(
      { city: "New York" },
      { city: "Paris", arrivalDate: "2027-06-11", arrivalFlexibilityDays: 1 },
      [outbound],
      cities,
    ),
  ).toEqual([outbound]);
  expect(
    matchingFlightLegs(
      {
        city: "Paris",
        departureDate: "2027-06-13",
        departureFlexibilityDays: 1,
      },
      { city: "New York" },
      [inbound],
      cities,
    ),
  ).toEqual([inbound]);
});
test("overview links include every connecting flight's carrier and number", () => {
  const leg = {
    ...outbound,
    segments: outbound.segments.map((segment, index) => ({
      ...segment,
      marketing_carrier_code: index ? "BA" : "AA",
      flight_number: index ? "BA200" : "100",
    })),
  };
  expect(flightNumbers(leg)).toBe("AA 100 · BA200");
});

test("partial choices merge across parties without duplicating shared flights or showing unselected bundle legs", () => {
  const choice = {
    partyId: "party",
    legKeys: [null, legKey(inbound)],
    nextOrigins: [],
    flights: [
      { legIndex: 0, leg: outbound },
      { legIndex: 1, leg: inbound },
    ],
  };
  expect(
    selectedLegs([], [choice, { ...choice, partyId: "another-party" }]),
  ).toEqual([inbound]);
  expect(
    selectedLegs(
      [],
      [
        choice,
        {
          partyId: "third-party",
          legKeys: [legKey(outbound)],
          nextOrigins: [],
          flights: [{ legIndex: 0, leg: outbound }],
        },
      ],
    ),
  ).toEqual([inbound, outbound]);
  expect(selectedLegs([], [{ ...choice, legKeys: [] }])).toEqual([]);
});
