import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
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
vi.mock("../../api/tripDocumentStore", () => ({
  openTripDocument: vi.fn().mockResolvedValue(undefined),
  refreshConflictedResource: vi.fn().mockResolvedValue(undefined),
  useTripDocumentState: () => ({
    userId: "owner",
    tripId: "trip",
    offline: false,
    loading: false,
    document: {
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
      <Link to="/trips/trip/flights">Plan Flights</Link>
      <Link to="/trips/trip/activities?destination=tokyo-jp">
        Plan activities
      </Link>
    </section>
  ),
}));
vi.mock("../activities/ActivityPlanning", () => ({
  default: function Activities({ tripHeader }: { tripHeader?: ReactNode }) {
    const [draft, setDraft] = useState("");
    const [query] = useSearchParams();
    return (
      <section aria-label="Activity planning">
        {tripHeader}
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

test("contextual links and Share navigate without losing the activity draft", async () => {
  render(
    <MemoryRouter initialEntries={["/trips/trip"]}>
      <Routes>
        <Route
          path="/trips/:tripId/*"
          element={<TripPlanningPage userId="owner" />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("region", { name: "Trip overview" });
  fireEvent.click(screen.getByRole("link", { name: "Plan activities" }));
  expect(
    screen.getByRole("region", { name: "Activity planning" }),
  ).toBeVisible();
  expect(screen.queryByRole("region", { name: "Trip overview" })).toBeNull();
  const draft = screen.getByLabelText("Draft");
  fireEvent.change(draft, { target: { value: "Unfinished plan" } });

  expect(
    screen.queryByRole("navigation", { name: "Trip sections" }),
  ).toBeNull();
  for (const section of ["Flights", "Party"]) {
    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    expect(draft).not.toBeVisible();
    fireEvent.click(
      section === "Party"
        ? screen.getByRole("button", { name: "Share" })
        : screen.getByRole("link", { name: "Plan Flights" }),
    );
    expect(draft).not.toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    expect(
      screen.getAllByRole("region", { name: "Trip overview" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: "Plan activities" }));
    expect(screen.queryByRole("region", { name: "Trip overview" })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Flight planning" }),
    ).toBeNull();
    expect(screen.queryByRole("region", { name: "Trip party" })).toBeNull();
    expect(screen.getByLabelText("Draft")).toBe(draft);
    expect(draft).toBeVisible();
    expect(draft).toHaveValue("Unfinished plan");
    expect(screen.getByText("tokyo-jp")).toBeVisible();
  }
});

test.each([false, true])(
  "Share opens party access from the Overview header when offline is %s",
  async (offline) => {
    render(
      <MemoryRouter initialEntries={["/trips/trip"]}>
        <Routes>
          <Route
            path="/trips/:tripId/*"
            element={<TripPlanningPage userId="owner" offline={offline} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    const share = await screen.findByRole("button", { name: "Share" });
    expect(share.closest(".trip-page-heading")).not.toBeNull();
    expect(share).toBeEnabled();
    fireEvent.click(share);
    expect(screen.getByRole("region", { name: "Trip party" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    expect(screen.getByRole("button", { name: "Share" })).toBeVisible();
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
