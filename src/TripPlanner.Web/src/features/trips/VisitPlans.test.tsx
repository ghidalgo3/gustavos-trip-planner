import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import VisitPlans from "./VisitPlans";
import type { Stay } from "../activities/activitiesApi";
import type { PlanResponse } from "../activities/activityPlanApi";

const stay: Stay = {
  id: "visit",
  order: 0,
  arrivalDate: "2027-06-10",
  departureDate: "2027-06-12",
  arrivalAt: "",
  departureAt: "",
};
const planDay = (date: string, activityIds: string[], stayId = "visit") => ({
  stayId,
  date,
  activityIds,
  settings: null,
  availableFrom: null,
  availableUntil: null,
  availabilityConfirmed: false,
});
const response: PlanResponse = {
  version: 1,
  contextVersion: "1",
  timingStale: false,
  savedAssessment: null,
  context: {
    destinationName: "Paris",
    tripInstructions: "",
    destinationInstructions: "",
    suggestedAvailability: [],
  },
  plan: {
    selectedActivityIds: ["museum", "walk", "other"],
    excludedActivityIds: [],
    days: [
      planDay("2027-06-12", ["walk"]),
      planDay("2027-06-10", ["museum"]),
      planDay("2027-06-11", ["other"], "other-visit"),
    ],
    rules: [],
    transportOverrides: [],
    timeZone: "Europe/Paris",
    settings: {
      sleepStart: "23:00:00",
      sleepEnd: "07:00:00",
      breakfastDuration: "PT30M",
      lunchDuration: "PT45M",
      dinnerDuration: "PT45M",
      slackDuration: "PT60M",
      transportMode: "walking",
      airportArrivalBufferDuration: "PT60M",
      airportDepartureBufferDuration: "PT120M",
      airportTransferDuration: "PT60M",
    },
  },
  assessment: {
    status: "fits",
    days: [],
    issues: [],
    travellerFit: [],
    groupUtility: 0,
    evaluatedAt: "2027-06-01T00:00:00Z",
    conflictCount: 0,
    travelDuration: "PT0M",
    overrunDuration: "PT0M",
    evidence: [],
  },
};
const activities = ["museum", "walk", "other"].map((id) => ({
  type: "Feature" as const,
  id,
  geometry: null,
  properties: {
    name: id,
    kinds: ["Culture" as const],
    address: null,
    ticketRequirement: "Unknown" as const,
    state: "Planned",
    description: "",
    notes: "",
    duration: null,
    cost: null,
    placeName: null,
  },
}));
function expand() {
  const button = screen.getByRole("button", {
    name: "Plans for Paris, visit 1",
  });
  fireEvent.click(button);
  return button;
}

test("plans collapse and group saved activities by visit and chronological day", () => {
  render(
    <VisitPlans
      stay={stay}
      name="Paris"
      response={response}
      activities={activities}
      onRetry={vi.fn()}
    />,
  );
  expect(screen.queryByText("museum")).not.toBeInTheDocument();
  const button = expand();
  expect(button).toHaveAttribute("aria-expanded", "true");
  const days = screen.getAllByRole("region");
  expect(days.map((day) => day.getAttribute("aria-label"))).toEqual([
    "2027-06-10",
    "2027-06-11",
    "2027-06-12",
  ]);
  expect(
    within(days[0])
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["Arrive", "museum"]);
  expect(within(days[1]).getByText("No activities scheduled.")).toBeVisible();
  expect(
    within(days[2])
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["walk", "Leave"]);
  expect(screen.queryByText("other")).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});

test.each([0, 1])(
  "a same-day visit includes Arrive and Leave even with plan version %s",
  (version) => {
    render(
      <VisitPlans
        stay={{ ...stay, departureDate: stay.arrivalDate }}
        name="Paris"
        response={{
          ...response,
          version,
          plan: { ...response.plan, days: [] },
        }}
        activities={[]}
        onRetry={vi.fn()}
      />,
    );
    expand();
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["Arrive", "Leave"]);
  },
);

test("undated visits explain how to start the daily plan", () => {
  render(
    <VisitPlans
      stay={{ ...stay, arrivalDate: null, departureDate: null }}
      name="Paris"
      response={{ ...response, version: 0 }}
      activities={[]}
      onRetry={vi.fn()}
    />,
  );
  expand();
  expect(
    screen.getByText("Add visit dates to see plans by day."),
  ).toBeVisible();
});

test("loading uses a daily plan skeleton and a failed request offers retry", () => {
  const retry = vi.fn();
  const view = render(<VisitPlans stay={stay} name="Paris" onRetry={retry} />);
  expand();
  expect(screen.getByLabelText("Loading plans")).toBeVisible();
  view.rerender(
    <VisitPlans stay={stay} name="Paris" response={null} onRetry={retry} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Could not load plans.");
  fireEvent.click(screen.getByRole("button", { name: "Retry plans" }));
  expect(retry).toHaveBeenCalledOnce();
});
