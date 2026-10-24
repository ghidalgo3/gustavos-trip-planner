import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DailyActivityPlan from "./DailyActivityPlan";
import {
  chooseActivity,
  moveActivity,
  planningRequest,
  previewActivityPlan,
  type ActivityPlan,
  type PlanResponse,
  type PlanResult,
} from "./activityPlanApi";

vi.mock("./activityPlanApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./activityPlanApi")>()),
  planningRequest: vi.fn(),
  previewActivityPlan: vi.fn(),
}));
const first = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  second = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const plan: ActivityPlan = {
  selectedActivityIds: [first, second],
  excludedActivityIds: [],
  days: [
    {
      stayId: "visit-1",
      date: "2027-06-10",
      activityIds: [first, second],
      settings: null,
      availableFrom: null,
      availableUntil: null,
      availabilityConfirmed: true,
    },
    {
      stayId: "visit-2",
      date: "2027-06-15",
      activityIds: [],
      settings: null,
      availableFrom: null,
      availableUntil: null,
      availabilityConfirmed: true,
    },
  ],
  settings: {
    sleepStart: "23:00:00",
    sleepEnd: "07:00:00",
    breakfastDuration: "PT30M",
    lunchDuration: "PT45M",
    dinnerDuration: "PT45M",
    slackDuration: "PT60M",
    transportMode: "walking",
    airportArrivalBufferDuration: "PT60M",
    airportDepartureBufferDuration: "PT120M",
    airportTransferDuration: "PT60M",
  },
  rules: [],
  transportOverrides: [],
  timeZone: "Europe/Paris",
};
const response: PlanResponse = {
  plan,
  version: 1,
  contextVersion: "context-1",
  timingStale: false,
  savedAssessment: null,
  context: {
    destinationName: "Paris",
    tripInstructions: "",
    destinationInstructions: "",
    suggestedAvailability: [],
  },
  assessment: {
    status: "provisional",
    issues: [],
    days: [],
    travellerFit: [],
    groupUtility: 0,
    evaluatedAt: "2026-10-16T12:00:00Z",
    conflictCount: 0,
    travelDuration: "PT20M",
    overrunDuration: "PT0M",
    evidence: [],
  },
};
const activities = [first, second].map((id, i) => ({
  type: "Feature" as const,
  id,
  geometry: null,
  properties: {
    name: i === 0 ? "Museum" : "Garden",
    duration: "PT60M",
    description: "",
    cost: null,
    state: "Planned",
    placeName: null,
  },
}));
const props = {
  tripId: "trip",
  destinationId: "paris-fr",
  activities,
  readOnly: false,
  useAiAllowed: false,
  onSelect: vi.fn(),
  onSaved: vi.fn(async () => {}),
};

describe("daily planning", () => {
  it("offers the solver for unscheduled activities without saving or changing the selection", async () => {
    const data = structuredClone(response);
    data.plan.days[0].activityIds = [];
    vi.mocked(planningRequest).mockResolvedValueOnce({ data, etag: '"1"' });
    render(<DailyActivityPlan {...props} />);
    const schedule = await screen.findByRole("button", {
      name: "Schedule activities",
    });
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reload plan" }),
    ).not.toBeInTheDocument();
    vi.mocked(planningRequest)
      .mockResolvedValueOnce({
        data: { operationId: "schedule-job", result: null },
        etag: "",
      })
      .mockResolvedValueOnce({
        data: {
          status: "Running",
          result: null,
          review: { dismissedSuggestionIds: [] },
        },
        etag: "",
      });
    fireEvent.click(schedule);
    await waitFor(() =>
      expect(planningRequest).toHaveBeenCalledWith(
        expect.stringMatching(/\/proposals$/),
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            kind: "schedule",
            refreshEvidence: true,
            useAi: false,
            plan: data.plan,
          }),
        }),
      ),
    );
    expect(screen.getByRole("region", { name: "To schedule" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Planning is running");
    expect(
      vi
        .mocked(planningRequest)
        .mock.calls.some(([, options]) => options?.method === "PUT"),
    ).toBe(false);
  });

  it.each(["scheduled", "no solution", "stale", "save rejected"])(
    "Schedule activities chooses and saves days and times safely: %s",
    async (outcome) => {
      const initial = structuredClone(response);
      initial.plan.days[0].activityIds = [];
      const scheduled = structuredClone(response);
      scheduled.contextVersion = "enriched-context";
      scheduled.assessment.days = [
        {
          stayId: "visit-1",
          date: "2027-06-10",
          availableDuration: "PT16H",
          activityDuration: "PT2H",
          travelDuration: "PT1H",
          mealDuration: "PT2H",
          restDuration: "PT8H",
          waitingDuration: "PT0M",
          slackDuration: "PT11H",
          requiredSlackDuration: "PT1H",
          overrunDuration: "PT0M",
          travel: [],
          breaks: [],
          entries: [first, second].map((id, index) => ({
            activityId: id,
            stayId: "visit-1",
            date: "2027-06-10",
            name: index === 0 ? "Museum" : "Garden",
            start: `2027-06-10T${index === 0 ? "09" : "11"}:00:00+02:00`,
            end: `2027-06-10T${index === 0 ? "10" : "12"}:00:00+02:00`,
            duration: "PT1H",
            provisional: true,
          })),
        },
      ];
      const result: PlanResult = {
        id: "schedule-job",
        kind: "schedule",
        status:
          outcome === "no solution" ? "no_feasible_candidate" : "completed",
        basePlanVersion: 1,
        contextVersion: "enriched-context",
        assessment: initial.assessment,
        alternatives:
          outcome === "no solution"
            ? []
            : [
                {
                  id: "travel",
                  title: "Suggested schedule",
                  plan: scheduled.plan,
                  assessment: scheduled.assessment,
                },
              ],
        suggestions: [],
        warnings:
          outcome === "no solution"
            ? ["The selected activities do not fit the available days."]
            : [],
        ruleChanges: [],
        suggestedRules: [],
      };
      vi.mocked(planningRequest).mockResolvedValueOnce({
        data: initial,
        etag: '"1"',
      });
      render(<DailyActivityPlan {...props} />);
      const button = await screen.findByRole("button", {
        name: "Schedule activities",
      });
      vi.mocked(planningRequest)
        .mockResolvedValueOnce({
          data: { operationId: "schedule-job", result: null },
          etag: "",
        })
        .mockResolvedValueOnce({
          data: {
            operationId: "schedule-job",
            status: "Completed",
            result,
            review: { dismissedSuggestionIds: [] },
            error: null,
          },
          etag: '"review"',
        })
        .mockResolvedValueOnce({
          data: {
            ...initial,
            version: outcome === "stale" ? 2 : 1,
            contextVersion: "enriched-context",
          },
          etag: '"current"',
        });
      if (outcome === "save rejected")
        vi.mocked(planningRequest).mockRejectedValueOnce(
          new Error("The plan changed before it could be saved."),
        );
      else
        vi.mocked(planningRequest).mockResolvedValueOnce({
          data: { ...scheduled, version: 2 },
          etag: '"2"',
        });
      fireEvent.click(button);
      if (outcome === "scheduled") {
        await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1));
        expect(
          screen.queryByRole("region", { name: "To schedule" }),
        ).not.toBeInTheDocument();
        const heading = screen.getByRole("button", {
          name: "Thursday, Jun 10",
        });
        const day = document.getElementById(
          heading.getAttribute("aria-controls")!,
        )!;
        expect(
          within(day).getByRole("button", { name: "Museum" }),
        ).toBeVisible();
        expect(within(day).getByText("09:00")).toBeVisible();
        expect(within(day).getByText("11:00")).toBeVisible();
        expect(
          screen.getByRole("button", { name: "Planning tools" }),
        ).toHaveAttribute("aria-expanded", "false");
      } else {
        await waitFor(() => expect(button).toBeEnabled());
        expect(
          screen.getByRole("region", { name: "To schedule" }),
        ).toBeVisible();
        expect(props.onSaved).not.toHaveBeenCalled();
        expect(
          screen.getByRole("region", { name: "Planning results" }),
        ).toBeVisible();
      }
      const writes = vi
        .mocked(planningRequest)
        .mock.calls.filter(([, options]) => options?.method === "PUT");
      if (outcome === "scheduled" || outcome === "save rejected") {
        expect(writes).toHaveLength(1);
        expect(writes[0][1]).toEqual(
          expect.objectContaining({
            etag: '"current"',
            body: {
              plan: scheduled.plan,
              contextVersion: "enriched-context",
              proposalId: "schedule-job",
              choiceId: "travel",
            },
          }),
        );
      } else expect(writes).toHaveLength(0);
    },
  );

  it.each([false, true])(
    "collapses each day independently, including read-only plans: %s",
    async (readOnly) => {
      const data = structuredClone(response);
      data.plan.days[0].activityIds = [first];
      data.plan.days[1].activityIds = [second];
      vi.mocked(planningRequest).mockResolvedValueOnce({ data, etag: '"1"' });
      render(<DailyActivityPlan {...props} readOnly={readOnly} />);
      const day = await screen.findByRole("button", {
        name: "Thursday, Jun 10",
      });
      expect(
        screen.queryByRole("heading", { name: "Daily plan" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Paris ·/)).not.toBeInTheDocument();
      expect(day).toHaveAttribute("aria-expanded", "true");
      const content = document.getElementById(
        day.getAttribute("aria-controls")!,
      )!;
      expect(content).toBeVisible();
      fireEvent.click(day);
      expect(day).toHaveAttribute("aria-expanded", "false");
      expect(content).not.toBeVisible();
      expect(screen.getByRole("button", { name: "Garden" })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Museum" }),
      ).not.toBeInTheDocument();
      expect(day).toBeEnabled();
      fireEvent.click(day);
      expect(screen.getByRole("button", { name: "Museum" })).toBeVisible();
    },
  );

  it.each([
    ["PT10H", "PT1H", "PT0M", "fits", "9 h free"],
    ["PT3H30M", "PT1H", "PT0M", "provisional", "2.5 h free (estimated)"],
    [
      "PT30M",
      "PT1H",
      "PT30M",
      "conflicting",
      "0 h free (estimated) · 30 min over capacity",
    ],
  ])(
    "shows assessed free hours after reserved slack: %s",
    async (slack, reserved, overrun, status, label) => {
      const data = structuredClone(response);
      data.assessment.status = status;
      data.assessment.days = [
        {
          stayId: "visit-1",
          date: "2027-06-10",
          availableDuration: "PT16H",
          activityDuration: "PT2H",
          travelDuration: "PT1H",
          mealDuration: "PT2H",
          restDuration: "PT8H",
          waitingDuration: "PT1H",
          slackDuration: slack,
          requiredSlackDuration: reserved,
          overrunDuration: overrun,
          entries: [],
          travel: [],
          breaks: [],
        },
      ];
      vi.mocked(planningRequest).mockResolvedValueOnce({ data, etag: '"1"' });
      render(<DailyActivityPlan {...props} />);
      const day = await screen.findByRole("button", {
        name: "Thursday, Jun 10",
      });
      expect(within(day).getByText(label)).toBeVisible();
      fireEvent.click(day);
      expect(within(day).getByText(label)).toBeVisible();
      fireEvent.click(day);
      vi.mocked(previewActivityPlan).mockResolvedValueOnce({
        ...data.assessment,
        status: "provisional",
        days: [
          {
            ...data.assessment.days[0],
            slackDuration: "PT2H",
            requiredSlackDuration: "PT1H",
            overrunDuration: "PT0M",
          },
        ],
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Move Garden earlier" }),
      );
      expect(within(day).queryByText(label)).not.toBeInTheDocument();
      expect(within(day).getByText("Calculating free time…")).toBeVisible();
      expect(
        await within(day).findByText("1 h free (estimated)"),
      ).toBeVisible();
      expect(
        vi.mocked(previewActivityPlan).mock.lastCall?.[1].days[0].activityIds,
      ).toEqual([second, first]);
      expect(
        vi
          .mocked(planningRequest)
          .mock.calls.every(([, options]) => options?.method !== "PUT"),
      ).toBe(true);
    },
  );

  it.each([
    ["walking", "Walking"],
    ["taxi", "Taxi / rideshare"],
    ["driving", "Driving"],
  ])(
    "shows %s travel cards between activities and for stay connections",
    async (mode, label) => {
      const data = structuredClone(response);
      const leg = {
        mode,
        duration: "PT25M",
        provisional: true,
        source: "Distance-based estimate",
        walkingDuration: "PT5M",
        transfers: 1,
        waitingDuration: "PT3M",
        departure: "2027-06-10T10:00:00+02:00",
      };
      data.assessment.days = [
        {
          stayId: "visit-1",
          date: "2027-06-10",
          availableDuration: "PT16H",
          activityDuration: "PT2H",
          travelDuration: "PT75M",
          mealDuration: "PT2H",
          restDuration: "PT8H",
          waitingDuration: "PT0M",
          slackDuration: "PT1H",
          requiredSlackDuration: "PT1H",
          overrunDuration: "PT0M",
          entries: [],
          breaks: [],
          // Lookup must match the endpoints, not the array's position.
          travel: [
            {
              ...leg,
              fromActivityId: second,
              toActivityId: null,
              provisional: false,
            },
            {
              ...leg,
              fromActivityId: null,
              toActivityId: first,
              provisional: false,
            },
            { ...leg, fromActivityId: first, toActivityId: second },
          ],
        },
      ];
      vi.mocked(planningRequest).mockResolvedValueOnce({ data, etag: '"1"' });
      render(<DailyActivityPlan {...props} />);
      const day = within(
        await screen.findByRole("region", { name: "Thursday, Jun 10" }),
      );
      const travel = day.getByRole("listitem", {
        name: "Travel from Museum to Garden",
      });
      expect(within(travel).getByText(`${label} · 25 min`)).toBeVisible();
      expect(within(travel).getByText("Estimated")).toBeVisible();
      const outbound = day.getByRole("listitem", {
        name: "Travel from stay to Museum",
      });
      const inbound = day.getByRole("listitem", {
        name: "Travel from Garden to stay",
      });
      expect(outbound).toHaveTextContent("From stay");
      expect(inbound).toHaveTextContent("Back to stay");
      expect(within(inbound).queryByText("Estimated")).not.toBeInTheDocument();
      const rows = day.getAllByRole("listitem");
      const museum = day.getByRole("button", { name: "Museum" }).closest("li")!;
      const garden = day.getByRole("button", { name: "Garden" }).closest("li")!;
      expect(rows.indexOf(outbound)).toBeLessThan(rows.indexOf(museum));
      expect(rows.indexOf(museum)).toBeLessThan(rows.indexOf(travel));
      expect(rows.indexOf(travel)).toBeLessThan(rows.indexOf(garden));
      expect(rows.indexOf(garden)).toBeLessThan(rows.indexOf(inbound));
      expect(
        within(
          screen.getByRole("region", { name: "Tuesday, Jun 15" }),
        ).queryByRole("listitem", { name: /^Travel from/ }),
      ).not.toBeInTheDocument();
    },
  );

  it("offers only walking and car transport settings", async () => {
    render(<DailyActivityPlan {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Planning tools" }),
    );
    fireEvent.click(screen.getByText("Default timing and transport"));
    const transport = screen.getByRole("combobox", {
      name: "Default transport",
    });
    expect(
      within(transport)
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual(["walking", "taxi", "driving"]);
    expect(
      within(transport).queryByRole("option", { name: "Public transit" }),
    ).not.toBeInTheDocument();
  });

  it("shows unknown travel time instead of assuming a missing route costs zero", async () => {
    const data = structuredClone(response);
    data.plan.transportOverrides = [
      {
        date: "2027-06-10",
        fromActivityId: first,
        toActivityId: second,
        mode: "taxi",
        duration: null,
      },
    ];
    vi.mocked(planningRequest).mockResolvedValueOnce({ data, etag: '"1"' });
    render(<DailyActivityPlan {...props} readOnly />);
    const travel = await screen.findByRole("listitem", {
      name: "Travel from Museum to Garden",
    });
    expect(travel).toHaveTextContent("Taxi / rideshare · Travel time unknown");
    expect(travel).not.toHaveTextContent("0 min");
    fireEvent.click(screen.getByRole("button", { name: "Thursday, Jun 10" }));
    expect(travel).not.toBeVisible();
  });

  it.each([false, true])(
    "shows daily routines with day overrides: %s",
    async (override) => {
      const data = structuredClone(response);
      if (override) {
        data.plan.days[0].settings = {
          ...plan.settings,
          sleepEnd: "09:00:00",
          sleepStart: "01:00:00",
          breakfastDuration: "PT45M",
        };
      }
      vi.mocked(planningRequest).mockResolvedValueOnce({ data, etag: '"1"' });
      render(<DailyActivityPlan {...props} />);
      const day = within(
        await screen.findByRole("region", { name: "Thursday, Jun 10" }),
      );
      const waking = day.getByRole("listitem", { name: "Wake up" });
      expect(
        within(waking).getByText(override ? "09:00" : "07:00"),
      ).toBeVisible();
      const bedtime = day.getByRole("listitem", { name: "Sleep" });
      expect(
        within(bedtime).getByText(override ? "01:00" : "23:00"),
      ).toBeVisible();
      if (override)
        expect(within(bedtime).getByText("Bedtime · Next day")).toBeVisible();
      expect(
        day.getByRole("listitem", { name: "Breakfast" }),
      ).toHaveTextContent(`${override ? 45 : 30} min · Time not set`);
      for (const meal of ["Lunch", "Dinner"]) {
        expect(day.getByRole("listitem", { name: meal })).toHaveTextContent(
          "45 min · Time not set",
        );
      }
    },
  );

  it("places assessed meals among activities and identifies included meals", async () => {
    const data = structuredClone(response);
    data.plan.rules = [
      {
        activityId: second,
        mustDo: false,
        fixedDate: null,
        fixedStart: null,
        afterActivityId: null,
        coversMeal: "dinner",
        duration: null,
        alwaysAvailable: false,
        openingWindows: [],
        closedDates: [],
      },
    ];
    data.assessment.days = [
      {
        stayId: "visit-1",
        date: "2027-06-10",
        availableDuration: "PT16H",
        activityDuration: "PT2H",
        travelDuration: "PT0M",
        mealDuration: "PT75M",
        restDuration: "PT8H",
        waitingDuration: "PT0M",
        slackDuration: "PT1H",
        requiredSlackDuration: "PT1H",
        overrunDuration: "PT0M",
        travel: [],
        entries: [first, second].map((id, i) => ({
          activityId: id,
          stayId: "visit-1",
          date: "2027-06-10",
          name: activities[i].properties.name,
          start: `2027-06-10T${i === 0 ? "10" : "14"}:00:00+02:00`,
          end: null,
          duration: "PT1H",
          provisional: true,
        })),
        breaks: [
          {
            name: "lunch",
            start: "2027-06-10T13:00:00+02:00",
            end: "2027-06-10T13:45:00+02:00",
            duration: "PT45M",
          },
        ],
      },
    ];
    vi.mocked(planningRequest).mockResolvedValueOnce({ data, etag: '"1"' });
    render(<DailyActivityPlan {...props} />);
    const day = within(
      await screen.findByRole("region", { name: "Thursday, Jun 10" }),
    );
    const lunch = day.getByRole("listitem", { name: "Lunch" });
    expect(lunch).toHaveTextContent("13:00");
    expect(lunch).toHaveTextContent("45 min · Estimated");
    const rows = day.getAllByRole("listitem");
    expect(
      rows.indexOf(
        screen.getByRole("button", { name: "Museum" }).closest("li")!,
      ),
    ).toBeLessThan(rows.indexOf(lunch));
    expect(
      rows.indexOf(
        screen.getByRole("button", { name: "Garden" }).closest("li")!,
      ),
    ).toBeGreaterThan(rows.indexOf(lunch));
    const dinner = day.getByRole("listitem", { name: "Dinner" });
    expect(dinner).toHaveTextContent("Included in Garden");
    expect(dinner).not.toHaveTextContent("45 min");
  });

  it.each([false, true])(
    "shows collapsible empty days across visits, including read-only: %s",
    async (readOnly) => {
      const data = structuredClone(response);
      data.plan.selectedActivityIds = [];
      data.plan.days = data.plan.days.map((day) => ({
        ...day,
        activityIds: [],
      }));
      vi.mocked(planningRequest).mockResolvedValueOnce({ data, etag: '"1"' });
      render(<DailyActivityPlan {...props} readOnly={readOnly} />);
      for (const name of ["Thursday, Jun 10", "Tuesday, Jun 15"]) {
        const heading = await screen.findByRole("button", { name });
        expect(within(heading).getByText("0 activities")).toBeVisible();
        const content = document.getElementById(
          heading.getAttribute("aria-controls")!,
        )!;
        expect(
          within(content).getByText("No activities scheduled for this day."),
        ).toBeVisible();
        expect(
          within(content).getByRole("listitem", { name: "Breakfast" }),
        ).toBeVisible();
        fireEvent.click(heading);
        expect(heading).toHaveAttribute("aria-expanded", "false");
        expect(content).not.toBeVisible();
        fireEvent.click(heading);
        expect(heading).toHaveAttribute("aria-expanded", "true");
        expect(content).toBeVisible();
      }
      expect(planningRequest).toHaveBeenCalledTimes(1);
    },
  );

  it("starts with an empty agenda and directs users to mark Ideas as Planned", async () => {
    vi.mocked(planningRequest).mockResolvedValueOnce({
      data: {
        ...response,
        plan: {
          ...plan,
          selectedActivityIds: [],
          days: plan.days.map((day) => ({ ...day, activityIds: [] })),
        },
      },
      etag: '"1"',
    });
    const choose = vi.fn();
    render(
      <DailyActivityPlan
        {...props}
        activities={activities.map((activity) => ({
          ...activity,
          properties: { ...activity.properties, state: "Proposed" },
        }))}
        onChooseActivities={choose}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Your agenda is empty" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Museum" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Assess draft" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Current assessment")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose activities" }));
    expect(choose).toHaveBeenCalledOnce();
    expect(planningRequest).toHaveBeenCalledTimes(1);
  });

  it("puts Planned activities in To schedule until the user chooses a day", async () => {
    vi.mocked(planningRequest).mockResolvedValueOnce({
      data: {
        ...response,
        plan: {
          ...plan,
          selectedActivityIds: [first],
          days: plan.days.map((day) => ({ ...day, activityIds: [] })),
        },
      },
      etag: '"1"',
    });
    render(<DailyActivityPlan {...props} />);
    const waiting = await screen.findByRole("region", { name: "To schedule" });
    expect(
      within(waiting).getByRole("button", { name: "Museum" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Garden" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Day for Museum" }), {
      target: { value: "2027-06-15" },
    });
    expect(
      screen.queryByRole("region", { name: "To schedule" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Museum" }).closest("section"),
    ).toHaveAttribute("aria-label", "Tuesday, Jun 15");
    expect(screen.getByText("Time to decide")).toBeVisible();
    expect(planningRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(planningRequest).toHaveBeenCalledTimes(2));
    const body = vi.mocked(planningRequest).mock.calls[1][1]!.body as {
      plan: ActivityPlan;
    };
    expect(body.plan.days[1].activityIds).toEqual([first]);
  });

  it("returns a planned activity to Ideas without removing the other agenda entries", async () => {
    render(<DailyActivityPlan {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Return Museum to Ideas" }),
    );
    expect(
      screen.queryByRole("button", { name: "Museum" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Garden" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(planningRequest).toHaveBeenCalledTimes(2));
    const body = vi.mocked(planningRequest).mock.calls[1][1]!.body as {
      plan: ActivityPlan;
    };
    expect(body.plan.selectedActivityIds).toEqual([second]);
    expect(body.plan.days[0].activityIds).toEqual([second]);
    expect(body.plan.excludedActivityIds).not.toContain(first);
  });

  it.each([
    ["Tokyo", "Asia/Tokyo"],
    ["Hong Kong", "Asia/Hong_Kong"],
    ["UTC", "UTC"],
  ])(
    "autocompletes %s and saves the recognized timezone ID",
    async (query, id) => {
      render(<DailyActivityPlan {...props} />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Planning tools" }),
      );
      fireEvent.click(screen.getByText("Default timing and transport"));
      const picker = screen.getByRole("combobox", {
        name: "Destination timezone",
      });
      fireEvent.change(picker, { target: { value: query } });
      if (query !== id) {
        expect(
          screen.getByRole("button", { name: "Save changes" }),
        ).toBeDisabled();
        expect(
          screen.getByText("Choose a timezone from the suggestions."),
        ).toBeVisible();
      }
      fireEvent.click(picker);
      fireEvent.click(await screen.findByRole("option", { name: id }));
      expect(picker).toHaveValue(id);
      expect(
        screen.queryByText("Choose a timezone from the suggestions."),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(planningRequest).toHaveBeenCalledTimes(2));
      const body = vi.mocked(planningRequest).mock.calls[1][1]!.body as {
        plan: ActivityPlan;
      };
      expect(body.plan.timeZone).toBe(id);
    },
  );

  it("keeps an invalid timezone out of save and assessment requests", async () => {
    render(<DailyActivityPlan {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Planning tools" }),
    );
    fireEvent.click(screen.getByText("Default timing and transport"));
    const picker = screen.getByRole("combobox", {
      name: "Destination timezone",
    });
    fireEvent.change(picker, { target: { value: "Not/A_Zone" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Assess draft" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Propose a draft" }),
    ).toBeDisabled();
    expect(planningRequest).toHaveBeenCalledTimes(1);
    fireEvent.change(picker, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("saves edited clock times in ISO 8601 format while displaying minute inputs", async () => {
    render(<DailyActivityPlan {...props} />);
    await screen.findByRole("button", { name: "Planning tools" });
    fireEvent.click(screen.getByRole("button", { name: "Planning tools" }));
    const sleep = screen.getByLabelText("Default sleep starts");
    expect(sleep).toHaveValue("23:00");
    fireEvent.change(sleep, { target: { value: "22:30" } });
    fireEvent.change(screen.getByLabelText("Fixed start for Museum"), {
      target: { value: "09:15" },
    });
    fireEvent.change(screen.getAllByLabelText("Available from")[0], {
      target: { value: "08:00" },
    });
    fireEvent.change(screen.getByLabelText("Default slack minutes"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(planningRequest).toHaveBeenCalledTimes(2));
    const body = vi.mocked(planningRequest).mock.calls[1][1]!.body as {
      plan: ActivityPlan;
    };
    expect(body.plan.settings.sleepStart).toBe("22:30:00");
    expect(body.plan.settings.sleepEnd).toBe("07:00:00");
    expect(body.plan.settings.slackDuration).toBe("PT90M");
    expect(
      body.plan.rules.find((rule) => rule.activityId === first)!.fixedStart,
    ).toBe("09:15:00");
    expect(body.plan.days[0].availableFrom).toBe("08:00:00");
    expect(body.plan.days[0].availableUntil).toBeNull();
  });

  it("refreshes context after research without discarding the unsaved draft", async () => {
    render(<DailyActivityPlan {...props} />);
    await screen.findByRole("button", { name: "Move Garden earlier" });
    fireEvent.click(
      screen.getByRole("button", { name: "Move Garden earlier" }),
    );
    const result = {
      id: "assessment-id",
      kind: "assessment",
      status: "completed",
      basePlanVersion: 1,
      contextVersion: "context-2",
      assessment: response.assessment,
      alternatives: [],
      suggestions: [],
      warnings: [],
      suggestedRules: [],
      ruleChanges: [],
      suggestedAvailability: [],
    };
    vi.mocked(planningRequest)
      .mockResolvedValueOnce({
        data: { operationId: "assessment-id", result: null },
        etag: "",
      })
      .mockResolvedValueOnce({
        data: {
          operationId: "assessment-id",
          status: "Completed",
          result,
          review: { dismissedSuggestionIds: [] },
          error: null,
        },
        etag: '"review"',
      })
      .mockResolvedValueOnce({
        data: { ...response, contextVersion: "context-2", timingStale: true },
        etag: '"1"',
      });
    fireEvent.click(screen.getByRole("button", { name: "Planning tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Assess draft" }));
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Save changes" }),
        ).toBeEnabled(),
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(
        vi
          .mocked(planningRequest)
          .mock.calls.some(([, options]) => options?.method === "PUT"),
      ).toBe(true),
    );
    const [, options] = vi
      .mocked(planningRequest)
      .mock.calls.find(([, options]) => options?.method === "PUT")!;
    const body = options!.body as {
      contextVersion: string;
      plan: ActivityPlan;
    };
    expect(body.contextVersion).toBe("context-2");
    expect(body.plan.days[0].activityIds).toEqual([second, first]);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(previewActivityPlan).mockResolvedValue(
      structuredClone(response.assessment),
    );
    vi.mocked(planningRequest).mockResolvedValue({
      data: structuredClone(response),
      etag: '"1"',
    });
  });
  it("moves an activity across repeat visits exactly once and retains unrelated restrictions", () => {
    const withRules = {
      ...plan,
      rules: [
        {
          activityId: first,
          mustDo: true,
          fixedDate: null,
          fixedStart: null,
          afterActivityId: null,
          coversMeal: null,
          duration: null,
          alwaysAvailable: true,
          openingWindows: [],
          closedDates: [],
        },
      ],
    };
    const moved = moveActivity(withRules, first, "2027-06-15");
    expect(
      moved.days.flatMap((d) => d.activityIds).filter((id) => id === first),
    ).toHaveLength(1);
    expect(moved.days[1].activityIds).toEqual([first]);
    expect(moved.rules).toEqual(withRules.rules);
    const removed = chooseActivity(moved, first, "idea");
    expect(removed.selectedActivityIds).not.toContain(first);
    expect(removed.excludedActivityIds).not.toContain(first);
    expect(removed.days.flatMap((d) => d.activityIds)).not.toContain(first);
  });
  it("offers button and select controls, and saves only after the user chooses", async () => {
    render(<DailyActivityPlan {...props} />);
    await screen.findByRole("button", { name: "Move Garden earlier" });
    fireEvent.click(
      screen.getByRole("button", { name: "Move Garden earlier" }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Day for Museum" }), {
      target: { value: "2027-06-15" },
    });
    const agendaActivity = screen.getByRole("button", { name: "Museum" });
    fireEvent.click(screen.getByRole("button", { name: "Planning tools" }));
    expect(
      screen.queryByRole("heading", { name: "Daily plan" }),
    ).not.toBeInTheDocument();
    expect(agendaActivity).toBeVisible();
    expect(screen.getByRole("button", { name: "Assess draft" })).toBeVisible();
    const toggle = screen.getByRole("button", { name: "Hide planning tools" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(agendaActivity).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Assess draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Planning tools" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(planningRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(planningRequest).toHaveBeenCalledTimes(2));
    const options = vi.mocked(planningRequest).mock.calls[1][1]!;
    expect(options.etag).toBe('"1"');
    const body = options.body as { plan: ActivityPlan; contextVersion: string };
    expect(body.contextVersion).toBe("context-1");
    expect(body.plan.days[0].activityIds).toEqual([second]);
    expect(body.plan.days[1].activityIds).toEqual([first]);
  });
  it("keeps a chosen day and predecessor as persistent restrictions", async () => {
    render(<DailyActivityPlan {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Planning tools" }),
    );
    await screen.findAllByRole("button", { name: "Keep this choice" });
    const garden = within(
      screen.getByRole("region", { name: "Planning tools" }),
    )
      .getByRole("button", { name: "Move Garden earlier" })
      .closest("li")!;
    fireEvent.click(
      within(garden).getByRole("button", { name: "Keep this choice" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(planningRequest).toHaveBeenCalledTimes(2));
    const body = vi.mocked(planningRequest).mock.calls[1][1]!.body as {
      plan: ActivityPlan;
    };
    expect(body.plan.rules).toContainEqual(
      expect.objectContaining({
        activityId: second,
        mustDo: true,
        fixedDate: "2027-06-10",
        afterActivityId: first,
      }),
    );
  });
  it("disables editing for travellers while preserving map detail navigation", async () => {
    render(<DailyActivityPlan {...props} readOnly />);
    await screen.findByRole("button", { name: "Museum" });
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Propose a draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Day for Museum" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Museum" }));
    expect(props.onSelect).toHaveBeenCalledWith(first);
  });
  it("reports stale saves and retains the local draft for review", async () => {
    render(<DailyActivityPlan {...props} />);
    await screen.findByRole("button", { name: "Move Garden earlier" });
    fireEvent.click(
      screen.getByRole("button", { name: "Move Garden earlier" }),
    );
    vi.mocked(planningRequest).mockRejectedValueOnce(
      new Error(
        "Planning inputs changed. Reload the plan before applying your changes.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      (await screen.findByText(/Planning inputs changed/)).closest(
        ".fui-Toast",
      ),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeInTheDocument();
  });
});
