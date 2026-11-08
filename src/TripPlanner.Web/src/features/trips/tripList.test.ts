import { expect, test } from "vitest";
import type { Trip } from "../../api/api";
import { formatTripDates, localToday, selectTrips } from "./tripList";

function trip(
  name: string,
  startDate?: string | null,
  endDate?: string | null,
): Trip {
  return {
    id: name,
    ownerUserId: "owner",
    name,
    description: "",
    constraints: {},
    createdAt: "",
    updatedAt: "",
    startDate,
    endDate,
  };
}

test("sorts ongoing, nearest future, and undated trips; past trips are most recent first", () => {
  const trips = [
    trip("Undated"),
    trip("Far", "2030-07-01", "2030-07-05"),
    trip("Near", "2030-06-16", "2030-06-18"),
    trip("Ongoing", "2030-06-10", "2030-06-17"),
    trip("Recent past", "2030-06-01", "2030-06-14"),
    trip("Older past", "2030-05-01", "2030-05-10"),
    trip("Today", "2030-06-15", "2030-06-15"),
  ];
  expect(
    selectTrips(trips, "", false, "2030-06-15").map((trip) => trip.name),
  ).toEqual(["Ongoing", "Today", "Near", "Far", "Undated"]);
  expect(
    selectTrips(trips, "", true, "2030-06-15").map((trip) => trip.name),
  ).toEqual(["Recent past", "Older past"]);
  expect(
    selectTrips(trips, " NEAR ", false, "2030-06-15").map((trip) => trip.name),
  ).toEqual(["Near"]);
});

test.each([
  [null, null, undefined],
  ["2030-06-15", "2030-06-15", "Jun 15, 2030"],
  ["2030-06-15", null, "From Jun 15, 2030"],
  [null, "2030-06-18", "Until Jun 18, 2030"],
  ["2030-06-15", "2030-06-18", "Jun 15, 2030 – Jun 18, 2030"],
])("formats partial and complete trip dates %s %s", (start, end, expected) => {
  expect(formatTripDates(trip("Dates", start, end))).toBe(expected);
});

test("uses the browser's local calendar day", () => {
  expect(localToday(new Date(2030, 5, 15, 0, 1))).toBe("2030-06-15");
});
