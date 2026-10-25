import { expect, test } from "vitest";
import { daylight } from "./daylight";

const sapporo = {
  latitude: 43.0618,
  longitude: 141.3545,
  timeZone: "Asia/Tokyo",
};

test("uses Sapporo's date and local time, independently of the browser zone", () => {
  const result = daylight("2026-12-04", sapporo)!;
  expect(result.events.map((e) => [e.name, e.localTime])).toEqual([
    ["Sunrise", "2026-12-04T06:48"],
    ["Sunset", "2026-12-04T16:00"],
  ]);
  const summer = daylight("2026-06-21", sapporo)!;
  expect(summer.events[0].localTime.slice(11) < "04:00").toBe(true);
  expect(summer.events[1].localTime.slice(11) > "19:00").toBe(true);
});

test.each([
  ["Pacific/Kiritimati", 1.8721, -157.4278],
  ["Pacific/Honolulu", 21.3099, -157.8581],
  ["Pacific/Auckland", -36.8509, 174.7645],
])(
  "keeps both events on the requested civil date in %s",
  (timeZone, latitude, longitude) => {
    const events = daylight("2026-12-04", {
      timeZone,
      latitude,
      longitude,
    })!.events;
    expect(events).toHaveLength(2);
    for (const event of events) {
      const parts = new Intl.DateTimeFormat("en", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(event.instant));
      const part = (type: string) => parts.find((p) => p.type === type)!.value;
      expect(`${part("year")}-${part("month")}-${part("day")}`).toBe(
        "2026-12-04",
      );
    }
  },
);

test("applies destination daylight saving on the visit date", () => {
  const nyc = {
    latitude: 40.7128,
    longitude: -74.006,
    timeZone: "America/New_York",
  };
  const before = daylight("2026-03-07", nyc)!.events[0];
  const after = daylight("2026-03-08", nyc)!.events[0];
  expect(before.localTime.slice(11, 13)).toBe("06");
  expect(after.localTime.slice(11, 13)).toBe("07");
  expect(
    (Date.parse(after.instant) - Date.parse(before.instant)) / 3_600_000,
  ).toBeCloseTo(24, 1);
});

test.each([
  ["2026-06-21", "Midnight sun · No sunset"],
  ["2026-12-21", "Polar night · No sunrise"],
])("explains polar conditions on %s without fabricated times", (date, note) => {
  expect(
    daylight(date, {
      latitude: 69.6492,
      longitude: 18.9553,
      timeZone: "Europe/Oslo",
    }),
  ).toEqual({ events: [], note });
});

test.each([
  { ...sapporo, timeZone: null },
  { ...sapporo, timeZone: "invalid" },
  { ...sapporo, latitude: NaN },
  { ...sapporo, latitude: 91 },
  { ...sapporo, longitude: 181 },
])("omits times for unusable location metadata: %j", (location) => {
  expect(daylight("2026-12-04", location)).toBeUndefined();
});
