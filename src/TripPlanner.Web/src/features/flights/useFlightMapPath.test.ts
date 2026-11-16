import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { FareLeg } from "../../api/operationsApi";
import { useTripDocumentState } from "../../api/tripDocumentStore";
import { searchAirports, type AirportSuggestion } from "./planningApi";
import { useFlightMapPath } from "./useFlightMapPath";

vi.mock("./planningApi", () => ({ searchAirports: vi.fn() }));
vi.mock("../../api/tripDocumentStore", () => ({
  useTripDocumentState: vi.fn(),
}));
const locations: Record<string, [number, number]> = {
  JFK: [-73.778, 40.641],
  LHR: [-0.4543, 51.47],
  CDG: [2.5479, 49.0097],
  ATL: [-84.4277, 33.6407],
  ORD: [-87.9073, 41.9742],
  HND: [139.7798, 35.5494],
  SYD: [151.1772, -33.9399],
  MEL: [144.843, -37.6733],
  VIE: [16.5697, 48.1103],
  ZRH: [8.5492, 47.4581],
};
function airport(code: string): AirportSuggestion {
  return {
    id: code,
    code,
    name: code,
    city: code,
    country: "US",
    location: { code, timeZone: "UTC" },
    longitude: locations[code]?.[0],
    latitude: locations[code]?.[1],
  };
}
function leg(...codes: string[]): FareLeg {
  return {
    segments: codes.slice(1).map((to, index) => ({
      departure_airport: codes[index],
      arrival_airport: to,
      departure_time_local: "2030-05-01T10:00:00",
      arrival_time_local: "2030-05-01T12:00:00",
    })),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useTripDocumentState).mockReturnValue({
    offline: false,
  } as ReturnType<typeof useTripDocumentState>);
  vi.mocked(searchAirports).mockImplementation(async (code) => [airport(code)]);
});

test("every flown segment has its own great-circle arc and every layover is marked", async () => {
  const flight = leg("JFK", "LHR", "CDG");
  const { result, rerender } = renderHook(
    ({ value }) => useFlightMapPath(value),
    { initialProps: { value: flight } },
  );
  expect(result.current.loading).toBe(true);
  await waitFor(() =>
    expect(result.current.route?.geometry.coordinates).toHaveLength(2),
  );
  const lines = result.current.route!.geometry.coordinates;
  expect(lines[0][0]).toEqual(locations.JFK);
  expect(lines[0].at(-1)).toEqual(locations.LHR);
  expect(lines[1][0]).toEqual(locations.LHR);
  expect(lines[1].at(-1)).toEqual(locations.CDG);
  expect(result.current.landmarks.map((pin) => pin.pin)).toEqual([
    "CDG",
    "JFK",
    "LHR",
  ]);
  expect(result.current.label).toBe("JFK → LHR → CDG");
  const route = result.current.route;
  rerender({ value: { ...flight, carrier: "Another airline" } });
  expect(result.current.route).toBe(route);
  expect(searchAirports).toHaveBeenCalledTimes(3);
});

test("late lookups cannot replace a different hovered flight or reappear after leaving", async () => {
  const pending = new Map<string, (value: AirportSuggestion[]) => void>();
  vi.mocked(searchAirports).mockImplementation(
    (code) => new Promise((resolve) => pending.set(code, resolve)),
  );
  const { result, rerender } = renderHook(
    ({ value }: { value?: FareLeg }) => useFlightMapPath(value),
    {
      initialProps: { value: leg("ATL", "ORD", "HND") as FareLeg | undefined },
    },
  );
  await waitFor(() => expect(pending.size).toBe(3));
  rerender({ value: leg("SYD", "MEL") });
  await waitFor(() => expect(pending.size).toBe(5));
  act(() => {
    for (const code of ["SYD", "MEL"]) pending.get(code)!([airport(code)]);
  });
  await waitFor(() => expect(result.current.route).toBeDefined());
  act(() => {
    for (const code of ["ATL", "ORD", "HND"])
      pending.get(code)!([airport(code)]);
  });
  expect(result.current.landmarks.map((pin) => pin.pin)).toEqual([
    "MEL",
    "SYD",
  ]);
  rerender({ value: undefined });
  expect(result.current.route).toBeUndefined();
  expect(result.current.landmarks).toEqual([]);
  expect(result.current.loading).toBe(false);
});

test("unknown airport coordinates never become a guessed direct route and can be retried", async () => {
  vi.mocked(searchAirports).mockImplementation(async (code) =>
    code === "ZRH" ? [] : [airport(code)],
  );
  const { result } = renderHook(() => useFlightMapPath(leg("VIE", "ZRH")));
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.route).toBeUndefined();
  vi.mocked(searchAirports).mockImplementation(async (code) => [airport(code)]);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.route).toBeDefined());
  expect(result.current.error).toBe(false);
});

test("saved airport geometry previews offline without network calls", () => {
  vi.mocked(useTripDocumentState).mockReturnValue({
    userId: "user",
    tripId: "trip",
    loading: false,
    offline: true,
    document: {
      document: {
        places: [
          {
            iataCode: "BOS",
            location: { type: "Point", coordinates: [-71.0052, 42.3656] },
          },
          {
            iataCode: "YYZ",
            location: { type: "Point", coordinates: [-79.6248, 43.6777] },
          },
        ],
      },
    },
  } as unknown as ReturnType<typeof useTripDocumentState>);
  const { result } = renderHook(() => useFlightMapPath(leg("BOS", "YYZ")));
  expect(result.current.route?.geometry.coordinates).toHaveLength(1);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBe(false);
  expect(searchAirports).not.toHaveBeenCalled();
});
