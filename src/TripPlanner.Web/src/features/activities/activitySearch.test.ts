import { expect, test } from "vitest";
import { calendarActivities } from "../../test/activityCalendarFixture";
import type { Activity } from "./activitiesApi";
import { activityMatchesSearch } from "./activitySearch";

const activity: Activity = {
  ...calendarActivities[0],
  id: "museum-123",
  geometry: { type: "Point", coordinates: [-71.1, 42.2] },
  properties: {
    ...calendarActivities[0].properties,
    name: "Science Museum",
    description: "Hands-on exhibits",
    notes: "Book ahead",
    kinds: ["Culture", "Family"],
    address: "12 Harbour Street",
    placeName: "Old Town",
    state: "Maybe",
    ticketRequirement: "Required",
    duration: "PT1H30M",
    cost: { amount: 19.5, currency: "USD", basis: "perPerson" },
    links: [{ url: "https://museum.example/tickets", label: "Reservations" }],
    durationEvidence: {
      notes: "Allow time for demonstrations",
      researchedAt: "2030-04-01T12:00:00Z",
      source: { url: "https://guide.example/visit", label: "Visitor guide" },
    },
  },
};

test.each([
  "science",
  "  MUSEUM  ",
  "hands-on",
  "book ahead",
  "family",
  "harbour",
  "old town",
  "maybe",
  "required",
  "PT1H30M",
  "19.5",
  "usd",
  "perperson",
  "museum.example/tickets",
  "reservations",
  "demonstrations",
  "2030-04-01",
  "visitor guide",
  "guide.example/visit",
  "-71.1",
  "museum-123",
  "",
  "   ",
])("searches all activity field values: %j", (query) => {
  expect(activityMatchesSearch(activity, query)).toBe(true);
});

test.each(["unmatched activity", "ticketRequirement", "properties"])(
  "does not match absent values or field names: %s",
  (query) => {
    expect(activityMatchesSearch(activity, query)).toBe(false);
  },
);

test.each([
  ["Maybe", "Maybe"],
  ["Yes", "Planned"],
  ["No", "Not Interested"],
])("searches the displayed label for status %s", (state, label) => {
  expect(
    activityMatchesSearch(
      { ...activity, properties: { ...activity.properties, state } },
      label,
    ),
  ).toBe(true);
});
