import { expect, test } from "vitest";
import type { Trip } from "../../api/api";
import type { Destination } from "../activities/activitiesApi";
import { destinationDates, tripSpansMultipleYears } from "./tripDates";

test.each([
  {
    name: "one calendar year",
    visits: [["2027-06-10", "2027-06-14"]],
    expected: "Jun 10 – Jun 14",
  },
  {
    name: "repeated visits in one year",
    visits: [
      ["2027-06-10", "2027-06-14"],
      ["2027-06-18", "2027-06-20"],
    ],
    expected: "Jun 10 – Jun 14 · Jun 18 – Jun 20",
  },
  {
    name: "a visit across New Year",
    visits: [["2027-12-30", "2028-01-02"]],
    expected: "Dec 30, 2027 – Jan 2, 2028",
  },
  {
    name: "a later visit in another year",
    visits: [
      ["2027-12-20", "2027-12-25"],
      ["2028-01-05", "2028-01-10"],
    ],
    expected: "Dec 20, 2027 – Dec 25, 2027 · Jan 5, 2028 – Jan 10, 2028",
  },
  {
    name: "another destination in a different year",
    visits: [["2027-12-20", "2027-12-25"]],
    otherVisits: [["2028-01-05", "2028-01-10"]],
    expected: "Dec 20, 2027 – Dec 25, 2027",
  },
  {
    name: "trip boundaries across years",
    visits: [["2027-12-20", "2027-12-25"]],
    startDate: "2027-12-20",
    endDate: "2028-01-10",
    expected: "Dec 20, 2027 – Dec 25, 2027",
  },
  {
    name: "one dated endpoint",
    visits: [["2027-06-10", null]],
    expected: "Jun 10 – Dates open",
  },
  {
    name: "a single day",
    visits: [["2027-06-10", "2027-06-10"]],
    expected: "Jun 10",
  },
  {
    name: "undecided dates",
    visits: [[null, null]],
    expected: "Dates to decide",
  },
])("destination years reflect the whole trip: $name", (scenario) => {
  const destination = (visits: (string | null)[][]) =>
    ({
      properties: {
        stays: visits.map(([arrivalDate, departureDate]) => ({
          arrivalDate,
          departureDate,
        })),
      },
    }) as Destination;
  const city = destination(scenario.visits);
  const includeYear = tripSpansMultipleYears(
    { startDate: scenario.startDate, endDate: scenario.endDate } as Trip,
    [city, destination(scenario.otherVisits ?? [])],
  );
  expect(destinationDates(city, includeYear)).toBe(scenario.expected);
});
