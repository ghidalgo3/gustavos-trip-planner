import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import DailyActivityPlan from "./DailyActivityPlan";
import {
  planningRequest,
  previewActivityPlan,
  type ActivityPlan,
  type PlanResponse,
} from "./activityPlanApi";
import { mapsClient } from "../../maps/mapsClient";
import {
  calendarActivities as activities,
  calendarResponse,
  calendarDestination,
} from "../../test/activityCalendarFixture";

vi.mock("../../maps/mapsClient", () => ({
  mapsClient: { estimateTravelTime: vi.fn() },
}));
vi.mock("./activityPlanApi", async (original) => ({
  ...(await original<typeof import("./activityPlanApi")>()),
  planningRequest: vi.fn(),
  previewActivityPlan: vi.fn(),
}));
const props = {
  tripId: "trip",
  destinationId: "paris-fr",
  destination: calendarDestination,
  activities,
  readOnly: false,
  onSelect: vi.fn(),
  onSaved: vi.fn(async () => {}),
};
let response: PlanResponse;
beforeEach(() => {
  vi.resetAllMocks();
  response = structuredClone(calendarResponse);
  vi.mocked(planningRequest).mockImplementation(async (_path, options) => {
    if (options?.method === "PUT")
      response = {
        ...response,
        plan: (options.body as { plan: ActivityPlan }).plan,
        version: response.version + 1,
      };
    return {
      data: structuredClone(response),
      etag: `"${response.version}"`,
    } as never;
  });
  vi.mocked(previewActivityPlan).mockResolvedValue(response.assessment);
});
const writes = () =>
  vi
    .mocked(planningRequest)
    .mock.calls.filter(([, options]) => options?.method === "PUT");

test("renders a time grid with timed events and travel, with planning forms behind event taps", async () => {
  render(<DailyActivityPlan {...props} />);
  const calendar = await screen.findByRole("region", { name: "Day calendar" });
  expect(
    within(calendar).getByRole("button", { name: "Museum" }),
  ).toBeVisible();
  expect(
    within(calendar).getByRole("button", {
      name: "Walking from Museum to Garden",
    }),
  ).toBeVisible();
  expect(within(calendar).getByText("09:00–10:00")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Planning tools" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Event date" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Unscheduled activities" }),
  ).toHaveTextContent("Cafe");
  expect(writes()).toHaveLength(0);
});

test("event timing is a draft until Save, which updates the complete plan with ISO times and concurrency", async () => {
  render(<DailyActivityPlan {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Museum" }));
  expect(screen.getByLabelText("Event start")).toHaveValue("09:00");
  fireEvent.change(screen.getByLabelText("Event start"), {
    target: { value: "08:30" },
  });
  fireEvent.change(screen.getByLabelText("Event end"), {
    target: { value: "10:00" },
  });
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0][1]).toMatchObject({
    etag: '"1"',
    body: {
      contextVersion: "context-1",
      plan: {
        settings: response.plan.settings,
        rules: [
          expect.objectContaining({
            activityId: "activity-0",
            fixedDate: "2027-06-10",
            fixedStart: "08:30:00",
            duration: "PT90M",
          }),
        ],
      },
    },
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

test("cancel discards temporal edits", async () => {
  render(<DailyActivityPlan {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Museum" }));
  fireEvent.change(screen.getByLabelText("Event start"), {
    target: { value: "11:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Museum" }));
  expect(screen.getByLabelText("Event start")).toHaveValue("09:00");
  expect(writes()).toHaveLength(0);
});

test.each(["invalid range", "flight conflict", "stale save"])(
  "retains event edits after %s and allows correction",
  async (failure) => {
    render(<DailyActivityPlan {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "Museum" }));
    fireEvent.change(screen.getByLabelText("Event start"), {
      target: { value: failure === "invalid range" ? "12:00" : "08:00" },
    });
    if (failure === "flight conflict")
      vi.mocked(previewActivityPlan).mockResolvedValueOnce({
        ...response.assessment,
        issues: [
          {
            code: "flight_unavailable",
            severity: "error",
            message: "Flight arrives at noon.",
            date: "2027-06-10",
            activityId: "activity-0",
            duration: null,
          },
        ],
      });
    if (failure === "stale save")
      vi.mocked(planningRequest).mockRejectedValueOnce(
        new Error("Plan changed. Refresh first."),
      );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Event start")).toHaveValue(
      failure === "invalid range" ? "12:00" : "08:00",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    if (failure !== "stale save") expect(writes()).toHaveLength(0);
  },
);

test.each(["driving", "walking"] as const)(
  "chooses %s between events and saves the Azure Maps estimate with the whole resource",
  async (mode) => {
    vi.mocked(mapsClient.estimateTravelTime).mockResolvedValue("PT12M");
    render(<DailyActivityPlan {...props} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Walking from Museum to Garden",
      }),
    );
    fireEvent.change(screen.getByLabelText("Transportation mode"), {
      target: { value: mode },
    });
    expect(screen.getByLabelText("Travel time (minutes)")).toHaveValue(null);
    fireEvent.click(
      screen.getByRole("button", { name: "Calculate travel time" }),
    );
    await screen.findByText("Azure Maps estimate");
    expect(mapsClient.estimateTravelTime).toHaveBeenCalledWith(
      [2.3, 48.8],
      [2.31, 48.8],
      mode,
      expect.any(AbortSignal),
    );
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({
      body: {
        plan: {
          transportOverrides: [
            {
              date: "2027-06-10",
              fromActivityId: "activity-0",
              toActivityId: "activity-1",
              mode,
              duration: "PT12M",
            },
          ],
          days: calendarResponse.plan.days,
        },
      },
    });
  },
);

test("route failure preserves manual travel time and exposes retry", async () => {
  vi.mocked(mapsClient.estimateTravelTime)
    .mockRejectedValueOnce(new Error("Route unavailable."))
    .mockResolvedValueOnce("PT15M");
  render(<DailyActivityPlan {...props} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Walking from Museum to Garden",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Calculate travel time" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Route unavailable.",
  );
  expect(screen.getByLabelText("Travel time (minutes)")).toHaveValue(20);
  fireEvent.click(
    screen.getByRole("button", { name: "Calculate travel time" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Travel time (minutes)")).toHaveValue(15),
  );
});

test("navigation and event details remain usable offline with editing disabled", async () => {
  render(<DailyActivityPlan {...props} readOnly />);
  fireEvent.click(await screen.findByRole("button", { name: "Museum" }));
  expect(screen.getByLabelText("Event start")).toHaveValue("09:00");
  expect(screen.getByLabelText("Event start")).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Save" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Next day" }));
  expect(screen.getByRole("combobox", { name: "Calendar day" })).toHaveValue(
    "visit-1:2027-06-15",
  );
  expect(screen.getByText("No events scheduled")).toBeVisible();
  expect(writes()).toHaveLength(0);
});

test("saving locks the draft and prevents overlapping writes while retaining the calendar", async () => {
  let finish!: (assessment: typeof response.assessment) => void;
  vi.mocked(previewActivityPlan).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<DailyActivityPlan {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Museum" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByLabelText("Event start")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(
    screen.getByRole("region", { name: "Day calendar", hidden: true }),
  ).toBeInTheDocument();
  await act(async () => finish(response.assessment));
  await waitFor(() => expect(writes()).toHaveLength(1));
});

test("a selected unscheduled activity is scheduled exactly once on a chosen visit", async () => {
  render(<DailyActivityPlan {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Schedule Cafe" }));
  fireEvent.change(screen.getByLabelText("Event date"), {
    target: { value: "visit-1:2027-06-15" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  const next = (writes()[0][1]!.body as { plan: ActivityPlan }).plan;
  expect(next.days[1].activityIds).toEqual(["activity-2"]);
  expect(
    next.days
      .flatMap((day) => day.activityIds)
      .filter((id) => id === "activity-2"),
  ).toHaveLength(1);
});

test("going offline aborts calculation and ignores a late route result", async () => {
  let finish!: (duration: string) => void;
  vi.mocked(mapsClient.estimateTravelTime).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(<DailyActivityPlan {...props} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Walking from Museum to Garden",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Calculate travel time" }),
  );
  expect(screen.getByRole("button", { name: "Calculating…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  rerender(<DailyActivityPlan {...props} readOnly />);
  expect(
    vi.mocked(mapsClient.estimateTravelTime).mock.calls[0][3]?.aborted,
  ).toBe(true);
  await act(async () => finish("PT12M"));
  expect(screen.getByLabelText("Travel time (minutes)")).toHaveValue(20);
  expect(
    screen.queryByRole("button", { name: "Save" }),
  ).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

test("missing locations produce an actionable route error without a provider request", async () => {
  render(
    <DailyActivityPlan
      {...props}
      activities={activities.map((item) => ({ ...item, geometry: null }))}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Walking from Museum to Garden",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Calculate travel time" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Set both activity locations",
  );
  expect(mapsClient.estimateTravelTime).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Travel time (minutes)")).toHaveValue(20);
});

test("route preview follows the chosen draft mode without saving it", async () => {
  const selectTravel = vi.fn();
  render(<DailyActivityPlan {...props} onSelectTravel={selectTravel} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Walking from Museum to Garden",
    }),
  );
  fireEvent.change(screen.getByLabelText("Transportation mode"), {
    target: { value: "driving" },
  });
  fireEvent.click(screen.getByRole("button", { name: "View route" }));
  expect(selectTravel).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "driving",
      plan: expect.objectContaining({
        transportOverrides: [
          expect.objectContaining({ mode: "driving", duration: null }),
        ],
      }),
    }),
  );
  expect(writes()).toHaveLength(0);
});
