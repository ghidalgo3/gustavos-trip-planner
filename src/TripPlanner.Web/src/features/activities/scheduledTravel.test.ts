import { expect, test } from "vitest";
import { calendarPlan } from "../../test/activityCalendarFixture";
import { scheduledTravelEntries } from "./scheduledTravel";

const day = calendarPlan.days[0];
const flight = {
  id: "flight-1",
  kind: "flight",
  name: "Flight JL 8",
  destinationVisitId: day.stayId,
  start: "2027-06-09T18:00:00-04:00",
  end: "2027-06-10T20:00:00+09:00",
};

test.each([
  ["Asia/Tokyo", 420, 1200],
  ["Europe/Paris", 0, 780],
  ["America/New_York", 0, 420],
])(
  "shows flights at destination-local times in %s, clipping overnight travel",
  (zone, start, end) => {
    expect(scheduledTravelEntries([flight], day, zone)).toMatchObject([
      { kind: "flight", title: "Flight JL 8", start, end },
    ]);
  },
);

test.each([
  { ...day, date: "2027-06-08" },
  { ...day, date: "2027-06-11" },
  { ...day, stayId: "different-visit" },
])("omits flights outside the date and visit: %s", (otherDay) => {
  expect(scheduledTravelEntries([flight], otherDay, "Asia/Tokyo")).toEqual([]);
});

test("saved transportation uses its timed itinerary entry even with no activities", () => {
  const transportation = { name: "Airport express", notes: "Platform 2" };
  expect(
    scheduledTravelEntries(
      [
        {
          id: "train",
          kind: "transportation",
          name: "Airport express",
          start: "2027-06-10T12:30:00Z",
          duration: "PT45M",
          transportation,
        },
      ],
      { ...day, activityIds: [] },
      "Europe/Paris",
    ),
  ).toMatchObject([
    {
      kind: "transportation",
      title: "Airport express",
      start: 870,
      end: 915,
      transportation,
    },
  ]);
});

test("a midnight arrival only occupies the preceding day", () => {
  expect(
    scheduledTravelEntries(
      [
        {
          ...flight,
          start: "2027-06-09T23:00:00+09:00",
          end: "2027-06-10T00:00:00+09:00",
        },
      ],
      day,
      "Asia/Tokyo",
    ),
  ).toEqual([]);
});

test("travellers on the same flight share one schedule link", () => {
  const entries = scheduledTravelEntries(
    [
      { ...flight, id: "person-one", serviceId: "same-flight" },
      { ...flight, id: "person-two", serviceId: "same-flight" },
    ],
    day,
    "Asia/Tokyo",
  );
  expect(entries).toHaveLength(1);
  expect(entries[0].title).toBe("Flight JL 8");
});
