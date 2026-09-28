import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import RouteFareResults from "./RouteFareResults";
import type { FareItinerary, FareSearchResult } from "./operationsApi";

afterEach(() => vi.unstubAllGlobals());

const outbound = {
  carrier: "American Airlines",
  duration_minutes: 600,
  segments: [
    {
      departure_airport: "ATL",
      arrival_airport: "AMS",
      departure_time_local: "2030-05-01T09:00:00",
      arrival_time_local: "2030-05-01T20:00:00",
      departure_time_utc: "2030-05-01T13:00:00Z",
      arrival_time_utc: "2030-05-01T18:00:00Z",
      marketing_carrier_code: "AA",
      operating_carrier_name: "American Airlines",
      flight_number: "100",
    },
    {
      departure_airport: "AMS",
      arrival_airport: "HKT",
      departure_time_local: "2030-05-01T21:30:00",
      arrival_time_local: "2030-05-02T15:00:00",
      departure_time_utc: "2030-05-01T19:30:00Z",
      arrival_time_utc: "2030-05-02T08:00:00Z",
      marketing_carrier_code: "KL",
      operating_carrier_name: "KLM",
      flight_number: "111",
    },
  ],
};
const returns = [
  {
    carrier: "Japan Airlines",
    duration_minutes: 780,
    segments: [
      {
        departure_airport: "HKT",
        arrival_airport: "ATL",
        departure_time_local: "2030-05-13T09:00:00",
        arrival_time_local: "2030-05-13T20:00:00",
        marketing_carrier_code: "JL",
        operating_carrier_name: "Japan Airlines",
        flight_number: "10",
      },
    ],
  },
  {
    carrier: "American Airlines",
    duration_minutes: 800,
    segments: [
      {
        departure_airport: "HKT",
        arrival_airport: "ATL",
        departure_time_local: "2030-05-14T10:00:00",
        arrival_time_local: "2030-05-14T21:00:00",
        marketing_carrier_code: "AA",
        operating_carrier_name: "American Airlines",
        flight_number: "20",
      },
    ],
  },
];
const itineraries: FareItinerary[] = [
  {
    legs: [outbound, returns[0]],
    price: { amount: 900, currency: "USD" },
    stops: 1,
    bookingOffers: [
      { ignavId: "outbound-offer", legIndexes: [0] },
      { ignavId: "return-0", legIndexes: [1] },
    ],
  },
  {
    legs: [outbound, returns[1]],
    price: { amount: 1100, currency: "USD" },
    stops: 1,
    bookingOffers: [
      { ignavId: "outbound-offer", legIndexes: [0] },
      { ignavId: "return-1", legIndexes: [1] },
    ],
  },
];
const result: FareSearchResult = {
  partyId: "party",
  cacheKey: "assembled",
  request: {
    origin: "ATL",
    destination: "HKT",
    departure_date: "2030-05-01",
    return_date: "2030-05-13",
    adults: 1,
    cabin_class: "economy",
    market: "US",
    searchKind: "itinerary",
  },
  response: { itineraries },
  evaluations: [],
  fetchedAt: "2030-01-01T00:00:00Z",
  expiresAt: "2030-01-01T01:00:00Z",
};

function show() {
  render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <RouteFareResults tripId="trip" results={[result]} parties={[]} />
      </FluentProvider>
    </MemoryRouter>,
  );
}

test("builds a feasible route one flight at a time and saves the chosen complete itinerary", async () => {
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes("/airports/cities"))
      return Response.json({ ATL: "Atlanta", AMS: "Amsterdam", HKT: "Phuket" });
    if (init?.method === "PUT") {
      const { itineraryIndex } = JSON.parse(init.body as string);
      return Response.json({
        tripId: "trip",
        partyId: "party",
        cacheKey: "assembled",
        itineraryIndex,
        request: result.request,
        itinerary: itineraries[itineraryIndex],
        selectedAt: "2030-01-01T00:00:00Z",
        purchasedLegs: [false, false],
      });
    }
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetch);
  show();
  expect(
    await screen.findByText(
      "Flight 1 of 2: choose Atlanta (ATL) → Phuket (HKT)",
    ),
  ).toBeVisible();
  expect(screen.getByText("Layover in Amsterdam (AMS) · 1h 30m")).toBeVisible();
  expect(screen.getByText(/Option 1 · American Airlines/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Edit flights" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 1" }));
  expect(
    screen.getByText("Flight 2 of 2: choose Phuket (HKT) → Atlanta (ATL)"),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Edit flights" })).toBeVisible();
  expect(screen.getByText(/Option 2 · American Airlines/)).toBeVisible();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Choose flight 2" })[1],
  );
  expect(screen.getByLabelText("Completed itinerary")).toHaveTextContent(
    "USD $1,100",
  );
  expect(screen.getByText("12 night stay")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Save complete itinerary" }),
  );
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/selectedFlights/party"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ cacheKey: "assembled", itineraryIndex: 1 }),
      }),
    ),
  );
  expect(
    await screen.findByText("Selected itinerary · USD $1,100"),
  ).toBeVisible();
  const switches = within(
    screen.getByLabelText("Completed itinerary"),
  ).getAllByRole("switch", { name: "Purchased" });
  fireEvent.click(switches[1]);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/selectedFlights/party/purchases"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          cacheKey: "assembled",
          itineraryIndex: 1,
          purchasedLegs: [false, true],
        }),
      }),
    ),
  );
});

test("filters complete routes by total price and outbound and return flight dates", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json([])),
  );
  show();
  fireEvent.change(screen.getByLabelText("Minimum total price (USD)"), {
    target: { value: "1000" },
  });
  expect(screen.getByText(/Complete trip from USD \$1,100/)).toBeVisible();
  expect(
    screen.queryByText(/Complete trip from USD \$900/),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Return flight date"), {
    target: { value: "2030-05-13" },
  });
  expect(
    screen.getByText(/No complete routes match these price and date filters/),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Return flight date"), {
    target: { value: "2030-05-14" },
  });
  fireEvent.change(screen.getByLabelText("Trip start date"), {
    target: { value: "2030-05-01" },
  });
  expect(screen.getByText(/Complete trip from USD \$1,100/)).toBeVisible();
});

test("shows every compatible return airline and keeps earlier flights in Edit flights", async () => {
  const extraReturns = [
    {
      ...returns[0],
      carrier: "Delta Air Lines",
      segments: [
        {
          ...returns[0].segments[0],
          marketing_carrier_code: "DL",
          operating_carrier_name: "Delta Air Lines",
          flight_number: "294",
        },
      ],
    },
    {
      ...returns[0],
      carrier: "Air Canada",
      segments: [
        {
          ...returns[0].segments[0],
          marketing_carrier_code: "AC",
          operating_carrier_name: "Air Canada",
          flight_number: "100",
        },
      ],
    },
  ];
  const alternatives = [...returns, ...extraReturns].map((leg, index) => ({
    ...itineraries[0],
    legs: [outbound, leg],
    price: { amount: 900 + index * 20, currency: "USD" },
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("/airports/cities")
        ? Response.json({ ATL: "Atlanta", HKT: "Phuket" })
        : Response.json([]),
    ),
  );
  render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <RouteFareResults
          tripId="trip"
          results={[{ ...result, response: { itineraries: alternatives } }]}
          parties={[]}
        />
      </FluentProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 1" }));
  expect(
    screen.getAllByRole("button", { name: "Choose flight 2" }),
  ).toHaveLength(4);
  expect(screen.getByText(/Option 3 · Delta Air Lines/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit flights" }));
  expect(
    await screen.findByRole("menuitem", {
      name: /Flight 1: Atlanta \(ATL\) → Phuket \(HKT\)/,
    }),
  ).toBeVisible();
});

test("shows only Ignav-classified airline booking links for the relevant leg", async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST")
      return Response.json({
        booking_options: [
          {
            leg_indexes: [0],
            links: [
              {
                provider_type: "airline",
                provider_name: "American Airlines",
                url: "aa.com/booking/123",
              },
              {
                provider_type: "third_party",
                provider_name: "Expedia",
                url: "https://expedia.com/checkout",
              },
              {
                provider_type: "airline",
                provider_name: "Unsafe",
                url: "javascript:alert(1)",
              },
            ],
          },
        ],
      });
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetch);
  show();
  const firstOption = screen
    .getByText(/Option 1 · American Airlines/)
    .closest("div")?.parentElement;
  expect(firstOption).toBeTruthy();
  fireEvent.click(
    within(firstOption!).getByRole("button", {
      name: "Airline booking options",
    }),
  );
  const link = await screen.findByRole("link", {
    name: /Book on American Airlines/,
  });
  expect(link).toHaveAttribute("href", "https://aa.com/booking/123");
  expect(
    screen.queryByRole("link", { name: /Expedia|Unsafe/ }),
  ).not.toBeInTheDocument();
});

test("identifies the other flight covered by a paired airline booking", async () => {
  const paired: FareSearchResult = {
    ...result,
    response: {
      itineraries: [
        {
          ...itineraries[0],
          bookingOffers: [{ ignavId: "paired-offer", legIndexes: [0, 1] }],
        },
      ],
    },
  };
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST"
      ? Response.json({
          booking_options: [
            {
              leg_indexes: [0, 1],
              links: [
                {
                  provider_type: "airline",
                  provider_name: "American Airlines",
                  url: "https://aa.com/book",
                },
              ],
            },
          ],
        })
      : Response.json([]),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <RouteFareResults tripId="trip" results={[paired]} parties={[]} />
      </FluentProvider>
    </MemoryRouter>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Airline booking options" }),
  );
  expect(
    await screen.findByRole("link", { name: /also covers flight 2/ }),
  ).toHaveAttribute("href", "https://aa.com/book");
});
