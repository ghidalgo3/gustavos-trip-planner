import { expect, test } from "vitest";
import { formatCityLabel } from "./api";

test.each([
  ["Atlanta, Ga.", "Atlanta, GA"],
  ["Boston, Massachusetts, United States", "Boston, MA, United States"],
  ["Paris, France", "Paris, France"],
])("formats city label %s", (input, expected) => {
  expect(formatCityLabel(input)).toBe(expected);
});

test("does not reinterpret a foreign region as a US state", () => {
  expect(formatCityLabel("Tbilisi, Georgia", "GE")).toBe("Tbilisi, Georgia");
});
