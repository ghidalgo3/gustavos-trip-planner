import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ColorSchemeProvider from "./ColorSchemeProvider";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { getSelectedFlights, getFlightChoices } from "./selectedFlightsApi";
import { legKey } from "./flightFormatting";
import TripOverview from "./TripOverview";
import { planningRequest } from "./activityPlanApi";
vi.mock("./activityPlanApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./activityPlanApi")>()),
  planningRequest: vi.fn(),
}));
import { resolveCity, searchCities, type Trip } from "./api";
import {
  addDestination,
  deleteDestination,
  replaceDestinationStay,
  replaceDestinationPlace,
  getDestinations,
  getActivities,
  type Destination,
} from "./activitiesApi";

vi.mock("./airportCities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./airportCities")>()),
  useAirportCities: () => ({ JFK: "New York", CDG: "Paris" }),
}));
vi.mock("./selectedFlightsApi", () => ({
  getSelectedFlights: vi.fn(),
  getFlightChoices: vi.fn(),
}));
vi.mock("./api", () => ({ searchCities: vi.fn(), resolveCity: vi.fn() }));
vi.mock("./activitiesApi", () => ({
  getDestinations: vi.fn(),
  getActivities: vi.fn(),
  addDestination: vi.fn(),
  deleteDestination: vi.fn(),
  replaceDestinationStay: vi.fn(),
  replaceDestinationPlace: vi.fn(),
}));
const trip: Trip = {
  id: "trip",
  ownerUserId: "owner",
  name: "Europe",
  description: "",
  constraints: {},
  createdAt: "",
  updatedAt: "",
};
const paris: Destination = {
  type: "Feature",
  id: "paris-fr",
  geometry: { type: "Point", coordinates: [2.35, 48.86] },
  properties: {
    name: "Paris",
    countryCode: "FR",
    timeZone: null,
    contextVersion: "1",
    arrivalDate: null,
    departureDate: null,
    isActive: true,
    stays: [
      {
        id: "stay-1",
        order: 0,
        arrivalDate: null,
        departureDate: null,
        arrivalAt: "",
        departureAt: "",
      },
    ],
  },
};
function show(readOnly = false, homeCity: string | null = "New York") {
  return render(
    <ColorSchemeProvider>
      <MemoryRouter>
        <TripOverview trip={trip} readOnly={readOnly} homeCity={homeCity} />
      </MemoryRouter>
    </ColorSchemeProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(planningRequest).mockResolvedValue({
    data: { version: 0 },
    etag: '"0"',
  });
  vi.mocked(getSelectedFlights).mockResolvedValue([]);
  vi.mocked(getFlightChoices).mockResolvedValue([]);
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [],
  });
  vi.mocked(deleteDestination).mockResolvedValue(undefined);
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [],
    route: [],
  });
  vi.mocked(searchCities).mockResolvedValue([
    {
      id: "paris",
      label: "Paris, France",
      cityName: "Paris",
      countryCode: "FR",
    },
  ]);
  vi.mocked(resolveCity).mockResolvedValue({
    longitude: 2.35,
    latitude: 48.86,
  });
  vi.mocked(addDestination).mockResolvedValue(paris);
});
function chooseStayDates(drawer: HTMLElement) {
  const calendar = within(drawer).getByLabelText("Destination dates");
  for (
    let count = 0;
    count < 24 &&
    calendar.querySelector(".trip-calendar-heading strong")?.textContent !==
      "June 2027";
    count++
  ) {
    const next = within(calendar).getByLabelText("Next month");
    act(() => next.focus());
    fireEvent.click(next);
  }
  for (const day of [10, 14]) {
    const button = within(calendar).getByRole("button", {
      name: new RegExp(`^Jun ${day}, 2027`),
    });
    act(() => button.focus());
    fireEvent.click(button);
  }
}

async function openAndChooseCity() {
  const trigger = await screen.findByRole("button", {
    name: "Add destination",
  });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const drawer = await screen.findByRole("dialog");
  // JSDOM has no layout for Tabster's automatic focus target selection.
  const input = within(drawer).getByLabelText("Destination city");
  act(() => input.focus());
  expect(
    await within(drawer).findByRole("combobox", { name: "Destination city" }),
  ).toBe(input);
  fireEvent.change(input, { target: { value: "Par" } });
  fireEvent.click(await screen.findByRole("option", { name: "Paris, France" }));
  return drawer;
}

test("starts empty and adds a selected city through the drawer without requiring dates", async () => {
  show();
  expect(
    await screen.findByRole("heading", { name: "Your trip starts here" }),
  ).toBeVisible();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  const drawer = await openAndChooseCity();
  expect(
    within(drawer).queryByLabelText("Country code"),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(drawer).getByRole("button", { name: "Add destination" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(addDestination).toHaveBeenCalledWith("trip", {
    name: "Paris",
    countryCode: "FR",
    longitude: 2.35,
    latitude: 48.86,
    arrivalDate: null,
    departureDate: null,
  });
  expect(await screen.findByRole("heading", { name: "Paris" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Plan activities in Paris" }),
  ).toHaveAttribute("href", "/trips/trip/activities?destination=paris-fr");
  expect(
    (await screen.findByText("Paris added to your trip.")).closest(
      ".fui-Toast",
    ),
  ).not.toBeNull();
});

test("cancel closes the drawer and discards its unsaved selection", async () => {
  show();
  const drawer = await openAndChooseCity();
  fireEvent.click(within(drawer).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(addDestination).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", { name: "Add destination" }),
  );
  const reopened = await screen.findByRole("dialog");
  expect(
    within(reopened).getByRole("combobox", { name: "Destination city" }),
  ).toHaveValue("");
  expect(
    within(reopened).getByRole("button", { name: "Add destination" }),
  ).toBeDisabled();
});

test("retains the selected date range after a save failure for retry", async () => {
  vi.mocked(addDestination).mockRejectedValueOnce(
    new Error("Please try again."),
  );
  show();
  const drawer = await openAndChooseCity();
  const submit = within(drawer).getByRole("button", {
    name: "Add destination",
  });
  chooseStayDates(drawer);
  fireEvent.click(submit);
  expect(
    (await screen.findByText("Please try again.")).closest(".fui-Toast"),
  ).not.toBeNull();
  expect(
    within(drawer).getByRole("combobox", { name: "Destination city" }),
  ).toHaveValue("Paris, France");
  expect(within(drawer).getByText("Jun 10, 2027 – Jun 14, 2027")).toBeVisible();
  fireEvent.click(submit);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(addDestination).toHaveBeenLastCalledWith(
    "trip",
    expect.objectContaining({
      arrivalDate: "2027-06-10",
      departureDate: "2027-06-14",
    }),
  );
});

test("shared trips show their destinations without offering edits", async () => {
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [paris],
    route: [{ destinationId: paris.id, stayId: "stay-1" }],
  });
  show(true);
  expect(await screen.findByRole("heading", { name: "Paris" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Add destination" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete destination: Paris" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole("link", { name: "View activities in Paris" }),
  ).toBeVisible();
});

test("load failures offer retry rather than showing an empty trip", async () => {
  vi.mocked(getDestinations).mockRejectedValueOnce(
    new Error("Could not load destinations."),
  );
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load destinations.",
  );
  expect(
    screen.queryByRole("heading", { name: "Your trip starts here" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "Your trip starts here" }),
  ).toBeVisible();
});

test("keeps repeat visits in itinerary order", async () => {
  const secondStay = { ...paris.properties.stays[0], id: "stay-2", order: 2 };
  const rome: Destination = {
    ...paris,
    id: "rome-it",
    properties: {
      ...paris.properties,
      name: "Rome",
      stays: [{ ...secondStay, id: "rome-stay", order: 1 }],
    },
  };
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [
      {
        ...paris,
        properties: {
          ...paris.properties,
          stays: [...paris.properties.stays, secondStay],
        },
      },
      rome,
    ],
    route: [
      { destinationId: paris.id, stayId: "stay-1" },
      { destinationId: rome.id, stayId: "rome-stay" },
      { destinationId: paris.id, stayId: "stay-2" },
    ],
  });
  show();
  const list = await screen.findByRole("list", { name: "Trip destinations" });
  expect(
    within(list)
      .getAllByRole("heading")
      .map((heading) => heading.textContent),
  ).toEqual(["Paris", "Rome", "Paris"]);
  const dialog = await openDelete();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete destination" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(await screen.findByRole("heading", { name: "Rome" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Paris" }),
  ).not.toBeInTheDocument();
  expect(deleteDestination).toHaveBeenCalledExactlyOnceWith("trip", "paris-fr");
});

async function openDelete(name = "Paris") {
  const triggers = await screen.findAllByRole("button", {
    name: `Delete destination: ${name}`,
  });
  act(() => triggers[0].focus());
  fireEvent.click(triggers[0]);
  const dialog = await screen.findByRole("dialog");
  act(() =>
    within(dialog)
      .getByText("Delete destination", { selector: "button" })
      .focus(),
  );
  await within(dialog).findByRole("button", { name: "Delete destination" });
  return dialog;
}

test("canceling deletion preserves the destination; confirming the last city restores the empty overview", async () => {
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [paris],
    route: [{ destinationId: paris.id, stayId: "stay-1" }],
  });
  show();
  const dialog = await openDelete();
  expect(
    within(dialog).getByText(
      /This deletes all visits to Paris and all activities/,
    ),
  ).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(deleteDestination).not.toHaveBeenCalled();
  expect(await screen.findByRole("heading", { name: "Paris" })).toBeVisible();
  const reopened = await openDelete();
  fireEvent.click(
    within(reopened).getByRole("button", { name: "Delete destination" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Your trip starts here" }),
  ).toBeVisible();
  expect(deleteDestination).toHaveBeenCalledExactlyOnceWith("trip", "paris-fr");
});

test("a deletion failure retains the city and allows retry", async () => {
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [paris],
    route: [{ destinationId: paris.id, stayId: "stay-1" }],
  });
  vi.mocked(deleteDestination).mockRejectedValueOnce(
    new Error("Please retry."),
  );
  show();
  const dialog = await openDelete();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete destination" }),
  );
  expect(
    (await screen.findByText("Please retry.")).closest(".fui-Toast"),
  ).not.toBeNull();
  fireEvent.click(
    await screen.findByRole("button", { name: "Dismiss notification" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("Please retry.")).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("heading", { name: "Paris", hidden: true }),
  ).toBeInTheDocument();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete destination" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Your trip starts here" }),
  ).toBeVisible();
  expect(deleteDestination).toHaveBeenCalledTimes(2);
});

test("destination visit dates can be edited on Overview", async () => {
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [paris],
    route: [{ destinationId: paris.id, stayId: "stay-1" }],
  });
  const updated = {
    ...paris,
    properties: {
      ...paris.properties,
      stays: [
        {
          ...paris.properties.stays[0],
          arrivalDate: "2027-06-10",
          departureDate: "2027-06-14",
        },
      ],
    },
  };
  vi.mocked(replaceDestinationStay).mockResolvedValue(updated);
  show();
  const trigger = await screen.findByRole("button", {
    name: "Edit dates: Paris, visit 1",
  });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const drawer = await screen.findByRole("dialog");
  chooseStayDates(drawer);
  fireEvent.click(within(drawer).getByRole("button", { name: "Save dates" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(replaceDestinationStay).toHaveBeenCalledWith(
    "trip",
    "paris-fr",
    "stay-1",
    { arrivalDate: "2027-06-10", departureDate: "2027-06-14" },
  );
  const notification = await screen.findByText("Visit dates saved.");
  expect(notification).toBeVisible();
  expect(notification.closest(".fui-Toast")).not.toBeNull();
  expect(notification.closest(".trip-overview")).toBeNull();
  const reopen = await screen.findByRole("button", {
    name: "Edit dates: Paris, visit 1",
  });
  act(() => reopen.focus());
  fireEvent.click(reopen);
  const reopened = await screen.findByRole("dialog");
  expect(
    within(reopened).getByText("Jun 10, 2027 – Jun 14, 2027"),
  ).toBeVisible();
});

test("orders dated visits chronologically, then keeps undated visits in itinerary order", async () => {
  const late = {
    ...paris,
    id: "late",
    properties: {
      ...paris.properties,
      name: "Late",
      stays: [
        {
          ...paris.properties.stays[0],
          id: "late-stay",
          order: 0,
          arrivalDate: "2027-07-20",
          departureDate: "2027-07-25",
        },
      ],
    },
  };
  const early = {
    ...paris,
    id: "early",
    properties: {
      ...paris.properties,
      name: "Early",
      stays: [
        {
          ...paris.properties.stays[0],
          id: "early-stay",
          order: 2,
          arrivalDate: "2027-07-10",
          departureDate: "2027-07-12",
        },
      ],
    },
  };
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [late, paris, early],
    route: [
      { destinationId: late.id, stayId: "late-stay" },
      { destinationId: paris.id, stayId: "stay-1" },
      { destinationId: early.id, stayId: "early-stay" },
    ],
  });
  show();
  const list = await screen.findByRole("list", { name: "Trip destinations" });
  expect(
    within(list)
      .getAllByRole("heading")
      .map((item) => item.textContent),
  ).toEqual(["Early", "Late", "Paris"]);
});

test("shows activity counts by free-form state instead of a plan button for a populated city", async () => {
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [paris],
    route: [{ destinationId: paris.id, stayId: "stay-1" }],
  });
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: ["Planned", "Planned", "Proposed", "Maybe"].map(
      (state, index) => ({
        type: "Feature",
        id: String(index),
        geometry: null,
        properties: {
          name: "Activity",
          description: "",
          duration: null,
          cost: null,
          placeName: null,
          state,
        },
      }),
    ),
  });
  show();
  expect(
    await screen.findByRole("link", { name: "2 Planned activities in Paris" }),
  ).toHaveAttribute("href", "/trips/trip/activities?destination=paris-fr");
  expect(
    screen.getByRole("link", { name: "1 Maybe activities in Paris" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Plan activities in Paris" }),
  ).not.toBeInTheDocument();
});

test("summary failures offer retry and do not imply a destination has no activities", async () => {
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [paris],
    route: [{ destinationId: paris.id, stayId: "stay-1" }],
  });
  vi.mocked(getActivities).mockRejectedValueOnce(new Error("Unavailable"));
  show();
  const retry = await screen.findByRole("button", {
    name: "Retry activity summary",
  });
  expect(screen.queryByText("Plan Activities")).not.toBeInTheDocument();
  fireEvent.click(retry);
  expect(await screen.findByText("Plan Activities")).toBeVisible();
});

test.each(["New York", null])(
  "a single destination includes outbound and return flight links from %s",
  async (homeCity) => {
    vi.mocked(getDestinations).mockResolvedValue({
      type: "FeatureCollection",
      features: [paris],
      route: [],
    });
    show(false, homeCity);
    const links = await screen.findAllByRole("link", { name: "Plan Flights" });
    expect(links).toHaveLength(2);
    for (const link of links)
      expect(link).toHaveAttribute("href", "/trips/trip/flights");
    expect(
      screen.getByRole("listitem", {
        name: `Flights from ${homeCity ?? "Home"} to Paris`,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("listitem", {
        name: `Flights from Paris to ${homeCity ?? "Home"}`,
      }),
    ).toBeVisible();
  },
);

test("flight cards follow chronological visits, including the trip home", async () => {
  const rome: Destination = {
    ...paris,
    id: "rome",
    properties: {
      ...paris.properties,
      name: "Rome",
      stays: [
        {
          ...paris.properties.stays[0],
          id: "rome-stay",
          arrivalDate: "2027-07-20",
        },
      ],
    },
  };
  const datedParis: Destination = {
    ...paris,
    properties: {
      ...paris.properties,
      stays: [{ ...paris.properties.stays[0], arrivalDate: "2027-07-10" }],
    },
  };
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [rome, datedParis],
    route: [],
  });
  show();
  expect(
    await screen.findAllByRole("link", { name: "Plan Flights" }),
  ).toHaveLength(3);
  const list = screen.getByRole("list", { name: "Trip destinations" });
  expect(
    within(list)
      .getAllByRole("listitem")
      .map(
        (item) =>
          item.getAttribute("aria-label") ??
          within(item).getByRole("heading").textContent,
      ),
  ).toEqual([
    "Flights from New York to Paris",
    "Paris",
    "Flights from Paris to Rome",
    "Rome",
    "Flights from Rome to New York",
  ]);
});

test("destination date flexibility and fixed ordering are saved on the city resource while preserving other constraints", async () => {
  const destination = {
    ...paris,
    properties: {
      ...paris.properties,
      constraints: {
        budget: 400,
        arrivalFlexibilityDays: 1,
        departureFlexibilityDays: 2,
        keepAfterPrevious: false,
      },
    },
  };
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [destination],
    route: [],
  });
  vi.mocked(replaceDestinationStay).mockResolvedValue(destination);
  vi.mocked(replaceDestinationPlace).mockResolvedValue(destination);
  show();
  const trigger = await screen.findByRole("button", {
    name: "Edit dates: Paris, visit 1",
  });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const drawer = await screen.findByRole("dialog");
  const arrival = within(drawer).getByLabelText("Arrival flexibility (± days)");
  act(() => arrival.focus());
  expect(arrival).toHaveValue(1);
  expect(
    within(drawer).getByLabelText("Departure flexibility (± days)"),
  ).toHaveValue(2);
  const submit = within(drawer).getByRole("button", { name: "Save dates" });
  fireEvent.change(arrival, { target: { value: "6" } });
  expect(submit).toBeDisabled();
  fireEvent.change(arrival, { target: { value: "3" } });
  fireEvent.change(
    within(drawer).getByLabelText("Departure flexibility (± days)"),
    { target: { value: "4" } },
  );
  expect(
    within(drawer).queryByRole("checkbox", {
      name: "Keep this destination after the previous one",
    }),
  ).toBeNull();
  fireEvent.click(submit);
  await waitFor(() =>
    expect(replaceDestinationPlace).toHaveBeenCalledWith("trip", destination, {
      budget: 400,
      arrivalFlexibilityDays: 3,
      departureFlexibilityDays: 4,
      keepAfterPrevious: true,
    }),
  );
});

test.each([
  [-1, false],
  [0, false],
  [1, false],
  [1, true],
])(
  "overview shows persisted flight numbers including partial choices (selected index: %s, read only: %s)",
  async (selectedIndex, readOnly) => {
    vi.mocked(getDestinations).mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          ...paris,
          properties: {
            ...paris.properties,
            stays: [
              {
                ...paris.properties.stays[0],
                arrivalDate: "2027-06-10",
                departureDate: "2027-06-14",
              },
            ],
          },
        },
      ],
      route: [],
    });
    const legs = [
      {
        segments: [
          {
            departure_airport: "JFK",
            arrival_airport: "CDG",
            departure_time_local: "2027-06-09T21:00",
            arrival_time_local: "2027-06-10T09:00",
            marketing_carrier_code: "AA",
            flight_number: "100",
          },
        ],
      },
      {
        segments: [
          {
            departure_airport: "CDG",
            arrival_airport: "JFK",
            departure_time_local: "2027-06-14T11:00",
            arrival_time_local: "2027-06-14T13:00",
            marketing_carrier_code: "AA",
            flight_number: "101",
          },
        ],
      },
    ];
    vi.mocked(getSelectedFlights).mockResolvedValue([
      {
        tripId: "trip",
        partyId: "party",
        cacheKey: "old-search",
        itineraryIndex: 9,
        selectedAt: "2027-01-01",
        request: {
          origin: "JFK",
          destination: "CDG",
          departure_date: "2027-06-09",
          return_date: "2027-06-14",
          adults: 1,
          cabin_class: "economy",
          market: "US",
        },
        itinerary: { legs },
      },
    ]);
    if (selectedIndex >= 0) {
      if (selectedIndex === 0)
        vi.mocked(getSelectedFlights).mockResolvedValue([]);
      // A newer partial selection takes precedence over this party's old complete itinerary.
      vi.mocked(getFlightChoices).mockResolvedValue([
        {
          partyId: "party",
          legKeys:
            selectedIndex === 0 ? [legKey(legs[0])] : [null, legKey(legs[1])],
          nextOrigins: [],
          flights: [{ legIndex: selectedIndex, leg: legs[selectedIndex] }],
        },
      ]);
    }
    show(readOnly);
    expect(
      await screen.findByRole("link", {
        name: selectedIndex === 1 ? "AA 101" : "AA 100",
      }),
    ).toHaveAttribute("href", "/trips/trip/flights");
    if (selectedIndex < 0) {
      expect(screen.getByRole("link", { name: "AA 101" })).toBeVisible();
      expect(
        screen.queryByRole("link", { name: "Plan Flights" }),
      ).not.toBeInTheDocument();
    } else {
      expect(
        screen.queryByRole("link", {
          name: selectedIndex === 0 ? "AA 101" : "AA 100",
        }),
      ).toBeNull();
      expect(
        screen.getByRole("link", {
          name: readOnly ? "View Flights" : "Plan Flights",
        }),
      ).toBeVisible();
    }
  },
);

test.each([null, "Hotel Paris"])(
  "overview labels the stay button for %s and opens its drawer",
  async (stayName) => {
    vi.mocked(getDestinations).mockResolvedValue({
      type: "FeatureCollection",
      features: [
        {
          ...paris,
          properties: {
            ...paris.properties,
            stayLocation: stayName
              ? {
                  type: "Feature",
                  id: "hotel",
                  geometry: { type: "Point", coordinates: [2.35, 48.86] },
                  properties: { name: stayName },
                }
              : null,
          },
        },
      ],
      route: [
        { destinationId: paris.id, stayId: paris.properties.stays[0].id },
      ],
    });
    render(
      <ColorSchemeProvider>
        <MemoryRouter>
          <TripOverview trip={trip} readOnly={false} />
        </MemoryRouter>
      </ColorSchemeProvider>,
    );
    const label = stayName ?? "Choose stay";
    const button = await screen.findByRole("button", {
      name: `${label} in Paris`,
    });
    expect(button).toHaveTextContent(label);
    expect(screen.getAllByText(label)).toHaveLength(1);
    fireEvent.click(button);
    const drawer = await screen.findByRole("dialog", { name: "Stay in Paris" });
    expect(
      within(drawer).getByRole("combobox", { name: "Stay location" }),
    ).toBeVisible();
    if (!stayName) {
      expect(
        within(drawer).getByRole("button", { name: "Save Stay" }),
      ).toBeDisabled();
    }
  },
);

test("the date range itself opens date editing and delete is in the card corner", async () => {
  const destination = {
    ...paris,
    properties: {
      ...paris.properties,
      stays: [
        {
          ...paris.properties.stays[0],
          arrivalDate: "2027-06-10",
          departureDate: "2027-06-14",
        },
      ],
    },
  };
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [destination],
    route: [{ destinationId: paris.id, stayId: "stay-1" }],
  });
  show();
  const dates = await screen.findByRole("button", {
    name: "Edit dates: Paris, visit 1",
  });
  expect(dates).toHaveTextContent("Jun 10, 2027 – Jun 14, 2027");
  expect(
    screen.getByRole("button", { name: "Delete destination: Paris" }),
  ).toHaveClass("overview-destination-delete");
  fireEvent.click(dates);
  expect(await screen.findByRole("dialog")).toBeVisible();
});

test("failed planning summary can retry without losing activity counts", async () => {
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [paris],
    route: [{ destinationId: paris.id, stayId: "stay-1" }],
  });
  vi.mocked(planningRequest).mockRejectedValueOnce(new Error("Unavailable"));
  show();
  const retry = await screen.findByRole("button", {
    name: "Retry planning summary",
  });
  expect(
    screen.getByRole("link", { name: "Plan activities in Paris" }),
  ).toBeVisible();
  fireEvent.click(retry);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry planning summary" }),
    ).not.toBeInTheDocument(),
  );
});
