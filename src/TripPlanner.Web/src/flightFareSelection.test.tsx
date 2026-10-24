import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import RouteFareResults from "./RouteFareResults";
import {
  buildFlightGraph,
  filterFlightPaths,
  flightNodeId,
} from "./flightRouteGraph";
import { legKey } from "./flightFormatting";
import type { FareLeg, FareSearchResult } from "./operationsApi";
import type { FlightChoiceProgress } from "./selectedFlightsApi";

afterEach(() => vi.unstubAllGlobals());

function flight(number: string, returning = false): FareLeg {
  return {
    carrier: "Delta",
    segments: [
      {
        departure_airport: returning ? "HND" : "ATL",
        arrival_airport: returning ? "ATL" : "HND",
        departure_time_local: returning
          ? "2030-11-13T10:00:00"
          : "2030-11-01T10:00:00",
        arrival_time_local: returning
          ? "2030-11-13T20:00:00"
          : "2030-11-02T10:00:00",
        marketing_carrier_code: "DL",
        flight_number: number,
      },
    ],
  };
}
const flights = [
  flight("295"),
  flight("100"),
  flight("120", true),
  flight("294", true),
];
const pairings = [
  [0, 2, 2627],
  [1, 3, 2315],
  [0, 3, 3229],
];
function fares(graphs: boolean): FareSearchResult {
  return {
    partyId: "party",
    cacheKey: "fares",
    fetchedAt: "2030-01-01T00:00:00Z",
    expiresAt: "2030-01-01T01:00:00Z",
    request: {
      origin: "ATL",
      destination: "HND",
      departure_date: "2030-11-01",
      return_date: "2030-11-13",
      adults: 1,
      cabin_class: "economy",
      market: "US",
      searchKind: "itinerary",
    },
    evaluations: pairings.map(() => ({ status: "Eligible", issues: [] })),
    response: {
      flights: flights.map((leg, index) => ({
        leg,
        legIndex: index < 2 ? 0 : 1,
        bookingLegCount: 2,
        price: {
          amount: index === 0 || index === 2 ? 2627 : 2315,
          currency: "USD",
        },
      })),
      itineraries: pairings.map(([outbound, returning, amount], index) => ({
        legs: [flights[outbound], flights[returning]],
        price: { amount, currency: "USD" },
        bookingOffers: [
          {
            ignavId: `pair-${index}`,
            legIndexes: [0, 1],
            price: { amount, currency: "USD" },
          },
        ],
      })),
      ...(graphs
        ? {
            flightConnections: pairings.map(
              ([fromFlightIndex, toFlightIndex]) => ({
                fromFlightIndex,
                toFlightIndex,
              }),
            ),
            routeGraphs: pairings.map(
              ([outbound, returning, amount], index) => ({
                connectionIndexes: [index],
                currency: "USD",
                bundledReturn: true,
                costs: [
                  { flightIndex: outbound, amount, ignavId: `pair-${index}` },
                  {
                    flightIndex: returning,
                    amount: 0,
                    ignavId: `pair-${index}`,
                  },
                ],
              }),
            ),
          }
        : {}),
    },
  };
}

test.each([false, true])(
  "fare quotes use the compatible pairing, including unsampled paths (graphs: %s)",
  (graphs) => {
    const result = fares(graphs);
    // The graph is authoritative even without sampled review itineraries.
    if (graphs) result.response.itineraries = [];
    const graph = buildFlightGraph(result, 2);
    const outbound = flightNodeId(0, legKey(flights[0]));
    const returning = flightNodeId(1, legKey(flights[3]));
    const initial = filterFlightPaths(graph);
    expect(initial.fares.get(outbound)?.price.amount).toBe(2627);
    expect(initial.fares.get(returning)?.price.amount).toBe(2315);
    const selected = filterFlightPaths(graph, [legKey(flights[0])]);
    expect(selected.fares.get(returning)?.price.amount).toBe(3229);
    const both = filterFlightPaths(graph, [
      legKey(flights[0]),
      legKey(flights[3]),
    ]);
    expect(both.fares.get(outbound)).toEqual(both.fares.get(returning));
    expect(both.fares.get(outbound)?.price.amount).toBe(3229);
    expect(both.minTotal).toBe(3229);
    expect(
      filterFlightPaths(graph, [legKey(flights[0])], {
        maxPrice: 3000,
      }).fares.has(returning),
    ).toBe(false);
  },
);

test("cheaper separate tickets replace a bundled quote without hiding the return fare", () => {
  const result = fares(true);
  result.response.routeGraphs!.push({
    connectionIndexes: [2],
    currency: "USD",
    bundledReturn: false,
    costs: [
      { flightIndex: 0, amount: 1800 },
      { flightIndex: 3, amount: 1100 },
    ],
  });
  const paths = filterFlightPaths(buildFlightGraph(result, 2), [
    legKey(flights[0]),
    legKey(flights[3]),
  ]);
  expect(paths.minTotal).toBe(2900);
  expect(paths.fares.get(flightNodeId(0, legKey(flights[0])))).toEqual({
    price: { amount: 1800, currency: "USD" },
    legIndexes: [0],
  });
  expect(paths.fares.get(flightNodeId(1, legKey(flights[3])))).toEqual({
    price: { amount: 1100, currency: "USD" },
    legIndexes: [1],
  });
});

test.each([false, true])(
  "shared fares update with selections and appear once in the summary and review (return first: %s)",
  async (returnFirst) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        Response.json(
          String(input).includes("/airports/cities")
            ? { ATL: "Atlanta", HND: "Tokyo" }
            : [],
        ),
      ),
    );
    const result = fares(true);
    function Planner() {
      const [chosen, setChosen] = useState<(string | null)[]>([]);
      return (
        <RouteFareResults
          tripId="trip"
          results={[result]}
          parties={[]}
          showGrid
          visits={[
            {
              id: "tokyo",
              location: { code: "HND", label: "Tokyo", timeZone: "Asia/Tokyo" },
              afterVisitIds: [],
              nights: null,
              presentFrom: null,
              presentThrough: null,
            },
          ]}
          savedChoices={{ party: chosen }}
          onChangeChoices={async (_, keys) => {
            setChosen(keys);
            return true;
          }}
        />
      );
    }
    render(
      <FluentProvider theme={webLightTheme}>
        <Planner />
      </FluentProvider>,
    );
    const grid = screen.getByRole("region", {
      name: "Flight destinations and connections",
    });
    const card = (number: string) =>
      within(grid)
        .getByRole("button", {
          name: new RegExp(`Choose flight DL ${number},`),
        })
        .closest('[role="group"]') as HTMLElement;
    const click = (number: string) =>
      fireEvent.click(within(card(number)).getByRole("button"));
    expect(within(card("295")).getByText("USD $2,627")).toBeVisible();
    expect(within(card("294")).getByText("USD $2,315")).toBeVisible();
    click(returnFirst ? "294" : "295");
    const summary = await screen.findByRole("region", {
      name: "Selected flights",
    });
    expect(within(summary).getByText("Outbound + return from")).toBeVisible();
    expect(
      within(card(returnFirst ? "295" : "294")).getByText("USD $3,229"),
    ).toBeVisible();
    click(returnFirst ? "295" : "294");
    expect(
      await within(summary).findByText("Outbound + return fare"),
    ).toBeVisible();
    expect(within(summary).getAllByText("USD $3,229")).toHaveLength(1);
    expect(
      within(summary).getByText("Included in flight 1 fare"),
    ).toBeVisible();
    expect(within(card("294")).queryByText("USD $3,229")).toBeNull();
    expect(
      within(card("294")).getByText("Included in flight 1 fare"),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Review selected flights" }),
    );
    await screen.findByRole("heading", { name: "Your route is ready" });
    expect(
      screen.queryByRole("region", { name: "Selected flights" }),
    ).toBeNull();
    const journey = document.querySelector(".journey-legs") as HTMLElement;
    expect(within(journey).getAllByText("USD $3,229")).toHaveLength(1);
    expect(
      within(journey).getByText("Included in flight 1 fare"),
    ).toBeVisible();
    click("294");
    fireEvent.click(
      await screen.findByRole("button", { name: "Deselect flights" }),
    );
    const partial = await screen.findByRole("region", {
      name: "Selected flights",
    });
    expect(within(partial).getByText("USD $2,627")).toBeVisible();
    expect(within(partial).getByText("Outbound + return from")).toBeVisible();
  },
);

test.each([
  [false, false],
  [true, false],
  [true, true],
])(
  "selected flight booking controls persist purchases and retry failures (paired: %s, complete path: %s)",
  async (paired, completePath) => {
    const result = fares(true);
    const keys = paired
      ? [legKey(flights[0]), legKey(flights[3])]
      : [legKey(flights[0])];
    const booking = {
      ignavId: paired ? "pair-2" : "one-way",
      legIndexes: paired ? [0, 1] : [0],
      legKeys: keys,
      price: { amount: paired ? 3229 : 600, currency: "USD" },
    };
    if (!completePath) {
      result.response.itineraries = [];
      result.response.routeGraphs = [];
    }
    let stored: FlightChoiceProgress = {
      partyId: "party",
      legKeys: keys,
      nextOrigins: [],
      bookings: [booking],
      purchasedOfferIds: [],
    };
    let failLink = true;
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/airports/cities"))
          return Response.json({ ATL: "Atlanta", HND: "Tokyo" });
        if (String(input).endsWith("/choices/party/bookingLinks")) {
          expect(JSON.parse(init!.body as string)).toEqual({
            ignavId: booking.ignavId,
          });
          if (failLink) {
            failLink = false;
            return Response.json(
              { title: "Booking service unavailable" },
              { status: 503 },
            );
          }
          return Response.json({
            booking_options: [
              {
                leg_indexes: paired ? [0, 1] : [0],
                links: [
                  {
                    provider_type: "airline",
                    provider_name: "Delta",
                    fare_name: "Main Extra",
                    price: {
                      amount: booking.price.amount + 120,
                      currency: "USD",
                    },
                    url: "https://delta.example/book",
                  },
                ],
              },
            ],
          });
        }
        return Response.json([]);
      },
    );
    vi.stubGlobal("fetch", fetch);
    let failPurchase = true;
    const save = vi.fn(async (ids: string[]) => {
      if (failPurchase) {
        failPurchase = false;
        throw new Error("Purchase status could not be saved");
      }
      stored = { ...stored, purchasedOfferIds: ids };
    });
    function Planner() {
      const [progress, setProgress] = useState(stored);
      return (
        <RouteFareResults
          tripId="trip"
          results={[result]}
          parties={[]}
          showGrid
          visits={[
            {
              id: "tokyo",
              location: { code: "HND", label: "Tokyo", timeZone: "Asia/Tokyo" },
              afterVisitIds: [],
              nights: null,
              presentFrom: null,
              presentThrough: null,
            },
          ]}
          savedChoices={{ party: progress.legKeys }}
          choiceProgress={{ party: progress }}
          onChangeChoices={async (_party, _keys, ids) => {
            await save(ids!);
            setProgress(stored);
            return true;
          }}
        />
      );
    }
    const show = () =>
      render(
        <FluentProvider theme={webLightTheme}>
          <Planner />
        </FluentProvider>,
      );
    const rendered = show();
    const summary = screen.getByRole("region", { name: "Selected flights" });
    const label = paired
      ? "Request round-trip booking link"
      : "Request booking link";
    expect(within(summary).getAllByRole("switch")).toHaveLength(1);
    expect(within(summary).getByRole("switch")).not.toBeChecked();
    expect(
      fetch.mock.calls.some(([input]) =>
        String(input).endsWith("bookingLinks"),
      ),
    ).toBe(false);
    fireEvent.click(within(summary).getByRole("button", { name: label }));
    expect(
      await within(summary).findByText(/Booking service unavailable/),
    ).toBeVisible();
    fireEvent.click(within(summary).getByRole("button", { name: label }));
    const link = await within(summary).findByRole("link", {
      name: /Book on Delta · Main Extra/,
    });
    expect(link).toHaveAttribute("href", "https://delta.example/book");
    expect(within(link).getByText("+$120")).toHaveAttribute(
      "title",
      expect.stringContaining("+USD $120 vs quoted"),
    );
    if (paired) expect(link).toHaveTextContent("also covers flight 2");
    if (paired)
      expect(
        within(summary).getByText(
          /Booking and purchase status are shared with flight 1/,
        ),
      ).toBeVisible();
    fireEvent.click(within(summary).getByRole("switch"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Purchase status could not be saved",
    );
    expect(within(summary).getByRole("switch")).not.toBeChecked();
    fireEvent.click(within(summary).getByRole("switch"));
    await waitFor(() =>
      expect(within(summary).getByRole("switch")).toBeChecked(),
    );
    expect(save).toHaveBeenLastCalledWith([booking.ignavId]);
    rendered.unmount();
    show();
    const restored = screen.getByRole("region", { name: "Selected flights" });
    expect(within(restored).getByRole("switch")).toBeChecked();
    if (paired)
      expect(
        within(restored).getByText(/shared with flight 1. Purchased/),
      ).toBeVisible();
    fireEvent.click(within(restored).getByRole("switch"));
    await waitFor(() =>
      expect(within(restored).getByRole("switch")).not.toBeChecked(),
    );
    expect(save).toHaveBeenLastCalledWith([]);
  },
);

test("a shared booking shows both separately priced directions without comparing either with the full quote", async () => {
  const result = fares(true);
  const keys = [legKey(flights[0]), legKey(flights[3])];
  const progress: FlightChoiceProgress = {
    partyId: "party",
    legKeys: keys,
    nextOrigins: [],
    bookings: [
      {
        ignavId: "pair-2",
        legIndexes: [0, 1],
        legKeys: keys,
        price: { amount: 3229, currency: "USD" },
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      Response.json(
        init?.method === "POST"
          ? {
              booking_options: [0, 1].map((index) => ({
                leg_indexes: [index],
                links: [
                  {
                    provider_type: "airline",
                    provider_name: "Delta",
                    fare_name: index === 0 ? "Main Classic" : "Main Extra",
                    price: {
                      amount: index === 0 ? 1800 : 1700,
                      currency: "USD",
                    },
                    url: "https://delta.example/book",
                  },
                ],
              })),
            }
          : String(input).includes("/airports/cities")
            ? {}
            : [],
      ),
    ),
  );
  render(
    <FluentProvider theme={webLightTheme}>
      <RouteFareResults
        tripId="trip"
        results={[result]}
        parties={[]}
        showGrid
        visits={[
          {
            id: "tokyo",
            location: { code: "HND", label: "Tokyo", timeZone: "Asia/Tokyo" },
            afterVisitIds: [],
            nights: null,
            presentFrom: null,
            presentThrough: null,
          },
        ]}
        savedChoices={{ party: keys }}
        choiceProgress={{ party: progress }}
        onChangeChoices={async () => true}
      />
    </FluentProvider>,
  );
  const summary = screen.getByRole("region", { name: "Selected flights" });
  fireEvent.click(
    within(summary).getByRole("button", {
      name: "Request round-trip booking link",
    }),
  );
  expect(
    await within(summary).findByRole("link", {
      name: /Main Classic · flight 1 only/,
    }),
  ).toHaveTextContent("USD $1,800 · Partial booking; difference unavailable");
  expect(
    within(summary).getByRole("link", { name: /Main Extra · flight 2 only/ }),
  ).toHaveTextContent("USD $1,700 · Partial booking; difference unavailable");
});
