import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import TripTravelEditor, { type TravelPlan } from "./TripTravelEditor";
import { planningRequest } from "../activities/activityPlanApi";
import { clearTripSnapshotCache } from "../../api/tripSnapshot";
vi.mock("../activities/activityPlanApi", () => ({ planningRequest: vi.fn() }));
const plan: TravelPlan = {
  version: 1,
  connections: [
    {
      id: "journey",
      name: "Train to Paris",
      from: { placeId: "urn:tripplanner:trip:place:home" },
      to: { visitId: "visit" },
      mode: "train",
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  clearTripSnapshotCache();
});
function show() {
  return render(
    <TripTravelEditor
      tripId="trip"
      readOnly={false}
      value={plan}
      activities={[]}
      destinations={{
        type: "FeatureCollection",
        route: [],
        features: [
          {
            type: "Feature",
            id: "paris",
            geometry: { type: "Point", coordinates: [2.35, 48.86] },
            properties: {
              name: "Paris",
              countryCode: "FR",
              timeZone: "Europe/Paris",
              contextVersion: "v1",
              arrivalDate: null,
              departureDate: null,
              stays: [
                {
                  id: "visit",
                  order: 0,
                  arrivalDate: null,
                  departureDate: null,
                  arrivalAt: "09:00:00",
                  departureAt: "18:00:00",
                  stayLocation: null,
                },
              ],
              isActive: true,
            },
          },
        ],
      }}
    />,
  );
}
test("travel remains a grouped draft until explicitly saved with its validator", async () => {
  vi.mocked(planningRequest).mockResolvedValue({
    data: plan,
    etag: '"travel-1"',
  });
  show();
  fireEvent.click(screen.getByText("Travel connections (1)"));
  fireEvent.click(screen.getByRole("button", { name: "Edit travel" }));
  const name = await screen.findByRole("textbox", { name: "Journey 1 name" });
  fireEvent.change(name, { target: { value: "Bike to Paris" } });
  fireEvent.change(
    screen.getByRole("combobox", { name: "Journey 1 transport" }),
    { target: { value: "bike" } },
  );
  expect(planningRequest).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Save travel" }));
  await waitFor(() => expect(planningRequest).toHaveBeenCalledTimes(2));
  expect(planningRequest).toHaveBeenLastCalledWith(
    "/trips/trip/travel",
    expect.objectContaining({
      method: "PUT",
      etag: '"travel-1"',
      body: {
        connections: [
          expect.objectContaining({
            id: "journey",
            name: "Bike to Paris",
            mode: "bike",
          }),
        ],
      },
    }),
  );
});
test("a failed travel replacement retains the draft and offers explicit refresh", async () => {
  vi.mocked(planningRequest)
    .mockResolvedValueOnce({
      data: plan,
      etag: '"travel-1"',
    })
    .mockRejectedValueOnce(new Error("Travel changed. Refresh."));
  show();
  fireEvent.click(screen.getByText("Travel connections (1)"));
  fireEvent.click(screen.getByRole("button", { name: "Edit travel" }));
  const name = await screen.findByRole("textbox", { name: "Journey 1 name" });
  fireEvent.change(name, { target: { value: "My journey" } });
  fireEvent.click(screen.getByRole("button", { name: "Save travel" }));
  await screen.findByRole("alert");
  expect(name).toHaveValue("My journey");
  expect(screen.getByRole("button", { name: "Refresh travel" })).toBeEnabled();
  expect(planningRequest).toHaveBeenCalledTimes(2);
});
