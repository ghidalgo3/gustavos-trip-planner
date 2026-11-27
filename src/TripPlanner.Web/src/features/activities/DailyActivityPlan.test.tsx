import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { createRef } from "react";
import DailyActivityPlan from "./DailyActivityPlan";
import { useTripResourceVersion } from "../../api/tripDocumentStore";
vi.mock("../../api/tripDocumentStore", async (original) => ({
  ...(await original<typeof import("../../api/tripDocumentStore")>()),
  useTripResourceVersion: vi.fn(),
}));
import {
  planningRequest,
  previewActivityPlan,
  type ActivityPlan,
  type PlanResponse,
  type Versioned,
} from "./activityPlanApi";
import { estimateTransportation } from "../trips/transportationApi";
import {
  calendarActivities as activities,
  calendarResponse,
  calendarDestination,
} from "../../test/activityCalendarFixture";

vi.mock("../trips/transportationApi", () => ({
  estimateTransportation: vi.fn(),
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
  onScheduleError: vi.fn(),
};
const routeGeometry = {
  type: "MultiLineString" as const,
  coordinates: [
    [
      [2.3, 48.8],
      [2.3, 48.81],
      [2.31, 48.8],
    ],
  ] as [number, number][][],
};
function estimate(duration: string) {
  return { data: { duration, geometry: routeGeometry }, etag: "" };
}
let response: PlanResponse;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useTripResourceVersion).mockReturnValue(0);
  response = structuredClone(calendarResponse);
  vi.mocked(planningRequest).mockImplementation(async (path, options) => {
    if (path.endsWith("/route-previews"))
      return {
        data: { mode: "walking", geometry: routeGeometry },
        etag: "",
      } as never;
    if (options?.method === "PUT")
      response = {
        ...response,
        plan: (options.body as { plan: ActivityPlan }).plan,
        version: response.version + 1,
        timingStale: false,
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

test.each(["calendar", "outside", "read-only"] as const)(
  "dragging an activity pin onto %s saves only a valid calendar drop",
  async (target) => {
    const mapPanel = createRef<HTMLDivElement>();
    const onPinClick = vi.fn();
    const readOnly = target === "read-only";
    render(
      <>
        <div ref={mapPanel}>
          <button data-calendar-activity-id="activity-2" onClick={onPinClick}>
            Select Cafe
          </button>
        </div>
        <DailyActivityPlan {...props} mapPanel={mapPanel} readOnly={readOnly} />
      </>,
    );
    const grid = await screen.findByRole("region", {
      name: "Day calendar",
      busy: false,
    });
    const events = grid.querySelector(".calendar-events")!;
    vi.spyOn(events, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 0, 400, 2160),
    );
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 700, 400, 500),
    );
    const pin = screen.getByRole("button", { name: "Select Cafe" });
    const capture = vi.fn();
    pin.setPointerCapture = capture;
    const cursor = { pointerId: 1, isPrimary: true, clientY: 813 };

    fireEvent.pointerDown(pin, { ...cursor, clientX: 650 });
    const clientX = target === "outside" ? 560 : 240;
    fireEvent.pointerMove(pin, { ...cursor, clientX });
    if (target === "calendar") {
      expect(grid.querySelector(".calendar-drag-preview")).toHaveTextContent(
        "Cafe09:00–10:00",
      );
    } else {
      expect(grid.querySelector(".calendar-drag-preview")).toBeNull();
    }
    fireEvent.pointerUp(pin, { ...cursor, clientX });
    fireEvent.click(pin);

    if (target === "calendar") {
      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(response.plan.days[0].activityIds).toContain("activity-2");
      expect(response.plan.rules).toContainEqual(
        expect.objectContaining({
          activityId: "activity-2",
          fixedStart: "09:00:00",
          duration: "PT60M",
        }),
      );
    } else {
      expect(writes()).toHaveLength(0);
    }
    expect(capture).toHaveBeenCalledTimes(readOnly ? 0 : 1);
    expect(onPinClick).toHaveBeenCalledTimes(readOnly ? 1 : 0);
  },
);

test("a late calendar response cannot replace the selected destination", async () => {
  let finishParis!: (value: Versioned<PlanResponse>) => void;
  const paris = new Promise<Versioned<PlanResponse>>((resolve) => {
    finishParis = resolve;
  });
  const london = structuredClone(response);
  const londonDay = {
    ...london.plan.days[0],
    stayId: "london-stay",
    date: "2027-06-20",
    activityIds: [],
  };
  london.plan.days = [londonDay];
  london.context.visits = [
    {
      stayId: londonDay.stayId,
      arrivalDate: londonDay.date,
      departureDate: londonDay.date,
    },
  ];
  vi.mocked(planningRequest)
    .mockImplementationOnce(() => paris as never)
    .mockResolvedValueOnce({ data: london, etag: '"london"' });

  const { rerender } = render(<DailyActivityPlan {...props} />);
  rerender(
    <DailyActivityPlan
      {...props}
      destinationId="london-gb"
      destination={{ ...calendarDestination, id: "london-gb" }}
    />,
  );
  const picker = screen.getByRole("combobox", { name: "Calendar day" });
  await waitFor(() => expect(picker).toHaveValue("london-stay:2027-06-20"));

  await act(async () => finishParis({ data: response, etag: '"paris"' }));
  expect(picker).toHaveValue("london-stay:2027-06-20");
});

test("reports selected-day order and all assigned activities to the map", async () => {
  const assigned = ["activity-2", "activity-1", "activity-0"];
  response.plan.days[0].activityIds = assigned;
  const onMapScheduleChange = vi.fn();
  render(
    <DailyActivityPlan {...props} onMapScheduleChange={onMapScheduleChange} />,
  );
  await screen.findByRole("region", { name: "Day calendar", busy: false });
  expect(onMapScheduleChange).toHaveBeenLastCalledWith({
    activeActivityIds: ["activity-0", "activity-1", "activity-2"],
    scheduledActivityIds: assigned,
  });

  fireEvent.click(screen.getByRole("button", { name: "Next day" }));
  expect(onMapScheduleChange).toHaveBeenLastCalledWith({
    activeActivityIds: [],
    scheduledActivityIds: assigned,
  });
  fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
  expect(onMapScheduleChange).toHaveBeenLastCalledWith({
    activeActivityIds: ["activity-0", "activity-1", "activity-2"],
    scheduledActivityIds: assigned,
  });

  const search = screen.getByRole("searchbox", {
    name: "Search schedule activities",
  });
  fireEvent.change(search, { target: { value: "Cafe" } });
  const cafe = screen.getByRole("button", { name: "Schedule Cafe" });
  expect(within(cafe).getByText("3")).toBeVisible();
  expect(cafe).toHaveAccessibleDescription("Activity 3");
  expect(writes()).toHaveLength(0);
});

test("refreshing the trip after a visit edit removes invalidated calendar assignments", async () => {
  const view = render(<DailyActivityPlan {...props} />);
  expect(await screen.findByRole("button", { name: "Museum" })).toBeVisible();
  response.plan.days = [];
  response.plan.rules = response.plan.rules.map((rule) => ({
    ...rule,
    fixedDate: null,
    fixedStart: null,
  }));
  response.context.visits = [
    {
      stayId: "visit-0",
      arrivalDate: "2027-06-20",
      departureDate: "2027-06-22",
    },
  ];
  response.version++;
  vi.mocked(useTripResourceVersion).mockReturnValue(1);
  view.rerender(<DailyActivityPlan {...props} />);
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Calendar day" })).toHaveValue(
      "visit-0:2027-06-20",
    ),
  );
  expect(screen.queryByRole("button", { name: "Museum" })).toBeNull();
  expect(
    screen.getByRole("region", { name: "Unscheduled activities" }),
  ).toHaveTextContent("Museum");
  expect(writes()).toHaveLength(0);
});

test.each([false, true])(
  "changed visit dates are reachable by default without rewriting the saved plan (read only: %s)",
  async (readOnly) => {
    response.context.visits = [
      {
        stayId: "visit-0",
        arrivalDate: "2026-11-23",
        departureDate: "2026-11-28",
      },
    ];
    render(<DailyActivityPlan {...props} readOnly={readOnly} />);
    const date = await screen.findByRole("combobox", { name: "Calendar day" });
    expect(date).toHaveValue("visit-0:2026-11-23");
    expect(within(date).getAllByRole("option")).toHaveLength(8);
    fireEvent.change(date, { target: { value: "visit-0:2027-06-10" } });
    expect(await screen.findByRole("button", { name: "Museum" })).toBeVisible();
    expect(writes()).toHaveLength(0);
  },
);

test("scheduling on a new visit date adds that day while retaining other saved days", async () => {
  response.context.visits = [
    {
      stayId: "visit-0",
      arrivalDate: "2026-11-23",
      departureDate: "2026-11-28",
    },
  ];
  render(<DailyActivityPlan {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Schedule Cafe" }));
  expect(screen.getByLabelText("Event date")).toHaveValue("visit-0:2026-11-23");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  const next = (writes()[0][1]!.body as { plan: ActivityPlan }).plan;
  expect(next.days).toHaveLength(3);
  expect(
    next.days.find((day) => day.date === "2026-11-23")?.activityIds,
  ).toEqual(["activity-2"]);
  expect(
    next.days.find((day) => day.date === "2027-06-10")?.activityIds,
  ).toEqual(["activity-0", "activity-1"]);
});

test("renders a time grid with timed events and travel, with planning forms behind event taps", async () => {
  render(<DailyActivityPlan {...props} />);
  const calendar = await screen.findByRole("region", {
    name: "Day calendar",
    busy: false,
  });
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

test("the drawer can unschedule an activity and retry a failed save", async () => {
  render(<DailyActivityPlan {...props} />);
  const calendar = await screen.findByRole("region", {
    name: "Day calendar",
    busy: false,
  });
  fireEvent.click(within(calendar).getByRole("button", { name: "Garden" }));
  vi.mocked(planningRequest).mockRejectedValueOnce(
    new Error("Schedule unavailable."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Unschedule" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Schedule unavailable.",
  );
  expect(calendar).toHaveTextContent("Garden");
  expect(screen.getByRole("dialog", { name: "Garden" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Unschedule" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    within(calendar).queryByRole("button", { name: "Garden" }),
  ).not.toBeInTheDocument();
  const unscheduled = screen.getByRole("region", {
    name: "Unscheduled activities",
  });
  fireEvent.click(
    within(unscheduled).getByRole("button", { name: "Schedule Garden" }),
  );
  expect(
    screen.queryByRole("button", { name: "Unschedule" }),
  ).not.toBeInTheDocument();
  expect(writes()).toHaveLength(2);
  expect(writes()[1][1]).toMatchObject({
    etag: '"1"',
    body: {
      plan: {
        selectedActivityIds: calendarResponse.plan.selectedActivityIds,
        days: [
          { ...calendarResponse.plan.days[0], activityIds: ["activity-0"] },
          calendarResponse.plan.days[1],
        ],
      },
    },
  });
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

test.each([
  ["driving", "10:30"],
  ["walking", null],
] as const)(
  "saves %s to the activity with time change %s in one plan update",
  async (mode, start) => {
    vi.mocked(estimateTransportation).mockResolvedValue(estimate("PT12M"));
    if (mode === "walking")
      response.assessment.days[0].travel[0].mode = "driving";
    const onTravelMapChange = vi.fn();
    const onMapScheduleChange = vi.fn();
    render(
      <DailyActivityPlan
        {...props}
        onTravelMapChange={onTravelMapChange}
        onMapScheduleChange={onMapScheduleChange}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Garden" }));
    const drawer = screen.getByRole("dialog", { name: "Garden" });
    expect(within(drawer).getByLabelText("Event start")).toHaveValue("10:20");
    if (start)
      fireEvent.change(within(drawer).getByLabelText("Event start"), {
        target: { value: start },
      });
    fireEvent.click(
      within(drawer).getByText("Transportation", { exact: true }),
    );
    fireEvent.change(screen.getByLabelText("Transportation mode"), {
      target: { value: mode },
    });
    expect(screen.getByLabelText("Travel time (minutes)")).toHaveValue(null);
    await waitFor(() =>
      expect(screen.getByLabelText("Travel time (minutes)")).toHaveValue(12),
    );
    expect(estimateTransportation).toHaveBeenCalledWith(
      "trip",
      activities[0].geometry,
      activities[1].geometry,
      mode === "walking" ? "walk" : "car",
      expect.any(AbortSignal),
      expect.any(String),
    );
    expect(onTravelMapChange).toHaveBeenLastCalledWith({
      mode,
      geometry: routeGeometry,
    });
    expect(drawer.querySelector(".activity-map-shell")).toBeNull();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    await waitFor(() =>
      expect(onMapScheduleChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          routes: new Map([
            ["activity-0:activity-1", { mode, geometry: routeGeometry }],
          ]),
        }),
      ),
    );
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
          rules: start
            ? [
                expect.objectContaining({
                  activityId: "activity-1",
                  fixedStart: "10:30:00",
                  duration: "PT50M",
                }),
              ]
            : [],
        },
      },
    });
  },
);

test("transport edits follow the current connection when an activity is reordered", async () => {
  render(<DailyActivityPlan {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Garden" }));
  fireEvent.click(screen.getByText("Transportation", { exact: true }));
  fireEvent.change(screen.getByLabelText("Travel time (minutes)"), {
    target: { value: "15" },
  });
  fireEvent.change(screen.getByLabelText("Event start"), {
    target: { value: "08:00" },
  });
  expect(
    screen.queryByText("Transportation", { exact: true }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  const next = (writes()[0][1]!.body as { plan: ActivityPlan }).plan;
  expect(next.days[0].activityIds).toEqual(["activity-1", "activity-0"]);
  expect(next.transportOverrides).toEqual([]);
});

test("the last activity drawer can edit the return to the stay separately", async () => {
  vi.mocked(estimateTransportation).mockResolvedValue(estimate("PT12M"));
  const destination = structuredClone(calendarDestination);
  destination.properties.stays = [
    {
      id: "visit-0",
      order: 0,
      arrivalDate: "2027-06-10",
      departureDate: "2027-06-12",
      arrivalAt: "",
      departureAt: "",
      stayLocation: {
        type: "Feature",
        id: "visit-0",
        geometry: destination.geometry,
        properties: {
          name: "Hotel",
          checkInTime: "16:00:00",
          checkOutTime: "11:00:00",
        },
      },
    },
  ];
  render(<DailyActivityPlan {...props} destination={destination} />);
  fireEvent.click(await screen.findByRole("button", { name: "Garden" }));
  fireEvent.click(screen.getByText("Return to stay", { exact: true }));
  const section = within(
    screen.getByRole("group", { name: "Return to stay details" }),
  );
  fireEvent.change(section.getByLabelText("Transportation mode"), {
    target: { value: "walking" },
  });
  const minutes = section.getByLabelText("Travel time (minutes)");
  await waitFor(() => expect(minutes).toHaveValue(12));
  fireEvent.change(minutes, { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  const next = (writes()[0][1]!.body as { plan: ActivityPlan }).plan;
  expect(next.rules).toEqual([]);
  expect(next.transportOverrides).toEqual([
    {
      date: "2027-06-10",
      fromActivityId: "activity-1",
      toActivityId: null,
      mode: "walking",
      duration: "PT15M",
    },
  ]);
});

test("a failed automatic route can be retried without losing a manual allowance", async () => {
  vi.mocked(estimateTransportation)
    .mockRejectedValueOnce(new Error("Route unavailable."))
    .mockRejectedValueOnce(new Error("Route still unavailable."))
    .mockResolvedValueOnce(estimate("PT15M"));
  render(<DailyActivityPlan {...props} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Walking from Museum to Garden",
    }),
  );
  fireEvent.change(screen.getByLabelText("Transportation mode"), {
    target: { value: "driving" },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Route unavailable.",
  );

  const minutes = screen.getByLabelText("Travel time (minutes)");
  fireEvent.change(minutes, { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Retry route" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Route still unavailable.",
  );
  expect(minutes).toHaveValue(20);
  fireEvent.click(screen.getByRole("button", { name: "Retry route" }));
  await waitFor(() => expect(minutes).toHaveValue(15));
});

test("navigation and event details remain usable offline with editing disabled", async () => {
  render(<DailyActivityPlan {...props} readOnly />);
  fireEvent.click(await screen.findByRole("button", { name: "Museum" }));
  expect(screen.getByLabelText("Event start")).toHaveValue("09:00");
  expect(screen.getByLabelText("Event start")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Unschedule" })).toBeDisabled();
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
  let finish!: (value: ReturnType<typeof estimate>) => void;
  vi.mocked(estimateTransportation).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onTravelMapChange = vi.fn();
  const { rerender } = render(
    <DailyActivityPlan {...props} onTravelMapChange={onTravelMapChange} />,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Walking from Museum to Garden",
    }),
  );
  fireEvent.change(screen.getByLabelText("Transportation mode"), {
    target: { value: "driving" },
  });
  expect(screen.getByLabelText("Travel time (minutes)")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  rerender(
    <DailyActivityPlan
      {...props}
      onTravelMapChange={onTravelMapChange}
      readOnly
    />,
  );
  expect(vi.mocked(estimateTransportation).mock.calls[0][4]?.aborted).toBe(
    true,
  );
  await act(async () => finish(estimate("PT12M")));
  expect(screen.getByLabelText("Travel time (minutes)")).toHaveValue(null);
  expect(onTravelMapChange).not.toHaveBeenCalled();
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
  fireEvent.change(screen.getByLabelText("Transportation mode"), {
    target: { value: "driving" },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Set both locations",
  );
  expect(estimateTransportation).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Travel time (minutes)")).toBeEnabled();
});

test("switching travel modes ignores stale results and cancel discards the preview", async () => {
  let finish!: (value: ReturnType<typeof estimate>) => void;
  vi.mocked(estimateTransportation)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(estimate("PT15M"));
  const onTravelMapChange = vi.fn();
  render(
    <DailyActivityPlan {...props} onTravelMapChange={onTravelMapChange} />,
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Walking from Museum to Garden",
    }),
  );
  const mode = screen.getByLabelText("Transportation mode");
  fireEvent.change(mode, { target: { value: "driving" } });
  fireEvent.change(mode, { target: { value: "walking" } });
  await waitFor(() =>
    expect(screen.getByLabelText("Travel time (minutes)")).toHaveValue(15),
  );
  expect(vi.mocked(estimateTransportation).mock.calls[0][4]?.aborted).toBe(
    true,
  );
  await act(async () => finish(estimate("PT3M")));
  expect(screen.getByLabelText("Travel time (minutes)")).toHaveValue(15);
  expect(onTravelMapChange).toHaveBeenLastCalledWith({
    mode: "walking",
    geometry: routeGeometry,
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onTravelMapChange).toHaveBeenLastCalledWith(undefined);
  expect(writes()).toHaveLength(0);
});

test("opening a saved schedule loads its street route without changing the travel time", async () => {
  response.plan.transportOverrides = [
    {
      date: "2027-06-10",
      fromActivityId: "activity-0",
      toActivityId: "activity-1",
      mode: "walking",
      duration: "PT12M",
    },
  ];
  const onMapScheduleChange = vi.fn();
  render(
    <DailyActivityPlan {...props} onMapScheduleChange={onMapScheduleChange} />,
  );
  await waitFor(() =>
    expect(onMapScheduleChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        routes: new Map([
          [
            "activity-0:activity-1",
            { mode: "walking", geometry: routeGeometry },
          ],
        ]),
      }),
    ),
  );
  expect(screen.getByText("12 min", { exact: false })).toBeVisible();
  expect(writes()).toHaveLength(0);
  expect(estimateTransportation).not.toHaveBeenCalled();
});

test.each(["planned", "open"])(
  "confirms a day as %s from Day details",
  async (kind) => {
    const [first] = response.plan.days;
    const second = {
      ...first,
      date: "2027-06-11",
      activityIds: ["activity-2"],
    };
    const open = { ...first, date: "2027-06-12", activityIds: [] };
    response.plan.days = [first, second, open];
    response.plan.rules = [
      {
        activityId: "activity-2",
        fixedStart: "14:00:00",
        fixedDate: second.date,
        duration: "PT1H",
        mustDo: false,
        afterActivityId: null,
        coversMeal: null,
        alwaysAvailable: true,
        openingWindows: [],
        closedDates: [],
      },
    ];
    const visit = {
      id: first.stayId,
      order: 0,
      arrivalDate: first.date,
      departureDate: open.date,
      arrivalAt: "",
      departureAt: "",
    };
    response.context.visits = [{ stayId: visit.id, ...visit }];
    const destination = {
      ...calendarDestination,
      properties: { ...calendarDestination.properties, stays: [visit] },
    };
    render(
      <DailyActivityPlan
        {...props}
        destination={destination}
        tripCalendar={{
          destinations: [destination],
          initialDayKey: `${visit.id}:${kind === "planned" ? first.date : open.date}`,
          onDestinationDay: vi.fn(),
        }}
      />,
    );
    const details = await screen.findByRole("button", { name: "Day details" });
    expect(screen.queryByRole("button", { name: "Review days" })).toBeNull();
    fireEvent.click(details);
    const dialog = await screen.findByRole("dialog", { name: "Day details" });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: kind === "planned" ? "Mark day planned" : "Keep day open",
      }),
    );
    expect(
      await within(dialog).findByText(
        kind === "planned" ? "Day planned" : "Open by choice",
      ),
    ).toBeVisible();
    expect(writes()).toHaveLength(1);
    expect(response.plan.days.filter((day) => day.review)).toHaveLength(1);
    expect(previewActivityPlan).not.toHaveBeenCalled();
  },
);

test.each(["current", "stale", "read-only", "inactive"])(
  "refreshes timing automatically only when editing an active stale schedule (%s)",
  async (condition) => {
    response.timingStale = condition !== "current";
    const savedPlan = structuredClone(response.plan);
    render(
      <DailyActivityPlan
        {...props}
        readOnly={condition === "read-only"}
        active={condition !== "inactive"}
      />,
    );
    await screen.findByRole("button", { name: "Museum" });
    if (condition === "stale") {
      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(writes()[0][1]).toMatchObject({
        etag: '"1"',
        body: { plan: savedPlan, contextVersion: "context-1" },
      });
    } else {
      expect(writes()).toHaveLength(0);
    }
    expect(screen.queryByRole("button", { name: "Update times" })).toBeNull();
  },
);

test("keeps the calendar and retries failed timing refreshes against the latest plan", async () => {
  response.timingStale = true;
  const request = vi.mocked(planningRequest).getMockImplementation()!;
  vi.mocked(planningRequest).mockImplementation((path, options) => {
    if (options?.method === "PUT" && writes().length === 1)
      return Promise.reject(new Error("The planning inputs changed."));
    return request(path, options);
  });
  render(<DailyActivityPlan {...props} />);
  const problem = await screen.findByRole("alert");
  expect(problem).toHaveTextContent("Couldn’t update schedule times.");
  expect(screen.getByRole("button", { name: "Museum" })).toBeEnabled();
  expect(writes()).toHaveLength(1);

  response.version = 2;
  response.contextVersion = "context-2";
  fireEvent.click(within(problem).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1][1]).toMatchObject({
    etag: '"2"',
    body: { contextVersion: "context-2" },
  });
  expect(screen.queryByText(/Couldn’t update schedule times/)).toBeNull();
});

test.each([0, 5, 7])(
  "shows up to five of %i relevant notices after filtering and opens the rest in a drawer",
  async (count) => {
    response.assessment.issues = Array.from({ length: count }, (_, index) => ({
      code: index === count - 1 ? "opening_window" : "notice",
      severity: index === count - 1 ? "conflict" : "provisional",
      message: `Notice ${index + 1}`,
      date: index % 2 ? response.plan.days[0].date : null,
      activityId: null,
      duration: null,
    }));
    const otherDay = {
      code: "other-day",
      severity: "conflict",
      message: "Only on the other date",
      date: response.plan.days[1].date,
      activityId: null,
      duration: null,
    };
    const hiddenNotices = [
      {
        ...otherDay,
        code: "unscheduled",
        severity: "incomplete",
        message: "Cafe is selected but has no day.",
        date: null,
        activityId: "activity-2",
      },
      {
        ...otherDay,
        code: "hours_unknown",
        severity: "provisional",
        message:
          "Opening hours for Museum have not been verified for this date.",
        date: response.plan.days[0].date,
        activityId: "activity-0",
      },
    ];
    response.assessment.issues.unshift(...hiddenNotices);
    response.assessment.issues.push(otherDay);
    render(<DailyActivityPlan {...props} readOnly />);
    await screen.findByRole("button", { name: "Museum" });
    const notices = screen.queryByRole("region", { name: "Schedule notices" });
    expect(screen.queryByText(otherDay.message)).toBeNull();
    for (const { message } of hiddenNotices)
      expect(screen.queryByText(message)).toBeNull();
    expect(
      within(
        screen.getByRole("region", { name: "Unscheduled activities" }),
      ).getByRole("button", { name: "Schedule Cafe" }),
    ).toBeVisible();
    if (!count) expect(notices).toBeNull();
    if (notices) {
      const items = within(notices).getAllByRole("listitem");
      expect(items).toHaveLength(Math.min(5, count));
      expect(items[0]).toHaveTextContent(`Notice ${count}`);
    }
    if (count <= 5) {
      expect(
        screen.queryByRole("button", { name: /View .* more notice/ }),
      ).toBeNull();
    } else {
      expect(screen.queryByText("Notice 5")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "View 2 more notices" }),
      );
      const drawer = await screen.findByRole("dialog", {
        name: "More schedule notices",
      });
      expect(
        within(drawer)
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["Notice 5", "Notice 6"]);
    }
  },
);
