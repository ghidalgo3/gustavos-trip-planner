import { expect, test } from "vitest";
import {
  applyEventTiming,
  calendarEntries,
  calendarLayout,
  calendarGestureTiming,
  localMinutes,
  type CalendarEntry,
} from "./activityCalendarModel";
import {
  calendarActivities,
  calendarPlan,
  calendarAssessment,
} from "../../test/activityCalendarFixture";
import { activityRule } from "./activityPlanApi";

test.each([
  ["move", 579, 585, 675],
  ["move", -30, 0, 90],
  ["move", 1450, 1425, 1515],
  ["start", 555, 555, 630],
  ["start", 700, 615, 630],
  ["end", 660, 540, 660],
  ["end", 510, 540, 555],
] as const)(
  "%s to minute %s snaps and bounds the event without changing the opposite edge",
  (mode, minute, start, end) => {
    expect(
      calendarGestureTiming(
        { activityId: "activity-0", start: 540, end: 630 },
        mode,
        minute,
      ),
    ).toEqual({ activityId: "activity-0", start, end });
  },
);

test.each([
  ["2027-06-10T09:00:00+09:00", "2027-06-10", 540],
  ["2027-06-10T09:00:00-07:00", "2027-06-10", 540],
  ["2027-06-11T01:00:00+02:00", "2027-06-10", 1500],
])(
  "positions %s by the destination wall clock",
  (timestamp, date, expected) => {
    expect(localMinutes(timestamp, date)).toBe(expected);
  },
);

test("moving an event across repeat visits schedules it once and retains unrelated data", () => {
  const plan = structuredClone(calendarPlan);
  plan.rules = [
    {
      ...activityRule(plan, "activity-0"),
      mustDo: true,
      alwaysAvailable: true,
      openingWindows: [
        { date: "2027-06-15", start: "08:00:00", end: "19:00:00" },
      ],
    },
  ];
  plan.transportOverrides = [
    {
      date: "2027-06-10",
      fromActivityId: "activity-0",
      toActivityId: "activity-1",
      mode: "walking",
      duration: "PT20M",
    },
    {
      date: "2027-06-15",
      fromActivityId: "activity-1",
      toActivityId: "activity-2",
      mode: "driving",
      duration: "PT10M",
    },
  ];
  const next = applyEventTiming(
    plan,
    "activity-0",
    plan.days[1],
    "14:00",
    "15:30",
    false,
  );
  expect(next.days[0].activityIds).toEqual(["activity-1"]);
  expect(next.days[1].activityIds).toEqual(["activity-0"]);
  expect(next.rules[0]).toMatchObject({
    mustDo: true,
    alwaysAvailable: true,
    openingWindows: plan.rules[0].openingWindows,
    fixedDate: "2027-06-15",
    fixedStart: "14:00:00",
    duration: "PT90M",
  });
  expect(next.settings).toEqual(plan.settings);
  expect(next.transportOverrides).toEqual([plan.transportOverrides[1]]);
  expect(plan.days[0].activityIds).toHaveLength(2);
});

test("timing edits order activities by their start times", () => {
  const next = applyEventTiming(
    calendarPlan,
    "activity-1",
    calendarPlan.days[0],
    "08:00",
    "09:00",
    false,
    calendarAssessment,
  );
  expect(next.days[0].activityIds).toEqual(["activity-1", "activity-0"]);
});

test("date choices distinguish visits sharing a boundary date", () => {
  const plan = structuredClone(calendarPlan);
  plan.days[1].date = plan.days[0].date;
  const next = applyEventTiming(
    plan,
    "activity-0",
    plan.days[1],
    "09:00",
    "10:00",
    false,
  );
  expect(next.days[0].activityIds).toEqual(["activity-1"]);
  expect(next.days[1].activityIds).toEqual(["activity-0"]);
});

test.each([
  ["23:00", "01:00", true, "PT120M"],
  ["09:00", "10:15", false, "PT75M"],
])(
  "stores %s–%s overnight=%s as an ISO duration",
  (start, end, overnight, expected) => {
    const next = applyEventTiming(
      calendarPlan,
      "activity-0",
      calendarPlan.days[0],
      start,
      end,
      overnight,
    );
    expect(activityRule(next, "activity-0").duration).toBe(expected);
  },
);

test.each([
  ["11:00", "10:00"],
  ["09:00", "09:00"],
  ["", "10:00"],
  ["25:00", "10:00"],
])("rejects invalid start/end combinations %s %s", (start, end) => {
  expect(() =>
    applyEventTiming(
      calendarPlan,
      "activity-0",
      calendarPlan.days[0],
      start,
      end,
      false,
    ),
  ).toThrow();
});

test("missing travel evidence remains unknown and opens a selectable connection", () => {
  const assessment = structuredClone(calendarAssessment);
  assessment.days[0].travel = [];
  const entry = calendarEntries(
    calendarPlan,
    calendarPlan.days[0],
    calendarActivities,
    assessment,
  ).find((item) => item.kind === "travel");
  expect(entry?.title).toBe("Choose transport");
  expect(entry?.detail).toBe("Travel time unknown");
  expect(entry?.travel).toMatchObject({
    fromActivityId: "activity-0",
    toActivityId: "activity-1",
  });
});

test("overlapping events use separate columns and later events regain the full width", () => {
  const events: CalendarEntry[] = [
    { id: "1", kind: "activity", title: "One", start: 540, end: 600 },
    { id: "2", kind: "activity", title: "Two", start: 570, end: 620 },
    { id: "3", kind: "activity", title: "Three", start: 630, end: 690 },
  ];
  expect(
    calendarLayout(events).map(({ lane, lanes }) => [lane, lanes]),
  ).toEqual([
    [0, 2],
    [1, 2],
    [0, 1],
  ]);
});

test.each([
  ["2027-03-14", "01:30", "03:30", "PT60M"],
  ["2027-11-07", "00:30", "02:30", "PT180M"],
])(
  "uses actual elapsed time across the daylight-saving transition on %s",
  (date, start, end, expected) => {
    const plan = structuredClone(calendarPlan);
    plan.timeZone = "America/New_York";
    plan.days[0].date = date;
    const next = applyEventTiming(
      plan,
      "activity-0",
      plan.days[0],
      start,
      end,
      false,
    );
    expect(activityRule(next, "activity-0").duration).toBe(expected);
  },
);

test.each([
  ["2027-03-14", "02:30"],
  ["2027-11-07", "01:30"],
])("rejects nonexistent or ambiguous local times on %s", (date, start) => {
  const plan = structuredClone(calendarPlan);
  plan.timeZone = "America/New_York";
  plan.days[0].date = date;
  expect(() =>
    applyEventTiming(plan, "activity-0", plan.days[0], start, "04:00", false),
  ).toThrow("daylight saving time");
});
