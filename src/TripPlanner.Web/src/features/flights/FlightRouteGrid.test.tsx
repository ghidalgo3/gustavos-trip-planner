import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
  act,
} from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import FlightRouteGrid from "./FlightRouteGrid";
import { legKey } from "./flightFormatting";
import type { FareLeg, FareSearchResult } from "../../api/operationsApi";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function connectionCount(container: HTMLElement) {
  return [
    ...container.querySelectorAll(".flight-grid-connections path"),
  ].reduce(
    (count, path) =>
      count + (path.getAttribute("d")?.match(/M /g)?.length ?? 0),
    0,
  );
}

function leg(origin: string, destination: string, flight: string): FareLeg {
  return {
    carrier: flight,
    segments: [
      {
        departure_airport: origin,
        arrival_airport: destination,
        departure_time_local: "2030-05-01T10:00:00",
        arrival_time_local: "2030-05-01T12:00:00",
        flight_number: flight,
      },
    ],
  };
}
const legs = [
  leg("ATL", "JFK", "First"),
  leg("JFK", "BOS", "Middle"),
  leg("BOS", "ATL", "Return"),
];
const alternative = leg("JFK", "BOS", "Alternative");
const result: FareSearchResult = {
  partyId: "party",
  cacheKey: "routes",
  fetchedAt: "2030-01-01T00:00:00Z",
  expiresAt: "2030-01-01T01:00:00Z",
  request: {
    origin: "ATL",
    destination: "JFK",
    departure_date: "2030-05-01",
    return_date: "2030-05-04",
    adults: 1,
    cabin_class: "economy",
    market: "US",
    searchKind: "itinerary",
  },
  response: {
    itineraries: [{ legs, price: { amount: 500, currency: "USD" } }],
    flights: [
      {
        legIndex: 0,
        leg: legs[0],
        bookingLegCount: 1,
        price: { amount: 100, currency: "USD" },
      },
      {
        legIndex: 1,
        leg: alternative,
        bookingLegCount: 2,
        price: { amount: 400, currency: "USD" },
      },
    ],
  },
  evaluations: [{ status: "Eligible", issues: [] }],
};
const visits = ["New York", "Boston"].map((label) => ({
  id: label,
  location: { code: label, label, timeZone: "America/New_York" },
  afterVisitIds: [],
  nights: 2,
  presentFrom: null,
  presentThrough: null,
}));

const otherLegs = [
  leg("ATL", "JFK", "Other outbound"),
  alternative,
  leg("BOS", "ATL", "Other return"),
];
const connected: FareSearchResult = {
  ...result,
  response: {
    flights: [
      legs[0],
      otherLegs[0],
      legs[1],
      otherLegs[1],
      legs[2],
      otherLegs[2],
    ].map((leg, index) => ({
      leg,
      legIndex: Math.floor(index / 2),
      bookingLegCount: 1,
      price: { amount: 100, currency: "USD" },
    })),
    itineraries: [
      { legs, price: { amount: 500, currency: "USD" } },
      { legs: otherLegs, price: { amount: 900, currency: "USD" } },
    ],
    flightConnections: [
      [0, 2],
      [2, 4],
      [1, 3],
      [3, 5],
    ].map(([fromFlightIndex, toFlightIndex]) => ({
      fromFlightIndex,
      toFlightIndex,
    })),
    routeGraphs: [
      {
        connectionIndexes: [0, 1],
        currency: "USD",
        costs: [0, 2, 4].map((flightIndex, index) => ({
          flightIndex,
          amount: index === 0 ? 100 : 200,
        })),
      },
      {
        connectionIndexes: [2, 3],
        currency: "USD",
        costs: [1, 3, 5].map((flightIndex) => ({ flightIndex, amount: 300 })),
      },
    ],
  },
  evaluations: [
    { status: "Eligible", issues: [] },
    { status: "Eligible", issues: [] },
  ],
};
function Grid({
  found = connected,
  searching = false,
  onReview = vi.fn(),
}: {
  found?: FareSearchResult;
  searching?: boolean;
  onReview?: (
    keys: string[],
    price?: { amount: number; currency: string },
  ) => void;
}) {
  const [chosen, setChosen] = useState<(string | null)[]>([]);
  return (
    <FluentProvider theme={webLightTheme}>
      <FlightRouteGrid
        result={found}
        visits={visits}
        cities={{}}
        searching={searching}
        chosen={chosen}
        onChoose={setChosen}
        onReview={onReview}
        busy={false}
        preferredAirlines={[]}
      />
    </FluentProvider>
  );
}

test("skeleton cards appear before and alongside streaming results, then disappear when searching finishes", () => {
  const props = {
    visits,
    cities: {},
    searching: true,
    chosen: [],
    busy: false,
    onChoose: vi.fn(),
    preferredAirlines: [],
  };
  const { rerender, container } = render(
    <FluentProvider theme={webLightTheme}>
      <FlightRouteGrid {...props} />
    </FluentProvider>,
  );
  expect(screen.getAllByLabelText(/Loading flights for/)).toHaveLength(3);
  expect(container.querySelectorAll(".flight-grid-skeleton")).toHaveLength(9);
  expect(screen.queryByRole("button", { name: /^Choose flight/ })).toBeNull();
  rerender(
    <FluentProvider theme={webLightTheme}>
      <FlightRouteGrid {...props} result={connected} />
    </FluentProvider>,
  );
  expect(container.querySelectorAll(".flight-grid-skeleton")).toHaveLength(3);
  const middle = screen.getByRole("group", { name: /Middle$/ });
  fireEvent.mouseEnter(middle);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Complete paths through this flight · 2 connected flights",
  );
  expect(connectionCount(container)).toBe(2);
  fireEvent.mouseLeave(middle);
  fireEvent.focus(
    within(middle).getByRole("button", { name: /^Choose flight/ }),
  );
  expect(connectionCount(container)).toBe(2);
  fireEvent.keyDown(middle, { key: "Escape" });
  expect(
    container.querySelectorAll(".flight-grid-connections path"),
  ).toHaveLength(0);
  rerender(
    <FluentProvider theme={webLightTheme}>
      <FlightRouteGrid {...props} searching={false} result={connected} />
    </FluentProvider>,
  );
  expect(screen.queryByLabelText(/Loading flights for/)).toBeNull();
  expect(screen.queryByText(/flight fare/i)).toBeNull();
});

test("a click selects only that flight, dims its column, filters the other columns, and can be undone", () => {
  const review = vi.fn();
  render(<Grid onReview={review} />);
  const middle = screen.getByRole("group", { name: /Middle$/ });
  fireEvent.click(within(middle).getByText("Flight details"));
  expect(screen.getByText("0 of 3 flights selected")).toBeVisible();
  fireEvent.click(middle);
  expect(screen.getByText("1 of 3 flights selected")).toBeVisible();
  expect(middle).toHaveClass("is-chosen");
  expect(
    within(middle).getByRole("button", { name: /^Choose flight/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("group", { name: /Alternative$/ })).toHaveClass(
    "is-muted",
  );
  expect(screen.queryByRole("group", { name: /Other outbound$/ })).toBeNull();
  expect(screen.queryByRole("group", { name: /Other return$/ })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Review selected flights" }),
  ).toBeDisabled();
  expect(review).not.toHaveBeenCalled();
  fireEvent.click(middle);
  expect(screen.getByRole("group", { name: /Other outbound$/ })).toBeVisible();
  fireEvent.click(screen.getByRole("group", { name: /Other return$/ }));
  expect(screen.queryByRole("group", { name: /Middle$/ })).toBeNull();
  expect(screen.getByRole("group", { name: /Return$/ })).toHaveClass(
    "is-muted",
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear selections" }));
  for (const name of [/Middle$/, /First$/, /Return$/])
    fireEvent.click(screen.getByRole("group", { name }));
  expect(review).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review selected flights" }),
  );
  expect(review).toHaveBeenCalledWith(legs.map(legKey), {
    amount: 500,
    currency: "USD",
  });
});

test("the slider filters complete trip totals and stays fixed as more expensive results arrive", () => {
  const { rerender } = render(<Grid searching />);
  fireEvent.change(
    screen.getByRole("slider", { name: "Maximum total trip cost" }),
    { target: { value: "600" } },
  );
  // Both sets of individual cards show $100; only the first full path costs <= $600.
  expect(screen.queryByRole("group", { name: /Alternative$/ })).toBeNull();
  expect(screen.getByRole("group", { name: /Middle$/ })).toBeVisible();
  const updated = structuredClone(connected);
  updated.response.routeGraphs![1].costs!.forEach(
    (cost) => (cost.amount = 500),
  );
  rerender(<Grid found={updated} searching />);
  expect(screen.getByRole("slider")).toHaveValue("600");
  expect(screen.queryByRole("group", { name: /Alternative$/ })).toBeNull();
  expect(screen.getByRole("slider")).toHaveAttribute("min", "500");
  expect(screen.getByRole("slider")).toHaveAttribute("max", "1500");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "500" } });
  expect(screen.getByRole("group", { name: /Middle$/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getByRole("group", { name: /Alternative$/ })).toBeVisible();
});

test("cost bounds follow selections and newly arriving prices, with a disabled slider for a single total", () => {
  const { rerender } = render(<Grid />);
  const slider = screen.getByRole("slider");
  expect(slider).toHaveAttribute("min", "500");
  expect(slider).toHaveAttribute("max", "900");
  fireEvent.click(screen.getByRole("group", { name: /Middle$/ }));
  expect(slider).toHaveAttribute("min", "500");
  expect(slider).toHaveAttribute("max", "500");
  expect(slider).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Clear selections" }));
  expect(slider).not.toBeDisabled();
  expect(slider).toHaveAttribute("max", "900");
  fireEvent.change(slider, { target: { value: "800" } });
  const cheaper = structuredClone(connected);
  cheaper.response.routeGraphs![1].costs!.forEach(
    (cost) => (cost.amount = 200),
  );
  rerender(<Grid found={cheaper} />);
  expect(slider).toHaveAttribute("max", "600");
  expect(slider).toHaveValue("600");
  expect(screen.getByRole("group", { name: /Other return$/ })).toBeVisible();
});

test("airline and stop multiselects remove whole paths containing disallowed flights", () => {
  const found = structuredClone(connected);
  found.response.flights![3].leg.segments = [
    {
      ...alternative.segments[0],
      arrival_airport: "IAD",
      arrival_time_local: "2030-05-01T11:00:00",
    },
    {
      ...alternative.segments[0],
      departure_airport: "IAD",
      departure_time_local: "2030-05-01T11:30:00",
      flight_number: "Connection",
    },
  ];
  render(<Grid found={found} />);
  fireEvent.click(screen.getByRole("combobox", { name: "Allowed stops" }));
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "1 stop" }));
  expect(screen.queryByRole("group", { name: /Other outbound$/ })).toBeNull();
  expect(screen.getByRole("group", { name: /First$/ })).toBeVisible();
  expect(screen.getByRole("slider")).toHaveAttribute("min", "500");
  expect(screen.getByRole("slider")).toHaveAttribute("max", "500");
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Allowed stops" }), {
    key: "Escape",
  });
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  fireEvent.click(screen.getByRole("combobox", { name: "Allowed airlines" }));
  fireEvent.click(
    screen.getByRole("menuitemcheckbox", { name: "Alternative" }),
  );
  expect(screen.queryByRole("group", { name: /Other return$/ })).toBeNull();
  expect(screen.getByRole("group", { name: /Return$/ })).toBeVisible();
});

test("cards show all flight numbers below the airline and reorder when preferences change", () => {
  const connecting: FareLeg = {
    carrier: "Delta",
    segments: [
      {
        ...legs[0].segments[0],
        arrival_airport: "BOS",
        marketing_carrier_code: "DL",
        flight_number: "123",
      },
      {
        ...legs[0].segments[0],
        departure_airport: "BOS",
        marketing_carrier_code: "KL",
        flight_number: "KL456",
      },
    ],
  };
  const american: FareLeg = {
    carrier: "American Airlines",
    segments: [
      {
        ...legs[0].segments[0],
        marketing_carrier_code: "AA",
        flight_number: "789",
        departure_time_local: "2030-05-01T09:00:00",
      },
    ],
  };
  const found: FareSearchResult = {
    ...result,
    response: {
      itineraries: [connecting, american].map((leg) => ({
        legs: [leg, legs[1], legs[2]],
      })),
    },
    evaluations: [
      { status: "Eligible", issues: [] },
      { status: "Eligible", issues: [] },
    ],
  };
  const props = {
    result: found,
    visits,
    cities: {},
    searching: true,
    chosen: [],
    busy: false,
    onChoose: vi.fn(),
  };
  const { rerender } = render(
    <FluentProvider theme={webLightTheme}>
      <FlightRouteGrid {...props} preferredAirlines={["DL"]} />
    </FluentProvider>,
  );
  const column = screen.getByRole("region", {
    name: "Destination 1: New York",
  });
  expect(within(column).getAllByRole("group")[0]).toHaveAccessibleName(
    /Delta$/,
  );
  const airline = screen.getByText("Delta").parentElement!;
  expect(within(airline).getByText("DL 123 · KL456")).toBeVisible();
  expect(within(column).getByText("AA 789")).toBeVisible();
  rerender(
    <FluentProvider theme={webLightTheme}>
      <FlightRouteGrid {...props} preferredAirlines={["AA"]} />
    </FluentProvider>,
  );
  expect(within(column).getAllByRole("group")[0]).toHaveAccessibleName(
    /American Airlines$/,
  );
});

test("hover reuses card geometry while resizing and expanded flight details update the connectors", async () => {
  let offset = 0;
  const rectangles = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      const column = this.closest(".flight-grid-column");
      const index = column
        ? [...document.querySelectorAll(".flight-grid-column")].indexOf(column)
        : 0;
      return new DOMRect(index * 300, index * offset, 240, 100);
    });
  const observe = vi.fn(),
    disconnect = vi.fn();
  const observers: (() => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const { container, unmount } = render(<Grid />);
  expect(observers).toHaveLength(1);
  expect(observe).toHaveBeenCalledTimes(7); // Six flight cards plus their canvas.
  rectangles.mockClear();
  observe.mockClear();
  const middle = screen.getByRole("group", { name: /Middle$/ });
  fireEvent.mouseEnter(middle);
  fireEvent.mouseLeave(middle);
  fireEvent.mouseEnter(screen.getByRole("group", { name: /First$/ }));
  expect(connectionCount(container)).toBe(2);
  expect(rectangles).not.toHaveBeenCalled();
  expect(observe).not.toHaveBeenCalled();
  expect(disconnect).not.toHaveBeenCalled();
  expect(container.querySelector(".flight-information")).toBeNull();
  const before = container
    .querySelector(".flight-grid-connections path")!
    .getAttribute("d");
  fireEvent.click(within(middle).getByText("Flight details"));
  await waitFor(() =>
    expect(middle.querySelector(".flight-information")).not.toBeNull(),
  );
  expect(screen.getByText("0 of 3 flights selected")).toBeVisible();
  // A detail drawer or viewport resize changes layout without changing flight data.
  offset = 40;
  act(() => {
    observers[0]();
    observers[0]();
  });
  await waitFor(() =>
    expect(
      container
        .querySelector(".flight-grid-connections path")!
        .getAttribute("d"),
    ).not.toBe(before),
  );
  expect(rectangles).toHaveBeenCalledTimes(7);
  expect(connectionCount(container)).toBe(2);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
