import { fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, test, vi } from "vitest";
import FirstLegResults from "./FirstLegResults";
import { legKey } from "./flightFormatting";
import type { FareSearchResult } from "./operationsApi";

afterEach(() => vi.unstubAllGlobals());

test("shows a first-leg fare while the rest of a route is searching", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ATL: "Atlanta", HKT: "Phuket" })),
  );
  const choose = vi.fn().mockResolvedValue(true);
  const result: FareSearchResult = {
    partyId: "party",
    cacheKey: "fare",
    request: {
      origin: "ATL",
      destination: "HKT",
      departure_date: "2030-05-01",
      return_date: "2030-05-01",
      adults: 1,
      cabin_class: "economy",
      market: "US",
      searchKind: "oneWay",
      searchPriority: 0,
    },
    response: {
      itineraries: [
        {
          price: { amount: 800, currency: "USD" },
          outbound: {
            segments: [
              {
                departure_airport: "ATL",
                arrival_airport: "HKT",
                departure_time_local: "2030-05-01T09:00:00",
                arrival_time_local: "2030-05-02T20:00:00",
                marketing_carrier_code: "DL",
                flight_number: "123",
              },
            ],
          },
        },
      ],
    },
    evaluations: [{ status: "Unverifiable", issues: [] }],
    fetchedAt: "2030-01-01T00:00:00Z",
    expiresAt: "2030-01-01T01:00:00Z",
  };
  render(
    <FluentProvider theme={webLightTheme}>
      <FirstLegResults
        results={[result]}
        parties={[
          {
            id: "party",
            members: [{ id: "user", name: "Ada", homeCity: "Atlanta" }],
          },
        ]}
        choices={{}}
        legCount={4}
        onChoose={choose}
      />
    </FluentProvider>,
  );
  expect(screen.getByText(/Flight 1 of 4/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 1" }));
  expect(choose).toHaveBeenCalledWith("party", [expect.any(String)]);
});

test("features different airlines before repeating cheaper airline options", () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
  const results: FareSearchResult[] = Array.from({ length: 7 }, (_, index) => ({
    partyId: "party",
    cacheKey: `fare-${index}`,
    request: {
      origin: "ATL",
      destination: "HKT",
      departure_date: "2030-05-01",
      return_date: "2030-05-01",
      adults: 1,
      cabin_class: "economy",
      market: "US",
      searchKind: "oneWay",
      searchPriority: 0,
    },
    response: {
      itineraries: [
        {
          price: { amount: 100 + index * 10, currency: "USD" },
          outbound: {
            carrier: index === 6 ? "Turkish Airlines" : "Etihad",
            segments: [
              {
                departure_airport: "ATL",
                arrival_airport: "HKT",
                departure_time_local: `2030-05-01T${String(index + 9).padStart(2, "0")}:00:00`,
                arrival_time_local: "2030-05-02T20:00:00",
                marketing_carrier_code: index === 6 ? "TK" : "EY",
              },
            ],
          },
        },
      ],
    },
    evaluations: [{ status: "Eligible", issues: [] }],
    fetchedAt: "2030-01-01T00:00:00Z",
    expiresAt: "2030-01-01T01:00:00Z",
  }));
  render(
    <FluentProvider theme={webLightTheme}>
      <FirstLegResults
        results={results}
        parties={[
          {
            id: "party",
            members: [{ id: "user", name: "Ada", homeCity: "Atlanta" }],
          },
        ]}
        choices={{}}
        legCount={4}
        onChoose={vi.fn().mockResolvedValue(true)}
      />
    </FluentProvider>,
  );
  expect(
    screen.getByText("Option 2").closest(".flight-information"),
  ).toHaveTextContent("Turkish Airlines");
});

test("shows the next cached leg after the first flight is saved", () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
  const first = {
    segments: [
      {
        departure_airport: "ATL",
        arrival_airport: "SAN",
        departure_time_local: "2030-05-01T09:00:00",
        arrival_time_local: "2030-05-01T12:00:00",
        marketing_carrier_code: "DL",
        flight_number: "100",
      },
    ],
  };
  const second = {
    segments: [
      {
        departure_airport: "SAN",
        arrival_airport: "SFO",
        departure_time_local: "2030-05-05T09:00:00",
        arrival_time_local: "2030-05-05T11:00:00",
        marketing_carrier_code: "UA",
        flight_number: "200",
      },
    ],
  };
  const fare: FareSearchResult = {
    partyId: "party",
    cacheKey: "second",
    request: {
      origin: "SAN",
      destination: "SFO",
      departure_date: "2030-05-05",
      return_date: "2030-05-05",
      adults: 1,
      cabin_class: "economy",
      market: "US",
      searchKind: "oneWay",
      searchPriority: 1,
    },
    response: {
      itineraries: [
        { outbound: second, price: { amount: 200, currency: "USD" } },
      ],
    },
    evaluations: [{ status: "Unverifiable", issues: [] }],
    fetchedAt: "2030-01-01T00:00:00Z",
    expiresAt: "2030-01-01T01:00:00Z",
  };
  const choose = vi.fn().mockResolvedValue(true);
  render(
    <FluentProvider theme={webLightTheme}>
      <FirstLegResults
        results={[fare]}
        parties={[
          {
            id: "party",
            members: [{ id: "user", name: "Ada", homeCity: "Atlanta" }],
          },
        ]}
        choices={{
          party: {
            partyId: "party",
            legKeys: [legKey(first)],
            nextOrigins: ["SAN"],
          },
        }}
        legCount={4}
        onChoose={choose}
      />
    </FluentProvider>,
  );
  expect(screen.getByText(/Flight 2 of 4/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 2" }));
  expect(choose).toHaveBeenCalledWith("party", [legKey(first), legKey(second)]);
});

test("moves to a waiting second leg when its search has not finished", () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
  render(
    <FluentProvider theme={webLightTheme}>
      <FirstLegResults
        results={[]}
        parties={[
          {
            id: "party",
            members: [{ id: "user", name: "Ada", homeCity: "Atlanta" }],
          },
        ]}
        choices={{
          party: {
            partyId: "party",
            legKeys: ["saved-first-flight"],
            nextOrigins: ["SAN"],
          },
        }}
        legCount={4}
        onChoose={vi.fn().mockResolvedValue(true)}
        searching
      />
    </FluentProvider>,
  );
  expect(screen.getByText(/Flight 2 of 4/)).toBeVisible();
  expect(screen.getByText("Searching flights for flight 2…")).toBeVisible();
});
