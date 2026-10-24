import { describe, expect, it } from "vitest";
import { durationFromMinutes, durationMinutes } from "./durations";

describe("ISO 8601 durations", () => {
  it.each([
    ["PT0S", 0],
    ["PT1H30M", 90],
    ["PT90M", 90],
    ["P1DT1H", 1500],
    ["PT30S", 0.5],
  ])(
    "displays %s as %s minutes and preserves it through editing",
    (iso, minutes) => {
      expect(durationMinutes(iso)).toBe(minutes);
      expect(durationMinutes(durationFromMinutes(minutes))).toBe(minutes);
    },
  );
  it("keeps unknown durations distinct from zero", () => {
    expect(durationMinutes(null)).toBeNull();
    expect(durationMinutes("PT0S")).toBe(0);
  });
  it.each(["90", "01:30:00", "P1Y", "P1M", "PT", "P"])(
    "rejects unsupported duration %s",
    (value) => {
      expect(() => durationMinutes(value)).toThrow();
    },
  );
});
