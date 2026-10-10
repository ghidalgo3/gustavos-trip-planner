import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import ActivityPlanning from "./ActivityPlanning";
import { resolveCity, searchCities, type Trip } from "./api";
import type { DestinationCollection } from "./activitiesApi";
import {
  addDestination,
  getDestinations,
  getActivities,
  replaceDestinationStay,
  saveActivity,
} from "./activitiesApi";

vi.mock("./ActivityMap", () => ({ default: () => <div aria-label="Map" /> }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  searchCities: vi.fn(),
  resolveCity: vi.fn(),
}));
vi.mock("./activitiesApi", () => ({
  getDestinations: vi.fn(),
  addDestination: vi.fn(),
  deleteDestinationStay: vi.fn(),
  replaceDestinationStay: vi.fn(),
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

function Location() {
  return <span data-testid="location">{useLocation().search}</span>;
}
function show(readOnly = false) {
  return render(
    <FluentProvider theme={webLightTheme}>
      <MemoryRouter initialEntries={["/trips/trip/activities"]}>
        <ActivityPlanning trip={trip} readOnly={readOnly} featureFlags={[]} />
        <Location />
      </MemoryRouter>
    </FluentProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getDestinations).mockReset();
  vi.mocked(getActivities).mockReset();
  vi.mocked(saveActivity).mockReset();
  vi.mocked(addDestination).mockReset();
  vi.mocked(replaceDestinationStay).mockReset();
  vi.mocked(searchCities).mockReset();
  vi.mocked(resolveCity).mockReset();
  vi.mocked(getActivities).mockResolvedValue({
    type: "FeatureCollection",
    features: [],
  });
});

test("lets the owner add a destination before choosing flights", async () => {
  vi.mocked(getDestinations)
    .mockResolvedValueOnce({
      type: "FeatureCollection",
      features: [],
      route: [],
    })
    .mockResolvedValue(destinations);
  vi.mocked(addDestination).mockResolvedValue(destinations.features[0]);
  vi.mocked(searchCities).mockResolvedValue([
    {
      id: "paris",
      label: "Paris, France",
      cityName: "Paris",
      countryCode: "FR",
      longitude: 2.35,
      latitude: 48.86,
    },
  ]);
  vi.mocked(resolveCity).mockResolvedValue({
    longitude: 2.35,
    latitude: 48.86,
  });
  show();
  expect(
    await screen.findByText(/Add a destination to start planning/),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Country code")).not.toBeInTheDocument();
  const addButton = screen.getByRole("button", { name: "Add destination" });
  expect(addButton).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "City" }), {
    target: { value: "Par" },
  });
  fireEvent.click(await screen.findByRole("option", { name: "Paris, France" }));
  expect(addButton).toBeEnabled();
  fireEvent.click(addButton);
  await waitFor(() =>
    expect(addDestination).toHaveBeenCalledWith("trip", {
      name: "Paris",
      countryCode: "FR",
      longitude: 2.35,
      latitude: 48.86,
      arrivalDate: null,
      departureDate: null,
    }),
  );
  expect(
    await screen.findByRole("tab", { name: "Paris · 2 stays" }),
  ).toBeInTheDocument();
});

test("shows repeated stays in one city tab and saves a manual activity", async () => {
  vi.mocked(getDestinations).mockResolvedValue(destinations);
  vi.mocked(saveActivity).mockImplementation(
    async (_tripId, _destination, input) => ({
      ...input,
      id: "activity",
      type: "Feature",
    }),
  );
  show();
  expect(
    await screen.findByRole("tab", { name: "Paris · 2 stays" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Paris → Rome → Paris")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Rome" }));
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      "destination=rome-it",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit dates" }));
  fireEvent.change(screen.getByLabelText("Arrival date"), {
    target: { value: "2027-06-15" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save dates" }));
  await waitFor(() =>
    expect(replaceDestinationStay).toHaveBeenCalledWith(
      "trip",
      "rome-it",
      "r1",
      { arrivalDate: "2027-06-15", departureDate: "2027-06-18" },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add activity" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Cooking class" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save activity" }));
  await waitFor(() => expect(saveActivity).toHaveBeenCalled());
  expect(vi.mocked(saveActivity).mock.calls[0][1].id).toBe("rome-it");
  expect(vi.mocked(saveActivity).mock.calls[0][2].properties.name).toBe(
    "Cooking class",
  );
});
