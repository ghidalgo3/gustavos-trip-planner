import { expect, test } from "vitest";
import {
  buildFlightGraph,
  createFlightPathFilter,
  type FlightPathFilters,
  filterFlightPaths,
  highlightedFlightPaths,
  flightNodeId,
} from "./flightRouteGraph";
import { legKey } from "./flightFormatting";
import type { FareLeg, FareSearchResult } from "../../api/operationsApi";

function leg(id: string): FareLeg {
  return {
    segments: [
      {
        departure_airport: "JFK",
        arrival_airport: "BOS",
        departure_time_local: "2030-05-01T10:00:00",
        arrival_time_local: "2030-05-01T12:00:00",
        flight_number: id,
      },
    ],
  };
}
const [a, b, c, d, e, f, pending] = "abcdefp".split("").map(leg);
const result: FareSearchResult = {
  partyId: "party",
  cacheKey: "routes",
  fetchedAt: "2030-01-01T00:00:00Z",
  expiresAt: "2030-01-01T01:00:00Z",
  request: {
    origin: "JFK",
    destination: "BOS",
    departure_date: "2030-05-01",
    return_date: "2030-05-04",
    adults: 1,
    cabin_class: "economy",
    market: "US",
    searchKind: "itinerary",
  },
  response: {
    itineraries: [
      [a, b, c],
      [a, d, e],
      [f, d, c],
    ].map((legs) => ({
      legs,
      price: { status: "verified", amount: 300, currency: "USD" },
    })),
    flights: [{ legIndex: 1, leg: pending, bookingLegCount: 1 }],
  },
  evaluations: Array.from({ length: 3 }, () => ({
    status: "Eligible",
    issues: [],
  })),
};

test("hovering highlights only full paths containing that flight, without mixing paired branches", () => {
  const graph = buildFlightGraph(result, 3);
  const paths = highlightedFlightPaths(graph, flightNodeId(1, legKey(b)));
  expect(paths.routeCount).toBe(1);
  expect([...paths.nodes]).toEqual(
    [a, b, c].map((leg, index) => flightNodeId(index, legKey(leg))),
  );
  expect(paths.edges).toHaveLength(2);
  const shared = highlightedFlightPaths(graph, flightNodeId(0, legKey(a)));
  expect(shared.routeCount).toBe(2);
  expect(shared.nodes.has(flightNodeId(0, legKey(f)))).toBe(false);
  expect(shared.nodes.has(flightNodeId(1, legKey(pending)))).toBe(false);
  expect(
    highlightedFlightPaths(graph, flightNodeId(1, legKey(pending))).routeCount,
  ).toBe(0);
});

test("new results add flights to each column and keep existing card identities", () => {
  const initial = buildFlightGraph(
    {
      ...result,
      response: { itineraries: [], flights: result.response.flights },
      evaluations: [],
    },
    3,
  );
  const final = buildFlightGraph(result, 3);
  expect(initial.columns.map((column) => column.length)).toEqual([0, 1, 0]);
  expect(
    final.columns[1].find((node) => node.id === initial.columns[1][0].id),
  ).toBeDefined();
  expect(final.columns.map((column) => column.length)).toEqual([2, 3, 2]);
});

test("repeat visits have distinct card identities even for the same flight and no count cap", () => {
  const graph = buildFlightGraph(
    { ...result, response: { itineraries: [{ legs: Array(9).fill(a) }] } },
    9,
  );
  expect(graph.columns).toHaveLength(9);
  expect(new Set(graph.columns.flat().map((node) => node.id)).size).toBe(9);
});

test.each(["Rejected", "Unverifiable"] as const)(
  "%s routes cannot create hover paths",
  (status) => {
    const graph = buildFlightGraph(
      {
        ...result,
        evaluations: result.evaluations.map((evaluation) => ({
          ...evaluation,
          status,
        })),
      },
      3,
    );
    expect(graph.routes).toHaveLength(0);
  },
);

test("round-trip hover includes every validated return even when its pair is outside the ranked sample", () => {
  const graph = buildFlightGraph(
    {
      ...result,
      response: {
        flights: [a, f, c, e].map((leg, index) => ({
          leg,
          legIndex: index < 2 ? 0 : 1,
          bookingLegCount: 1,
        })),
        itineraries: [{ legs: [a, c] }, { legs: [f, e] }],
        roundTripConnections: [
          { outboundFlightIndex: 0, returnFlightIndex: 2 },
          { outboundFlightIndex: 0, returnFlightIndex: 3 },
          { outboundFlightIndex: 1, returnFlightIndex: 2 },
          { outboundFlightIndex: 1, returnFlightIndex: 3 },
        ],
      },
    },
    2,
  );
  const fromOutbound = highlightedFlightPaths(
    graph,
    flightNodeId(0, legKey(a)),
  );
  expect(fromOutbound.routeCount).toBe(2);
  expect([...fromOutbound.nodes]).toEqual([
    flightNodeId(0, legKey(a)),
    flightNodeId(1, legKey(c)),
    flightNodeId(1, legKey(e)),
  ]);
  const fromReturn = highlightedFlightPaths(graph, flightNodeId(1, legKey(e)));
  expect(fromReturn.routeCount).toBe(2);
  expect(fromReturn.nodes.has(flightNodeId(0, legKey(a)))).toBe(true);
  expect(fromReturn.nodes.has(flightNodeId(0, legKey(f)))).toBe(true);
});

test.each([
  {
    preferred: [" aa "],
    expected: ["complete-AA", "complete-DL", "pending-AA", "pending-DL"],
  },
  {
    preferred: ["DL"],
    expected: ["complete-DL", "complete-AA", "pending-DL", "pending-AA"],
  },
  {
    preferred: [],
    expected: ["complete-DL", "complete-AA", "pending-AA", "pending-DL"],
  },
])(
  "complete paths rise above pending flights, then preferred airlines sort first: $preferred",
  ({ preferred, expected }) => {
    const flights = [
      ["pending-AA", "AA", "08"],
      ["pending-DL", "DL", "09"],
      ["complete-DL", "DL", "11"],
      ["complete-AA", "AA", "12"],
    ].map(([id, carrier, hour]) => ({
      segments: [
        {
          ...leg(id).segments[0],
          marketing_carrier_code: carrier,
          departure_time_local: `2030-05-01T${hour}:00:00`,
        },
      ],
    }));
    const initial: FareSearchResult = {
      ...result,
      response: {
        flights: flights.map((leg) => ({
          legIndex: 0,
          leg,
          bookingLegCount: 1,
        })),
        itineraries: [],
      },
      evaluations: [],
    };
    const before = buildFlightGraph(initial, 2, preferred);
    const after = buildFlightGraph(
      {
        ...initial,
        response: {
          ...initial.response,
          itineraries: flights.slice(2).map((leg) => ({ legs: [leg, c] })),
        },
        evaluations: [
          { status: "Eligible", issues: [] },
          { status: "Eligible", issues: [] },
        ],
      },
      2,
      preferred,
    );
    expect(before.columns[0][0].leg.segments[0].flight_number).toMatch(
      /^pending-/,
    );
    expect(
      after.columns[0].map((node) => node.leg.segments[0].flight_number),
    ).toEqual(expected);
    expect(after.columns[0].map((node) => node.id).sort()).toEqual(
      before.columns[0].map((node) => node.id).sort(),
    );
  },
);

test("round-trip connections also promote flights outside the ranked itinerary sample", () => {
  const graph = buildFlightGraph(
    {
      ...result,
      response: {
        flights: [a, f, c].map((leg, index) => ({
          leg,
          legIndex: index < 2 ? 0 : 1,
          bookingLegCount: 1,
        })),
        itineraries: [],
        roundTripConnections: [
          { outboundFlightIndex: 1, returnFlightIndex: 2 },
        ],
      },
      evaluations: [],
    },
    2,
  );
  expect(graph.columns[0].map((node) => node.id)).toEqual([
    flightNodeId(0, legKey(f)),
    flightNodeId(0, legKey(a)),
  ]);
});

test("multi-stop hover follows every compatible branch without crossing fare contexts or bypassing the hovered flight", () => {
  const [g, h] = [leg("g"), leg("h")];
  const flights = [a, f, b, d, c, e, g, h];
  const graph = buildFlightGraph(
    {
      ...result,
      response: {
        flights: [
          { leg: pending, legIndex: 0, bookingLegCount: 1 },
          ...flights.map((leg, index) => ({
            leg,
            legIndex: Math.floor(index / 2),
            bookingLegCount: 1,
          })),
        ],
        // The a-b-c-g route is valid but absent from the ranked sample.
        itineraries: [{ legs: [a, d, e, g] }, { legs: [f, b, c, h] }],
        flightConnections: [
          [0, 2],
          [0, 3],
          [2, 4],
          [3, 5],
          [4, 6],
          [5, 6],
          [1, 2],
          [4, 7],
        ].map(([from, to]) => ({
          fromFlightIndex: from + 1,
          toFlightIndex: to + 1,
        })),
        routeGraphs: [
          { connectionIndexes: [0, 1, 2, 3, 4, 5] },
          { connectionIndexes: [6, 2, 7] },
        ],
      },
    },
    4,
  );
  const id = (flight: FareLeg) =>
    flightNodeId(Math.floor(flights.indexOf(flight) / 2), legKey(flight));
  const fromOutbound = highlightedFlightPaths(graph, id(a));
  expect(fromOutbound.nodes).toEqual(new Set([a, b, d, c, e, g].map(id)));
  expect(fromOutbound.edges).toHaveLength(6);
  expect(fromOutbound.nodes.has(id(h))).toBe(false);
  const fromMiddle = highlightedFlightPaths(graph, id(b));
  expect(fromMiddle.nodes).toEqual(new Set([a, f, b, c, g, h].map(id)));
  expect(fromMiddle.edges).toHaveLength(5);
  expect(fromMiddle.edges).not.toContainEqual({ from: id(a), to: id(d) });
  expect(fromMiddle.routeCount).toBeNull();
  expect(
    highlightedFlightPaths(graph, flightNodeId(0, legKey(pending))).nodes.size,
  ).toBe(0);
  expect(graph.columns[0].at(-1)?.id).toBe(flightNodeId(0, legKey(pending)));
});

test("path filters count a bundled fare once and evaluate unsampled combinations under every selected flight", () => {
  const flights = [a, b, d, c, e, f];
  const graph = buildFlightGraph(
    {
      ...result,
      response: {
        flights: flights.map((leg, index) => ({
          leg,
          legIndex: index === 0 ? 0 : index === 5 ? 3 : index <= 2 ? 1 : 2,
          bookingLegCount: 1,
        })),
        itineraries: [],
        flightConnections: [
          [0, 1],
          [0, 2],
          [1, 3],
          [1, 4],
          [2, 3],
          [2, 4],
          [3, 5],
          [4, 5],
        ].map(([fromFlightIndex, toFlightIndex]) => ({
          fromFlightIndex,
          toFlightIndex,
        })),
        routeGraphs: [
          {
            connectionIndexes: [0, 1, 2, 3, 4, 5, 6, 7],
            currency: "USD",
            bundledReturn: true,
            costs: [500, 10, 80, 10, 80, 0].map((amount, flightIndex) => ({
              status: "verified",
              amount,
              flightIndex,
            })),
          },
        ],
      },
      evaluations: [],
    },
    4,
  );
  const all = filterFlightPaths(graph, [], { currency: "USD", maxPrice: 600 });
  expect(all.nodes.size).toBe(6); // Every card participates in at least one affordable path.
  expect(all.minTotal).toBe(520);
  expect(all.maxTotal).toBe(660);
  expect(all.prices.get(flightNodeId(0, legKey(a)))?.amount).toBe(520);
  expect(all.fares.get(flightNodeId(0, legKey(a)))).toEqual({
    price: { status: "verified", amount: 500, currency: "USD" },
    legIndexes: [0, 3],
  });
  expect(all.fares.get(flightNodeId(3, legKey(f)))).toEqual(
    all.fares.get(flightNodeId(0, legKey(a))),
  );
  expect(all.fares.get(flightNodeId(1, legKey(b)))).toEqual({
    price: { status: "verified", amount: 10, currency: "USD" },
    legIndexes: [1],
  });
  const selected = filterFlightPaths(graph, [null, legKey(d)], {
    currency: "USD",
    maxPrice: 600,
  });
  expect(selected.nodes.has(flightNodeId(2, legKey(c)))).toBe(true);
  expect(selected.nodes.has(flightNodeId(2, legKey(e)))).toBe(false); // 500 + 80 + 80 is too much.
  expect(selected.edges).toHaveLength(3);
  expect(selected.fares.has(flightNodeId(2, legKey(e)))).toBe(false);
  expect(filterFlightPaths(graph, [], { currency: "EUR" }).fares.size).toBe(0);
  expect(
    filterFlightPaths(graph, [null, legKey(d), legKey(e)], { maxPrice: 600 })
      .nodes.size,
  ).toBe(0);
});

test("selection and cost filtering never connect an outbound with another bundle's return", () => {
  const graph = buildFlightGraph(
    {
      ...result,
      response: {
        flights: [a, f, b, c, e].map((leg, index) => ({
          leg,
          legIndex: index < 2 ? 0 : index === 2 ? 1 : 2,
          bookingLegCount: 1,
        })),
        itineraries: [],
        flightConnections: [
          [0, 2],
          [1, 2],
          [2, 3],
          [2, 4],
        ].map(([fromFlightIndex, toFlightIndex]) => ({
          fromFlightIndex,
          toFlightIndex,
        })),
        routeGraphs: [
          {
            connectionIndexes: [0, 2],
            currency: "USD",
            costs: [
              { status: "verified", flightIndex: 0, amount: 500 },
              { status: "verified", flightIndex: 2, amount: 100 },
              { status: "verified", flightIndex: 3, amount: 0 },
            ],
          },
          {
            connectionIndexes: [1, 3],
            currency: "USD",
            costs: [
              { status: "verified", flightIndex: 1, amount: 200 },
              { status: "verified", flightIndex: 2, amount: 100 },
              { status: "verified", flightIndex: 4, amount: 0 },
            ],
          },
        ],
      },
      evaluations: [],
    },
    3,
  );
  expect(
    filterFlightPaths(graph, [legKey(a)], { maxPrice: 400 }).nodes.size,
  ).toBe(0);
  const fromReturn = filterFlightPaths(graph, [null, null, legKey(e)], {
    maxPrice: 600,
  });
  expect(fromReturn.nodes.has(flightNodeId(0, legKey(f)))).toBe(true);
  expect(fromReturn.nodes.has(flightNodeId(0, legKey(a)))).toBe(false);
});

test("all segments must satisfy the airline filter and currencies remain separate", () => {
  const mixed = {
    ...b,
    segments: [
      { ...b.segments[0], marketing_carrier_code: "DL" },
      {
        ...b.segments[0],
        marketing_carrier_code: "KL",
        flight_number: "connection",
      },
    ],
  };
  const graph = buildFlightGraph(
    {
      ...result,
      response: {
        itineraries: [
          {
            legs: [a, mixed, c],
            price: { status: "verified", amount: 500, currency: "USD" },
          },
          {
            legs: [a, mixed, c],
            price: { status: "verified", amount: 400, currency: "EUR" },
          },
        ],
      },
    },
    3,
  );
  expect(
    filterFlightPaths(graph, [], { airlines: ["Unknown airline", "DL"] }).nodes
      .size,
  ).toBe(0);
  const euros = filterFlightPaths(graph, [], {
    currency: "EUR",
    maxPrice: 450,
    stops: ["0", "1"],
  });
  expect(euros.nodes.size).toBe(3);
  expect(euros.prices.get(flightNodeId(1, legKey(mixed)))).toEqual({
    status: "verified",
    amount: 400,
    currency: "EUR",
  });
  expect(
    filterFlightPaths(graph, [], { currency: "USD", maxPrice: 450 }).nodes.size,
  ).toBe(0);
  expect(filterFlightPaths(graph, [], { stops: ["0"] }).nodes.size).toBe(0);
  expect(filterFlightPaths(graph, [], { stops: [] }).nodes.size).toBe(0);
  expect(filterFlightPaths(graph, [], { airlines: [] }).nodes.size).toBe(0);
});

test.each(
  [[], [0], [null, 4], [null, null, 7, 10], [0, null, null, 10]].map(
    (selection) => ({ selection }),
  ),
)(
  "prepared path queries match exhaustive complete itineraries for selected flights $selection",
  ({ selection }) => {
    const flights = Array.from({ length: 12 }, (_, index) => {
      const flight = leg(String(index));
      flight.segments[0].marketing_carrier_code = index % 2 ? "DL" : "AA";
      if (index === 5)
        flight.segments.push({
          ...flight.segments[0],
          flight_number: "connection",
        });
      return flight;
    });
    const connections = Array.from({ length: 3 }, (_, layer) =>
      Array.from({ length: 3 }, (_, from) =>
        Array.from({ length: 3 }, (_, to) => ({
          fromFlightIndex: layer * 3 + from,
          toFlightIndex: (layer + 1) * 3 + to,
        })),
      ).flat(),
    ).flat();
    const contexts = Array.from({ length: 3 }, (_, context) => ({
      currency: context === 2 ? "EUR" : "USD",
      connectionIndexes: connections.flatMap((edge, index) =>
        (edge.fromFlightIndex >= 3 || edge.fromFlightIndex === context) &&
        (edge.toFlightIndex < 9 || edge.toFlightIndex === 11 - context)
          ? [index]
          : [],
      ),
      costs: flights.map((_, flightIndex) => ({
        status: "verified",
        flightIndex,
        amount:
          flightIndex < 3
            ? 100 + context * 50
            : flightIndex >= 9
              ? 0
              : 5 + flightIndex * 2.25,
      })),
    }));
    const graph = buildFlightGraph(
      {
        ...result,
        response: {
          flights: flights.map((leg, index) => ({
            leg,
            legIndex: Math.floor(index / 3),
            bookingLegCount: 1,
          })),
          itineraries: [],
          flightConnections: connections,
          routeGraphs: contexts,
        },
        evaluations: [],
      },
      4,
    );
    const find = createFlightPathFilter(graph);
    const selected = selection.map((index) =>
      index == null ? null : legKey(flights[index]),
    );
    const id = (index: number) =>
      flightNodeId(Math.floor(index / 3), legKey(flights[index]));
    const filters: FlightPathFilters[] = [
      {},
      { currency: "USD", maxPrice: 145 },
      { maxPrice: 190 },
      { stops: ["0"] },
      { airlines: ["AA"] },
      { currency: "EUR" },
    ];
    for (const filter of filters) {
      const paths = contexts.flatMap((context, index) => {
        if (filter.currency && filter.currency !== context.currency) return [];
        return [3, 4, 5]
          .flatMap((middle) =>
            [6, 7, 8].map((onward) => [index, middle, onward, 11 - index]),
          )
          .filter((path) =>
            path.every(
              (flight, index) =>
                (!selected[index] ||
                  selected[index] === legKey(flights[flight])) &&
                (!filter.stops ||
                  filter.stops.includes(
                    String(flights[flight].segments.length - 1),
                  )) &&
                (!filter.airlines ||
                  flights[flight].segments.every((segment) =>
                    filter.airlines!.includes(segment.marketing_carrier_code!),
                  )),
            ),
          )
          .map((path) => ({
            path,
            amount: path.reduce(
              (sum, index) => sum + context.costs[index].amount,
              0,
            ),
            currency: context.currency,
          }));
      });
      const affordable = paths.filter(
        (path) => path.amount <= (filter.maxPrice ?? Infinity),
      );
      const actual = find(selected, filter);
      expect(actual.minTotal).toBe(
        Math.min(...paths.map((path) => path.amount)),
      );
      expect(actual.maxTotal).toBe(
        Math.max(...paths.map((path) => path.amount)),
      );
      expect(actual.nodes).toEqual(
        new Set(affordable.flatMap(({ path }) => path.map(id))),
      );
      expect(
        new Set(actual.edges.map((edge) => `${edge.from}->${edge.to}`)),
      ).toEqual(
        new Set(
          affordable.flatMap(({ path }) =>
            path.slice(1).map((to, index) => `${id(path[index])}->${id(to)}`),
          ),
        ),
      );
      for (const node of actual.nodes)
        expect(actual.prices.get(node)?.amount).toBe(
          Math.min(
            ...affordable
              .filter(({ path }) => path.some((index) => id(index) === node))
              .map((path) => path.amount),
          ),
        );
    }
    // Reusing work buffers must not mutate earlier answers or carry a previous filter.
    const first = find(selected);
    find(selected, { maxPrice: 0 });
    expect(find(selected)).toEqual(first);
  },
);

test("mixed verification keeps unpriced routes selectable without contaminating confirmed totals", () => {
  const found: FareSearchResult = {
    ...result,
    response: {
      itineraries: [],
      flights: [a, b, c, d].map((leg, i) => ({
        leg,
        legIndex: i === 0 ? 0 : i === 3 ? 2 : 1,
        bookingLegCount: 1,
      })),
      flightConnections: [
        [0, 1],
        [1, 3],
        [0, 2],
        [2, 3],
      ].map(([fromFlightIndex, toFlightIndex]) => ({
        fromFlightIndex,
        toFlightIndex,
      })),
      routeGraphs: [
        {
          currency: "USD",
          connectionIndexes: [0, 1, 2, 3],
          costs: [
            { flightIndex: 0, amount: 100, status: "verified" },
            { flightIndex: 1, amount: 10, status: "unverified" },
            { flightIndex: 2, amount: 200, status: "verified" },
            { flightIndex: 3, amount: 100, status: "verified" },
          ],
        },
      ],
    },
  };
  const graph = buildFlightGraph(found, 3);
  const all = filterFlightPaths(graph);
  expect(all.nodes.size).toBe(4);
  expect(all.minTotal).toBe(400);
  expect(all.maxTotal).toBe(400);
  expect(all.prices.has(flightNodeId(1, legKey(b)))).toBe(false);
  expect(all.prices.get(flightNodeId(0, legKey(a)))?.amount).toBe(400);
  const unknown = filterFlightPaths(graph, [null, legKey(b)]);
  expect(unknown.nodes.size).toBe(3);
  expect(unknown.prices.size).toBe(0);
  expect(unknown.minTotal).toBe(Infinity);
  expect(
    filterFlightPaths(graph, [], { maxPrice: 500 }).nodes.has(
      flightNodeId(1, legKey(b)),
    ),
  ).toBe(false);
});
