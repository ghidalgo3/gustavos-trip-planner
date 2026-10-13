import { fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { beforeEach, expect, test, vi } from "vitest";
import TripPlanning from "./TripPlanning";
import PlanningRun from "./PlanningRun";
import { getTripFlightPlanningData } from "./planningApi";
import { getDestinations } from "./activitiesApi";
import type { Trip } from "./api";
vi.mock("./PlanningRun", () => ({
  default: vi.fn(() => <div>Flight search and selection</div>),
}));
vi.mock("./planningApi", () => ({ getTripFlightPlanningData: vi.fn() }));
vi.mock("./activitiesApi", () => ({ getDestinations: vi.fn() }));
const trip: Trip = {
  id: "trip",
  ownerUserId: "owner",
  name: "Europe",
  description: "",
  constraints: {},
  createdAt: "",
  updatedAt: "",
};
const planning = {
  document: {
    schemaVersion: 1,
    destination: null,
    visits: [
      {
        id: "stay",
        location: { code: "CDG", timeZone: "Europe/Paris" },
        nights: null,
        presentFrom: "2030-06-10",
        presentThrough: "2030-06-14",
        afterVisitIds: [],
      },
    ],
    parties: [],
    constraints: [],
  },
  parties: [],
};
function show() {
  const onBack = vi.fn();
  render(
    <FluentProvider theme={webLightTheme}>
      <TripPlanning trip={trip} onBack={onBack} />
    </FluentProvider>,
  );
  return onBack;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getTripFlightPlanningData).mockResolvedValue(planning);
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "paris",
        geometry: { type: "Point", coordinates: [2.35, 48.86] },
        properties: {
          name: "Paris",
          countryCode: "FR",
          timeZone: null,
          contextVersion: "1",
          isActive: true,
          arrivalDate: null,
          departureDate: null,
          stays: [
            {
              id: "stay",
              order: 0,
              arrivalDate: null,
              departureDate: null,
              arrivalAt: "",
              departureAt: "",
            },
          ],
        },
      },
    ],
    route: [],
  });
});
test("keeps only flight search and selection, using the server's destination-derived planning data", async () => {
  show();
  expect(await screen.findByText("Flight search and selection")).toBeVisible();
  const props = vi.mocked(PlanningRun).mock.calls.at(-1)![0];
  expect(props.visitCount).toBe(1);
  expect(props.hasUnsavedChanges).toBe(false);
  expect(props.constraints).toEqual([]);
  expect(
    screen.queryByRole("heading", { name: "Where and when?" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Add traveler" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save planning details" }),
  ).not.toBeInTheDocument();
});
test("trips without destinations return to Overview to plan them", async () => {
  vi.mocked(getDestinations).mockResolvedValue({
    type: "FeatureCollection",
    features: [],
    route: [],
  });
  const onBack = show();
  expect(await screen.findByText(/Add destinations on Overview/)).toBeVisible();
  expect(PlanningRun).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to Overview" }));
  expect(onBack).toHaveBeenCalledOnce();
});
test("loading errors offer retry", async () => {
  vi.mocked(getTripFlightPlanningData).mockRejectedValueOnce(
    new Error("Unavailable"),
  );
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry flights" }));
  expect(await screen.findByText("Flight search and selection")).toBeVisible();
});
