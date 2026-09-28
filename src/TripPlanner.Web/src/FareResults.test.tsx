import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import FareResults from "./FareResults";
import type { FareSearchResult } from "./operationsApi";
import type { PartySettings, PlanningParty } from "./planningApi";
import type { SelectedFlight } from "./selectedFlightsApi";

afterEach(() => vi.unstubAllGlobals());

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
    evaluations: Array.from({ length: 4 }, () => ({
      status: "Eligible" as const,
      issues: [],
    })),
    fetchedAt: "2030-01-01T12:00:00Z",
    expiresAt: "2030-01-01T13:00:00Z",
  },
];

test("uses shared flight cards for both round-trip legs without changing fare controls", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("/airports/cities")
        ? Response.json({ BOS: "Boston", CDG: "Paris" })
        : Response.json([]),
    ),
  );
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <FareResults
          tripId="trip"
          results={results}
          parties={[party]}
          partySettings={[settings]}
        />
      </MemoryRouter>
    </FluentProvider>,
  );

  expect(screen.getByText("Cheapest overall")).toBeVisible();
  expect(screen.getByText("Cheapest preferred airline")).toBeVisible();
  expect(screen.getByText("Cheapest nonstop flight")).toBeVisible();
  expect(
    screen.getByText("USD $30 more than the cheapest overall option."),
  ).toBeVisible();
  const cheapest = screen.getByText("Cheapest overall").closest("article")!;
  const outbound = within(cheapest)
    .getByText("Outbound flight")
    .closest(".flight-information") as HTMLElement;
  const inbound = within(cheapest)
    .getByText("Return flight")
    .closest(".flight-information") as HTMLElement;
  expect(outbound).toBeVisible();
  expect(inbound).toBeVisible();
  expect(within(outbound).getAllByText(/DL 123/)).not.toHaveLength(0);
  expect(within(outbound).getByText(/Layover in CDG · 1h 0m/)).toBeVisible();
  expect(outbound).toHaveTextContent("Delta · 1 stop · 5h 0m");
  await waitFor(() => {
    expect(
      within(outbound).getByText("Boston (BOS) → Paris (CDG)"),
    ).toBeVisible();
    expect(
      within(inbound).getByText("Boston (BOS) → Paris (CDG)"),
    ).toBeVisible();
  });
  expect(screen.getByRole("button", { name: "Book this fare" })).toBeVisible();
  const departureTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, 8, 0));
  expect(outbound).toHaveTextContent(departureTime);
  expect(outbound).not.toHaveTextContent("2030-01-05");
  expect(screen.getByText("More matching options (1)")).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getAllByRole("article")[0]).toHaveClass("fare-card");
  fireEvent.click(screen.getByText("More matching options (1)"));
  expect(screen.getAllByRole("article")).toHaveLength(4);

  expect(screen.getByRole("combobox", { name: "Airline" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Arrival time" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Stops" })).toBeVisible();
  expect(screen.getByLabelText("Minimum price slider")).toBeVisible();
  expect(screen.getByLabelText("Maximum price slider")).toBeVisible();
});

test("never recommends or offers booking for a rejected itinerary", () => {
  const checked = structuredClone(results);
  checked[0].evaluations[0] = {
    status: "Rejected",
    issues: [
      {
        code: "presence",
        message: "Arrival is after the required stay begins.",
        constraintIds: ["required-stay"],
      },
    ],
  };
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <FareResults
          tripId="trip"
          results={checked}
          parties={[party]}
          partySettings={[settings]}
        />
      </MemoryRouter>
    </FluentProvider>,
  );
  expect(
    screen.getByText("Cheapest overall").closest("article"),
  ).toHaveTextContent("USD $130");
  fireEvent.click(screen.getByText("Excluded or unverified options (1)"));
  const rejected = screen
    .getByText("Arrival is after the required stay begins.")
    .closest("article")!;
  expect(
    within(rejected).queryByRole("button", { name: "Book this fare" }),
  ).not.toBeInTheDocument();
});

test("selects, replaces, and clears a flight for the party", async () => {
  let selected: SelectedFlight | undefined;
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const { cacheKey, itineraryIndex } = JSON.parse(String(init.body)) as {
          cacheKey: string;
          itineraryIndex: number;
        };
        selected = {
          tripId: "trip",
          partyId: "party",
          cacheKey,
          itineraryIndex,
          request: results[0].request,
          itinerary: results[0].response.itineraries[itineraryIndex],
          selectedAt: "2030-01-01T12:00:00Z",
        };
        return Response.json(selected);
      }
      if (init?.method === "DELETE") {
        selected = undefined;
        return new Response(null, { status: 204 });
      }
      return Response.json(selected ? [selected] : []);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <FareResults
          tripId="trip"
          results={results}
          parties={[party]}
          partySettings={[settings]}
        />
      </MemoryRouter>
    </FluentProvider>,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Select flight" })[0]);
  await waitFor(() => expect(selected?.itineraryIndex).toBe(0));
  const alternative = screen.getByText("USD $130").closest("article")!;
  fireEvent.click(
    within(alternative).getByRole("button", { name: "Change to this flight" }),
  );
  await waitFor(() => expect(selected?.itineraryIndex).toBe(1));
  fireEvent.click(
    within(alternative).getByRole("button", { name: "Deselect flight" }),
  );
  await waitFor(() => expect(selected).toBeUndefined());
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/selectedFlights/party"),
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ cacheKey: "cache", itineraryIndex: 1 }),
    }),
  );
});

test("does not label a different refreshed itinerary as selected", async () => {
  const selected = {
    tripId: "trip",
    partyId: "party",
    cacheKey: "cache",
    itineraryIndex: 0,
    request: results[0].request,
    itinerary: results[0].response.itineraries[0],
    selectedAt: "2030-01-01T12:00:00Z",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json([selected])),
  );
  const refreshed = structuredClone(results);
  refreshed[0].response.itineraries[0].ignav_id = "different-fare";
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <FareResults
          tripId="trip"
          results={refreshed}
          parties={[party]}
          partySettings={[settings]}
        />
      </MemoryRouter>
    </FluentProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: "Change to this flight" }).length,
    ).toBeGreaterThan(0),
  );
  expect(screen.queryByText("Selected for this trip")).not.toBeInTheDocument();
});

test("restores fare filters from the route and updates its query", () => {
  function RouteQuery() {
    return <output data-testid="route-query">{useLocation().search}</output>;
  }
  render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/trips/trip?advanced=1&minPrice=140"]}>
        <FareResults
          tripId="trip"
          results={results}
          parties={[party]}
          partySettings={[settings]}
        />
        <RouteQuery />
      </MemoryRouter>
    </FluentProvider>,
  );

  expect(screen.getByRole("spinbutton", { name: "Minimum price" })).toHaveValue(
    140,
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: "Minimum price" }), {
    target: { value: "150" },
  });
  expect(screen.getByTestId("route-query")).toHaveTextContent("advanced=1");
  expect(screen.getByTestId("route-query")).toHaveTextContent("minPrice=150");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByTestId("route-query")).toHaveTextContent("advanced=1");
  expect(screen.getByTestId("route-query")).not.toHaveTextContent("minPrice");
});
