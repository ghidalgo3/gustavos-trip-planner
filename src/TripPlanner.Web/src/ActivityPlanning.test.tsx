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
  importActivityImage,
  waitForActivityJob,
  getSuggestionResult,
  type DestinationCollection,
  type Activity,
} from "./activitiesApi";
import type { TrackedOperation } from "./operationsApi";
vi.mock("./ActivityMap", () => ({ default: () => <div aria-label="Map" /> }));
vi.mock("./api", () => ({ searchPlaces: vi.fn() }));
vi.mock("./activitiesApi", () => ({
  getDestinations: vi.fn(),
  getActivities: vi.fn(),
  getActivity: vi.fn(),
  saveActivity: vi.fn(),
  deleteActivity: vi.fn(),
  suggestActivities: vi.fn(),
  importActivityImage: vi.fn(),
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
async function add() {
  const trigger = await screen.findByRole("button", { name: "Add activity" });
  act(() => trigger.focus());
  fireEvent.click(trigger);
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
  fireEvent.click(screen.getByRole("tab", { name: /Rome/ }));
  await waitFor(() =>
    expect(onDestinationChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "rome-it" }),
    ),
  );
  expect(screen.getByTestId("location")).toHaveTextContent(
    "destination=rome-it",
  );
  expect(
    screen.getByRole("table", { name: "Rome activities" }),
  ).toBeInTheDocument();
});

test("place lookup populates the activity's name and location, and saving updates the table", async () => {
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
  fireEvent.change(within(drawer).getByLabelText("Activity or place name"), {
    target: { value: "Louvre" },
  });
  fireEvent.click(
    within(drawer).getByRole("button", { name: "Search Azure Maps" }),
  );
  fireEvent.click(
    await within(drawer).findByRole("button", { name: "Louvre, Paris" }),
  );
  expect(searchPlaces).toHaveBeenCalledWith(
    "Louvre",
    expect.any(AbortSignal),
    [2.35, 48.86],
  );
  expect(within(drawer).getByLabelText("Name")).toHaveValue("Louvre");
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [activity],
  });
  fireEvent.click(
    within(drawer).getByRole("button", { name: "Save activity" }),
  );
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
    await screen.findByRole("table", { name: "Paris activities" }),
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
  const edit = await screen.findByRole("button", {
    name: "Edit activity: Louvre",
  });
  act(() => edit.focus());
  fireEvent.click(edit);
  const drawer = await screen.findByRole("dialog");
  expect(within(drawer).getByLabelText("Name")).toHaveValue("Louvre");
  fireEvent.change(within(drawer).getByLabelText("Description"), {
    target: { value: "Visit in the morning" },
  });
  const stateTrigger = within(drawer).getByRole("button", {
    name: "State Proposed",
  });
  act(() => stateTrigger.focus());
  fireEvent.click(stateTrigger);
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: "Planned" }),
  );
  const saveButton = within(drawer).getByRole("button", {
    name: "Save activity",
    hidden: true,
  });
  act(() => saveButton.focus());
  fireEvent.click(
    within(drawer).getByRole("button", { name: "Save activity" }),
  );
  expect(await within(drawer).findByRole("alert")).toHaveTextContent(
    "Please retry.",
  );
  expect(within(drawer).getByLabelText("Description")).toHaveValue(
    "Visit in the morning",
  );
  fireEvent.click(
    within(drawer).getByRole("button", { name: "Save activity" }),
  );
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
      }),
    }),
    '"v1"',
  );
});

test("canceling the activity drawer discards its draft", async () => {
  show();
  const drawer = await add();
  fireEvent.change(within(drawer).getByLabelText("Name"), {
    target: { value: "Unsaved" },
  });
  fireEvent.click(within(drawer).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const reopened = await add();
  expect(within(reopened).getByLabelText("Name")).toHaveValue("");
  expect(saveActivity).not.toHaveBeenCalled();
});

test("shared trip members see the table without add or edit actions", async () => {
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [activity],
  });
  show(true);
  expect(await screen.findByRole("button", { name: "Louvre" })).toBeVisible();
  expect(
    screen.getByRole("table", { name: "Paris activities" }),
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
    vi.mocked(importActivityImage).mockResolvedValue(operation);
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
    fireEvent.click(
      within(drawer).getByRole("tab", {
        name: method === "prompt" ? "AI prompt" : "Image",
      }),
    );
    fireEvent.change(
      within(drawer).getByLabelText(
        method === "prompt"
          ? "What would you like to do?"
          : "Image instructions (optional)",
      ),
      { target: { value: "Art museums" } },
    );
    const file = new File(["image"], "museum.png", { type: "image/png" });
    if (method === "image")
      fireEvent.change(within(drawer).getByLabelText("Activity image"), {
        target: { files: [file] },
      });
    vi.mocked(getActivities).mockResolvedValue({
      type: "FeatureCollection",
      features: [activity],
    });
    fireEvent.click(
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
      expect(importActivityImage).toHaveBeenCalledWith(
        "trip",
        destinations.features[0],
        file,
        "Art museums",
      );
    expect(
      await screen.findByRole("table", { name: "Paris activities" }),
    ).toHaveTextContent("Louvre");
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 activities added as Proposed.",
    );
  },
);

afterEach(() => vi.unstubAllGlobals());
