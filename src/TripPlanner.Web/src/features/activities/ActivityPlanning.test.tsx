import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Trip } from "../../api/api";
import ColorSchemeProvider from "../../app/ColorSchemeProvider";
import type { PlaceSearch } from "../../maps/ActivityMap";
import { mapsClient } from "../../maps/mapsClient";
import PersistentMapSurface from "../../maps/PersistentMapSurface";
import {
  deleteActivity,
  getActivities,
  getActivity,
  getDestinations,
  saveActivity,
  type Activity,
  type DestinationCollection,
} from "./activitiesApi";
import { planningRequest } from "./activityPlanApi";
import ActivityPlanning from "./ActivityPlanning";
import { listActivityKinds } from "./activityKindsApi";
vi.mock("./activityKindsApi", () => ({ listActivityKinds: vi.fn() }));
import type {
  ActivityRoutePreview,
  ActivityRouteSelection,
} from "./activityRouteApi";
vi.mock("./activityPlanApi", async (original) => ({
  ...(await original<typeof import("./activityPlanApi")>()),
  planningRequest: vi.fn(),
}));
vi.mock("../../maps/ActivityMap", () => ({
  default: ({
    activities,
    onSelect,
    stayLocations,
    placeSearch,
    portalHost,
    route,
    onClearRoute,
  }: {
    route?: ActivityRoutePreview;
    onClearRoute?: () => void;
    portalHost?: HTMLElement | null;
    placeSearch?: PlaceSearch;
    stayLocations?: import("./activitiesApi").StayLocation[];
    activities: Activity[];
    onSelect: (id: string) => void;
  }) => (
    <PersistentMapSurface host={portalHost}>
      <div aria-label="Map">
        {route && (
          <button onClick={onClearRoute}>Selected {route.mode} route</button>
        )}
        {placeSearch?.results.map((place, index) => (
          <button key={index} onClick={() => placeSearch.onSelect(index)}>
            {`Search marker: ${index + 1}. ${place.label}`}
          </button>
        ))}
        {!placeSearch &&
          stayLocations?.map((stay) => (
            <button
              key={stay.id}
              onClick={() => onSelect(`stay:${stay.id}`)}
            >{`Stay marker: ${stay.properties.name}`}</button>
          ))}
        {(placeSearch ? [] : activities)
          .filter((item) => item.geometry)
          .map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
            >{`Map marker: ${item.properties.name}`}</button>
          ))}
      </div>
    </PersistentMapSurface>
  ),
}));
vi.mock("../../maps/mapsClient", () => ({
  mapsClient: { searchPlaces: vi.fn() },
}));
vi.mock("./DailyActivityPlan", () => ({
  default: ({
    onSelectTravel,
  }: {
    onSelectTravel?: (value: ActivityRouteSelection) => void;
  }) => (
    <div>
      Plan editor
      <button
        onClick={() =>
          onSelectTravel?.({
            stayId: "visit",
            date: "2027-06-10",
            fromActivityId: "museum",
            toActivityId: "garden",
            mode: "walking",
            duration: "PT10M",
            label: "Travel from Museum to Garden",
            contextVersion: "revision",
            plan: {} as ActivityRouteSelection["plan"],
          })
        }
      >
        Show sample travel route
      </button>
    </div>
  ),
}));
vi.mock("./activitiesApi", () => ({
  getDestinations: vi.fn(),
  getActivities: vi.fn(),
  getActivity: vi.fn(),
  saveActivity: vi.fn(),
  researchActivityLocation: vi.fn(),
  researchActivityPlaces: vi.fn(),
  researchActivityDetails: vi.fn(),
  deleteActivity: vi.fn(),
  suggestActivities: vi.fn(),
  importActivityImages: vi.fn(),
  waitForActivityJob: vi.fn(),
  getSuggestionResult: vi.fn(),
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
const destinations: DestinationCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "paris-fr",
      geometry: { type: "Point", coordinates: [2.35, 48.86] },
      properties: {
        name: "Paris",
        countryCode: "FR",
        timeZone: "Europe/Paris",
        contextVersion: "p1",
        arrivalDate: null,
        departureDate: null,
        isActive: true,
        stays: [
          {
            id: "p1",
            order: 0,
            arrivalDate: "2027-06-10",
            departureDate: "2027-06-14",
            arrivalAt: "",
            departureAt: "",
          },
          {
            id: "p2",
            order: 2,
            arrivalDate: "2027-06-18",
            departureDate: "2027-06-20",
            arrivalAt: "",
            departureAt: "",
          },
        ],
      },
    },
    {
      type: "Feature",
      id: "rome-it",
      geometry: { type: "Point", coordinates: [12.49, 41.9] },
      properties: {
        name: "Rome",
        countryCode: "IT",
        timeZone: "Europe/Rome",
        contextVersion: "r1",
        arrivalDate: "2027-06-14",
        departureDate: "2027-06-18",
        isActive: true,
        stays: [
          {
            id: "r1",
            order: 1,
            arrivalDate: "2027-06-14",
            departureDate: "2027-06-18",
            arrivalAt: "",
            departureAt: "",
          },
        ],
      },
    },
  ],
  route: [
    { destinationId: "paris-fr", stayId: "p1" },
    { destinationId: "rome-it", stayId: "r1" },
    { destinationId: "paris-fr", stayId: "p2" },
  ],
};

const activity: Activity = {
  type: "Feature",
  id: "museum",
  geometry: { type: "Point", coordinates: [2.33, 48.86] },
  properties: {
    name: "Louvre",
    description: "See the paintings",
    notes: "Book morning entry.",
    duration: "PT120M",
    cost: null,
    kinds: ["Culture" as const],
    address: null,
    ticketRequirement: "Unknown" as const,
    state: "Maybe",
    placeName: "Louvre, Paris",
  },
};
function Location() {
  return <span data-testid="location">{useLocation().search}</span>;
}
function show(readOnly = false, onDestinationChange = vi.fn()) {
  return render(
    <ColorSchemeProvider>
      <MemoryRouter initialEntries={["/trips/trip/activities"]}>
        <ActivityPlanning
          trip={trip}
          readOnly={readOnly}

          onDestinationChange={onDestinationChange}
        />
        <Location />
      </MemoryRouter>
    </ColorSchemeProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listActivityKinds).mockResolvedValue({ kinds: [], hasMore: false });
  vi.mocked(getDestinations).mockResolvedValue(destinations);
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [],
  });
  vi.mocked(saveActivity).mockImplementation(
    async (_trip, _destination, input) => ({ ...input, id: input.id ?? "new" }),
  );
});
function click(element: HTMLElement) {
  act(() => element.focus());
  fireEvent.click(element);
}
function change(
  element: HTMLElement,
  options: Parameters<typeof fireEvent.change>[1],
) {
  act(() => element.focus());
  fireEvent.change(element, options);
}
async function add(chooseKind = true) {
  const trigger = await screen.findByRole("button", { name: "Add activity" });
  act(() => trigger.focus());
  click(trigger);
  const drawer = await screen.findByRole("dialog");
  if (chooseKind) {
    const input = within(drawer).getByRole("combobox", { name: "Kinds" });
    change(input, { target: { value: "Culture" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  }
  return drawer;
}

test("an empty trip points back to Overview without destination forms", async () => {
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [],
    route: [],
  });
  show();
  expect(
    await screen.findByRole("link", { name: "Go to Overview" }),
  ).toHaveAttribute("href", "/trips/trip");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

test("selecting a Plan travel step opens the map and forwards its route; closing it clears the path", async () => {
  vi.mocked(planningRequest).mockResolvedValue({
    data: {
      mode: "walking",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [2.3, 48.8],
            [2.35, 48.86],
          ],
        ],
      },
    },
    etag: "",
  });
  show(true);
  await screen.findByRole("tab", { name: "Plan" });
  click(screen.getByRole("tab", { name: "Plan" }));
  expect(screen.getByRole("button", { name: "Show map" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  const scrollToMap = vi.fn();
  document.querySelector<HTMLDivElement>(
    ".activity-map-panel",
  )!.scrollIntoView = scrollToMap;
  click(screen.getByRole("button", { name: "Show sample travel route" }));
  const selected = await screen.findByRole("button", {
    name: "Selected walking route",
  });
  expect(screen.getByRole("button", { name: "Hide map" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await waitFor(() =>
    expect(scrollToMap).toHaveBeenCalledWith({ block: "nearest" }),
  );
  expect(planningRequest).toHaveBeenCalledWith(
    expect.stringContaining("/activity-plan/route-previews"),
    expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        stayId: "visit",
        fromActivityId: "museum",
        toActivityId: "garden",
        contextVersion: "revision",
      }),
    }),
  );
  click(selected);
  expect(
    screen.queryByRole("button", { name: "Selected walking route" }),
  ).not.toBeInTheDocument();
});

test("Plan shows only activity bubbles marked Yes, and Ideas restores the others", async () => {
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [
      activity,
      {
        ...activity,
        id: "garden",
        properties: {
          ...activity.properties,
          name: "Garden",
          kinds: ["Culture" as const],
          address: null,
          ticketRequirement: "Unknown" as const,
          state: "Yes",
        },
      },
      {
        ...activity,
        id: "rejected",
        properties: {
          ...activity.properties,
          name: "Excluded place",
          kinds: ["Culture" as const],
          address: null,
          ticketRequirement: "Unknown" as const,
          state: "No",
        },
      },
    ],
  });
  show();
  expect(
    await screen.findByRole("button", { name: "Map marker: Louvre" }),
  ).toBeInTheDocument();
  click(screen.getByRole("tab", { name: "Plan" }));
  expect(
    screen.queryByRole("tab", { name: "Daily plan" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Map marker: Garden" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Map marker: Louvre" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Map marker: Excluded place" }),
  ).not.toBeInTheDocument();
  click(screen.getByRole("tab", { name: "Ideas" }));
  expect(
    screen.getByRole("button", { name: "Map marker: Louvre" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Map marker: Excluded place" }),
  ).toBeInTheDocument();
});

test("destination tabs show every visit's dates and switch the selected city without duplicate headings or destination details", async () => {
  const onDestinationChange = vi.fn();
  show(false, onDestinationChange);
  const paris = await screen.findByRole("tab", { name: /Paris/ });
  expect(paris.querySelector(".city-icon use")).toHaveAttribute(
    "href",
    "/artwork/cities.svg#fr-paris",
  );
  expect(paris).toHaveTextContent("Jun 10, 2027 – Jun 14, 2027");
  expect(paris).toHaveTextContent("Jun 18, 2027 – Jun 20, 2027");
  expect(screen.queryByText("Destination details")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Paris" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("What would you like to do?"),
  ).not.toBeInTheDocument();
  click(screen.getByRole("tab", { name: /Rome/ }));
  await waitFor(() =>
    expect(onDestinationChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "rome-it" }),
    ),
  );
  expect(screen.getByTestId("location")).toHaveTextContent(
    "destination=rome-it",
  );
  expect(
    screen.getByRole("list", { name: "Rome activities" }),
  ).toBeInTheDocument();
});

test.each(["map", "list", "cancel"])(
  "place search hides existing bubbles until choosing from %s or closing",
  async (action) => {
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [activity],
    });
    const results = [
      {
        id: "garden",
        label: "Garden, Paris",
        name: "Garden",
        longitude: 2.3,
        latitude: 48.8,
      },
    ];
    let completeSearch!: (value: typeof results) => void;
    vi.mocked(mapsClient.searchPlaces).mockReturnValue(
      new Promise((resolve) => {
        completeSearch = resolve;
      }),
    );
    show();
    expect(
      await screen.findByRole("button", { name: "Map marker: Louvre" }),
    ).toBeInTheDocument();
    const drawer = await add();
    change(within(drawer).getByLabelText("Find a place"), {
      target: { value: "Garden" },
    });
    click(within(drawer).getByRole("button", { name: "Search places" }));
    expect(
      screen.queryByRole("button", { name: "Map marker: Louvre" }),
    ).not.toBeInTheDocument();
    await act(async () => completeSearch(results));
    expect(
      screen.getByRole("button", { name: "Search marker: 1. Garden, Paris" }),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByRole("button", { name: "1. Garden, Paris" }),
    ).toBeInTheDocument();
    if (action === "map")
      click(
        screen.getByRole("button", { name: "Search marker: 1. Garden, Paris" }),
      );
    else
      click(
        within(drawer).getByRole("button", {
          name: action === "list" ? "1. Garden, Paris" : "Cancel",
        }),
      );
    expect(
      screen.getByRole("button", { name: "Map marker: Louvre" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Search marker: 1. Garden, Paris" }),
    ).not.toBeInTheDocument();
    if (action !== "cancel")
      expect(within(drawer).getByLabelText("Activity name")).toHaveValue(
        "Garden",
      );
  },
);

test("the place SearchBox searches on Enter without submitting the editor or starting duplicate searches", async () => {
  let completeSearch!: (value: []) => void;
  vi.mocked(mapsClient.searchPlaces).mockReturnValue(
    new Promise((resolve) => {
      completeSearch = resolve;
    }),
  );
  show();
  const drawer = await add();
  const input = within(drawer).getByRole("searchbox", {
    name: "Find a place",
  });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(mapsClient.searchPlaces).not.toHaveBeenCalled();
  change(input, { target: { value: "Louvre" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(mapsClient.searchPlaces).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(mapsClient.searchPlaces).toHaveBeenCalledWith(
    "Louvre",
    expect.any(AbortSignal),
    [2.35, 48.86],
    "FR",
  );
  fireEvent.keyDown(input, { key: "Enter" });
  expect(mapsClient.searchPlaces).toHaveBeenCalledTimes(1);
  expect(saveActivity).not.toHaveBeenCalled();
  await act(async () => completeSearch([]));
  expect(
    within(drawer).getByRole("button", { name: "Search places" }),
  ).toBeEnabled();
});

test.each([
  ["name", true],
  ["card", true],
  ["details", true],
  ["name", false],
  ["card", false],
  ["details", false],
])(
  "clicking an idea's %s opens its edit drawer directly, located=%s",
  async (target, located) => {
    const idea = { ...activity, geometry: located ? activity.geometry : null };
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [idea],
    });
    vi.mocked(getActivity).mockResolvedValue({ activity: idea, etag: '"v1"' });
    show();
    const name = await screen.findByRole("button", { name: "Louvre" });
    const card = name.closest(".activity-list-item")! as HTMLElement;
    click(
      target === "name"
        ? name
        : target === "card"
          ? card
          : within(card).getByText("Culture"),
    );
    const drawer = await screen.findByRole("dialog", { name: "Edit activity" });
    expect(within(drawer).getByLabelText("Activity name")).toHaveValue(
      "Louvre",
    );
    expect(getActivity).toHaveBeenCalledExactlyOnceWith(
      "trip",
      "paris-fr",
      "museum",
    );
    expect(
      screen.queryByRole("region", { name: "Selected activity details" }),
    ).not.toBeInTheDocument();
    expect(saveActivity).not.toHaveBeenCalled();
  },
);

test("editing uses a drawer and preserves changes after a failed save for retry", async () => {
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [activity],
  });
  vi.mocked(getActivity).mockResolvedValue({ activity, etag: '"v1"' });
  vi.mocked(saveActivity).mockRejectedValueOnce(new Error("Please retry."));
  show();
  click(await screen.findByRole("button", { name: "Louvre" }));
  const drawer = await screen.findByRole("dialog");
  expect(drawer.closest(".activity-map-panel")).toBeNull();
  expect(drawer).not.toHaveAttribute("aria-modal", "true");
  expect(document.querySelector(".fui-DialogSurface__backdrop")).toBeNull();
  expect(within(drawer).getByLabelText("Activity name")).toHaveValue("Louvre");
  expect(within(drawer).getByLabelText("Notes")).toHaveValue(
    "Book morning entry.",
  );
  change(within(drawer).getByLabelText("Description"), {
    target: { value: "Paintings and sculpture" },
  });
  change(within(drawer).getByLabelText("Notes"), {
    target: { value: "Visit in the morning\nMeet at the entrance." },
  });
  click(within(drawer).getByRole("button", { name: "Add link" }));
  change(within(drawer).getByLabelText("Link URL 1"), {
    target: { value: "https://museum.example/tickets" },
  });
  change(within(drawer).getByLabelText("Link label 1"), {
    target: { value: "Tickets" },
  });
  const stateTrigger = within(drawer).getByRole("button", {
    name: "State Maybe",
  });
  act(() => stateTrigger.focus());
  click(stateTrigger);
  click(await screen.findByRole("menuitemradio", { name: "Yes" }));
  const saveButton = within(drawer).getByRole("button", {
    name: "Save activity",
    hidden: true,
  });
  act(() => saveButton.focus());
  click(within(drawer).getByRole("button", { name: "Save activity" }));
  expect(
    (
      await screen.findByText("Please retry.", { selector: ".fui-ToastTitle" })
    ).closest(".fui-Toast"),
  ).not.toBeNull();
  expect(
    screen
      .getByText("Please retry.", { selector: ".fui-ToastTitle" })
      .closest(".activity-drawer-body"),
  ).toBeNull();
  expect(within(drawer).getByLabelText("Description")).toHaveValue(
    "Paintings and sculpture",
  );
  expect(within(drawer).getByLabelText("Notes")).toHaveValue(
    "Visit in the morning\nMeet at the entrance.",
  );
  click(within(drawer).getByRole("button", { name: "Save activity" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(saveActivity).toHaveBeenLastCalledWith(
    "trip",
    destinations.features[0],
    expect.objectContaining({
      id: "museum",
      properties: expect.objectContaining({
        description: "Paintings and sculpture",
        notes: "Visit in the morning\nMeet at the entrance.",
        kinds: ["Culture" as const],
        address: null,
        ticketRequirement: "Unknown" as const,
        state: "Yes",
        links: [{ url: "https://museum.example/tickets", label: "Tickets" }],
      }),
    }),
    '"v1"',
  );
});

test.each(["", "Visit after lunch.\nBring the booking confirmation."])(
  "saving notes %j preserves the activity description",
  async (notes) => {
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [activity],
    });
    vi.mocked(getActivity).mockResolvedValue({ activity, etag: '"v1"' });
    show();
    click(await screen.findByRole("button", { name: "Louvre" }));
    const drawer = await screen.findByRole("dialog", { name: "Edit activity" });
    change(within(drawer).getByLabelText("Notes"), {
      target: { value: notes },
    });
    expect(saveActivity).not.toHaveBeenCalled();
    click(within(drawer).getByRole("button", { name: "Save activity" }));
    await waitFor(() => expect(saveActivity).toHaveBeenCalled());
    expect(vi.mocked(saveActivity).mock.calls[0][2].properties).toEqual({
      ...activity.properties,
      notes,
    });
  },
);

test("canceling the activity drawer discards its draft", async () => {
  show();
  const drawer = await add();
  change(within(drawer).getByLabelText("Activity name"), {
    target: { value: "Unsaved" },
  });
  change(within(drawer).getByLabelText("Description"), {
    target: { value: "Unsaved description" },
  });
  change(within(drawer).getByLabelText("Notes"), {
    target: { value: "Unsaved notes" },
  });
  click(within(drawer).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const reopened = await add();
  expect(within(reopened).getByLabelText("Activity name")).toHaveValue("");
  expect(within(reopened).getByLabelText("Description")).toHaveValue("");
  expect(within(reopened).getByLabelText("Notes")).toHaveValue("");
  expect(saveActivity).not.toHaveBeenCalled();
});

test("shared trip members see the cards without add or edit actions", async () => {
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [activity],
  });
  show(true);
  expect(await screen.findByRole("button", { name: "Louvre" })).toBeVisible();
  expect(
    screen.getByRole("list", { name: "Paris activities" }),
  ).toHaveTextContent("Louvre");
  expect(
    screen.queryByRole("button", { name: "Add activity" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Edit activity/ }),
  ).not.toBeInTheDocument();
});

afterEach(() => vi.unstubAllGlobals());

test("activity links appear in the cards and can be removed in the edit drawer", async () => {
  const linked = {
    ...activity,
    properties: {
      ...activity.properties,
      links: [{ url: "https://museum.example/tickets", label: "Tickets" }],
    },
  };
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [linked],
  });
  vi.mocked(getActivity).mockResolvedValue({ activity: linked, etag: '"v1"' });
  show();
  click(await screen.findByRole("button", { name: "Map marker: Louvre" }));
  expect(await screen.findByRole("link", { name: "Tickets" })).toHaveAttribute(
    "href",
    "https://museum.example/tickets",
  );
  const trigger = await screen.findByRole("button", {
    name: "Edit activity: Louvre",
  });
  act(() => trigger.focus());
  click(trigger);
  const drawer = await screen.findByRole("dialog");
  // Establish modal focus explicitly when JSDOM cannot select a layout target.
  act(() =>
    within(drawer).getByText("Remove link 1", { selector: "button" }).focus(),
  );
  click(await within(drawer).findByRole("button", { name: "Remove link 1" }));
  click(within(drawer).getByRole("button", { name: "Save activity" }));
  await waitFor(() => expect(saveActivity).toHaveBeenCalled());
  expect(vi.mocked(saveActivity).mock.calls[0][2].properties.links).toEqual([]);
});

test.each([false, true])(
  "located activities offer a map link, including read-only=%s",
  async (readOnly) => {
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [
        activity,
        {
          ...activity,
          id: "unlocated",
          geometry: null,
          properties: { ...activity.properties, name: "Unlocated" },
        },
      ],
    });
    show(readOnly);
    const list = await screen.findByRole("list", { name: "Paris activities" });
    expect(
      within(list).queryByText("See the paintings"),
    ).not.toBeInTheDocument();
    expect(within(list).queryByText("2h")).not.toBeInTheDocument();
    expect(
      await within(
        await within(list).findByRole("list", { name: "Maybe activities" }),
      ).findAllByText("Maybe"),
    ).toHaveLength(2);
    expect(
      within(list).queryAllByRole("button", { name: /^State for/ }),
    ).toHaveLength(readOnly ? 0 : 2);
    expect(within(list).getByText("Needs location · Not on map")).toBeVisible();
    expect(
      within(list).queryByRole("button", {
        name: "Set location for Unlocated",
      }) !== null,
    ).toBe(!readOnly);
    click(await screen.findByRole("button", { name: "Map marker: Louvre" }));
    const link = await screen.findByRole("link", {
      name: "Direction to Louvre",
    });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("48.86%2C2.33"),
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const card = link.closest(".activity-card")! as HTMLElement;
    expect(within(card).getByRole("heading", { name: "Louvre" })).toBeVisible();
    expect(within(card).getByText("See the paintings")).toBeVisible();
    expect(within(card).getByLabelText("Activity 1")).toHaveTextContent("1");
    expect(within(card).getByText("2h")).toBeVisible();
    expect(within(card).getByText("Maybe")).toBeVisible();
    click(within(card).getByText("See the paintings"));
    expect(
      within(list).getByRole("button", { name: "Louvre" }),
    ).toHaveAttribute("aria-pressed", "true");
    if (readOnly) {
      click(within(list).getByRole("button", { name: "Unlocated" }));
      const details = screen.getByRole("region", {
        name: "Selected activity details",
      });
      expect(within(details).getByLabelText("Activity 2")).toHaveTextContent(
        "2",
      );
      expect(within(details).getByText("Needs location")).toBeVisible();
      expect(
        screen.queryByRole("link", { name: "Direction to Unlocated" }),
      ).not.toBeInTheDocument();
    }
  },
);

test.each([false, true])(
  "full-screen map shows a dismissible activity card after marker selection, read-only=%s",
  async (readOnly) => {
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [activity],
    });
    show(readOnly);
    click(await screen.findByRole("button", { name: "Map marker: Louvre" }));
    expect(screen.queryByText("No description yet.")).not.toBeInTheDocument();
    expect(document.querySelector(".activity-selection")).toBeNull();
    click(screen.getByRole("button", { name: "Explore map full screen" }));
    const mapDialog = await screen.findByRole("dialog", {
      name: "Map of Paris",
    });
    expect(
      within(mapDialog).queryByRole("region", {
        name: "Selected activity details",
      }),
    ).not.toBeInTheDocument();
    click(
      within(mapDialog).getByRole("button", { name: "Map marker: Louvre" }),
    );
    const card = within(mapDialog).getByRole("region", {
      name: "Selected activity details",
    });
    expect(within(card).getByRole("heading", { name: "Louvre" })).toBeVisible();
    expect(within(card).getByLabelText("Activity 1")).toHaveTextContent("1");
    expect(within(card).getByText("See the paintings")).toBeVisible();
    expect(within(card).getByText("2h")).toBeVisible();
    expect(
      within(card).getByRole("link", { name: "Direction to Louvre" }),
    ).toHaveAttribute("target", "_blank");
    expect(
      within(card).queryByRole("button", { name: "Edit activity: Louvre" }) !==
        null,
    ).toBe(!readOnly);
    click(within(card).getByRole("button", { name: "Close activity details" }));
    expect(
      within(mapDialog).queryByRole("region", {
        name: "Selected activity details",
      }),
    ).not.toBeInTheDocument();
    click(
      within(mapDialog).getByRole("button", { name: "Exit full-screen map" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Map of Paris" }),
      ).not.toBeInTheDocument(),
    );
    // Tabster restores background accessibility asynchronously after closing.
    // Wait for the control to be accessible, not just for the dialog to disappear.
    expect(
      await screen.findByRole("button", { name: "Explore map full screen" }),
    ).toBeVisible();
  },
);

test.each(["Cancel", "Save activity"])(
  "editing from the full-screen map stays there after %s",
  async (action) => {
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [activity],
    });
    vi.mocked(getActivity).mockResolvedValue({ activity, etag: '"v1"' });
    vi.mocked(saveActivity).mockResolvedValue(activity);
    show();
    click(
      await screen.findByRole("button", { name: "Explore map full screen" }),
    );
    const mapDialog = await screen.findByRole("dialog", {
      name: "Map of Paris",
    });
    const map = within(mapDialog).getByLabelText("Map");
    click(
      within(mapDialog).getByRole("button", { name: "Map marker: Louvre" }),
    );
    click(
      within(mapDialog).getByRole("button", { name: "Edit activity: Louvre" }),
    );
    const drawer = await screen.findByRole("dialog", { name: "Edit activity" });
    expect(map).toBeInTheDocument();
    expect(drawer.closest(".activity-fullscreen-map")).toBe(mapDialog);
    expect(mapDialog).toHaveAttribute("aria-modal", "false");
    expect(
      within(drawer).getByRole("button", { name: "Close activity drawer" }),
    ).toHaveFocus();
    click(within(drawer).getByRole("button", { name: action }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit activity" }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole("dialog", { name: "Map of Paris" })).toBe(
      mapDialog,
    );
    expect(mapDialog).toHaveAttribute("aria-modal", "true");
    expect(within(mapDialog).getByLabelText("Map")).toBe(map);
    expect(
      await within(mapDialog).findByRole("region", {
        name: "Selected activity details",
      }),
    ).toBeVisible();
    expect(
      within(mapDialog).getByRole("button", { name: "Exit full-screen map" }),
    ).toBeVisible();
  },
);

test("a Stay marker presents accommodation details separately from activities", async () => {
  vi.mocked(getDestinations).mockResolvedValue({
    ...destinations,
    features: destinations.features.map((destination, index) =>
      index
        ? destination
        : {
            ...destination,
            properties: {
              ...destination.properties,
              stays: [
                {
                  ...destination.properties.stays[0],
                  stayLocation: {
                    type: "Feature",
                    id: "stay",
                    geometry: { type: "Point", coordinates: [2.34, 48.85] },
                    properties: { name: "Paris Hotel" },
                  },
                },
                destination.properties.stays[1],
              ],
            },
          },
    ),
  });
  show(true);
  click(
    await screen.findByRole("button", { name: "Stay marker: Paris Hotel" }),
  );
  const details = screen.getByRole("region", { name: "Stay details" });
  expect(
    within(details).getByRole("heading", { name: "Paris Hotel" }),
  ).toBeVisible();
  expect(
    within(details).getByRole("link", { name: "Direction" }),
  ).toHaveAttribute("target", "_blank");
  expect(
    screen.getByRole("list", { name: "Paris activities" }).children,
  ).toHaveLength(0);
});

test("activity costs use a known currency selection and save the selected currency", async () => {
  show();
  const drawer = await add();
  const currency = within(drawer).getByRole("combobox", { name: "Currency" });
  expect(currency.tagName).toBe("SELECT");
  expect(currency).toBeDisabled();
  change(within(drawer).getByLabelText("Activity name"), {
    target: { value: "Museum" },
  });
  change(within(drawer).getByLabelText("Cost amount"), {
    target: { value: "25" },
  });
  expect(currency).toBeEnabled();
  expect(currency).toHaveValue("USD");
  for (const code of ["USD", "EUR", "JPY", "GBP"]) {
    expect(
      within(currency).getByRole("option", { name: new RegExp(`^${code} —`) }),
    ).toHaveValue(code);
  }
  expect(
    within(currency).queryByRole("option", { name: /^XYZ/ }),
  ).not.toBeInTheDocument();
  change(currency, { target: { value: "JPY" } });
  click(within(drawer).getByRole("button", { name: "Save activity" }));
  await waitFor(() =>
    expect(saveActivity).toHaveBeenCalledWith(
      "trip",
      destinations.features[0],
      expect.objectContaining({
        properties: expect.objectContaining({
          cost: { amount: 25, currency: "JPY", basis: "perPerson" },
        }),
      }),
      undefined,
    ),
  );
});

test("the map can collapse for list browsing and reopen when selecting an activity", async () => {
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [activity],
  });
  show(true);
  const toggle = await screen.findByRole("button", { name: "Hide map" });
  const map = screen.getByLabelText("Map");
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panel = map.closest(".activity-map-panel")!;
  expect(toggle).toHaveAttribute("aria-controls", panel.id);
  click(toggle);
  expect(screen.getByRole("button", { name: "Show map" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  expect(panel.parentElement).toHaveClass("activity-map-collapsed");
  expect(map).toBeInTheDocument();
  click(screen.getByRole("button", { name: "Show map" }));
  expect(panel.parentElement).not.toHaveClass("activity-map-collapsed");
  click(screen.getByRole("button", { name: "Hide map" }));
  click(await screen.findByRole("button", { name: "Louvre" }));
  expect(panel.parentElement).not.toHaveClass("activity-map-collapsed");
  expect(screen.getByRole("button", { name: "Hide map" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(
    await screen.findByRole("region", { name: "Selected activity details" }),
  ).toBeInTheDocument();
});

test.each([
  ["ideas", "Maybe", "Yes"],
  ["ideas", "Yes", "No"],
  ["ideas", "No", "Maybe"],
  ["map", "Maybe", "Yes"],
])(
  "%s card menu changes %s to %s with the current ETag and preserves other fields",
  async (view, state, nextState) => {
    const current = {
      ...activity,
      properties: { ...activity.properties, state },
    };
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [current],
    });
    vi.mocked(getActivity).mockResolvedValue({
      activity: current,
      etag: '"current"',
    });
    vi.mocked(saveActivity).mockResolvedValue({
      ...activity,
      properties: { ...activity.properties, state: nextState },
    });
    show();
    const list = await screen.findByRole("list", { name: "Paris activities" });
    if (view === "map")
      click(await screen.findByRole("button", { name: "Map marker: Louvre" }));
    const container =
      view === "map"
        ? await screen.findByRole("region", {
            name: "Selected activity details",
          })
        : list;
    click(
      await within(container).findByRole("button", {
        name: `State for Louvre: ${state}`,
      }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Edit activity" }),
    ).not.toBeInTheDocument();
    expect(
      (await screen.findAllByRole("menuitemradio")).map(
        (item) => item.textContent,
      ),
    ).toEqual(["Maybe", "Yes", "No"]);
    click(await screen.findByRole("menuitemradio", { name: nextState }));
    await within(container).findByRole("button", {
      name: `State for Louvre: ${nextState}`,
    });
    expect(
      screen.queryByRole("dialog", { name: "Edit activity" }),
    ).not.toBeInTheDocument();
    expect(getActivity).toHaveBeenCalledTimes(1);
    expect(
      within(
        screen.getByRole("list", { name: `${nextState} activities` }),
      ).getByRole("button", { name: "Louvre" }),
    ).toBeVisible();
    if (view === "ideas")
      expect(
        screen.queryByRole("region", { name: "Selected activity details" }),
      ).not.toBeInTheDocument();
    expect(saveActivity).toHaveBeenCalledWith(
      "trip",
      destinations.features[0],
      {
        ...activity,
        properties: { ...activity.properties, state: nextState },
      },
      '"current"',
    );
  },
);

test.each(["ideas", "map", "fullscreen"])(
  "%s card menu deletion requires confirmation and supports retry",
  async (view) => {
    const fullscreen = view === "fullscreen";
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [activity],
    });
    vi.mocked(getActivity).mockResolvedValue({ activity, etag: '"current"' });
    vi.mocked(deleteActivity)
      .mockRejectedValueOnce(new Error("Please retry."))
      .mockResolvedValue(undefined);
    show();
    if (fullscreen) {
      click(
        await screen.findByRole("button", { name: "Explore map full screen" }),
      );
      click(await screen.findByRole("button", { name: "Map marker: Louvre" }));
    } else if (view === "map") {
      click(await screen.findByRole("button", { name: "Map marker: Louvre" }));
    }
    const container =
      view === "ideas"
        ? await screen.findByRole("list", { name: "Paris activities" })
        : await screen.findByRole("region", {
            name: "Selected activity details",
          });
    const stateButton = await within(container).findByRole("button", {
      name: "State for Louvre: Maybe",
    });
    const openDelete = async () => {
      act(() => stateButton.focus());
      click(stateButton);
      const item = await screen.findByRole("menuitem", {
        name: "Delete activity",
      });
      act(() => item.focus());
      click(item);
    };
    expect(
      screen.queryByRole("button", { name: "Delete activity: Louvre" }),
    ).not.toBeInTheDocument();
    await openDelete();
    let dialog = await screen.findByRole("dialog", { name: "Delete Louvre?" });
    expect(deleteActivity).not.toHaveBeenCalled();
    const cancel = await within(dialog).findByRole("button", {
      name: "Cancel",
    });
    expect(cancel).toHaveFocus();
    if (fullscreen) {
      expect(dialog.closest(".activity-fullscreen-map")).toHaveAttribute(
        "aria-modal",
        "false",
      );
    }
    click(cancel);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    if (fullscreen)
      expect(
        await screen.findByRole("dialog", { name: "Map of Paris" }),
      ).toHaveAttribute("aria-modal", "true");
    expect(deleteActivity).not.toHaveBeenCalled();
    await openDelete();
    dialog = await screen.findByRole("dialog", { name: "Delete Louvre?" });
    click(
      await within(dialog).findByRole("button", { name: "Delete activity" }),
    );
    expect(
      (
        await screen.findByText("Please retry.", {
          selector: ".fui-ToastTitle",
        })
      ).closest(".fui-Toast"),
    ).not.toBeNull();
    click(await screen.findByRole("button", { name: "Dismiss notification" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Please retry.", { selector: ".fui-ToastTitle" }),
      ).not.toBeInTheDocument(),
    );
    dialog = await screen.findByRole("dialog", { name: "Delete Louvre?" });
    click(
      await within(dialog).findByRole("button", { name: "Delete activity" }),
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    if (fullscreen)
      expect(
        screen.getByRole("dialog", { name: "Map of Paris" }),
      ).toBeInTheDocument();
    expect(deleteActivity).toHaveBeenCalledWith(
      "trip",
      destinations.features[0],
      "museum",
      '"current"',
    );
    expect(
      screen.queryByRole("button", { name: "Louvre" }),
    ).not.toBeInTheDocument();
  },
);

const locationSuggestion = {
  venueName: "Louvre",
  geometry: {
    type: "Point" as const,
    coordinates: [2.33, 48.86] as [number, number],
  },
  source: {
    url: "https://www.wikidata.org/wiki/Q19675",
    label: "Published coordinates",
  },
  retrievedAt: "2026-10-20T12:00:00Z",
};

test("a generated candidate can be dismissed without applying its geometry", async () => {
  const unlocated = {
    ...activity,
    geometry: null,
    properties: { ...activity.properties, locationSuggestion },
  };
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [unlocated],
  });
  vi.mocked(getActivity).mockResolvedValue({
    activity: unlocated,
    etag: '"7"',
  });
  show();
  click(
    await screen.findByRole("button", { name: "Review location for Louvre" }),
  );
  const drawer = await screen.findByRole("dialog");
  click(within(drawer).getByRole("button", { name: "Dismiss location" }));
  click(within(drawer).getByRole("button", { name: "Save activity" }));
  await waitFor(() => expect(saveActivity).toHaveBeenCalled());
  expect(vi.mocked(saveActivity).mock.calls[0][2].geometry).toBeNull();
  expect(
    vi.mocked(saveActivity).mock.calls[0][2].properties.locationSuggestion,
  ).toBeNull();
});

const detailsSuggestion = {
  duration: {
    value: "PT1H30M",
    evidence: {
      notes: "Recommended 60–90 minute visit.",
      source: { url: "https://museum.test/visit", label: "Duration source" },
      researchedAt: "2026-10-20T12:00:00Z",
    },
  },
  cost: {
    value: { amount: 20, currency: "EUR", basis: "perPerson" as const },
    evidence: {
      notes: "Adult admission; future prices unconfirmed.",
      source: { url: "https://museum.test/tickets", label: "Cost source" },
      researchedAt: "2026-10-20T12:00:00Z",
    },
  },
};

test.each([
  [0.5, "PT30M", "30 min"],
  [1.5, "PT90M", "1 hour 30 min"],
  [12, "PT720M", "12 hours"],
])(
  "duration slider saves %s hours as an ISO duration",
  async (hours, expected, text) => {
    show();
    const drawer = await add();
    change(within(drawer).getByLabelText("Activity name"), {
      target: { value: "Explore the museum" },
    });
    const slider = within(drawer).getByRole("slider", { name: "Duration" });
    expect(slider).toHaveAttribute("min", "0.5");
    expect(slider).toHaveAttribute("max", "12");
    expect(slider).toHaveAttribute("step", "0.5");
    if (hours === 0.5)
      click(within(drawer).getByRole("button", { name: "Use 30 min" }));
    else change(slider, { target: { value: String(hours) } });
    expect(slider).toHaveAttribute("aria-valuetext", text);
    click(within(drawer).getByRole("button", { name: "Save activity" }));
    await waitFor(() => expect(saveActivity).toHaveBeenCalled());
    expect(vi.mocked(saveActivity).mock.calls[0][2].properties.duration).toBe(
      expected,
    );
  },
);

test.each([null, "PT45M", "PT13H"])(
  "opening an activity keeps its existing duration %s until explicitly adjusted",
  async (duration) => {
    const existing = {
      ...activity,
      properties: { ...activity.properties, duration },
    };
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [existing],
    });
    vi.mocked(getActivity).mockResolvedValue({
      activity: existing,
      etag: '"7"',
    });
    show();
    click(await screen.findByRole("button", { name: "Louvre" }));
    const drawer = await screen.findByRole("dialog", { name: "Edit activity" });
    expect(
      within(drawer).getByText(
        duration === null
          ? "Not set"
          : duration === "PT45M"
            ? "45 min"
            : "13 hours",
      ),
    ).toBeVisible();
    click(within(drawer).getByRole("button", { name: "Save activity" }));
    await waitFor(() => expect(saveActivity).toHaveBeenCalled());
    expect(vi.mocked(saveActivity).mock.calls[0][2].properties.duration).toBe(
      duration,
    );
  },
);

test.each([3, null])(
  "manually changing a researched duration to %s clears its previous evidence",
  async (hours) => {
    const researched = {
      ...activity,
      properties: {
        ...activity.properties,
        durationEvidence: detailsSuggestion.duration.evidence,
      },
    };
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [researched],
    });
    vi.mocked(getActivity).mockResolvedValue({
      activity: researched,
      etag: '"7"',
    });
    show();
    click(await screen.findByRole("button", { name: "Louvre" }));
    const drawer = await screen.findByRole("dialog", { name: "Edit activity" });
    expect(
      within(drawer).queryByRole("button", {
        name: "Research duration and cost",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(drawer).getByRole("link", { name: "Duration source" }),
    ).toBeVisible();
    if (hours === null)
      click(within(drawer).getByRole("button", { name: "Clear duration" }));
    else
      change(within(drawer).getByRole("slider", { name: "Duration" }), {
        target: { value: String(hours) },
      });
    click(within(drawer).getByRole("button", { name: "Save activity" }));
    await waitFor(() => expect(saveActivity).toHaveBeenCalled());
    expect(
      vi.mocked(saveActivity).mock.calls[0][2].properties.durationEvidence,
    ).toBeNull();
    expect(vi.mocked(saveActivity).mock.calls[0][2].properties.duration).toBe(
      hours === null ? null : "PT180M",
    );
  },
);

test("read-only members can see accepted research sources and conditions", async () => {
  const researched = {
    ...activity,
    properties: {
      ...activity.properties,
      cost: detailsSuggestion.cost.value,
      costEvidence: detailsSuggestion.cost.evidence,
    },
  };
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [researched],
  });
  show(true);
  click(await screen.findByRole("button", { name: "Louvre" }));
  const card = await screen.findByRole("region", {
    name: "Selected activity details",
  });
  expect(
    within(card).getByRole("link", { name: "Cost source" }),
  ).toHaveAttribute("href", detailsSuggestion.cost.evidence.source.url);
  expect(
    within(card).getByText("Adult admission; future prices unconfirmed."),
  ).toBeVisible();
  expect(
    within(card).queryByRole("button", { name: /Edit activity/ }),
  ).not.toBeInTheDocument();
});

test.each([false, true])(
  "groups Ideas by state and collapses groups independently, read-only=%s",
  async (readOnly) => {
    const states = ["Yes", "Maybe", "No", "Maybe", "Maybe"];
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: states.map((state, index) => ({
        ...activity,
        id: `idea-${index}`,
        properties: {
          ...activity.properties,
          name: `Idea ${index + 1}`,
          state,
        },
      })),
    });
    show(readOnly);
    const list = await screen.findByRole("list", { name: "Paris activities" });
    await within(list).findByRole("button", { name: "Idea 5" });
    expect(
      within(list)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Maybe3", "Yes1", "No1"]);
    const proposed = within(list).getByRole("button", {
      name: "Maybe activities",
    });
    const planned = within(list).getByRole("button", {
      name: "Yes activities",
    });
    const contents = document.getElementById(
      proposed.getAttribute("aria-controls")!,
    )!;
    // Keep the map's original numbering even when grouping changes the list order.
    expect(
      within(contents).getByRole("button", { name: "Idea 2" }),
    ).toHaveTextContent("2");
    click(proposed);
    expect(proposed).toHaveAttribute("aria-expanded", "false");
    expect(contents).not.toBeVisible();
    expect(
      within(list).queryByRole("button", { name: "Idea 2" }),
    ).not.toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Idea 1" })).toBeVisible();
    click(planned);
    click(proposed);
    expect(proposed).toHaveAttribute("aria-expanded", "true");
    expect(contents).toBeVisible();
    expect(planned).toHaveAttribute("aria-expanded", "false");
    expect(saveActivity).not.toHaveBeenCalled();
  },
);

test("Find location is hidden when all activities already have locations", async () => {
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [activity],
  });
  show(false);
  await screen.findByRole("button", { name: "Louvre" });
  expect(
    screen.queryByRole("button", { name: "Find location" }),
  ).not.toBeInTheDocument();
});

test("activity details require a kind and save multiple kinds, address and tickets together", async () => {
  show();
  const drawer = await add(false);
  change(within(drawer).getByLabelText("Activity name"), {
    target: { value: "Gallery visit" },
  });
  const save = within(drawer).getByRole("button", { name: "Save activity" });
  expect(save).toBeDisabled();
  const kinds = within(drawer).getByRole("combobox", { name: "Kinds" });
  const addKind = (value: string) => {
    change(kinds, { target: { value } });
    fireEvent.keyDown(kinds, { key: "Enter", code: "Enter" });
  };
  addKind("   ");
  expect(save).toBeDisabled();
  addKind("Architecture & design");
  expect(save).toBeEnabled();
  addKind("Architecture & design");
  addKind("夜景");
  addKind("Temporary");
  click(within(drawer).getByLabelText("Remove Temporary"));
  change(within(drawer).getByLabelText("Address"), {
    target: { value: "1 museum street" },
  });
  expect(within(drawer).getByRole("combobox", { name: "Tickets" })).toHaveValue(
    "Unknown",
  );
  change(within(drawer).getByRole("combobox", { name: "Tickets" }), {
    target: { value: "Required" },
  });
  expect(saveActivity).not.toHaveBeenCalled();
  click(save);
  await waitFor(() => expect(saveActivity).toHaveBeenCalled());
  expect(vi.mocked(saveActivity).mock.calls[0][2].properties).toMatchObject({
    name: "Gallery visit",
    kinds: ["Architecture & design", "夜景"],
    address: "1 museum street",
    ticketRequirement: "Required",
    duration: null,
    cost: null,
    links: [],
  });
});

test("offline activity details show description, notes, kinds, address and tickets", async () => {
  const enriched = {
    ...activity,
    properties: {
      ...activity.properties,
      kinds: ["Architecture & design", "夜景"],
      address: "1 museum street",
      ticketRequirement: "Required" as const,
    },
  };
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [enriched],
  });
  show(true);
  click(await screen.findByRole("button", { name: "Louvre" }));
  const details = screen.getByRole("region", {
    name: "Selected activity details",
  });
  expect(within(details).getByText("Architecture & design")).toBeVisible();
  expect(within(details).getByText("夜景")).toBeVisible();
  expect(within(details).getByText("1 museum street")).toBeVisible();
  expect(within(details).getByText("Tickets: Required")).toBeVisible();
  expect(within(details).getByText("See the paintings")).toBeVisible();
  expect(within(details).getByText("Notes")).toBeVisible();
  expect(within(details).getByText("Book morning entry.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Edit activity: Louvre" }),
  ).not.toBeInTheDocument();
});
