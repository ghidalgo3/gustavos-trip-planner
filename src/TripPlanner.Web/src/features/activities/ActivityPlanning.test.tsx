import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ColorSchemeProvider from "../../app/ColorSchemeProvider";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ActivityPlanning from "./ActivityPlanning";
import { searchPlaces, type Trip } from "../../api/api";
import {
  getDestinations,
  getActivities,
  getActivity,
  saveActivity,
  researchActivityLocation,
  researchActivityDetails,
  deleteActivity,
  suggestActivities,
  importActivityImages,
  waitForActivityJob,
  getSuggestionResult,
  type DestinationCollection,
  type Activity,
} from "./activitiesApi";
import type { TrackedOperation } from "../../api/operationsApi";
import type { PlaceSearch } from "../../maps/ActivityMap";
import PersistentMapSurface from "../../maps/PersistentMapSurface";
vi.mock("../../maps/ActivityMap", () => ({
  default: ({
    activities,
    onSelect,
    stayLocation,
    placeSearch,
    portalHost,
  }: {
    portalHost?: HTMLElement | null;
    placeSearch?: PlaceSearch;
    stayLocation?: DestinationCollection["features"][number]["properties"]["stayLocation"];
    activities: Activity[];
    onSelect: (id: string) => void;
  }) => (
    <PersistentMapSurface host={portalHost}>
      <div aria-label="Map">
        {placeSearch?.results.map((place, index) => (
          <button key={index} onClick={() => placeSearch.onSelect(index)}>
            {`Search marker: ${index + 1}. ${place.label}`}
          </button>
        ))}
        {!placeSearch && stayLocation && (
          <button
            onClick={() => onSelect("stay")}
          >{`Stay marker: ${stayLocation.properties.name}`}</button>
        )}
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
vi.mock("../../api/api", () => ({ searchPlaces: vi.fn() }));
vi.mock("./DailyActivityPlan", () => ({
  default: () => <div>Plan editor</div>,
}));
vi.mock("./activitiesApi", () => ({
  getDestinations: vi.fn(),
  getActivities: vi.fn(),
  getActivity: vi.fn(),
  saveActivity: vi.fn(),
  researchActivityLocation: vi.fn(),
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
    duration: "PT120M",
    cost: null,
    state: "Proposed",
    placeName: "Louvre, Paris",
  },
};
function Location() {
  return <span data-testid="location">{useLocation().search}</span>;
}
function show(
  readOnly = false,
  featureFlags: string[] = [],
  onDestinationChange = vi.fn(),
) {
  return render(
    <ColorSchemeProvider>
      <MemoryRouter initialEntries={["/trips/trip/activities"]}>
        <ActivityPlanning
          trip={trip}
          readOnly={readOnly}
          featureFlags={featureFlags}
          onDestinationChange={onDestinationChange}
        />
        <Location />
      </MemoryRouter>
    </ColorSchemeProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
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
async function add() {
  const trigger = await screen.findByRole("button", { name: "Add activity" });
  act(() => trigger.focus());
  click(trigger);
  return screen.findByRole("dialog");
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

test("Plan shows only Planned activity bubbles, and Ideas restores the others", async () => {
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
          state: "Planned",
        },
      },
      {
        ...activity,
        id: "rejected",
        properties: {
          ...activity.properties,
          name: "Rejected place",
          state: "Rejected",
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
    screen.queryByRole("button", { name: "Map marker: Rejected place" }),
  ).not.toBeInTheDocument();
  click(screen.getByRole("tab", { name: "Ideas" }));
  expect(
    screen.getByRole("button", { name: "Map marker: Louvre" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Map marker: Rejected place" }),
  ).toBeInTheDocument();
});

test("destination tabs show every visit's dates and switch the selected city without duplicate headings or destination details", async () => {
  const onDestinationChange = vi.fn();
  show(false, [], onDestinationChange);
  const paris = await screen.findByRole("tab", { name: /Paris/ });
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
    vi.mocked(searchPlaces).mockReturnValue(
      new Promise((resolve) => {
        completeSearch = resolve;
      }),
    );
    show();
    expect(
      await screen.findByRole("button", { name: "Map marker: Louvre" }),
    ).toBeInTheDocument();
    const drawer = await add();
    change(within(drawer).getByLabelText("Activity or place name"), {
      target: { value: "Garden" },
    });
    click(within(drawer).getByRole("button", { name: "Search Azure Maps" }));
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
      expect(within(drawer).getByLabelText("Name")).toHaveValue("Garden");
  },
);

test("the place SearchBox searches on Enter without submitting the editor or starting duplicate searches", async () => {
  let completeSearch!: (value: []) => void;
  vi.mocked(searchPlaces).mockReturnValue(
    new Promise((resolve) => {
      completeSearch = resolve;
    }),
  );
  show();
  const drawer = await add();
  const input = within(drawer).getByRole("searchbox", {
    name: "Activity or place name",
  });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(searchPlaces).not.toHaveBeenCalled();
  change(input, { target: { value: "Louvre" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(searchPlaces).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(searchPlaces).toHaveBeenCalledWith(
    "Louvre",
    expect.any(AbortSignal),
    [2.35, 48.86],
    "FR",
  );
  fireEvent.keyDown(input, { key: "Enter" });
  expect(searchPlaces).toHaveBeenCalledTimes(1);
  expect(saveActivity).not.toHaveBeenCalled();
  await act(async () => completeSearch([]));
  expect(
    within(drawer).getByRole("button", { name: "Search Azure Maps" }),
  ).toBeEnabled();
});

test("place lookup populates the activity's name and location, and saving updates the cards", async () => {
  vi.mocked(searchPlaces).mockResolvedValue([
    {
      id: "louvre",
      label: "Louvre, Paris",
      name: "Louvre",
      longitude: 2.33,
      latitude: 48.86,
    },
  ]);
  show();
  const drawer = await add();
  expect(within(drawer).getByRole("tab", { name: "AI prompt" })).toBeDisabled();
  change(within(drawer).getByLabelText("Activity or place name"), {
    target: { value: "Louvre" },
  });
  click(within(drawer).getByRole("button", { name: "Search Azure Maps" }));
  click(
    await within(drawer).findByRole("button", { name: "1. Louvre, Paris" }),
  );
  expect(searchPlaces).toHaveBeenCalledWith(
    "Louvre",
    expect.any(AbortSignal),
    [2.35, 48.86],
    "FR",
  );
  expect(drawer.closest(".activity-map-panel")).toBeNull();
  expect(drawer).not.toHaveAttribute("aria-modal", "true");
  expect(document.querySelector(".fui-DialogSurface__backdrop")).toBeNull();
  expect(within(drawer).getByLabelText("Name")).toHaveValue("Louvre");
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [activity],
  });
  click(within(drawer).getByRole("button", { name: "Save activity" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const savedToast = await screen.findByText("Activity saved.");
  expect(savedToast.closest(".fui-Toast")).not.toBeNull();
  expect(savedToast.closest(".activity-planning")).toBeNull();
  click(screen.getByRole("button", { name: "Dismiss notification" }));
  await waitFor(() => expect(savedToast).not.toBeInTheDocument());
  expect(saveActivity).toHaveBeenCalledWith(
    "trip",
    destinations.features[0],
    expect.objectContaining({
      geometry: activity.geometry,
      properties: expect.objectContaining({
        name: "Louvre",
        placeName: "Louvre, Paris",
      }),
    }),
    undefined,
  );
  expect(
    await screen.findByRole("list", { name: "Paris activities" }),
  ).toHaveTextContent("Louvre");
});

test("editing uses a drawer and preserves changes after a failed save for retry", async () => {
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [activity],
  });
  vi.mocked(getActivity).mockResolvedValue({ activity, etag: '"v1"' });
  vi.mocked(saveActivity).mockRejectedValueOnce(new Error("Please retry."));
  show();
  click(await screen.findByRole("button", { name: "Louvre" }));
  const edit = await screen.findByRole("button", {
    name: "Edit activity: Louvre",
  });
  act(() => edit.focus());
  click(edit);
  const drawer = await screen.findByRole("dialog");
  expect(drawer.closest(".activity-map-panel")).toBeNull();
  expect(drawer).not.toHaveAttribute("aria-modal", "true");
  expect(document.querySelector(".fui-DialogSurface__backdrop")).toBeNull();
  expect(within(drawer).getByLabelText("Name")).toHaveValue("Louvre");
  change(within(drawer).getByLabelText("Description"), {
    target: { value: "Visit in the morning" },
  });
  click(within(drawer).getByRole("button", { name: "Add link" }));
  change(within(drawer).getByLabelText("Link URL 1"), {
    target: { value: "https://museum.example/tickets" },
  });
  change(within(drawer).getByLabelText("Link label 1"), {
    target: { value: "Tickets" },
  });
  const stateTrigger = within(drawer).getByRole("button", {
    name: "State Proposed",
  });
  act(() => stateTrigger.focus());
  click(stateTrigger);
  click(await screen.findByRole("menuitemradio", { name: "Planned" }));
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
    "Visit in the morning",
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
        description: "Visit in the morning",
        state: "Planned",
        links: [{ url: "https://museum.example/tickets", label: "Tickets" }],
      }),
    }),
    '"v1"',
  );
});

test("canceling the activity drawer discards its draft", async () => {
  show();
  const drawer = await add();
  change(within(drawer).getByLabelText("Name"), {
    target: { value: "Unsaved" },
  });
  click(within(drawer).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const reopened = await add();
  expect(within(reopened).getByLabelText("Name")).toHaveValue("");
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

test.each(["prompt", "image"] as const)(
  "%s generation runs inside the drawer and refreshes saved Proposed activities",
  async (method) => {
    const operation: TrackedOperation = {
      id: "op",
      resourceId: null,
      type: "activities",
      status: "Completed",
      progress: { items: 1, completedItems: 1, failedItems: 0 },
      createdAt: "",
      updatedAt: "",
      pollingUrl: "",
    };
    vi.mocked(suggestActivities).mockResolvedValue(operation);
    vi.mocked(importActivityImages).mockResolvedValue(operation);
    let complete!: (operation: TrackedOperation) => void;
    vi.mocked(waitForActivityJob).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    vi.mocked(getSuggestionResult).mockResolvedValue({
      operationId: "op",
      activities: { type: "FeatureCollection", features: [activity] },
      warnings: [],
    });
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL() {
          return "blob:test";
        }
        static revokeObjectURL() {}
      },
    );
    show(false, ["LLM"]);
    const drawer = await add();
    click(
      within(drawer).getByRole("tab", {
        name: method === "prompt" ? "AI prompt" : "Images",
      }),
    );
    change(
      within(drawer).getByLabelText(
        method === "prompt"
          ? "What would you like to do?"
          : "Image instructions (optional)",
      ),
      { target: { value: "Art museums" } },
    );
    const file = new File(["image"], "museum.png", { type: "image/png" });
    if (method === "image")
      change(within(drawer).getByLabelText("Activity images"), {
        target: { files: [file] },
      });
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [activity],
    });
    click(
      within(drawer).getByRole("button", {
        name: method === "prompt" ? "Suggest activities" : "Extract activities",
      }),
    );
    await waitFor(() => expect(waitForActivityJob).toHaveBeenCalled());
    const progress = drawer.querySelector(
      ".activity-drawer-progress",
    ) as HTMLElement;
    expect(progress).toHaveAttribute("role", "status");
    expect(progress).toHaveTextContent(
      method === "image"
        ? "Extracting activities from your photos"
        : "Generating activities",
    );
    expect(progress.closest(".activity-drawer-footer")).not.toBeNull();
    expect(within(progress).getByRole("progressbar")).toBeInTheDocument();
    expect(
      within(drawer).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    await act(async () => complete(operation));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    if (method === "prompt")
      expect(suggestActivities).toHaveBeenCalledWith(
        "trip",
        destinations.features[0],
        "Art museums",
      );
    else
      expect(importActivityImages).toHaveBeenCalledWith(
        "trip",
        destinations.features[0],
        [file],
        "Art museums",
      );
    expect(
      await screen.findByRole("list", { name: "Paris activities" }),
    ).toHaveTextContent("Louvre");
    const summary = await screen.findByText("1 activities added as Proposed.");
    expect(summary).toBeVisible();
    expect(summary.closest(".activity-planning")).toBeNull();
    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(summary).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
    click(screen.getByRole("button", { name: "Dismiss activity summary" }));
    await waitFor(() => expect(summary).not.toBeInTheDocument());
  },
);

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
  click(await screen.findByRole("button", { name: "Louvre" }));
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
        await within(list).findByRole("list", { name: "Proposed activities" }),
      ).findAllByText("Proposed"),
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
    click(await within(list).findByRole("button", { name: "Louvre" }));
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
    expect(within(card).getByText("Proposed")).toBeVisible();
    click(within(card).getByText("See the paintings"));
    expect(
      within(list).getByRole("button", { name: "Louvre" }),
    ).toHaveAttribute("aria-pressed", "true");
    click(within(list).getByRole("button", { name: "Unlocated" }));
    const details = screen.getByRole("region", {
      name: "Selected activity details",
    });
    expect(within(details).getByLabelText("Activity 2")).toHaveTextContent("2");
    expect(within(details).getByText("Needs location")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Direction to Unlocated" }),
    ).not.toBeInTheDocument();
  },
);

test("image import accepts ten images, removes individual images, and preserves the selection after an invalid batch", async () => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:test";
      }
      static revokeObjectURL() {}
    },
  );
  const operation: TrackedOperation = {
    id: "op",
    resourceId: null,
    type: "activities",
    status: "Completed",
    progress: { items: 1, completedItems: 1, failedItems: 0 },
    createdAt: "",
    updatedAt: "",
    pollingUrl: "",
  };
  vi.mocked(importActivityImages).mockResolvedValue(operation);
  vi.mocked(waitForActivityJob).mockResolvedValue(operation);
  vi.mocked(getSuggestionResult).mockResolvedValue({
    operationId: "op",
    activities: { type: "FeatureCollection", features: [] },
    warnings: [],
  });
  show(false, ["LLM"]);
  const drawer = await add();
  click(within(drawer).getByRole("tab", { name: "Images" }));
  const input = within(drawer).getByLabelText("Activity images");
  expect(input).toHaveAttribute("multiple");
  const files = ["first.png", "second.png", "third.png"].map(
    (name) => new File(["image"], name, { type: "image/png" }),
  );
  change(input, { target: { files: files.slice(0, 2) } });
  expect(within(drawer).getAllByRole("img")).toHaveLength(2);
  click(
    within(drawer).getByRole("button", { name: "Remove image 1: first.png" }),
  );
  change(input, { target: { files: [files[2]] } });
  expect(within(drawer).getAllByRole("img")).toHaveLength(2);
  const additionalFiles = Array.from(
    { length: 8 },
    (_, index) => new File(["image"], `${index}.png`, { type: "image/png" }),
  );
  change(input, { target: { files: additionalFiles } });
  expect(within(drawer).getAllByRole("img")).toHaveLength(10);
  change(input, { target: { files: [files[0]] } });
  expect(within(drawer).getByRole("alert")).toHaveTextContent(
    "Only the first 10 photos were accepted",
  );
  expect(within(drawer).getAllByRole("img")).toHaveLength(10);
  click(within(drawer).getByRole("button", { name: "Extract activities" }));
  await waitFor(() =>
    expect(importActivityImages).toHaveBeenCalledWith(
      "trip",
      destinations.features[0],
      [files[1], files[2], ...additionalFiles],
      "",
    ),
  );
});

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
    expect(
      screen.getByRole("button", { name: "Explore map full screen" }),
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
              stayLocation: {
                type: "Feature",
                id: "stay",
                geometry: { type: "Point", coordinates: [2.34, 48.85] },
                properties: { name: "Paris Hotel" },
              },
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
  change(within(drawer).getByLabelText("Name"), {
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

test.each([
  {
    kind: "count",
    reason: "Only the first 10 photos were accepted",
    count: 10,
  },
  { kind: "format", reason: "unsupported format", count: 1 },
  { kind: "empty", reason: "the file is empty", count: 1 },
  { kind: "size", reason: "10 MB limit per photo", count: 1 },
  { kind: "total", reason: "50 MB total upload limit", count: 5 },
])(
  "photo selection previews accepted files and explains $kind rejections",
  async ({ kind, reason, count }) => {
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL() {
          return "blob:preview";
        }
        static revokeObjectURL() {}
      },
    );
    const photo = (name: string, size = 5) => {
      const file = new File(["photo"], name, { type: "image/jpeg" });
      Object.defineProperty(file, "size", { value: size });
      return file;
    };
    const files =
      kind === "count"
        ? Array.from({ length: 12 }, (_, i) => photo(`${i}.jpg`))
        : kind === "total"
          ? [
              ...Array.from({ length: 5 }, (_, index) =>
                photo(`${index}.jpg`, 10_000_000),
              ),
              photo("rejected.jpg", 1),
            ]
          : [
              photo("accepted.jpg"),
              kind === "format"
                ? new File(["gif"], "rejected.gif", { type: "image/gif" })
                : photo("rejected.jpg", kind === "empty" ? 0 : 10_000_001),
            ];
    show(false, ["LLM"]);
    const drawer = await add();
    click(within(drawer).getByRole("tab", { name: "Images" }));
    change(within(drawer).getByLabelText("Activity images"), {
      target: { files },
    });
    expect(within(drawer).getAllByRole("img")).toHaveLength(count);
    expect(within(drawer).getByRole("status")).toHaveTextContent(
      `${count} of 10 photos ready to upload`,
    );
    expect(within(drawer).getByRole("alert")).toHaveTextContent(reason);
    if (kind !== "count")
      expect(within(drawer).getByRole("alert")).toHaveTextContent("rejected.");
    expect(within(drawer).getAllByRole("img")[0]).toHaveAttribute(
      "src",
      "blob:preview",
    );
  },
);

test("the map can collapse for list browsing and reopen when selecting an activity", async () => {
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [activity],
  });
  show();
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
    await screen.findByRole("button", { name: "Edit activity: Louvre" }),
  ).toBeInTheDocument();
});

test.each([
  ["ideas", "Proposed", "Planned"],
  ["ideas", "Planned", "Rejected"],
  ["ideas", "Legacy custom state", "Proposed"],
  ["map", "Proposed", "Planned"],
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
      click(await within(list).findByRole("button", { name: "Louvre" }));
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
    expect(await screen.findAllByRole("menuitemradio")).toHaveLength(3);
    expect(
      screen.queryByRole("menuitemradio", { name: "Legacy custom state" }),
    ).not.toBeInTheDocument();
    click(await screen.findByRole("menuitemradio", { name: nextState }));
    await within(container).findByRole("button", {
      name: `State for Louvre: ${nextState}`,
    });
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
      click(await screen.findByRole("button", { name: "Louvre" }));
    }
    const container =
      view === "ideas"
        ? await screen.findByRole("list", { name: "Paris activities" })
        : await screen.findByRole("region", {
            name: "Selected activity details",
          });
    const stateButton = await within(container).findByRole("button", {
      name: "State for Louvre: Proposed",
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

test("researched coordinates remain a preview until selected and saved", async () => {
  const unlocated = { ...activity, geometry: null };
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [unlocated],
  });
  vi.mocked(getActivity).mockResolvedValue({
    activity: unlocated,
    etag: '"7"',
  });
  vi.mocked(researchActivityLocation).mockResolvedValue(locationSuggestion);
  show(false, ["LLM"]);
  click(await screen.findByRole("button", { name: "Set location for Louvre" }));
  const drawer = await screen.findByRole("dialog");
  click(
    within(drawer).getByRole("button", {
      name: "Research saved activity location",
    }),
  );
  expect(
    await within(drawer).findByRole("link", { name: "View coordinate source" }),
  ).toHaveAttribute("href", locationSuggestion.source.url);
  expect(within(drawer).getByText(/entrance not verified/)).toBeVisible();
  expect(researchActivityLocation).toHaveBeenCalledWith(
    "trip",
    destinations.features[0],
    activity.id,
    '"7"',
  );
  expect(saveActivity).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Map marker: Louvre" }),
  ).not.toBeInTheDocument();
  click(within(drawer).getByRole("button", { name: "Use this location" }));
  expect(saveActivity).not.toHaveBeenCalled();
  click(within(drawer).getByRole("button", { name: "Save activity" }));
  await waitFor(() => expect(saveActivity).toHaveBeenCalled());
  expect(vi.mocked(saveActivity).mock.calls[0][2]).toMatchObject({
    ...activity,
    geometry: locationSuggestion.geometry,
    properties: {
      ...activity.properties,
      locationSuggestion: null,
      links: [locationSuggestion.source],
    },
  });
});

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

test.each(["duration", "cost", "dismiss"])(
  "duration/cost research only applies the reviewed %s choice",
  async (choice) => {
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [activity],
    });
    vi.mocked(getActivity).mockResolvedValue({ activity, etag: '"7"' });
    vi.mocked(researchActivityDetails).mockResolvedValue(detailsSuggestion);
    show(false, ["LLM"]);
    click(await screen.findByRole("button", { name: "Louvre" }));
    click(await screen.findByRole("button", { name: "Edit activity: Louvre" }));
    const drawer = await screen.findByRole("dialog", { name: "Edit activity" });
    click(
      within(drawer).getByRole("button", {
        name: "Research duration and cost",
      }),
    );
    expect(
      await within(drawer).findByRole("link", { name: "Duration source" }),
    ).toHaveAttribute("href", detailsSuggestion.duration.evidence.source.url);
    expect(
      within(drawer).getByText("Adult admission; future prices unconfirmed."),
    ).toBeVisible();
    expect(researchActivityDetails).toHaveBeenCalledWith(
      "trip",
      destinations.features[0],
      activity.id,
      '"7"',
    );
    expect(saveActivity).not.toHaveBeenCalled();
    click(
      within(drawer).getByRole("button", {
        name:
          choice === "dismiss" ? "Dismiss suggestions" : `Use this ${choice}`,
      }),
    );
    expect(saveActivity).not.toHaveBeenCalled();
    click(within(drawer).getByRole("button", { name: "Save activity" }));
    await waitFor(() => expect(saveActivity).toHaveBeenCalled());
    const saved = vi.mocked(saveActivity).mock.calls[0][2];
    expect(saved.properties.duration).toBe(
      choice === "duration" ? "PT1H30M" : activity.properties.duration,
    );
    expect(saved.properties.cost).toEqual(
      choice === "cost" ? detailsSuggestion.cost.value : null,
    );
    expect(saved.properties.description).toBe(activity.properties.description);
    expect(saved.geometry).toEqual(activity.geometry);
    if (choice === "duration")
      expect(saved.properties.durationEvidence).toEqual(
        detailsSuggestion.duration.evidence,
      );
    if (choice === "cost")
      expect(saved.properties.costEvidence).toEqual(
        detailsSuggestion.cost.evidence,
      );
  },
);

test("manually changing a researched duration clears its previous evidence", async () => {
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
  click(await screen.findByRole("button", { name: "Edit activity: Louvre" }));
  const drawer = await screen.findByRole("dialog", { name: "Edit activity" });
  expect(
    within(drawer).queryByRole("button", {
      name: "Research duration and cost",
    }),
  ).not.toBeInTheDocument();
  expect(
    within(drawer).getByRole("link", { name: "Duration source" }),
  ).toBeVisible();
  change(within(drawer).getByLabelText("Duration, minutes"), {
    target: { value: "180" },
  });
  click(within(drawer).getByRole("button", { name: "Save activity" }));
  await waitFor(() => expect(saveActivity).toHaveBeenCalled());
  expect(
    vi.mocked(saveActivity).mock.calls[0][2].properties.durationEvidence,
  ).toBeNull();
});

test.each(["empty", "failure"])(
  "research %s keeps the editor values and shows a toast",
  async (outcome) => {
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [activity],
    });
    vi.mocked(getActivity).mockResolvedValue({ activity, etag: '"7"' });
    if (outcome === "empty")
      vi.mocked(researchActivityDetails).mockResolvedValue(null);
    else
      vi.mocked(researchActivityDetails).mockRejectedValue(
        new Error("Research unavailable."),
      );
    show(false, ["LLM"]);
    click(await screen.findByRole("button", { name: "Louvre" }));
    click(await screen.findByRole("button", { name: "Edit activity: Louvre" }));
    const drawer = await screen.findByRole("dialog", { name: "Edit activity" });
    click(
      within(drawer).getByRole("button", {
        name: "Research duration and cost",
      }),
    );
    const message =
      outcome === "empty"
        ? "No supported duration or cost was found. You can still enter them manually."
        : "Research unavailable.";
    expect(
      (await screen.findByText(message)).closest(".fui-Toast"),
    ).not.toBeNull();
    expect(within(drawer).getByLabelText("Duration, minutes")).toHaveValue(120);
    expect(saveActivity).not.toHaveBeenCalled();
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
    const states = ["Planned", "Proposed", "Rejected", "Maybe", "Proposed"];
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
    ).toEqual(["Proposed2", "Planned1", "Rejected1", "Maybe1"]);
    const proposed = within(list).getByRole("button", {
      name: "Proposed activities",
    });
    const planned = within(list).getByRole("button", {
      name: "Planned activities",
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

test.each([
  [false, true, true],
  [false, false, false],
  [true, true, false],
])(
  "Find location visibility for readOnly=%s and AI=%s",
  async (readOnly, ai, visible) => {
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [{ ...activity, geometry: null }],
    });
    show(readOnly, ai ? ["LLM"] : []);
    await screen.findByText("Needs location · Not on map");
    expect(
      screen.queryByRole("button", { name: "Find location" }) !== null,
    ).toBe(visible);
  },
);

test("Find location is hidden when all activities already have locations", async () => {
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [activity],
  });
  show(false, ["LLM"]);
  await screen.findByRole("button", { name: "Louvre" });
  expect(
    screen.queryByRole("button", { name: "Find location" }),
  ).not.toBeInTheDocument();
});

test("Find location fills missing pins, preserves latest fields and sources, and skips existing locations", async () => {
  const missing = { ...activity, geometry: null };
  const second = {
    ...missing,
    id: "garden",
    properties: { ...activity.properties, name: "Garden" },
  };
  const located = {
    ...activity,
    id: "located",
    properties: { ...activity.properties, name: "Already located" },
  };
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [missing, second, located],
  });
  const latest = {
    ...missing,
    properties: {
      ...missing.properties,
      state: "Planned",
      description: "Latest edit",
      links: [{ url: "https://www.louvre.fr", label: "Official" }],
    },
  };
  vi.mocked(getActivity).mockImplementation(async (_trip, _city, id) => ({
    activity: id === missing.id ? latest : second,
    etag: `"${id}-latest"`,
  }));
  vi.mocked(researchActivityLocation).mockResolvedValue(locationSuggestion);
  show(false, ["LLM"]);
  click(await screen.findByRole("button", { name: "Find location" }));
  await screen.findByText("2 locations found and saved.");
  expect(getActivity).toHaveBeenCalledTimes(2);
  expect(researchActivityLocation).toHaveBeenCalledTimes(2);
  expect(saveActivity).toHaveBeenCalledWith(
    "trip",
    destinations.features[0],
    {
      ...latest,
      geometry: locationSuggestion.geometry,
      properties: {
        ...latest.properties,
        locationSuggestion: null,
        links: [...latest.properties.links, locationSuggestion.source],
      },
    },
    '"museum-latest"',
    expect.any(AbortSignal),
  );
  expect(
    screen.getByRole("button", { name: "Map marker: Louvre" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Map marker: Garden" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Find location" }),
  ).not.toBeInTheDocument();
});

test("bulk locations retain partial successes and leave unknown or stale activities unchanged", async () => {
  const items = [
    "found",
    "unknown",
    "provider-error",
    "stale",
    "already-filled",
  ].map((id) => ({
    ...activity,
    id,
    geometry: null,
    properties: { ...activity.properties, name: id },
  }));
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: items,
  });
  vi.mocked(getActivity).mockImplementation(async (_trip, _city, id) => ({
    activity: {
      ...items.find((item) => item.id === id)!,
      geometry: id === "already-filled" ? activity.geometry : null,
    },
    etag: '"current"',
  }));
  vi.mocked(researchActivityLocation).mockImplementation(
    async (_trip, _destination, id) => {
      if (id === "unknown") return null;
      if (id === "provider-error") throw new Error("Provider unavailable");
      return locationSuggestion;
    },
  );
  vi.mocked(saveActivity).mockImplementation(
    async (_trip, _destination, input) => {
      if (input.id === "stale") throw new Error("The activity changed");
      return { ...input, id: input.id! };
    },
  );
  show(false, ["LLM"]);
  click(await screen.findByRole("button", { name: "Find location" }));
  await screen.findByText(
    "1 location found and saved. 1 already located. 1 could not be verified. 2 failed; try again.",
  );
  expect(researchActivityLocation).toHaveBeenCalledTimes(4);
  expect(saveActivity).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("button", { name: "Map marker: found" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Map marker: stale" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Find location" })).toBeEnabled();
});

test("bulk locations limit concurrent research and cancel queued work when leaving", async () => {
  const items = ["one", "two", "three"].map((id) => ({
    ...activity,
    id,
    geometry: null,
  }));
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: items,
  });
  vi.mocked(getActivity).mockImplementation(async (_trip, _city, id) => ({
    activity: items.find((item) => item.id === id)!,
    etag: '"current"',
  }));
  const resolvers: (() => void)[] = [];
  vi.mocked(researchActivityLocation).mockImplementation(
    () =>
      new Promise((resolve) =>
        resolvers.push(() => resolve(locationSuggestion)),
      ),
  );
  const view = show(false, ["LLM"]);
  click(await screen.findByRole("button", { name: "Find location" }));
  await waitFor(() =>
    expect(researchActivityLocation).toHaveBeenCalledTimes(2),
  );
  expect(screen.getByRole("button", { name: "Find location" })).toBeDisabled();
  const signal = vi.mocked(researchActivityLocation).mock.calls[0][4]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolvers.forEach((resolve) => resolve());
  });
  expect(researchActivityLocation).toHaveBeenCalledTimes(2);
  expect(saveActivity).not.toHaveBeenCalled();
});
