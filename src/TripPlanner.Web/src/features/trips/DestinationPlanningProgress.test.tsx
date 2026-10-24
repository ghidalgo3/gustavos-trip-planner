import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import DestinationPlanningProgress from "./DestinationPlanningProgress";
import type {
  DayAssessment,
  PlanResponse,
} from "../activities/activityPlanApi";
import { durationFromMinutes } from "../../shared/time/durations";

function day(available: number, free: number, stayId = "visit"): DayAssessment {
  return {
    stayId,
    date: "2027-06-10",
    availableDuration: durationFromMinutes(available),
    activityDuration: "PT0M",
    travelDuration: "PT0M",
    mealDuration: "PT0M",
    restDuration: "PT0M",
    waitingDuration: "PT0M",
    slackDuration: durationFromMinutes(free + 60),
    requiredSlackDuration: "PT60M",
    overrunDuration: "PT0M",
    entries: [],
    travel: [],
    breaks: [],
  };
}
function response(days: DayAssessment[]): PlanResponse {
  return {
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
      selectedActivityIds: ["activity"],
      excludedActivityIds: [],
      rules: [],
      transportOverrides: [],
      timeZone: "Europe/Paris",
      days: [
        {
          stayId: "visit",
          date: "2027-06-10",
          activityIds: ["activity"],
          settings: null,
          availableFrom: null,
          availableUntil: null,
          availabilityConfirmed: false,
        },
      ],
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
      days,
      status: "fits",
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
}
function show(value: PlanResponse) {
  return render(
    <DestinationPlanningProgress
      response={value}
      stayId="visit"
      name="Paris"
    />,
  );
}

test.each([
  [0, "success"],
  [60, "success"],
  [61, "warning"],
  [80, "warning"],
  [81, "error"],
  [100, "error"],
])("%i percent utilization has the requested color", (percent, color) => {
  show(response([day(600, 600 * (1 - Number(percent) / 100))]));
  const bar = screen.getByRole("progressbar", {
    name: "Planning utilization for Paris",
  });
  expect(Number(bar.getAttribute("aria-valuenow"))).toBeCloseTo(
    Number(percent) / 100,
  );
  expect(bar.parentElement).toHaveAttribute("data-utilization", color);
  expect(bar).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining(`${percent}% utilized`),
  );
});

test("totals all days by available time, reserves slack and excludes other visits", () => {
  show(
    response([
      day(600, 120),
      { ...day(300, 180), date: "2027-06-11" },
      day(1000, 1000, "other"),
    ]),
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    "67% utilized · 5 h free",
  );
});

test.each(["unsaved", "unassigned", "no capacity"])(
  "hides utilization when %s",
  (condition) => {
    const value = response([day(600, 300)]);
    if (condition === "unsaved") value.version = 0;
    if (condition === "unassigned") value.plan.days[0].activityIds = [];
    if (condition === "no capacity") value.assessment.days = [day(0, 0)];
    show(value);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  },
);

test.each(["provisional", "stale"])("labels %s estimates", (condition) => {
  const value = response([day(600, 300)]);
  if (condition === "stale") value.timingStale = true;
  else value.assessment.status = "provisional";
  show(value);
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("(estimated)"),
  );
});

test("overrun days have no free time and the bar never exceeds 100 percent", () => {
  const value = response([{ ...day(600, 20), overrunDuration: "PT30M" }]);
  show(value);
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuetext",
    "100% utilized · 0 h free",
  );
});
