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
import { FlightMapPreviewContext } from "./FlightMapPreviewContext";
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
    itineraries: [
      { legs, price: { status: "verified", amount: 500, currency: "USD" } },
    ],
    flights: [
      {
        legIndex: 0,
        leg: legs[0],
        bookingLegCount: 1,
        price: { status: "verified", amount: 100, currency: "USD" },
      },
      {
        legIndex: 1,
        leg: alternative,
        bookingLegCount: 2,
        price: { status: "verified", amount: 400, currency: "USD" },
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
      price: { status: "verified", amount: 100, currency: "USD" },
    })),
    itineraries: [
      { legs, price: { status: "verified", amount: 500, currency: "USD" } },
      {
        legs: otherLegs,
        price: { status: "verified", amount: 900, currency: "USD" },
      },
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
          status: "verified",
          flightIndex,
          amount: index === 0 ? 100 : 200,
        })),
      },
      {
        connectionIndexes: [2, 3],
        currency: "USD",
        costs: [1, 3, 5].map((flightIndex) => ({
          status: "verified",
          flightIndex,
          amount: 300,
        })),
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
}: {
  found?: FareSearchResult;
  searching?: boolean;
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
  render(<Grid />);
  const middle = screen.getByRole("group", { name: /Middle$/ });
  fireEvent.click(within(middle).getByText("Flight details"));
  expect(screen.queryByText(/\d+ of \d+ flights selected/)).toBeNull();
  expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  fireEvent.click(middle);
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
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
    screen.queryByRole("button", { name: "Review selected flights" }),
  ).toBeNull();
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
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(3);
  expect(
    screen.queryByRole("button", { name: "Review selected flights" }),
  ).toBeNull();
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
  expect(container.querySelector(".flight-onboard-details")).toBeNull();
  const before = container
    .querySelector(".flight-grid-connections path")!
    .getAttribute("d");
  fireEvent.click(within(middle).getByText("Flight details"));
  await waitFor(() =>
    expect(middle.querySelector(".flight-onboard-details")).not.toBeNull(),
  );
  expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
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

test.each(["unverified", undefined, "unknown"])(
  "unconfirmed %s quotes never appear as fares, totals, or slider values",
  (status) => {
    const found = structuredClone(connected);
    found.response.flights!.forEach((flight) => {
      flight.price = { amount: 98765, currency: "USD", status };
    });
    found.response.itineraries.forEach((itinerary) => {
      itinerary.price = { amount: 98765, currency: "USD", status };
    });
    found.response.routeGraphs!.forEach((graph) =>
      graph.costs!.forEach((cost) => {
        cost.amount = 98765;
        cost.status = status;
      }),
    );
    const { container } = render(<Grid found={found} />);
    expect(screen.getAllByText("Price unconfirmed")).toHaveLength(6);
    expect(container.textContent).not.toMatch(/98,?765|197,?530|296,?295/);
    expect(screen.getByRole("slider")).toBeDisabled();
    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-valuetext",
      "Price unconfirmed",
    );
    // Route compatibility remains available even without a confirmed price.
    fireEvent.click(
      screen.getByRole("button", { name: /Choose flight First,/ }),
    );
    expect(
      screen.getByRole("button", { name: /Choose flight First,/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getAllByText("Complete trip · price unconfirmed").length,
    ).toBeGreaterThan(0);
  },
);

test("verified cards show the confirmed quote without a verification tag", () => {
  render(<Grid />);
  expect(screen.queryByText("Price verified")).toBeNull();
  expect(screen.queryByText("Price unconfirmed")).toBeNull();
  expect(screen.getAllByText("USD $100").length).toBeGreaterThan(0);
});

test("price sort changes direction, keeps selections first, and puts unconfirmed fares last", () => {
  const found = structuredClone(connected);
  const unknown = leg("ATL", "JFK", "Unconfirmed");
  found.response.flights!.push({
    legIndex: 0,
    leg: unknown,
    bookingLegCount: 1,
    price: { amount: 1, currency: "USD", status: "unverified" },
  });
  render(<Grid found={found} />);
  const column = screen.getByRole("region", {
    name: "Destination 1: New York",
  });
  const order = () =>
    within(column)
      .getAllByRole("button", { name: /^Choose flight/ })
      .map((button) => button.getAttribute("aria-label")!.split(",")[0]);
  expect(order()).toEqual([
    "Choose flight First",
    "Choose flight Other outbound",
    "Choose flight Unconfirmed",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Price: ascending" }));
  expect(order()).toEqual([
    "Choose flight Other outbound",
    "Choose flight First",
    "Choose flight Unconfirmed",
  ]);
  fireEvent.click(
    within(column).getByRole("button", { name: /^Choose flight First,/ }),
  );
  expect(order()).toEqual([
    "Choose flight First",
    "Choose flight Other outbound",
    "Choose flight Unconfirmed",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Price: descending" }));
  expect(order()[0]).toBe("Choose flight First");
  fireEvent.click(
    within(column).getByRole("button", { name: /^Choose flight Unconfirmed,/ }),
  );
  expect(order()[0]).toBe("Choose flight Unconfirmed");
});

test("return header shows the planned date before results arrive", () => {
  render(
    <FlightRouteGrid
      visits={visits}
      returnDate="2030-05-09"
      cities={{}}
      searching
      chosen={[]}
      busy={false}
      onChoose={vi.fn()}
      preferredAirlines={[]}
    />,
  );
  const column = screen.getByRole("region", { name: "Return home" });
  expect(column.querySelector("header")).toHaveTextContent("2030-05-09");
});

test("return header shows available departure dates and follows the selected return", () => {
  const found = structuredClone(connected);
  found.response.flights![4].leg.segments[0].departure_time_local =
    "2030-05-09T10:00:00";
  found.response.flights![5].leg.segments[0].departure_time_local =
    "2030-05-10T10:00:00";
  // Use the authoritative graph without older itinerary samples.
  found.response.itineraries = [];
  render(<Grid found={found} />);
  const column = screen.getByRole("region", { name: "Return home" });
  expect(column.querySelector("header")).toHaveTextContent(
    "2030-05-09 – 2030-05-10",
  );
  fireEvent.click(
    within(column).getByRole("button", {
      name: /^Choose flight Other return,/,
    }),
  );
  expect(column.querySelector("header")).toHaveTextContent("2030-05-10");
  expect(column.querySelector("header")).not.toHaveTextContent("2030-05-09");
});

test("flight details expand compact aircraft information without repeating the itinerary or selecting the card", async () => {
  const found = structuredClone(connected);
  found.response.flights![0].leg.segments[0].aircraft = "Boeing 737 MAX 9";
  found.response.flights![0].leg.segments[0].operating_carrier_name =
    "Example Air";
  render(<Grid found={found} />);
  const card = screen.getByRole("group", { name: /First$/ });
  fireEvent.click(within(card).getByText("Flight details"));
  expect(
    await within(card).findByText("Aircraft: Boeing 737 MAX 9"),
  ).toBeVisible();
  expect(within(card).getByText("Operated by Example Air")).toBeVisible();
  expect(within(card).queryByText("Amenities not provided")).toBeNull();
  expect(card.querySelector(".flight-information")).toBeNull();
  expect(
    within(card).getByRole("button", { name: /^Choose flight/ }),
  ).toHaveAttribute("aria-pressed", "false");
});

test.each(["Departure", "Arrival", "Duration"])(
  "split sort selects %s without changing direction; primary button reverses it",
  async (field) => {
    const found = structuredClone(connected);
    found.response.itineraries = [];
    const early = found.response.flights![0].leg;
    const late = found.response.flights![1].leg;
    early.segments[0].departure_time_local = "2030-05-01T08:00:00";
    early.segments[0].arrival_time_local = "2030-05-01T10:00:00";
    early.duration_minutes = 120;
    late.segments[0].departure_time_local = "2030-05-01T14:00:00";
    late.segments[0].arrival_time_local = "2030-05-01T18:00:00";
    late.duration_minutes = 240;
    render(<Grid found={found} />);
    const column = screen.getByRole("region", {
      name: "Destination 1: New York",
    });
    const first = () =>
      within(column).getAllByRole("button", { name: /^Choose flight/ })[0];
    fireEvent.click(screen.getByRole("button", { name: "Choose sort field" }));
    expect(
      screen.getByRole("menuitemradio", { name: "Price" }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: field }));
    const ascending = await screen.findByRole("button", {
      name: `${field}: ascending`,
    });
    expect(first()).toHaveAccessibleName(/^Choose flight First,/);
    fireEvent.click(ascending);
    expect(
      screen.getByRole("button", { name: `${field}: descending` }),
    ).toBeVisible();
    expect(first()).toHaveAccessibleName(/^Choose flight Other outbound,/);
    fireEvent.click(
      within(column).getByRole("button", { name: /^Choose flight First,/ }),
    );
    expect(first()).toHaveAccessibleName(/^Choose flight First,/);
    fireEvent.click(screen.getByRole("button", { name: "Choose sort field" }));
    expect(screen.getByRole("menuitemradio", { name: field })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Price" }));
    expect(
      await screen.findByRole("button", { name: "Price: descending" }),
    ).toBeVisible();
  },
);

test("preferred airlines are tagged on the matching grid cards", () => {
  const found = structuredClone(connected);
  found.response.flights![0].leg.segments[0].marketing_carrier_code = "DL";
  found.response.itineraries = [];
  render(
    <FlightRouteGrid
      result={found}
      visits={visits}
      cities={{}}
      searching={false}
      chosen={[]}
      busy={false}
      onChoose={vi.fn()}
      preferredAirlines={["DL"]}
    />,
  );
  const preferred = screen.getByRole("group", { name: /First$/ });
  const other = screen.getByRole("group", { name: /Other outbound$/ });
  expect(within(preferred).getByText("Preferred Airline")).toBeVisible();
  expect(within(other).queryByText("Preferred Airline")).toBeNull();
});

test.each(["hover", "focus"])(
  "%s ignores alternative flights in a chosen column and resumes when the choice is cleared",
  (interaction) => {
    const { container } = render(<Grid />);
    const middle = screen.getByRole("group", { name: /Middle$/ });
    const alternative = screen.getByRole("group", { name: /Alternative$/ });
    const activate = () =>
      interaction === "hover"
        ? fireEvent.mouseEnter(alternative)
        : fireEvent.focus(
            within(alternative).getByRole("button", { name: /^Choose flight/ }),
          );
    activate();
    expect(alternative).toHaveClass("is-active");
    expect(connectionCount(container)).toBe(2);
    // Changing the selection also invalidates an existing highlight on another card.
    fireEvent.click(
      within(middle).getByRole("button", { name: /^Choose flight/ }),
    );
    expect(alternative).not.toHaveClass("is-active");
    expect(connectionCount(container)).toBe(0);
    activate();
    expect(alternative).not.toHaveClass("is-active");
    expect(connectionCount(container)).toBe(0);
    expect(screen.getByRole("status")).not.toHaveTextContent(
      "replace your selection",
    );
    // Blocking highlights must not block choosing a replacement.
    fireEvent.click(
      within(alternative).getByRole("button", { name: /^Choose flight/ }),
    );
    expect(alternative).toHaveClass("is-chosen");
    fireEvent.click(
      within(alternative).getByRole("button", { name: /^Choose flight/ }),
    );
    activate();
    expect(alternative).toHaveClass("is-active");
    expect(connectionCount(container)).toBe(2);
  },
);

test("a fully chosen trip keeps its connecting line visible without hover or keyboard focus", () => {
  const { container } = render(<Grid />);
  for (const name of [/First$/, /Middle$/, /Return$/]) {
    const card = screen.getByRole("group", { name });
    fireEvent.click(
      within(card).getByRole("button", { name: /^Choose flight/ }),
    );
    fireEvent.mouseLeave(card);
    fireEvent.keyDown(card, { key: "Escape" });
  }
  expect(connectionCount(container)).toBe(2);
  const path = container
    .querySelector(".flight-grid-connections path")!
    .getAttribute("d");
  const alternative = screen.getByRole("group", { name: /Alternative$/ });
  fireEvent.mouseEnter(alternative);
  fireEvent.focus(
    within(alternative).getByRole("button", { name: /^Choose flight/ }),
  );
  expect(alternative).not.toHaveClass("is-active");
  expect(
    container.querySelector(".flight-grid-connections path")!.getAttribute("d"),
  ).toBe(path);
  const middle = screen.getByRole("group", { name: /Middle$/ });
  fireEvent.click(
    within(middle).getByRole("button", { name: /^Choose flight/ }),
  );
  expect(connectionCount(container)).toBe(0);
});

test("restored chosen flights remain connected when no current search graph is available", () => {
  const props = {
    visits,
    cities: {},
    searching: false,
    busy: false,
    onChoose: vi.fn(),
    preferredAirlines: [],
  };
  const found = structuredClone(connected);
  found.response.itineraries = [];
  found.response.flightConnections = undefined;
  found.response.routeGraphs = undefined;
  const chosenLegs = [
    found.response.flights![0].leg,
    found.response.flights![2].leg,
    found.response.flights![4].leg,
  ];
  const { container, rerender } = render(
    <FlightRouteGrid
      {...props}
      result={found}
      chosen={chosenLegs.map(legKey)}
    />,
  );
  expect(connectionCount(container)).toBe(2);
  expect(screen.getByRole("status")).toHaveTextContent(
    "No complete trips match",
  );
  // Do not draw through a card that has not loaded yet.
  rerender(
    <FlightRouteGrid
      {...props}
      result={undefined}
      chosen={chosenLegs.map(legKey)}
    />,
  );
  expect(connectionCount(container)).toBe(0);
});

test("hover and keyboard focus preview an alternative's entire itinerary without changing the chosen flight", () => {
  const preview = { onHover: vi.fn(), onFocus: vi.fn() };
  const connecting = {
    ...alternative,
    segments: [
      ...leg("JFK", "IAD", "Connection one").segments,
      ...leg("IAD", "BOS", "Connection two").segments,
    ],
  };
  const found = structuredClone(connected);
  found.response.flights = found.response.flights!.map((flight) =>
    flight.leg.carrier === alternative.carrier
      ? { ...flight, leg: connecting }
      : flight,
  );
  found.response.itineraries = found.response.itineraries.map((itinerary) => ({
    ...itinerary,
    legs: itinerary.legs?.map((flight) =>
      flight.carrier === alternative.carrier ? connecting : flight,
    ),
  }));
  render(
    <FlightMapPreviewContext.Provider value={preview}>
      <Grid found={found} />
    </FlightMapPreviewContext.Provider>,
  );
  const middle = screen.getByRole("group", { name: /Middle$/ });
  fireEvent.click(
    within(middle).getByRole("button", { name: /^Choose flight/ }),
  );
  const card = screen.getByRole("group", { name: /Alternative$/ });
  fireEvent.mouseEnter(card);
  expect(preview.onHover).toHaveBeenLastCalledWith(connecting);
  expect(card).not.toHaveClass("is-active");
  expect(middle).toHaveClass("is-chosen");
  fireEvent.mouseLeave(card);
  expect(preview.onHover).toHaveBeenLastCalledWith(undefined);
  fireEvent.focus(within(card).getByRole("button", { name: /^Choose flight/ }));
  expect(preview.onFocus).toHaveBeenLastCalledWith(connecting);
  fireEvent.blur(card, { relatedTarget: document.body });
  expect(preview.onFocus).toHaveBeenLastCalledWith(undefined);
  fireEvent.keyDown(card, { key: "Escape" });
  expect(preview.onHover).toHaveBeenLastCalledWith(undefined);
  expect(middle).toHaveClass("is-chosen");
});
