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
import TripOverview from "./TripOverview";
import { resolveCity, searchCities, type Trip } from "./api";
import {
  addDestination,
  deleteDestination,
  replaceDestinationStay,
  getDestinations,
  type Destination,
} from "./activitiesApi";

vi.mock("./api", () => ({ searchCities: vi.fn(), resolveCity: vi.fn() }));
vi.mock("./activitiesApi", () => ({
  getDestinations: vi.fn(),
  addDestination: vi.fn(),
  deleteDestination: vi.fn(),
  replaceDestinationStay: vi.fn(),
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
function show(readOnly = false) {
  return render(
    <ColorSchemeProvider>
      <MemoryRouter>
        <TripOverview trip={trip} readOnly={readOnly} />
      </MemoryRouter>
    </ColorSchemeProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
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
async function openAndChooseCity() {
  const trigger = await screen.findByRole("button", {
    name: "Add destination",
  });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const drawer = await screen.findByRole("dialog");
  const input = within(drawer).getByRole("combobox", {
    name: "Destination city",
  });
  act(() => input.focus());
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
  expect(screen.getByRole("status")).toHaveTextContent(
    "Paris added to your trip.",
  );
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

test("validates stay dates and retains the form after a save failure for retry", async () => {
  vi.mocked(addDestination).mockRejectedValueOnce(
    new Error("Please try again."),
  );
  show();
  const drawer = await openAndChooseCity();
  const submit = within(drawer).getByRole("button", {
    name: "Add destination",
  });
  fireEvent.change(within(drawer).getByLabelText("Arrival date"), {
    target: { value: "2027-06-10" },
  });
  fireEvent.change(within(drawer).getByLabelText("Departure date"), {
    target: { value: "2027-06-09" },
  });
  expect(submit).toBeDisabled();
  fireEvent.change(within(drawer).getByLabelText("Departure date"), {
    target: { value: "2027-06-14" },
  });
  fireEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Please try again.",
  );
  expect(
    within(drawer).getByRole("combobox", { name: "Destination city" }),
  ).toHaveValue("Paris, France");
  expect(within(drawer).getByLabelText("Arrival date")).toHaveValue(
    "2027-06-10",
  );
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
    screen.getByRole("link", { name: "View activities in Paris" }),
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
  return screen.findByRole("dialog");
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
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Please retry.",
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
  fireEvent.change(within(drawer).getByLabelText("Arrival date"), {
    target: { value: "2027-06-10" },
  });
  fireEvent.change(within(drawer).getByLabelText("Departure date"), {
    target: { value: "2027-06-14" },
  });
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
  expect(await screen.findByText("Visit dates saved.")).toBeVisible();
  const reopen = await screen.findByRole("button", {
    name: "Edit dates: Paris, visit 1",
  });
  act(() => reopen.focus());
  fireEvent.click(reopen);
  const reopened = await screen.findByRole("dialog");
  expect(within(reopened).getByLabelText("Arrival date")).toHaveValue(
    "2027-06-10",
  );
});
