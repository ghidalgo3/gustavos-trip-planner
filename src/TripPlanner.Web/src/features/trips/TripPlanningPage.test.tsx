import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useSearchParams,
} from "react-router";
import { expect, test, vi } from "vitest";
import TripPlanningPage from "./TripPlanningPage";

vi.mock("../../api/api", () => ({
  apiBaseUrl: "",
  getTrip: vi.fn().mockResolvedValue({
    id: "trip",
    name: "Test trip",
    ownerUserId: "owner",
  }),
}));
vi.mock("../../api/tripSnapshot", () => ({
  openTripSnapshot: vi.fn().mockResolvedValue(undefined),
  refreshConflictedResource: vi.fn().mockResolvedValue(undefined),
  useTripSnapshotState: () => ({
    userId: "owner",
    tripId: "trip",
    offline: false,
    loading: false,
    snapshot: {
      resources: {
        "/trips/trip": {
          data: { id: "trip", name: "Test trip", ownerUserId: "owner" },
        },
      },
    },
  }),
}));
vi.mock("./TripOverview", () => ({
  default: () => (
    <section aria-label="Trip overview">
      <Link to="/trips/trip/activities?destination=tokyo-jp">
        Plan activities
      </Link>
    </section>
  ),
}));
vi.mock("../activities/ActivityPlanning", () => ({
  default: function Activities() {
    const [draft, setDraft] = useState("");
    const [query] = useSearchParams();
    return (
      <section aria-label="Activity planning">
        <span>{query.get("destination")}</span>
        <input
          aria-label="Draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </section>
    );
  },
}));
vi.mock("../flights/TripPlanning", () => ({
  default: ({ readOnly }: { readOnly: boolean }) => (
    <section aria-label="Flight planning" data-read-only={String(readOnly)} />
  ),
}));
vi.mock("../party/TripParties", () => ({
  default: () => <section aria-label="Trip party" />,
}));

test.each(["Activities", "Plan activities"])(
  "%s navigates repeatedly without leaving the previous section behind or losing the activity draft",
  async (link) => {
    render(
      <MemoryRouter initialEntries={["/trips/trip"]}>
        <Routes>
          <Route
            path="/trips/:tripId/*"
            element={<TripPlanningPage userId="owner" featureFlags={[]} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("region", { name: "Trip overview" });
    fireEvent.click(screen.getByRole("link", { name: link }));
    expect(
      screen.getByRole("region", { name: "Activity planning" }),
    ).toBeVisible();
    expect(screen.queryByRole("region", { name: "Trip overview" })).toBeNull();
    const draft = screen.getByLabelText("Draft");
    fireEvent.change(draft, { target: { value: "Unfinished plan" } });

    for (const section of ["Flights", "Party", "Overview", "Overview"]) {
      fireEvent.click(screen.getByRole("link", { name: section }));
      expect(draft).not.toBeVisible();
      fireEvent.click(screen.getByRole("link", { name: "Overview" }));
      expect(
        screen.getAllByRole("region", { name: "Trip overview" }),
      ).toHaveLength(1);
      fireEvent.click(screen.getByRole("link", { name: link }));
      expect(
        screen.queryByRole("region", { name: "Trip overview" }),
      ).toBeNull();
      expect(
        screen.queryByRole("region", { name: "Flight planning" }),
      ).toBeNull();
      expect(screen.queryByRole("region", { name: "Trip party" })).toBeNull();
      expect(screen.getByLabelText("Draft")).toBe(draft);
      expect(draft).toBeVisible();
      expect(draft).toHaveValue("Unfinished plan");
      if (link === "Plan activities") {
        expect(screen.getByText("tokyo-jp")).toBeVisible();
      }
    }
  },
);

test.each([false, true])(
  "preserves the flight planning screen when offline is %s",
  async (offline) => {
    render(
      <MemoryRouter initialEntries={["/trips/trip/flights"]}>
        <Routes>
          <Route
            path="/trips/:tripId/*"
            element={
              <TripPlanningPage
                userId="owner"
                featureFlags={[]}
                offline={offline}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("region", { name: "Flight planning" }),
    ).toHaveAttribute("data-read-only", String(offline));
  },
);
