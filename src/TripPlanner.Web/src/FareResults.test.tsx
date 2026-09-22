import { render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test } from "vitest";
import FareResults from "./FareResults";
import type { FareSearchResult } from "./operationsApi";
import type { PartySettings, PlanningParty } from "./planningApi";

const party: PlanningParty = {
  id: "party",
  members: [{ id: "user", name: "Ada", homeCity: "Boston" }],
};
const settings: PartySettings = {
  partyId: "party",
  origin: null,
  cabin: "economy",
  market: "US",
  maxJourneyHours: 48,
  maxStops: null,
  preferredAirlines: ["UA"],
};
const segment = (code: string, departure: string, arrival: string) => ({
  departure_airport: "BOS",
  arrival_airport: "CDG",
  departure_time_local: departure,
  arrival_time_local: arrival,
  marketing_carrier_code: code,
  flight_number: "123",
});
const results: FareSearchResult[] = [
  {
    partyId: "party",
    cacheKey: "cache",
    request: {
      origin: "BOS",
      destination: "CDG",
      departure_date: "2030-01-05",
      return_date: "2030-01-15",
      adults: 1,
      cabin_class: "economy",
      market: "US",
    },
    response: {
      itineraries: [
        {
          ignav_id: "fare-1",
          price: { amount: 100, currency: "USD" },
          outbound: {
            carrier: "Delta",
            duration_minutes: 300,
            segments: [
              segment("DL", "2030-01-05T08:00", "2030-01-05T10:00"),
              segment("DL", "2030-01-05T11:00", "2030-01-05T13:00"),
            ],
          },
          inbound: {
            carrier: "Delta",
            duration_minutes: 300,
            segments: [
              segment("DL", "2030-01-15T08:00", "2030-01-15T10:00"),
              segment("DL", "2030-01-15T11:00", "2030-01-15T13:00"),
            ],
          },
        },
        {
          price: { amount: 130, currency: "USD" },
          outbound: {
            carrier: "United",
            segments: [
              segment("UA", "2030-01-05T09:00", "2030-01-05T11:00"),
              segment("UA", "2030-01-05T12:00", "2030-01-05T14:00"),
            ],
          },
          inbound: {
            carrier: "United",
            segments: [
              segment("UA", "2030-01-15T09:00", "2030-01-15T11:00"),
              segment("UA", "2030-01-15T12:00", "2030-01-15T14:00"),
            ],
          },
        },
        {
          price: { amount: 140, currency: "USD" },
          outbound: {
            carrier: "British Airways",
            segments: [segment("BA", "2030-01-05T10:00", "2030-01-05T14:00")],
          },
          inbound: {
            carrier: "British Airways",
            segments: [segment("BA", "2030-01-15T10:00", "2030-01-15T14:00")],
          },
        },
        {
          price: { amount: 150, currency: "USD" },
          outbound: {
            carrier: "Air France",
            segments: [
              segment("AF", "2030-01-05T11:00", "2030-01-05T14:00"),
              segment("AF", "2030-01-05T15:00", "2030-01-05T17:00"),
            ],
          },
          inbound: {
            carrier: "Air France",
            segments: [
              segment("AF", "2030-01-15T11:00", "2030-01-15T14:00"),
              segment("AF", "2030-01-15T15:00", "2030-01-15T17:00"),
            ],
          },
        },
      ],
    },
    fetchedAt: "2030-01-01T12:00:00Z",
    expiresAt: "2030-01-01T13:00:00Z",
  },
];

test("highlights three fare categories and places the remainder behind a disclosure", () => {
  render(
    <FluentProvider theme={webLightTheme}>
      <FareResults
        tripId="trip"
        results={results}
        parties={[party]}
        partySettings={[settings]}
      />
    </FluentProvider>,
  );

  expect(screen.getByText("Cheapest overall")).toBeVisible();
  expect(screen.getByText("Cheapest preferred airline")).toBeVisible();
  expect(screen.getByText("Cheapest nonstop flight")).toBeVisible();
  expect(
    screen.getByText("USD 30 more than the cheapest overall option."),
  ).toBeVisible();
  expect(screen.getAllByText("Departure time")).not.toHaveLength(0);
  expect(screen.getAllByText(/DL 123/)).not.toHaveLength(0);
  expect(screen.getByRole("button", { name: "Book this fare" })).toBeVisible();
  expect(screen.getByText("Outbound: 5 hrs")).toBeVisible();
  expect(screen.getAllByText("(1 hr in CDG)")).not.toHaveLength(0);
  expect(
    screen.getByText(
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date("2030-01-05T08:00")),
    ),
  ).toBeVisible();
  expect(screen.getByText("More matching options (1)")).toBeVisible();

  expect(screen.getByRole("combobox", { name: "Airline" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Arrival time" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Stops" })).toBeVisible();
  expect(screen.getByLabelText("Minimum price slider")).toBeVisible();
  expect(screen.getByLabelText("Maximum price slider")).toBeVisible();
});
