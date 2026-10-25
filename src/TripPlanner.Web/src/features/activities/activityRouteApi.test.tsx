import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { planningRequest, type ActivityPlan } from "./activityPlanApi";
import {
  useActivityRoute,
  type ActivityRouteSelection,
  type ActivityRoutePreview,
} from "./activityRouteApi";
vi.mock("./activityPlanApi", async (original) => ({
  ...(await original<typeof import("./activityPlanApi")>()),
  planningRequest: vi.fn(),
}));
beforeEach(() => vi.mocked(planningRequest).mockReset());
const selection: ActivityRouteSelection = {
  stayId: "visit",
  date: "2027-06-10",
  fromActivityId: "museum",
  toActivityId: "garden",
  mode: "walking",
  duration: "PT10M",
  label: "Travel from Museum to Garden",
  contextVersion: "revision",
  plan: {
    selectedActivityIds: [],
    excludedActivityIds: [],
    days: [],
    rules: [],
    transportOverrides: [],
    timeZone: "Europe/Paris",
    settings: {
      sleepStart: "23:00:00",
      sleepEnd: "07:00:00",
      breakfastDuration: "PT30M",
      lunchDuration: "PT45M",
      dinnerDuration: "PT45M",
      slackDuration: "PT1H",
      transportMode: "fastest",
      airportArrivalBufferDuration: "PT1H",
      airportDepartureBufferDuration: "PT2H",
      airportTransferDuration: "PT1H",
    },
  } satisfies ActivityPlan,
};
const route: ActivityRoutePreview = {
  mode: "driving",
  geometry: {
    type: "MultiLineString",
    coordinates: [
      [
        [2.3, 48.8],
        [2.35, 48.86],
      ],
    ],
  },
};

test("switching or clearing selection aborts requests and ignores stale route responses", async () => {
  let finish!: (value: { data: ActivityRoutePreview; etag: string }) => void;
  vi.mocked(planningRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender } = renderHook(
    ({ selected }: { selected?: ActivityRouteSelection }) =>
      useActivityRoute("trip", "city", selected),
    {
      initialProps: {
        selected: selection as ActivityRouteSelection | undefined,
      },
    },
  );
  expect(result.current.loading).toBe(true);
  const firstSignal = vi.mocked(planningRequest).mock.calls[0][1]!.signal!;
  vi.mocked(planningRequest).mockResolvedValueOnce({ data: route, etag: "" });
  rerender({
    selected: { ...selection, fromActivityId: "garden", toActivityId: null },
  });
  expect(firstSignal.aborted).toBe(true);
  await waitFor(() => expect(result.current.route).toEqual(route));
  await act(async () =>
    finish({ data: { ...route, mode: "walking" }, etag: "" }),
  );
  expect(result.current.route?.mode).toBe("driving");
  rerender({ selected: undefined });
  expect(result.current.route).toBeUndefined();
  expect(result.current.loading).toBe(false);
});

test("reports a failed route request without drawing a guessed path", async () => {
  vi.mocked(planningRequest).mockRejectedValueOnce(
    new Error("No route available"),
  );
  const { result } = renderHook(() =>
    useActivityRoute("trip", "city", selection),
  );
  await waitFor(() => expect(result.current.error).toBe("No route available"));
  expect(result.current.route).toBeUndefined();
  expect(result.current.loading).toBe(false);
});
