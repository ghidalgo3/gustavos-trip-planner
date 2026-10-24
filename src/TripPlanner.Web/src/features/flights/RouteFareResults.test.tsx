import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import RouteFareResults from "./RouteFareResults";
import { legKey } from "./flightFormatting";
import type { FareItinerary, FareSearchResult } from "../../api/operationsApi";

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
    await screen.findByRole("heading", {
      name: "Choose Atlanta (ATL) → Phuket (HKT)",
    }),
  ).toBeVisible();
  expect(screen.getByRole("tab", { name: /Flight 1/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: /Flight 1/ })).toHaveTextContent(
    "ATL → HKT",
  );
  expect(screen.getByRole("tab", { name: /Flight 2/ })).toBeDisabled();
  expect(screen.getByText("Layover in Amsterdam (AMS) · 1h 30m")).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Atlanta (ATL) → Phuket (HKT)" }),
  ).toBeVisible();
  expect(
    screen.getByText("This flight is on the cheapest route"),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 1" }));
  expect(
    screen.getByRole("heading", {
      name: "Choose Phuket (HKT) → Atlanta (ATL)",
    }),
  ).toBeVisible();
  expect(screen.getByRole("tab", { name: /Flight 2/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getAllByRole("heading", { name: "Phuket (HKT) → Atlanta (ATL)" }),
  ).toHaveLength(2);
  fireEvent.click(
    screen.getAllByRole("button", { name: "Choose flight 2" })[1],
  );
  expect(screen.getByLabelText("Completed itinerary")).toHaveTextContent(
    "USD $1,100",
  );
  expect(screen.getByRole("tab", { name: "Review route" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    within(screen.getByLabelText("Completed itinerary")).queryByText(
      "This flight is on the cheapest route",
    ),
  ).toBeNull();
  expect(screen.getByText("12 night stay")).toBeVisible();
  const actions = screen.getByRole("button", {
    name: "Save complete itinerary",
  }).parentElement!;
  expect(
    within(actions)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Save complete itinerary", "Start over"]);
  fireEvent.click(
    screen.getByRole("button", { name: "Save complete itinerary" }),
  );
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/flights/party"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          cacheKey: "assembled",
          itineraryIndex: 1,
          legKeys: itineraries[1].legs!.map(legKey),
          priceAmount: itineraries[1].price!.amount,
          priceCurrency: itineraries[1].price!.currency,
        }),
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
      expect.stringContaining("/flights/party/purchases"),
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

test("deselecting a saved itinerary clears the choices and restarts at flight one", async () => {
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes("/airports/cities"))
      return Response.json({ ATL: "Atlanta", HKT: "Phuket" });
    if (init?.method === "PUT")
      return Response.json({
        tripId: "trip",
        partyId: "party",
        cacheKey: "assembled",
        itineraryIndex: 0,
        request: result.request,
        itinerary: itineraries[0],
        selectedAt: "2030-01-01T00:00:00Z",
        purchasedLegs: [false, false],
      });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetch);
  const saveChoices = vi.fn(async (party: string, keys: (string | null)[]) => {
    expect(party).toBe("party");
    expect(Array.isArray(keys)).toBe(true);
    return true;
  });
  function ControlledResults() {
    const [keys, setKeys] = useState<(string | null)[]>([]);
    return (
      <MemoryRouter>
        <FluentProvider theme={webLightTheme}>
          <RouteFareResults
            tripId="trip"
            results={[result]}
            parties={[]}
            savedChoices={{ party: keys }}
            onChangeChoices={async (party, next) => {
              const saved = await saveChoices(party, next);
              if (saved) setKeys(next);
              return saved;
            }}
          />
        </FluentProvider>
      </MemoryRouter>
    );
  }
  render(<ControlledResults />);
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 1" }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /Flight 2/ })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Choose flight 2" })[0],
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Completed itinerary")).toBeVisible(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save complete itinerary" }),
  );
  expect(
    await screen.findByText("Selected itinerary · USD $900"),
  ).toBeVisible();
  const completed = screen.getByLabelText("Completed itinerary");
  expect(
    within(completed).getAllByText("This flight is on the cheapest route"),
  ).toHaveLength(2);
  const actions = screen.getByRole("button", {
    name: "Deselect itinerary",
  }).parentElement!;
  expect(
    within(actions)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Itinerary selected", "Deselect itinerary"]);
  fireEvent.click(screen.getByRole("button", { name: "Deselect itinerary" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Deselect flights" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /Flight 1/ })).toHaveAttribute(
      "aria-selected",
      "true",
    ),
  );
  expect(screen.queryByLabelText("Completed itinerary")).toBeNull();
  expect(screen.queryByText("Selected itinerary · USD $900")).toBeNull();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/flights/party"),
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(saveChoices).toHaveBeenLastCalledWith("party", []);
});

test("uses saved partial flight choices after the route view reloads", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json([])),
  );
  let stored: (string | null)[] = [];
  const save = vi.fn(async (_party: string, keys: (string | null)[]) => {
    stored = keys;
    return true;
  });
  const view = render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <RouteFareResults
          tripId="trip"
          results={[result]}
          parties={[]}
          savedChoices={{ party: stored }}
          onChangeChoices={save}
        />
      </FluentProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 1" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith("party", [expect.any(String)]),
  );
  view.unmount();
  render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <RouteFareResults
          tripId="trip"
          results={[result]}
          parties={[]}
          savedChoices={{ party: stored }}
          onChangeChoices={save}
        />
      </FluentProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("tab", { name: /Flight 2/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("shows a failed flight-choice save beside the picker", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json([])),
  );
  render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <RouteFareResults
          tripId="trip"
          results={[result]}
          parties={[]}
          savedChoices={{ party: [] }}
          onChangeChoices={vi
            .fn()
            .mockRejectedValue(new Error("The chosen flight cannot be saved."))}
        />
      </FluentProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 1" }));
  expect(
    await screen.findByText("The chosen flight cannot be saved."),
  ).toBeVisible();
  expect(screen.getByRole("tab", { name: /Flight 1/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("offers all compatible routes without a result-filter panel", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json([])),
  );
  show();
  expect(screen.queryByLabelText("Minimum total price (USD)")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 1" }));
  expect(
    screen.getAllByRole("button", { name: "Choose flight 2" }),
  ).toHaveLength(2);
});

test("marks the cheapest route even when fares arrive out of price order", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json([])),
  );
  render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <RouteFareResults
          tripId="trip"
          results={[
            {
              ...result,
              response: { itineraries: [...itineraries].reverse() },
            },
          ]}
          parties={[]}
        />
      </FluentProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 1" }));
  const returnButtons = screen.getAllByRole("button", {
    name: "Choose flight 2",
  });
  expect(returnButtons[0].closest(".flight-information")).not.toHaveTextContent(
    "This flight is on the cheapest route",
  );
  expect(returnButtons[1].closest(".flight-information")).toHaveTextContent(
    "This flight is on the cheapest route",
  );
});

test("marks preferred-airline flights independently of the cheapest-route badge", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json([])),
  );
  render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <RouteFareResults
          tripId="trip"
          results={[result]}
          parties={[]}
          partySettings={[
            {
              partyId: "party",
              origin: null,
              cabin: "economy",
              market: "US",
              maxJourneyHours: 48,
              maxStops: null,
              preferredAirlines: ["AA"],
            },
          ]}
        />
      </FluentProvider>
    </MemoryRouter>,
  );
  const outboundCard = screen
    .getByRole("button", {
      name: "Choose flight 1",
    })
    .closest(".flight-information")!;
  expect(
    within(outboundCard as HTMLElement).getByText("Preferred Airline"),
  ).toBeVisible();
  expect(
    within(outboundCard as HTMLElement).getByText(
      "This flight is on the cheapest route",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Choose flight 1" }));
  const returnButtons = screen.getAllByRole("button", {
    name: "Choose flight 2",
  });
  expect(returnButtons[0].closest(".flight-information")).not.toHaveTextContent(
    "Preferred Airline",
  );
  expect(returnButtons[1].closest(".flight-information")).toHaveTextContent(
    "Preferred Airline",
  );
});

test("shows every compatible return airline and revisits earlier flights via tabs", async () => {
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
  expect(screen.getByText("Delta Air Lines · Nonstop · 13h 0m")).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: /Flight 1/ }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Deselect flights" }),
  );
  await screen.findByRole("button", { name: "Choose flight 1" });
  expect(screen.getByRole("tab", { name: /Flight 1/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("button", { name: "Choose flight 1" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Choose flight 2" })).toBeNull();
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
    .getByRole("button", {
      name: "Choose flight 1",
    })
    .closest<HTMLElement>(".flight-information");
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

test("saved itinerary stays selected after cache keys and result ordering change, including after a reload", async () => {
  const stored = {
    tripId: "trip",
    partyId: "party",
    cacheKey: "older-composition",
    itineraryIndex: 1,
    request: result.request,
    itinerary: itineraries[1],
    selectedAt: "2030-01-01T00:00:00Z",
    purchasedLegs: [true, false],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/airports/cities")
        ? Response.json({ ATL: "Atlanta", AMS: "Amsterdam", HKT: "Phuket" })
        : Response.json([stored]),
    ),
  );
  const current = {
    ...result,
    cacheKey: "new-composition",
    response: {
      ...result.response,
      itineraries: [itineraries[1], itineraries[0]],
    },
  };
  const element = (
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter>
        <RouteFareResults
          tripId="trip"
          results={[current]}
          parties={[]}
          savedChoices={{ party: itineraries[1].legs!.map(legKey) }}
          onChangeChoices={vi.fn()}
        />
      </MemoryRouter>
    </FluentProvider>
  );
  const first = render(element);
  expect(
    await screen.findByRole("button", { name: "Itinerary selected" }),
  ).toBeDisabled();
  expect(screen.getAllByRole("switch", { name: "Purchased" })[0]).toBeChecked();
  expect(
    screen.queryByRole("button", { name: "Save complete itinerary" }),
  ).not.toBeInTheDocument();
  first.unmount();
  render(element);
  expect(
    await screen.findByRole("button", { name: "Itinerary selected" }),
  ).toBeDisabled();
});

test("desktop selections stay individual until explicit review, survive recomposition, and save the exact chosen flights", async () => {
  const change = vi.fn(async () => true);
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/airports/cities"))
      return Response.json({ ATL: "Atlanta", HKT: "Phuket" });
    if (init?.method === "PUT")
      return Response.json({
        tripId: "trip",
        partyId: "party",
        cacheKey: "reviewed",
        itineraryIndex: 0,
        request: result.request,
        itinerary: itineraries[1],
        selectedAt: "2030-01-01T00:00:00Z",
      });
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetch);
  function Desktop() {
    const [keys, setKeys] = useState<(string | null)[]>([]);
    const current: FareSearchResult = {
      ...result,
      cacheKey: keys.length ? "reviewed" : "assembled",
      response: {
        itineraries: keys.length ? [itineraries[1]] : itineraries,
        choiceKeys: keys,
        flights: [outbound, ...returns].map((leg, index) => ({
          leg,
          legIndex: index === 0 ? 0 : 1,
          bookingLegCount: 1,
        })),
        flightConnections: [
          { fromFlightIndex: 0, toFlightIndex: 1 },
          { fromFlightIndex: 0, toFlightIndex: 2 },
        ],
        routeGraphs: [
          {
            connectionIndexes: [0, 1],
            currency: "USD",
            costs: [
              { flightIndex: 0, amount: 700 },
              { flightIndex: 1, amount: 200 },
              { flightIndex: 2, amount: 400 },
            ],
          },
        ],
      },
      evaluations: (keys.length ? [itineraries[1]] : itineraries).map(() => ({
        status: "Eligible",
        issues: [],
      })),
    };
    return (
      <RouteFareResults
        tripId="trip"
        results={[current]}
        parties={[]}
        showGrid
        visits={[
          {
            id: "phuket",
            location: {
              code: "HKT",
              label: "Phuket",
              timeZone: "Asia/Bangkok",
            },
            afterVisitIds: [],
            nights: null,
            presentFrom: null,
            presentThrough: null,
          },
        ]}
        savedChoices={{ party: keys }}
        onChangeChoices={async (party, next) => {
          await change();
          expect(party).toBe("party");
          setKeys(next);
          return true;
        }}
      />
    );
  }
  render(
    <MemoryRouter>
      <FluentProvider theme={webLightTheme}>
        <Desktop />
      </FluentProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Choose flight AA 20/ }));
  expect(await screen.findByText("1 of 2 flights selected")).toBeVisible();
  const selectedFlights = screen.getByRole("region", {
    name: "Selected flights",
  });
  expect(
    within(selectedFlights).getByRole("group", {
      name: "Flight 2: Return home",
    }),
  ).toBeVisible();
  expect(within(selectedFlights).getByText(/AA 20/)).toBeVisible();
  expect(
    within(selectedFlights).queryByRole("group", { name: /Flight 1/ }),
  ).toBeNull();
  expect(change).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("heading", { name: "Your route is ready" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Choose flight AA 100/ }));
  expect(await screen.findByText("2 of 2 flights selected")).toBeVisible();
  expect(
    within(selectedFlights)
      .getAllByRole("group", { name: /^Flight \d/ })
      .map((group) => group.getAttribute("aria-label")),
  ).toEqual(["Flight 1: Phuket", "Flight 2: Return home"]);
  expect(change).toHaveBeenCalledTimes(2);
  fireEvent.click(
    screen.getByRole("button", { name: "Review selected flights" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Your route is ready" }),
  ).toBeVisible();
  expect(change).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("region", { name: "Selected flights" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Save complete itinerary" }),
  );
  await waitFor(() =>
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(
      true,
    ),
  );
  const saved = fetch.mock.calls.find(
    ([, init]) => init?.method === "PUT",
  )![1]!;
  expect(JSON.parse(saved.body as string)).toMatchObject({
    legKeys: itineraries[1].legs!.map(legKey),
    priceAmount: 1100,
    priceCurrency: "USD",
  });
  fireEvent.click(screen.getByRole("button", { name: "Clear selections" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Keep selections" }),
  );
  expect(change).toHaveBeenCalledTimes(2);
  fireEvent.click(
    await screen.findByRole("button", { name: "Clear selections" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Deselect flights" }),
  );
  expect(await screen.findByText("0 of 2 flights selected")).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Choose flight JL 10/ }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Your route is ready" }),
  ).toBeNull();
});

test.each([false, true])(
  "shows selected flights below the grid without a complete route (restored: %s)",
  async (restored) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          String(input).includes("/airports/cities")
            ? { ATL: "Atlanta", HKT: "Phuket" }
            : [],
        ),
      ),
    );
    const partial: FareSearchResult = {
      ...result,
      response: {
        itineraries: [],
        flights: [
          { legIndex: 0, leg: outbound, bookingLegCount: 1 },
          {
            legIndex: 1,
            leg: returns[1],
            bookingLegCount: 2,
            price: { amount: 400, currency: "USD" },
          },
        ],
      },
      evaluations: [],
    };
    function Partial() {
      const [keys, setKeys] = useState<(string | null)[]>(
        restored ? [null, legKey(returns[1])] : [],
      );
      return (
        <RouteFareResults
          tripId="trip"
          results={[partial]}
          parties={[]}
          showGrid
          searching
          visits={[
            {
              id: "phuket",
              location: {
                code: "HKT",
                label: "Phuket",
                timeZone: "Asia/Bangkok",
              },
              afterVisitIds: [],
              nights: null,
              presentFrom: null,
              presentThrough: null,
            },
          ]}
          savedChoices={{ party: keys }}
          onChangeChoices={async (_party, next) => {
            setKeys(next);
            return true;
          }}
        />
      );
    }
    render(
      <FluentProvider theme={webLightTheme}>
        <Partial />
      </FluentProvider>,
    );
    if (!restored) {
      expect(
        screen.queryByRole("region", { name: "Selected flights" }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: /Choose flight AA 20/ }),
      );
    }
    const summary = await screen.findByRole("region", {
      name: "Selected flights",
    });
    expect(
      within(summary).getByRole("group", { name: "Flight 2: Return home" }),
    ).toBeVisible();
    expect(within(summary).getByText(/AA 20/)).toBeVisible();
    expect(
      within(summary).getByText("Fare available with a complete path"),
    ).toBeVisible();
    expect(within(summary).queryByText("USD $400")).toBeNull();
    expect(
      screen
        .getByRole("region", { name: "Flight destinations and connections" })
        .compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Your route is ready" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Choose flight AA 20/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Keep selections" }),
    );
    expect(
      await screen.findByRole("region", { name: "Selected flights" }),
    ).toBeVisible();
    fireEvent.click(
      await screen.findByRole("button", { name: /Choose flight AA 20/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Deselect flights" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Selected flights" }),
      ).toBeNull(),
    );
  },
);

test("booking links show fare names and price differences without collapsing variants sharing a URL", async () => {
  const mainExtra = {
    provider_type: "airline",
    provider_name: "Delta",
    fare_name: "Main Extra",
    price: { amount: 850, currency: "USD" },
    url: "https://delta.example/book",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Response.json(
        init?.method === "POST"
          ? {
              booking_options: [
                {
                  legs: ["outbound"],
                  links: [
                    {
                      ...mainExtra,
                      fare_name: "Basic",
                      price: { amount: 700, currency: "USD" },
                    },
                    mainExtra,
                    mainExtra,
                    {
                      ...mainExtra,
                      fare_name: "Main Classic",
                      price: { amount: 650, currency: "USD" },
                    },
                    {
                      ...mainExtra,
                      fare_name: "Comfort",
                      price: { amount: 900, currency: "EUR" },
                    },
                    { ...mainExtra, fare_name: undefined, price: undefined },
                  ],
                },
              ],
            }
          : [],
      ),
    ),
  );
  const quoted: FareSearchResult = {
    ...result,
    response: {
      itineraries: [
        {
          ...itineraries[0],
          bookingOffers: [
            {
              ignavId: "quote",
              legIndexes: [0],
              price: { amount: 700, currency: "USD" },
            },
          ],
        },
      ],
    },
  };
  render(
    <FluentProvider theme={webLightTheme}>
      <RouteFareResults tripId="trip" results={[quoted]} parties={[]} />
    </FluentProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Airline booking options" }),
  );
  expect(
    await screen.findByRole("link", { name: /Main Extra/ }),
  ).toHaveTextContent("+$150");
  expect(screen.getByRole("link", { name: /Basic/ })).toHaveTextContent("+$0");
  expect(screen.getByRole("link", { name: /Main Classic/ })).toHaveTextContent(
    "−$50",
  );
  expect(screen.getByRole("link", { name: /Comfort/ })).toHaveTextContent(
    "Different currency; difference unavailable",
  );
  expect(
    screen.getByRole("link", { name: /Fare name unavailable/ }),
  ).toHaveTextContent("Price unavailable · difference unavailable");
  expect(screen.getAllByRole("link")).toHaveLength(5);
});
