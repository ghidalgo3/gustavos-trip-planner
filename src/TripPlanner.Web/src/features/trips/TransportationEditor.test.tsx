import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import TransportationEditor from "./TransportationEditor";
import { planningRequest } from "../activities/activityPlanApi";
import type { Transportation } from "./transportationApi";

const journey: Transportation = {
  type: "FeatureCollection",
  id: "journey",
  name: "Airport train",
  notes: "Take the express.",
  features: [
    {
      type: "Feature",
      id: "from",
      geometry: null,
      properties: { reference: { kind: "home", id: "person" } },
    },
    {
      type: "Feature",
      id: "to",
      geometry: { type: "Point", coordinates: [139, 35] },
      properties: { name: "Station", address: "Station address" },
    },
    {
      type: "Feature",
      id: "step-1",
      geometry: null,
      properties: {
        sequence: 0,
        mode: "train",
        line: "Express",
        instructions: "Platform 2",
      },
    },
  ],
  mode: "train",
  departureDate: null,
  departureTime: null,
  timeZone: null,
  duration: "PT30M",
  version: 3,
  etag: "transportation-journey-3",
  routeStale: false,
};
vi.mock("../activities/activityPlanApi", () => ({ planningRequest: vi.fn() }));
vi.mock("../../api/tripDocumentStore", () => ({
  useTripDocumentState: () => ({
    document: {
      document: {
        people: [{ id: "person", name: "Traveler" }],
        places: [],
        itinerary: { items: [] },
      },
    },
  }),
  cachedTripResource: (path: string) =>
    path.endsWith("/transportation") ? [journey] : journey,
  refreshConflictedResource: vi.fn().mockResolvedValue(undefined),
}));
beforeEach(() => vi.resetAllMocks());

test("editing notes preserves route steps and saves one complete journey with its ETag", async () => {
  vi.mocked(planningRequest).mockResolvedValue({
    data: journey,
    etag: '"next"',
  });
  render(<TransportationEditor tripId="trip" readOnly={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit journey" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Journey notes" }), {
    target: { value: "Transfer to Metro A toward Central." },
  });
  expect(planningRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save journey" }));
  await waitFor(() =>
    expect(planningRequest).toHaveBeenCalledWith(
      "/trips/trip/transportation/journey",
      expect.objectContaining({
        method: "PUT",
        etag: '"transportation-journey-3"',
        body: expect.objectContaining({
          notes: "Transfer to Metro A toward Central.",
          features: journey.features,
        }),
      }),
    ),
  );
});

test("failed saves retain the journey draft for correction or explicit refresh", async () => {
  vi.mocked(planningRequest).mockRejectedValue(new Error("Location changed."));
  render(<TransportationEditor tripId="trip" readOnly={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit journey" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Journey notes" }), {
    target: { value: "Keep my directions" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save journey" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "Journey notes" })).toHaveValue(
    "Keep my directions",
  );
  expect(
    screen.getByRole("button", { name: "Refresh transportation" }),
  ).toBeEnabled();
});

test("offline transportation retains notes and route directions with editing unavailable", () => {
  render(<TransportationEditor tripId="trip" readOnly />);
  expect(screen.getByText("Take the express.")).toBeInTheDocument();
  expect(screen.getByText("Express · Platform 2")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Edit journey" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add journey" }),
  ).not.toBeInTheDocument();
});
