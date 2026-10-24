import {
  isVerifiedPrice,
  legKey,
  legUsesPreferredAirline,
} from "./flightFormatting";
import type {
  FareItinerary,
  FareSearchResult,
  FlightGridOption,
} from "../../api/operationsApi";

// Displaying retained selections does not require a live search request or quote timestamp.
export type FlightRouteResult = Pick<
  FareSearchResult,
  "partyId" | "cacheKey" | "response" | "evaluations"
> & { savedOnly?: boolean };

export type FlightNode = FlightGridOption & {
  id: string;
  routes: number[];
};
export type FlightEdge = { from: string; to: string };
export type FlightFare = {
  ignavId?: string;
  price: { amount: number; currency: string; status?: string };
  legIndexes: number[];
};

export function presentFlightFare(
  fare: FlightFare | undefined,
  index: number,
  selected: FlightSelections,
) {
  if (!fare) return { label: "Fare available with a complete path" };
  const firstSelected = fare.legIndexes.find((leg) => selected[leg]);
  if (selected[index] && firstSelected !== undefined && firstSelected !== index)
    return { label: `Included in flight ${firstSelected + 1} fare` };
  const fixed = fare.legIndexes.every((leg) => selected[leg]);
  return {
    price: fare.price,
    label:
      fare.legIndexes.length > 1
        ? `Outbound + return${fixed ? " fare" : " from"}`
        : "One-way fare",
  };
}

type RouteGraph = {
  incoming: Map<string, FlightEdge[]>;
  outgoing: Map<string, FlightEdge[]>;
  currency?: string;
  costs?: Map<string, number>;
  fares?: Map<string, FlightFare>;
};
export type FlightGraph = {
  columns: FlightNode[][];
  roundTripConnections?: FlightEdge[];
  routeGraphs?: RouteGraph[];
  routes: { itinerary: FareItinerary; keys: string[] }[];
};

export function flightNodeId(index: number, key: string): string {
  return `${index}:${key}`;
}

// Path membership comes from complete server-validated itineraries. Joining
// adjacent airports alone would invent routes that violate dates or paired fares.
export function buildFlightGraph(
  result: FlightRouteResult | undefined,
  legCount: number,
  preferredAirlines: readonly string[] = [],
): FlightGraph {
  const columns = Array.from(
    { length: legCount },
    () => new Map<string, FlightNode>(),
  );
  for (const option of result?.response.flights ?? []) {
    if (!option.leg.segments.length) continue;
    const id = flightNodeId(option.legIndex, legKey(option.leg));
    columns[option.legIndex]?.set(id, { ...option, id, routes: [] });
  }
  const routes = (result?.response.itineraries ?? []).flatMap(
    (itinerary, index) =>
      itinerary.legs?.length === legCount &&
      itinerary.legs.every((leg) => leg.segments.length) &&
      result?.evaluations[index]?.status === "Eligible"
        ? [{ itinerary, keys: itinerary.legs.map(legKey) }]
        : [],
  );
  routes.sort(
    (a, b) =>
      (a.itinerary.price?.currency ?? "").localeCompare(
        b.itinerary.price?.currency ?? "",
      ) ||
      (a.itinerary.price?.amount ?? Infinity) -
        (b.itinerary.price?.amount ?? Infinity),
  );
  routes.forEach(({ itinerary, keys }, routeIndex) => {
    itinerary.legs!.forEach((leg, legIndex) => {
      const id = flightNodeId(legIndex, keys[legIndex]);
      const offer = itinerary.bookingOffers?.find((offer) =>
        offer.legIndexes.includes(legIndex),
      );
      const node: FlightNode = columns[legIndex].get(id) ?? {
        id,
        legIndex,
        leg,
        routes: [],
        price: offer?.price,
        bookingLegCount: offer?.legIndexes.length ?? 1,
      };
      node.routes.push(routeIndex);
      columns[legIndex].set(id, node);
    });
  });
  const roundTripConnections =
    legCount === 2
      ? result?.response.roundTripConnections?.flatMap((connection) => {
          const outbound =
            result.response.flights?.[connection.outboundFlightIndex];
          const inbound =
            result.response.flights?.[connection.returnFlightIndex];
          if (
            outbound?.legIndex !== 0 ||
            inbound?.legIndex !== 1 ||
            !outbound.leg.segments.length ||
            !inbound.leg.segments.length
          )
            return [];
          return [
            {
              from: flightNodeId(0, legKey(outbound.leg)),
              to: flightNodeId(1, legKey(inbound.leg)),
            },
          ];
        })
      : undefined;
  const connections = result?.response.flightConnections?.map((edge) => {
    const from = result.response.flights?.[edge.fromFlightIndex];
    const to = result.response.flights?.[edge.toFlightIndex];
    if (
      !from?.leg.segments.length ||
      !to?.leg.segments.length ||
      from.legIndex + 1 !== to.legIndex ||
      from.legIndex < 0 ||
      to.legIndex >= legCount
    )
      return undefined;
    return {
      from: flightNodeId(from.legIndex, legKey(from.leg)),
      to: flightNodeId(to.legIndex, legKey(to.leg)),
    };
  });
  const routeGraphs = result?.response.routeGraphs?.flatMap((context) => {
    const incoming = new Map<string, FlightEdge[]>();
    const outgoing = new Map<string, FlightEdge[]>();
    for (const index of context.connectionIndexes) {
      const edge = connections?.[index];
      if (!edge) continue;
      incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    }
    const offerIds = new Map<string, string | undefined>();
    const costs =
      context.costs &&
      new Map(
        context.costs.flatMap((cost) => {
          const flight = result.response.flights?.[cost.flightIndex];
          if (flight)
            offerIds.set(
              flightNodeId(flight.legIndex, legKey(flight.leg)),
              cost.ignavId,
            );
          return flight &&
            isVerifiedPrice({ ...cost, currency: context.currency ?? "" })
            ? [
                [
                  flightNodeId(flight.legIndex, legKey(flight.leg)),
                  cost.amount,
                ] as const,
              ]
            : [];
        }),
      );
    const fares = new Map<string, FlightFare>();
    if (costs && context.currency) {
      const outbound = [...columns[0].keys()].find((id) => costs.has(id));
      for (const [id, amount] of costs) {
        const index = Number(id.slice(0, id.indexOf(":")));
        const bundled =
          context.bundledReturn && (index === 0 || index === legCount - 1);
        if (bundled && !outbound) continue;
        fares.set(id, {
          ignavId: offerIds.get(id),
          price: {
            amount: bundled ? costs.get(outbound!)! : amount,
            currency: context.currency,
            status: "verified",
          },
          legIndexes: bundled ? [0, legCount - 1] : [index],
        });
      }
    }
    const priced = {
      incoming,
      outgoing,
      costs,
      fares,
      currency: context.currency,
    };
    // Keep unpriced flights selectable. Only the verified subgraph contributes amounts.
    return costs && costs.size === context.costs?.length
      ? [priced]
      : [{ incoming, outgoing, currency: context.currency }, priced];
  });
  const completeFlights = new Set([
    ...routes.flatMap((route) =>
      route.keys.map((key, index) => flightNodeId(index, key)),
    ),
    ...(roundTripConnections ?? []).flatMap(({ from, to }) => [from, to]),
    ...(routeGraphs ?? []).flatMap(({ incoming, outgoing }) => [
      ...incoming.keys(),
      ...outgoing.keys(),
    ]),
  ]);
  return {
    roundTripConnections,
    routeGraphs,
    columns: columns.map((column) =>
      [...column.values()].sort(
        (a, b) =>
          Number(completeFlights.has(b.id)) -
            Number(completeFlights.has(a.id)) ||
          Number(legUsesPreferredAirline(b.leg, preferredAirlines)) -
            Number(legUsesPreferredAirline(a.leg, preferredAirlines)) ||
          (a.leg.segments[0].departure_time_local ?? "").localeCompare(
            b.leg.segments[0].departure_time_local ?? "",
          ) ||
          a.id.localeCompare(b.id),
      ),
    ),
    routes,
  };
}

export function highlightedFlightPaths(graph: FlightGraph, hovered?: string) {
  if (graph.roundTripConnections) {
    const edges = graph.roundTripConnections.filter(
      (edge) => edge.from === hovered || edge.to === hovered,
    );
    return {
      nodes: new Set(edges.flatMap((edge) => [edge.from, edge.to])),
      edges,
      routeCount: edges.length,
    };
  }
  if (graph.routeGraphs) {
    const nodes = new Set<string>();
    // Contexts share the same edge objects, so deduplicate by identity without
    // repeatedly serializing long flight keys during pointer movement.
    const edges = new Set<FlightEdge>();
    // Walk each fare context separately. Merging graphs first would join an
    // outbound to another offer's bundled return. Walking both directions in
    // one traversal would also light up branches that bypass the hovered card.
    for (const context of graph.routeGraphs) {
      if (!hovered) break;
      for (const direction of ["incoming", "outgoing"] as const) {
        const visited = new Set([hovered]);
        const pending = [hovered];
        while (pending.length) {
          const current = pending.pop()!;
          for (const edge of context[direction].get(current) ?? []) {
            nodes.add(edge.from);
            nodes.add(edge.to);
            edges.add(edge);
            const next = direction === "incoming" ? edge.from : edge.to;
            if (!visited.has(next)) {
              visited.add(next);
              pending.push(next);
            }
          }
        }
      }
    }
    // The graph may represent exponentially many routes, with overlapping fare
    // contexts. Show connected flights instead of a misleading sample count.
    return { nodes, edges: [...edges], routeCount: null };
  }
  const routes = hovered
    ? graph.routes.filter((route) =>
        route.keys.some((key, index) => flightNodeId(index, key) === hovered),
      )
    : [];
  const nodes = new Set<string>();
  const edges = new Map<string, { from: string; to: string }>();
  for (const route of routes) {
    route.keys.forEach((key, index) => {
      const id = flightNodeId(index, key);
      nodes.add(id);
      if (index > 0) {
        const from = flightNodeId(index - 1, route.keys[index - 1]);
        edges.set(JSON.stringify([from, id]), { from, to: id });
      }
    });
  }
  return { nodes, edges: [...edges.values()], routeCount: routes.length };
}

export type FlightPathFilters = {
  currency?: string;
  maxPrice?: number;
  stops?: readonly string[];
  airlines?: readonly string[];
};
export type FlightSelections = readonly (string | null)[];

export function flightAirlines(leg: FlightNode["leg"]) {
  return [
    ...new Set(
      leg.segments.map(
        (segment) =>
          segment.marketing_carrier_code?.trim().toUpperCase() ||
          segment.operating_carrier_name ||
          leg.carrier ||
          "Unknown airline",
      ),
    ),
  ];
}

export function flightMatchesFilters(
  node: FlightNode,
  filters: FlightPathFilters,
) {
  const stops = Math.min(2, node.leg.segments.length - 1).toString();
  return (
    (filters.stops === undefined || filters.stops.includes(stops)) &&
    (filters.airlines === undefined ||
      flightAirlines(node.leg).every((code) =>
        filters.airlines!.includes(code),
      ))
  );
}

// Older responses have priced itinerary samples but no weighted graph. A sample
// remains one indivisible path; its total is never summed once per flight.
function pricedContexts(graph: FlightGraph): RouteGraph[] {
  if (graph.routeGraphs?.length) return graph.routeGraphs;
  return graph.routes.map(({ itinerary, keys }) => {
    const ids = keys.map((key, index) => flightNodeId(index, key));
    const incoming = new Map<string, FlightEdge[]>();
    const outgoing = new Map<string, FlightEdge[]>();
    ids.slice(1).forEach((to, index) => {
      const edge = { from: ids[index], to };
      outgoing.set(edge.from, [edge]);
      incoming.set(edge.to, [edge]);
    });
    return {
      incoming,
      outgoing,
      fares: new Map(
        ids.flatMap((id, index) => {
          const offer = itinerary.bookingOffers?.find((offer) =>
            offer.legIndexes.includes(index),
          );
          return isVerifiedPrice(offer?.price)
            ? [
                [
                  id,
                  {
                    price: offer.price,
                    legIndexes: offer.legIndexes,
                    ignavId: offer.ignavId,
                  },
                ] as const,
              ]
            : [];
        }),
      ),
      currency: itinerary.price?.currency,
      costs: isVerifiedPrice(itinerary.price)
        ? new Map(
            ids.map((id, index) => [
              id,
              index === 0 ? itinerary.price!.amount : 0,
            ]),
          )
        : undefined,
    };
  });
}

export function flightCurrencies(graph: FlightGraph) {
  return [
    ...new Set(
      pricedContexts(graph).flatMap((context) =>
        context.currency ? [context.currency] : [],
      ),
    ),
  ].sort();
}

// Prepare integer-indexed adjacency and costs once per result set. Pointer moves
// reuse this topology, rather than serializing flight keys and allocating maps
// and parent/child arrays for every flight in every fare context.
export function createFlightPathFilter(graph: FlightGraph) {
  const flights = graph.columns.flat();
  const indexes = new Map(flights.map((node, index) => [node.id, index]));
  const metadata = flights.map((node) => ({
    key: legKey(node.leg),
    stops: Math.min(2, node.leg.segments.length - 1).toString(),
    airlines: flightAirlines(node.leg),
  }));
  const columnIndexes = graph.columns.map((column) =>
    column.map((node) => indexes.get(node.id)!),
  );
  const canonicalEdges = new Map<number, Map<number, FlightEdge>>();
  const contexts = pricedContexts(graph).map((context) => {
    const weights = new Float64Array(flights.length);
    const members = new Uint8Array(flights.length);
    const incoming = Array.from(
      { length: flights.length },
      () => [] as number[],
    );
    const outgoing = Array.from(
      { length: flights.length },
      () => [] as number[],
    );
    const edges: { from: number; to: number; value: FlightEdge }[] = [];
    for (const [id, list] of context.outgoing) {
      const from = indexes.get(id);
      if (from === undefined) continue;
      let byTarget = canonicalEdges.get(from);
      if (!byTarget) canonicalEdges.set(from, (byTarget = new Map()));
      for (const edge of list) {
        const to = indexes.get(edge.to);
        if (to === undefined) continue;
        const value = byTarget.get(to) ?? edge;
        byTarget.set(to, value);
        outgoing[from].push(to);
        incoming[to].push(from);
        edges.push({ from, to, value });
      }
    }
    flights.forEach((node, index) => {
      members[index] = Number(
        (context.incoming.has(node.id) || context.outgoing.has(node.id)) &&
          (!context.costs || context.costs.has(node.id)),
      );
      weights[index] = Math.round((context.costs?.get(node.id) ?? 0) * 100);
    });
    return {
      currency: context.currency,
      fares: flights.map((node) => context.fares?.get(node.id)),
      priced: !!context.costs,
      weights,
      members,
      incoming,
      outgoing,
      edges,
      columns: columnIndexes.map((column) =>
        column.filter((index) => members[index]),
      ),
    };
  });
  const prefix = new Float64Array(flights.length);
  const maximum = new Float64Array(flights.length);
  const suffix = new Float64Array(flights.length);

  // Evaluate every fare context independently: joining their edge unions would
  // invent mixed bundles or paths that exceed the total cost cap.
  return (selected: FlightSelections = [], filters: FlightPathFilters = {}) => {
    const nodes = new Set<string>();
    const edges = new Set<FlightEdge>();
    const prices = new Map<
      string,
      { amount: number; currency: string; status?: string }
    >();
    const fares = new Map<string, FlightFare>();
    let minTotal = Infinity;
    let maxTotal = -Infinity;
    const allowed = metadata.map(
      (item, index) =>
        (!selected[flights[index].legIndex] ||
          selected[flights[index].legIndex] === item.key) &&
        (filters.stops === undefined || filters.stops.includes(item.stops)) &&
        (filters.airlines === undefined ||
          item.airlines.every((code) => filters.airlines!.includes(code))),
    );
    const pinned = selected.flatMap((key, column) =>
      key ? [indexes.get(flightNodeId(column, key)) ?? -1] : [],
    );
    const cap =
      filters.maxPrice === undefined
        ? Infinity
        : Math.round(filters.maxPrice * 100);
    for (const context of contexts) {
      if (filters.currency && context.currency !== filters.currency) continue;
      if (filters.maxPrice !== undefined && !context.priced) continue;
      if (
        pinned.some(
          (index) => index < 0 || !context.members[index] || !allowed[index],
        )
      )
        continue;
      prefix.fill(Infinity);
      maximum.fill(-Infinity);
      suffix.fill(Infinity);
      for (let column = 0; column < context.columns.length; column++) {
        for (const index of context.columns[column]) {
          if (!allowed[index]) continue;
          let cheapest = column === 0 ? 0 : Infinity;
          let highest = column === 0 ? 0 : -Infinity;
          for (const parent of context.incoming[index]) {
            cheapest = Math.min(cheapest, prefix[parent]);
            highest = Math.max(highest, maximum[parent]);
          }
          prefix[index] = cheapest + context.weights[index];
          maximum[index] = highest + context.weights[index];
        }
      }
      const last = context.columns.length - 1;
      for (let column = last; column >= 0; column--) {
        for (const index of context.columns[column]) {
          if (!Number.isFinite(prefix[index])) continue;
          let cheapest = column === last ? 0 : Infinity;
          for (const child of context.outgoing[index])
            cheapest = Math.min(cheapest, suffix[child]);
          suffix[index] = cheapest + context.weights[index];
          const total = prefix[index] + cheapest;
          if (!Number.isFinite(total) || total > cap) continue;
          const id = flights[index].id;
          nodes.add(id);
          if (
            context.priced &&
            context.currency &&
            total < (prices.get(id)?.amount ?? Infinity) * 100
          ) {
            prices.set(id, {
              amount: total / 100,
              currency: context.currency,
              status: "verified",
            });
            const fare = context.fares[index];
            if (fare) fares.set(id, fare);
            else fares.delete(id);
          }
        }
      }
      for (const index of context.columns[last] ?? []) {
        if (!Number.isFinite(prefix[index]) || !context.priced) continue;
        minTotal = Math.min(minTotal, prefix[index] / 100);
        maxTotal = Math.max(maxTotal, maximum[index] / 100);
      }
      for (const edge of context.edges) {
        if (
          Number.isFinite(prefix[edge.from]) &&
          Number.isFinite(suffix[edge.to]) &&
          prefix[edge.from] + suffix[edge.to] <= cap
        )
          edges.add(edge.value);
      }
    }
    return { nodes, edges: [...edges], prices, fares, minTotal, maxTotal };
  };
}

export function filterFlightPaths(
  graph: FlightGraph,
  selected: FlightSelections = [],
  filters: FlightPathFilters = {},
) {
  return createFlightPathFilter(graph)(selected, filters);
}
