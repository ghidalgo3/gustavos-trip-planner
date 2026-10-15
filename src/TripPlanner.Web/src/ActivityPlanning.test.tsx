import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import ColorSchemeProvider from "./ColorSchemeProvider";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ActivityPlanning from "./ActivityPlanning";
import { searchPlaces, type Trip } from "./api";
import {
  getDestinations,
  getActivities,
  getActivity,
  saveActivity,
  suggestActivities,
  importActivityImages,
  waitForActivityJob,
  getSuggestionResult,
  type DestinationCollection,
  type Activity,
} from "./activitiesApi";
import type { TrackedOperation } from "./operationsApi";
vi.mock("./ActivityMap", () => ({
  default: ({
    activities,
    onSelect,
    stayLocation,
  }: {
    stayLocation?: DestinationCollection["features"][number]["properties"]["stayLocation"];
    activities: Activity[];
    onSelect: (id: string) => void;
  }) => (
    <div aria-label="Map">
      {stayLocation && (
        <button
          onClick={() => onSelect("stay")}
        >{`Stay marker: ${stayLocation.properties.name}`}</button>
      )}
      {activities
        .filter((item) => item.geometry)
        .map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
          >{`Map marker: ${item.properties.name}`}</button>
        ))}
    </div>
  ),
}));
vi.mock("./api", () => ({ searchPlaces: vi.fn() }));
vi.mock("./activitiesApi", () => ({
  getDestinations: vi.fn(),
  getActivities: vi.fn(),
  getActivity: vi.fn(),
  saveActivity: vi.fn(),
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
    durationMinutes: 120,
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
  click(await within(drawer).findByRole("button", { name: "Louvre, Paris" }));
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
  expect(await within(drawer).findByRole("alert")).toHaveTextContent(
    "Please retry.",
  );
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
    vi.mocked(waitForActivityJob).mockResolvedValue(operation);
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
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 activities added as Proposed.",
    );
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
    expect(within(list).queryByText("Proposed")).not.toBeInTheDocument();
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
      within(card).getByRole("button", { name: "Louvre" }),
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
    "up to 10 images",
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
    click(within(drawer).getByRole("button", { name: action }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit activity" }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole("dialog", { name: "Map of Paris" })).toBe(
      mapDialog,
    );
    expect(within(mapDialog).getByLabelText("Map")).toBe(map);
    expect(
      within(mapDialog).getByRole("region", {
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
