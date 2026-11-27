import { expect, test } from "vitest";
import {
  applyEventTiming,
  calendarEntries,
  calendarLayout,
  calendarGestureTiming,
  localMinutes,
  calendarDays,
  withCalendarDay,
  type CalendarEntry,
} from "./activityCalendarModel";
import {
  calendarActivities,
  calendarPlan,
  calendarAssessment,
  calendarDestination,
} from "../../test/activityCalendarFixture";
import { activityRule, unscheduleActivity } from "./activityPlanApi";

test.each([
  ["2027-06-10", "Check-in · Hotel", 960],
  ["2027-06-12", "Check-out · Hotel", 660],
  ["2027-06-11", null, null],
])(
  "stay appointments appear on their own boundary day: %s",
  (date, title, time) => {
    const destination = structuredClone(calendarDestination);
    destination.properties.stays = [
      {
        id: "visit-0",
        order: 0,
        arrivalDate: "2027-06-10",
        departureDate: "2027-06-12",
        arrivalAt: "",
        departureAt: "",
        stayLocation: {
          type: "Feature",
          id: "visit-0",
          geometry: destination.geometry,
          properties: {
            name: "Hotel",
            checkInTime: "16:00:00",
            checkOutTime: "11:00:00",
          },
        },
      },
    ];
    const entries = calendarEntries(
      calendarPlan,
      { ...calendarPlan.days[0], date: date!, activityIds: [] },
      [],
      undefined,
      destination,
    ).filter((entry) => entry.kind === "lodging");
    if (title === null) expect(entries).toEqual([]);
    else expect(entries).toMatchObject([{ title, start: time, end: time }]);
  },
);

test("repeat visits to one hotel retain their own overridden stay times", () => {
  const destination = structuredClone(calendarDestination);
  destination.properties.stays = [0, 1].map((index) => ({
    id: `visit-${index}`,
    order: index,
    arrivalDate: "2027-06-10",
    departureDate: "2027-06-12",
    arrivalAt: "",
    departureAt: "",
    stayLocation: {
      type: "Feature",
      id: `visit-${index}`,
      geometry: destination.geometry,
      properties: {
        name: "Hotel",
        hotelId: "same-hotel",
        checkInTime: index ? "18:30:00" : "16:00:00",
        checkOutTime: "11:00:00",
      },
    },
  }));
  const entries = calendarEntries(
    calendarPlan,
    { ...calendarPlan.days[0], stayId: "visit-1", activityIds: [] },
    [],
    undefined,
    destination,
  ).filter((entry) => entry.kind === "lodging");
  expect(entries).toMatchObject([{ start: 1110, end: 1110 }]);
  const removed = {
    ...destination,
    properties: { ...destination.properties, stays: [] },
  };
  expect(
    calendarEntries(
      calendarPlan,
      { ...calendarPlan.days[0], activityIds: [] },
      [],
      undefined,
      removed,
    ),
  ).toEqual([]);
});

test("changed visit dates add calendar days without moving the older saved schedule", () => {
  const plan = structuredClone(calendarPlan);
  const original = structuredClone(plan);
  const days = calendarDays(plan, [
    {
      stayId: "visit-0",
      arrivalDate: "2026-11-23",
      departureDate: "2026-11-28",
    },
  ]);
  expect(days.filter((day) => day.date.startsWith("2026"))).toHaveLength(6);
  expect(days.filter((day) => day.date.startsWith("2027"))).toEqual(plan.days);
  expect(plan).toEqual(original);
  const added = days.find((day) => day.date === "2026-11-23")!;
  expect(added.activityIds).toEqual([]);
  const updated = withCalendarDay(plan, added);
  expect(updated.days).toContainEqual(added);
  expect(updated.days.filter((day) => day.date.startsWith("2027"))).toEqual(
    plan.days,
  );
  expect(withCalendarDay(updated, added)).toBe(updated);
});

test("visit days retain saved names and distinguish visits sharing a date", () => {
  const plan = structuredClone(calendarPlan);
  plan.days[0].name = "Arrival day";
  const days = calendarDays(plan, [
    {
      stayId: "visit-0",
      arrivalDate: "2027-06-10",
      departureDate: "2027-06-10",
    },
    {
      stayId: "visit-1",
      arrivalDate: "2027-06-10",
      departureDate: "2027-06-10",
    },
  ]);
  expect(days.filter((day) => day.date === "2027-06-10")).toHaveLength(2);
  expect(days.find((day) => day.stayId === "visit-0")).toEqual(plan.days[0]);
});

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

test("unscheduling clears the assignment, time and connected routes while retaining the activity", () => {
  const plan = structuredClone(calendarPlan);
  const day = plan.days[0];
  day.mealPositions = { breakfast: 0, lunch: 1, dinner: 2 };
  plan.rules = [
    {
      ...activityRule(plan, "activity-0"),
      mustDo: true,
      fixedDate: day.date,
      fixedStart: "09:00:00",
      duration: "PT90M",
    },
  ];
  const leg = {
    date: day.date,
    fromActivityId: "activity-0",
    toActivityId: "activity-1",
    mode: "driving",
    duration: "PT15M",
  };
  const remaining = {
    ...leg,
    fromActivityId: "activity-1",
    toActivityId: null,
  };
  plan.transportOverrides = [
    leg,
    remaining,
    { ...leg, fromActivityId: null, toActivityId: "activity-0" },
  ];
  const next = unscheduleActivity(plan, "activity-0");

  expect(next.selectedActivityIds).toEqual(plan.selectedActivityIds);
  expect(next.days[0]).toMatchObject({
    activityIds: ["activity-1"],
    mealPositions: { breakfast: 0, lunch: 0, dinner: 1 },
  });
  expect(next.days[1]).toBe(plan.days[1]);
  expect(next.rules[0]).toMatchObject({
    fixedDate: null,
    fixedStart: null,
    duration: "PT90M",
    mustDo: true,
  });
  expect(next.transportOverrides).toEqual([remaining]);
  expect(unscheduleActivity(next, "activity-0")).toBe(next);
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
  expect(calendarLayout(events).map((entry) => entry.overlaps)).toEqual([
    [{ start: 570, end: 600 }],
    [{ start: 570, end: 600 }],
    [],
  ]);
});

test.each([
  { start: 610, overlap: [{ start: 590, end: 600 }] },
  { start: 660, overlap: [] },
])(
  "inbound travel ends at the activity start ($start), even before assessment refresh",
  ({ start, overlap }) => {
    const entries = calendarEntries(
      calendarPlan,
      calendarPlan.days[0],
      calendarActivities,
      calendarAssessment,
      undefined,
      { activityId: "activity-1", start, end: start + 60 },
    );
    const [museum, travel, garden] = calendarLayout(entries);

    expect(travel).toMatchObject({
      kind: "travel",
      start: start - 20,
      end: start,
      isTravelExtension: true,
      lane: garden.lane,
      lanes: garden.lanes,
      overlaps: overlap,
    });
    expect(museum.overlaps).toEqual(overlap);
    expect(garden).toMatchObject({
      hasTravelExtension: true,
      overlaps: [],
    });
  },
);

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
