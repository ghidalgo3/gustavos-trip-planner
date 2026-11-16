import { expect, test } from "vitest";
import { greatCircle } from "./greatCircle";
import { destinationCamera } from "./destinationFlight";

test("a transatlantic great-circle arc curves north of both airports", () => {
  const from: [number, number] = [-73.778, 40.641];
  const to: [number, number] = [-0.4543, 51.47];
  const lines = greatCircle(from, to);
  expect(lines[0][0]).toEqual(from);
  expect(lines.at(-1)?.at(-1)).toEqual(to);
  expect(Math.max(...lines.flat().map((point) => point[1]))).toBeGreaterThan(
    52,
  );
  expect(lines[0].length).toBeGreaterThan(20);
});

test("a Pacific arc splits at the dateline and fits the Pacific instead of the whole world", () => {
  const from: [number, number] = [140.3929, 35.7719];
  const to: [number, number] = [-122.3088, 47.4502];
  const lines = greatCircle(from, to);
  expect(lines).toHaveLength(2);
  expect(lines[0][0]).toEqual(from);
  expect(lines[1].at(-1)).toEqual(to);
  expect(lines[0].at(-1)?.[0]).toBe(180);
  expect(lines[1][0][0]).toBe(-180);
  expect(lines[0].at(-1)?.[1]).toBeCloseTo(lines[1][0][1], 8);
  for (const line of lines) {
    for (let i = 1; i < line.length; i++)
      expect(Math.abs(line[i][0] - line[i - 1][0])).toBeLessThanOrEqual(180);
  }
  const camera = destinationCamera(
    lines.flat(),
    { width: 800, height: 400 },
    14,
  );
  expect(Math.abs(camera.center[0])).toBeGreaterThan(160);
  expect(camera.zoom).toBeGreaterThan(1);
});

test.each([
  [
    [0, 0],
    [0, 0],
  ],
  [
    [0, 0],
    [180, 0],
  ],
  [
    [0, 90],
    [0, -90],
  ],
  [
    [179, 10],
    [-179, 10],
  ],
])(
  "coincident, antipodal, polar, and dateline endpoints produce finite paths: %j to %j",
  (from, to) => {
    const lines = greatCircle(from as [number, number], to as [number, number]);
    expect(lines.every((line) => line.length >= 2)).toBe(true);
    expect(
      lines
        .flat()
        .every(
          ([longitude, latitude]) =>
            Number.isFinite(longitude) &&
            Math.abs(longitude) <= 180 &&
            Number.isFinite(latitude) &&
            Math.abs(latitude) <= 90,
        ),
    ).toBe(true);
  },
);
