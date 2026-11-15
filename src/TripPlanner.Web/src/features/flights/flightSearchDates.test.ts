import { expect, test } from "vitest";
import type { Destination } from "../activities/activitiesApi";
import { pastDestinationDateIssues } from "./flightSearchDates";

function destination(
  arrivalDate: string | null,
  departureDate: string | null,
  timeZone: string | null = "Europe/Amsterdam",
): Destination {
  return {
    type: "Feature",
    id: "amsterdam",
    geometry: { type: "Point", coordinates: [4.9, 52.37] },
    properties: {
      name: "Amsterdam",
      countryCode: "NL",
      timeZone,
      contextVersion: "1",
      isActive: true,
      arrivalDate,
      departureDate,
      constraints: { arrivalFlexibilityDays: 5, departureFlexibilityDays: 5 },
      stays: [
        {
          id: "visit",
          order: 0,
          arrivalDate,
          departureDate,
          arrivalAt: "",
          departureAt: "",
        },
      ],
    },
  };
}

test.each([
  ["2026-11-13", "2026-11-16", true],
  [null, "2026-11-13", true],
  ["2026-11-13", null, true],
  ["2026-11-14", "2026-11-16", false],
  [null, "2026-11-14", false],
  ["2026-11-15", "2026-11-16", false],
  [null, null, false],
])(
  "checks both destination dates regardless of flexibility: %s–%s, expired=%s",
  (arrival, departure, expired) => {
    const issues = pastDestinationDateIssues(
      [destination(arrival, departure)],
      [],
      new Date("2026-11-14T12:00:00Z"),
    );
    expect(issues).toEqual(
      expired
        ? [
            {
              code: "pastDestinationDates",
              message:
                "Destination Amsterdam's dates are in the past, you must plan a future trip",
              partyId: null,
              constraintIds: ["visit"],
            },
          ]
        : [],
    );
  },
);

test.each(["Europe/Amsterdam", null])(
  "compares with the destination's local day using its place or flight time zone (%s)",
  (timeZone) => {
    const issues = pastDestinationDateIssues(
      [destination("2026-11-14", "2026-11-16", timeZone)],
      [
        {
          id: "visit",
          location: { code: "AMS", timeZone: "Europe/Amsterdam" },
          presentFrom: "2026-11-14",
          presentThrough: "2026-11-16",
          nights: null,
          afterVisitIds: [],
        },
      ],
      new Date("2026-11-14T23:30:00Z"),
    );
    expect(issues).toHaveLength(1);
  },
);
