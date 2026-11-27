import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import {
  useExplicitResourceRefresh,
  useTripDocumentState,
  useTripResourceVersion,
} from "../../api/tripDocumentStore";
import { tripDocumentScheduleDays } from "../../api/tripDocument";
import { mapsClient } from "../../maps/mapsClient";
import {
  durationFromMinutes,
  durationMinutes,
} from "../../shared/time/durations";
import type { Activity, Destination, Point } from "./activitiesApi";
import {
  activityPlanPath,
  activityPlanSchedule,
  activityRule,
  planningRequest,
  previewActivityPlan,
  unscheduleActivity,
  type ActivityPlan,
  type PlanAssessment,
  type PlanDay,
  type PlanResponse,
  type Versioned,
} from "./activityPlanApi";
import {
  applyEventTiming,
  calendarClock,
  calendarDateLabel,
  calendarDayKey,
  calendarDayOptions,
  calendarDays,
  calendarEntries,
  calendarTravelLegs,
  calendarVisits,
  clockMinutes,
  withCalendarDay,
  type CalendarEntry,
  type CalendarTiming,
} from "./activityCalendarModel";
import {
  activityRouteKey,
  type ActivityRouteSelection,
  type ActivityRouteStep,
} from "./activityRouteApi";
import ActivityCalendar from "./ActivityCalendar";
import DayNameEditor from "./DayNameEditor";
import ActivityCalendarSubscriptions from "./ActivityCalendarSubscriptions";
import "./activityPlan.css";

type EventTiming = {
  dayKey: string;
  start: string;
  end: string;
  nextDay: boolean;
};
type EventDraft = EventTiming & {
  kind: "event";
  id: string;
  initialTiming: EventTiming;
  travelEdits: Record<string, TravelDraft>;
  openTravel?: string;
};
type TravelDraft = {
  step: ActivityRouteStep;
  mode: "driving" | "walking";
  minutes: string;
  calculated?: boolean;
};
type Editor =
  EventDraft | { kind: "day" } | { kind: "info"; entry: CalendarEntry };
type CalendarRequests = {
  path: string;
  writing: boolean;
  route?: AbortController;
  save?: AbortController;
};

function withEventTiming(
  plan: ActivityPlan,
  day: PlanDay,
  event: EventDraft,
  assessment?: PlanAssessment,
) {
  return applyEventTiming(
    withCalendarDay(plan, day),
    event.id,
    day,
    event.start,
    event.end,
    event.nextDay,
    assessment,
  );
}

function travelDuration(value: string) {
  const minutes = Number(value);
  return value.trim() &&
    Number.isFinite(minutes) &&
    minutes >= 0 &&
    minutes <= 1440
    ? durationFromMinutes(minutes)
    : null;
}

function withTravel(
  plan: ActivityPlan,
  draft: TravelDraft,
  duration: string | null,
): ActivityPlan {
  return {
    ...plan,
    transportOverrides: [
      ...plan.transportOverrides.filter(
        (item) =>
          !(
            item.date === draft.step.date &&
            item.fromActivityId === draft.step.fromActivityId &&
            item.toActivityId === draft.step.toActivityId
          ),
      ),
      {
        date: draft.step.date,
        fromActivityId: draft.step.fromActivityId,
        toActivityId: draft.step.toActivityId,
        mode: draft.mode,
        duration,
      },
    ],
  };
}

export default function DailyActivityPlan({
  tripId,
  destinationId,
  destination,
  tripCalendar,
  activities,
  activitiesLoading = false,
  readOnly: providedReadOnly,
  onSelect,
  onSaved,
  onScheduleError,
  onChooseActivities,
  onSelectTravel,
  onPlanChange,
  onMapDayChange,
}: {
  tripId: string;
  destinationId: string;
  destination: Destination;
  tripCalendar?: {
    destinations: Destination[];
    initialDayKey?: string;
    onDestinationDay: (destinationId: string, key: string) => void;
  };
  activities: Activity[];
  activitiesLoading?: boolean;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onSaved: () => Promise<void>;
  onScheduleError: (message: string) => void;
  onChooseActivities?: () => void;
  onSelectTravel?: (selection: ActivityRouteSelection) => void;
  onPlanChange?: () => void;
  onMapDayChange?: (activityIds: string[]) => void;
}) {
  const path = activityPlanPath(tripId, destinationId);
  const resourceVersion = useTripResourceVersion(path);
  const documentState = useTripDocumentState();
  const tripDocument =
    documentState.tripId === tripId
      ? documentState.document?.document
      : undefined;
  const offline = documentState.offline || navigator.onLine === false;
  const readOnly = providedReadOnly || offline;
  const [resource, setResource] = useState<Versioned<PlanResponse>>();
  const [dayKey, setDayKey] = useState(tripCalendar?.initialDayKey ?? "");
  const [editor, setEditor] = useState<Editor>();
  const [saving, setSaving] = useState<"calendar" | "editor">();
  const busy = saving !== undefined;
  const savingEditor = saving === "editor";
  const [calculating, setCalculating] = useState<string>();
  const [error, setError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [pendingSchedule, setPendingSchedule] = useState<{
    plan: ActivityPlan;
    timing?: CalendarTiming;
  }>();
  const [previousPath, setPreviousPath] = useState(path);
  const activeRequests = useRef<CalendarRequests>(undefined);
  if (previousPath !== path) {
    setPreviousPath(path);
    setResource(undefined);
    setDayKey(tripCalendar?.initialDayKey ?? "");
    setEditor(undefined);
    setSaving(undefined);
    setCalculating(undefined);
    setError("");
    setEditorError("");
    setPendingSchedule(undefined);
  }
  const plan = pendingSchedule?.plan ?? resource?.data.plan;
  const pendingTiming = pendingSchedule?.timing;
  const assessment = resource?.data.assessment;
  const savedVisits = resource?.data.context.visits;
  const visits = useMemo(
    () => savedVisits ?? calendarVisits(destination),
    [savedVisits, destination],
  );
  const savedDays = useMemo(
    () => tripDocumentScheduleDays(tripDocument),
    [tripDocument],
  );
  const days = useMemo(
    () => calendarDays(plan, visits, savedDays.get(destinationId)),
    [plan, visits, savedDays, destinationId],
  );
  const day =
    days.find((item) => calendarDayKey(item) === dayKey) ??
    days.find((item) =>
      visits.some(
        (visit) =>
          visit.stayId === item.stayId &&
          item.date === (visit.arrivalDate ?? visit.departureDate),
      ),
    ) ??
    days[0];
  const tripDestinations = tripCalendar?.destinations;
  const dayOptions = useMemo(
    () =>
      calendarDayOptions(
        destinationId,
        days,
        tripDestinations ?? [destination],
        savedDays,
      ),
    [destinationId, days, tripDestinations, destination, savedDays],
  );
  const eventDraft = editor?.kind === "event" ? editor : undefined;
  const eventIsScheduled =
    eventDraft &&
    plan?.days.some((item) => item.activityIds.includes(eventDraft.id));
  const targetDay = days.find(
    (item) => calendarDayKey(item) === eventDraft?.dayKey,
  );
  const timingChanged =
    eventDraft &&
    (eventDraft.dayKey !== eventDraft.initialTiming.dayKey ||
      eventDraft.start !== eventDraft.initialTiming.start ||
      eventDraft.end !== eventDraft.initialTiming.end ||
      eventDraft.nextDay !== eventDraft.initialTiming.nextDay);
  let travelPlan = plan;
  if (
    plan &&
    eventDraft &&
    targetDay &&
    (timingChanged || !targetDay.activityIds.includes(eventDraft.id))
  ) {
    try {
      travelPlan = withEventTiming(plan, targetDay, eventDraft, assessment);
    } catch {
      // Keep the existing legs visible while the user corrects an incomplete time.
    }
  }
  const travelDay = travelPlan?.days.find(
    (item) => calendarDayKey(item) === eventDraft?.dayKey,
  );
  const travelDrafts =
    travelPlan && travelDay && eventDraft
      ? calendarTravelLegs(
          travelPlan,
          travelDay,
          activities,
          assessment,
          destination,
        )
          .filter(
            ({ step }) =>
              (step.toActivityId ?? step.fromActivityId) === eventDraft.id,
          )
          .map(
            ({ step, minutes }): TravelDraft =>
              eventDraft.travelEdits[activityRouteKey(step)] ?? {
                step,
                mode: step.mode === "walking" ? "walking" : "driving",
                minutes: minutes === null ? "" : String(minutes),
              },
          )
      : [];
  const showDayOnMap = useEffectEvent((activityIds: string[]) =>
    onMapDayChange?.(activityIds),
  );
  useLayoutEffect(() => {
    if (!plan || !day) {
      showDayOnMap([]);
      return;
    }
    const timed = new Set(
      calendarEntries(
        plan,
        day,
        activities,
        assessment,
        undefined,
        pendingTiming,
      ).flatMap((entry) => (entry.activityId ? [entry.activityId] : [])),
    );
    showDayOnMap([...timed, ...day.activityIds.filter((id) => !timed.has(id))]);
  }, [plan, day, activities, assessment, pendingTiming]);
  const invalidateRoute = useEffectEvent(() => onPlanChange?.());
  useEffect(() => {
    invalidateRoute();
  }, [resource?.etag]);
  useLayoutEffect(() => {
    const requests: CalendarRequests = { path, writing: false };
    activeRequests.current = requests;
    return () => {
      activeRequests.current = undefined;
      requests.route?.abort();
      requests.save?.abort();
    };
  }, [path]);
  useEffect(() => {
    const abort = new AbortController();
    const requests = activeRequests.current;
    void planningRequest<PlanResponse>(path, { signal: abort.signal }).then(
      (value) => {
        if (!abort.signal.aborted && activeRequests.current === requests) {
          setResource(value);
          setError("");
        }
      },
      (reason: Error) => {
        if (!abort.signal.aborted && activeRequests.current === requests)
          setError(reason.message);
      },
    );
    return () => {
      abort.abort();
    };
  }, [path, resourceVersion]);
  useEffect(() => {
    if (readOnly) {
      activeRequests.current?.route?.abort();
      activeRequests.current?.save?.abort();
    }
  }, [readOnly]);
  async function reload() {
    const requests = currentRequests();
    if (!requests || requests.writing) return;
    if (!resource) setError("");
    try {
      const value = await planningRequest<PlanResponse>(path);
      if (activeRequests.current === requests) {
        setResource(value);
        setError("");
      }
    } catch (reason) {
      if (activeRequests.current === requests)
        setError((reason as Error).message);
    }
  }
  useExplicitResourceRefresh(path, reload);

  function currentRequests() {
    const requests = activeRequests.current;
    return requests?.path === path ? requests : undefined;
  }

  function selectDay(key: string) {
    const option = dayOptions.find((item) => item.key === key);
    if (!option) return;
    if (option.destinationId !== destinationId) {
      tripCalendar?.onDestinationDay(option.destinationId, key);
      return;
    }
    setDayKey(key);
    onPlanChange?.();
  }

  async function persist(
    next: ActivityPlan,
    {
      closeEditor = true,
      background,
    }: { closeEditor?: boolean; background?: { timing?: CalendarTiming } } = {},
  ) {
    const requests = currentRequests();
    if (!resource || readOnly || !requests || requests.writing) return;
    requests.writing = true;
    setSaving(editor && !background ? "editor" : "calendar");
    setEditorError("");
    const controller = new AbortController();
    // A dropped card starts a background save that can finish after leaving Schedule.
    if (background)
      setPendingSchedule({ plan: next, timing: background.timing });
    else requests.save = controller;
    try {
      if (next.timeZone === null)
        throw new Error(
          "The destination time zone is unavailable. Refresh the calendar and try again.",
        );
      if (
        JSON.stringify(activityPlanSchedule(next)) !==
        JSON.stringify(activityPlanSchedule(resource.data.plan))
      ) {
        const checked = await previewActivityPlan(
          path,
          next,
          resource.data.contextVersion,
          controller.signal,
        );
        const conflict = checked.issues.find(
          (issue) => issue.code === "flight_unavailable",
        );
        if (conflict) throw new Error(conflict.message);
      }
      const value = await planningRequest<PlanResponse>(path, {
        method: "PUT",
        etag: resource.etag,
        signal: controller.signal,
        body: { plan: next, contextVersion: resource.data.contextVersion },
      });
      if (controller.signal.aborted || activeRequests.current !== requests)
        return;
      setResource(value);
      if (background) setPendingSchedule(undefined);
      if (closeEditor) setEditor(undefined);
      try {
        await onSaved();
      } catch {
        const message = "Calendar saved. Activity details could not refresh.";
        if (background) onScheduleError(message);
        else if (activeRequests.current === requests) setError(message);
      }
    } catch (reason) {
      if (background) {
        if (activeRequests.current === requests) setPendingSchedule(undefined);
        throw reason;
      }
      if (controller.signal.aborted || activeRequests.current !== requests)
        return;
      if (editor) setEditorError((reason as Error).message);
      throw reason;
    } finally {
      requests.writing = false;
      if (activeRequests.current === requests) setSaving(undefined);
    }
  }
  async function saveTiming(timing: CalendarTiming) {
    if (!plan || !day || readOnly || currentRequests()?.writing) return;
    setError("");
    try {
      const next = applyEventTiming(
        withCalendarDay(plan, day),
        timing.activityId,
        day,
        calendarClock(timing.start),
        calendarClock(timing.end),
        timing.end >= 1440,
        resource?.data.assessment,
      );
      await persist(next, { closeEditor: false, background: { timing } });
    } catch (reason) {
      const message =
        reason instanceof Error && !(reason instanceof TypeError)
          ? reason.message
          : "Try again.";
      onScheduleError(`Could not save the schedule. ${message}`);
    }
  }
  async function removeFromSchedule(
    activityId: string,
    source: "drawer" | "drag",
  ) {
    if (!plan || readOnly || calculating || currentRequests()?.writing) return;
    const next = unscheduleActivity(plan, activityId);
    if (next === plan) return;
    setError("");
    try {
      await persist(
        next,
        source === "drag" ? { closeEditor: false, background: {} } : undefined,
      );
    } catch (reason) {
      if (source === "drag") {
        const message =
          reason instanceof Error && !(reason instanceof TypeError)
            ? reason.message
            : "Try again.";
        onScheduleError(`Could not unschedule the activity. ${message}`);
      }
    }
  }
  function openEvent(id?: string, travel?: ActivityRouteStep) {
    const requests = currentRequests();
    if (!plan || !day || !requests) return;
    const selected =
      id ??
      plan.selectedActivityIds.find(
        (item) => !plan.days.some((d) => d.activityIds.includes(item)),
      ) ??
      plan.selectedActivityIds[0] ??
      activities[0]?.id;
    if (!selected) return;
    const assigned =
      plan.days.find((item) => item.activityIds.includes(selected)) ?? day;
    const event = calendarEntries(
      plan,
      assigned,
      activities,
      resource?.data.assessment,
      destination,
      pendingTiming,
    ).find((item) => item.activityId === selected);
    const rule = activityRule(plan, selected);
    const start =
      rule.fixedStart?.slice(0, 5) ??
      (event ? calendarClock(event.start) : "09:00");
    const minutes =
      durationMinutes(
        rule.duration ??
          activities.find((item) => item.id === selected)?.properties.duration,
      ) ?? 60;
    const endMinute = event?.end ?? clockMinutes(start) + minutes;
    const timing = {
      dayKey: calendarDayKey(assigned),
      start,
      end: calendarClock(endMinute),
      nextDay: endMinute >= 1440,
    };
    requests.route?.abort();
    requests.route = undefined;
    setCalculating(undefined);
    setEditor({
      kind: "event",
      id: selected,
      ...timing,
      initialTiming: timing,
      travelEdits: {},
      openTravel: travel ? activityRouteKey(travel) : undefined,
    });
    setEditorError("");
  }
  function openEntry(entry: CalendarEntry) {
    setEditorError("");
    const activityId =
      entry.activityId ??
      entry.travel?.toActivityId ??
      entry.travel?.fromActivityId;
    if (activityId) openEvent(activityId, entry.travel);
    else setEditor({ kind: "info", entry });
  }
  function close() {
    const requests = currentRequests();
    if (savingEditor || !requests) return;
    requests.route?.abort();
    requests.route = undefined;
    setCalculating(undefined);
    setEditor(undefined);
    setEditorError("");
  }
  function updateEvent(change: Partial<EventTiming>) {
    setEditor((current) =>
      current?.kind === "event" ? { ...current, ...change } : current,
    );
    setEditorError("");
  }
  function updateTravel(draft: TravelDraft, change: Partial<TravelDraft>) {
    const key = activityRouteKey(draft.step);
    setEditor((current) =>
      current?.kind === "event"
        ? {
            ...current,
            travelEdits: {
              ...current.travelEdits,
              [key]: { ...draft, ...change },
            },
          }
        : current,
    );
    setEditorError("");
  }
  function point(id: string | null, stayId: string): Point | null | undefined {
    return id === null
      ? destination?.properties.stays.find((stay) => stay.id === stayId)
          ?.stayLocation?.geometry
      : activities.find((item) => item.id === id)?.geometry;
  }
  async function calculate(travel: TravelDraft) {
    const requests = currentRequests();
    if (readOnly || calculating || !requests) return;
    const { step, mode } = travel;
    const from = point(step.fromActivityId, step.stayId);
    const to = point(step.toActivityId, step.stayId);
    if (!from || !to) {
      setEditorError("Set both locations before calculating travel time.");
      return;
    }
    const controller = new AbortController();
    requests.route = controller;
    setCalculating(activityRouteKey(step));
    setEditorError("");
    try {
      const duration = await mapsClient.estimateTravelTime(
        from.coordinates,
        to.coordinates,
        mode,
        controller.signal,
      );
      if (!controller.signal.aborted)
        updateTravel(travel, {
          minutes: String(durationMinutes(duration)),
          calculated: true,
        });
    } catch (reason) {
      if (!controller.signal.aborted) setEditorError((reason as Error).message);
    } finally {
      if (activeRequests.current === requests && requests.route === controller)
        setCalculating(undefined);
    }
  }
  async function saveEditor() {
    const requests = currentRequests();
    if (
      !plan ||
      !eventDraft ||
      readOnly ||
      calculating ||
      !requests ||
      requests.writing
    )
      return;
    try {
      if (!targetDay) throw new Error("Choose a day in this visit.");
      const editedTravel = travelDrafts.filter(
        ({ step }) => eventDraft.travelEdits[activityRouteKey(step)],
      );
      let next =
        timingChanged ||
        !targetDay.activityIds.includes(eventDraft.id) ||
        !editedTravel.length
          ? withEventTiming(plan, targetDay, eventDraft, assessment)
          : plan;
      for (const travel of editedTravel) {
        const duration = travelDuration(travel.minutes);
        if (duration === null)
          throw new Error("Enter a travel time between 0 and 1,440 minutes.");
        next = withTravel(next, travel, duration);
      }
      await persist(next);
      if (activeRequests.current === requests) setDayKey(eventDraft.dayKey);
    } catch (reason) {
      if (activeRequests.current === requests)
        setEditorError((reason as Error).message);
    }
  }
  const title =
    editor?.kind === "event"
      ? (activities.find((item) => item.id === editor.id)?.properties.name ??
        "Event")
      : editor?.kind === "day"
        ? "Day details"
        : editor?.kind === "info"
          ? editor.entry.title
          : "Event";
  return (
    <section className="daily-plan" aria-label="Activity calendar">
      <ActivityCalendar
        tripId={tripId}
        itinerary={tripDocument?.itinerary}
        plan={plan && { ...plan, days }}
        day={day}
        dayOptions={dayOptions}
        activities={activities}
        activitiesLoading={activitiesLoading}
        planLoading={!resource && !error}
        assessment={assessment}
        destination={destination}
        readOnly={readOnly}
        busy={busy}
        pendingTiming={pendingTiming}
        notice={
          <>
            {error && (
              <div role="alert" className="calendar-notice">
                {error}
                {!resource && (
                  <Button onClick={() => void reload()}>Retry calendar</Button>
                )}
              </div>
            )}
            {plan && resource?.data.timingStale && (
              <p className="calendar-notice">
                Schedule needs review{" "}
                <Button
                  disabled={busy || readOnly}
                  onClick={() =>
                    void persist(plan, { closeEditor: false }).catch(
                      (reason: Error) => setError(reason.message),
                    )
                  }
                >
                  Update times
                </Button>
              </p>
            )}
          </>
        }
        onDay={selectDay}
        onTiming={(timing) => void saveTiming(timing)}
        onUnschedule={(id) => void removeFromSchedule(id, "drag")}
        onEvent={openEvent}
        onEntry={openEntry}
        onDayDetails={() => {
          setEditorError("");
          setEditor({ kind: "day" });
        }}
      />
      {plan &&
        !plan.selectedActivityIds.length &&
        !readOnly &&
        onChooseActivities && (
          <Button onClick={onChooseActivities}>Choose activities</Button>
        )}
      <OverlayDrawer
        open={!!editor}
        position="end"
        size="small"
        className="calendar-editor"
        onOpenChange={(_, data) => {
          if (!data.open) close();
        }}
      >
        <DrawerHeader>
          <DrawerHeaderTitle
            action={
              <Button
                appearance="secondary"
                aria-label="Close event"
                icon={<Dismiss24Regular />}
                disabled={savingEditor}
                onClick={close}
              />
            }
          >
            {title}
          </DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody>
          {editor?.kind === "event" && (
            <fieldset
              disabled={savingEditor || Boolean(calculating) || readOnly}
              className="calendar-editor-fields"
            >
              <legend className="visually-hidden">Event timing</legend>
              <label>
                Activity
                <select
                  aria-label="Event activity"
                  value={editor.id}
                  onChange={(event) => openEvent(event.target.value)}
                >
                  {activities.map(({ id }) => (
                    <option key={id} value={id}>
                      {activities.find((item) => item.id === id)?.properties
                        .name ?? "Activity"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Date
                <select
                  aria-label="Event date"
                  value={editor.dayKey}
                  onChange={(event) =>
                    updateEvent({ dayKey: event.target.value })
                  }
                >
                  {days.map((item) => (
                    <option
                      key={calendarDayKey(item)}
                      value={calendarDayKey(item)}
                    >
                      {item.name ? `${item.name} · ` : ""}
                      {calendarDateLabel(item.date)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Starts
                <input
                  aria-label="Event start"
                  type="time"
                  required
                  value={editor.start}
                  onChange={(event) =>
                    updateEvent({ start: event.target.value })
                  }
                />
              </label>
              <label>
                Ends
                <input
                  aria-label="Event end"
                  type="time"
                  required
                  value={editor.end}
                  onChange={(event) => updateEvent({ end: event.target.value })}
                />
              </label>
              <label className="calendar-checkbox">
                <input
                  type="checkbox"
                  checked={editor.nextDay}
                  onChange={(event) =>
                    updateEvent({ nextDay: event.target.checked })
                  }
                />
                Ends next day
              </label>
              <span className="calendar-zone">{plan?.timeZone}</span>
            </fieldset>
          )}
          {travelDrafts.map((travel) => {
            const key = activityRouteKey(travel.step);
            const estimating = calculating === key;
            const heading =
              travel.step.toActivityId === null
                ? "Return to stay"
                : "Transportation";
            return (
              <details
                className="calendar-editor-travel"
                key={key}
                open={eventDraft?.openTravel === key || undefined}
              >
                <summary>{heading}</summary>
                <p className="calendar-journey-label">{travel.step.label}</p>
                <fieldset
                  disabled={busy || Boolean(calculating) || readOnly}
                  className="calendar-editor-fields"
                >
                  <legend className="visually-hidden">{heading} details</legend>
                  <label>
                    Travel by
                    <select
                      aria-label="Transportation mode"
                      value={travel.mode}
                      onChange={(event) =>
                        updateTravel(travel, {
                          mode: event.target.value as TravelDraft["mode"],
                          minutes: "",
                          calculated: false,
                        })
                      }
                    >
                      <option value="driving">Driving</option>
                      <option value="walking">Walking</option>
                    </select>
                  </label>
                  <Button
                    appearance="secondary"
                    onClick={() => void calculate(travel)}
                  >
                    {estimating ? "Calculating…" : "Calculate travel time"}
                  </Button>
                  <label>
                    Travel time (minutes)
                    <input
                      aria-label="Travel time (minutes)"
                      type="number"
                      min={0}
                      max={1440}
                      value={travel.minutes}
                      onChange={(event) =>
                        updateTravel(travel, {
                          minutes: event.target.value,
                          calculated: false,
                        })
                      }
                    />
                  </label>
                  {travel.calculated && (
                    <span role="status">Azure Maps estimate</span>
                  )}
                  {estimating && (
                    <span role="status">Calculating travel time…</span>
                  )}
                </fieldset>
                {onSelectTravel && resource && travelPlan && (
                  <Button
                    disabled={busy || Boolean(calculating) || offline}
                    onClick={() => {
                      const duration = travelDuration(travel.minutes);
                      onSelectTravel({
                        ...travel.step,
                        mode: travel.mode,
                        duration: duration ?? travel.step.duration,
                        plan: withTravel(travelPlan, travel, duration),
                        contextVersion: resource.data.contextVersion,
                      });
                      close();
                    }}
                  >
                    View route
                  </Button>
                )}
              </details>
            );
          })}
          {editor?.kind === "day" && day && plan && (
            <>
              <DayNameEditor
                day={day}
                draftDay={false}
                disabled={busy || readOnly}
                onCommit={async (value, name) => {
                  await persist(
                    {
                      ...plan,
                      days: withCalendarDay(plan, value).days.map((item) =>
                        calendarDayKey(item) === calendarDayKey(value)
                          ? { ...item, name }
                          : item,
                      ),
                    },
                    { closeEditor: false },
                  );
                }}
              />
              <ActivityCalendarSubscriptions
                tripId={tripId}
                readOnly={offline}
              />
            </>
          )}
          {editor?.kind === "info" && (
            <>
              <p>
                {calendarClock(editor.entry.start)}
                {editor.entry.end !== editor.entry.start &&
                  `–${calendarClock(editor.entry.end)}`}
                {editor.entry.detail && ` · ${editor.entry.detail}`}
              </p>
              {editor.entry.transportation && (
                <div className="calendar-transportation-details">
                  {editor.entry.transportation.mode && (
                    <p>{editor.entry.transportation.mode}</p>
                  )}
                  {editor.entry.transportation.notes && (
                    <p>{editor.entry.transportation.notes}</p>
                  )}
                  <ol>
                    {editor.entry.transportation.features
                      .filter(
                        (feature) =>
                          feature.id === "from" ||
                          feature.id === "to" ||
                          feature.properties.instructions,
                      )
                      .sort((a, b) =>
                        a.id === "from" || b.id === "to"
                          ? -1
                          : b.id === "from" || a.id === "to"
                            ? 1
                            : (a.properties.sequence ?? 0) -
                              (b.properties.sequence ?? 0),
                      )
                      .map((feature) => (
                        <li key={feature.id}>
                          {[
                            feature.properties.name,
                            feature.properties.line,
                            feature.properties.instructions,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </li>
                      ))}
                  </ol>
                  {editor.entry.transportation.routeStale && (
                    <p role="status">Route needs review</p>
                  )}
                </div>
              )}
            </>
          )}
          {editorError && (
            <div role="alert" className="calendar-editor-error">
              {editorError}
              <Button
                disabled={busy || Boolean(calculating) || offline}
                onClick={() => void reload()}
              >
                Refresh calendar
              </Button>
            </div>
          )}
        </DrawerBody>
        <DrawerFooter className="calendar-editor-footer">
          {editor?.kind === "event" && (
            <Button
              disabled={busy}
              onClick={() => {
                onSelect(editor.id);
                close();
              }}
            >
              Activity details
            </Button>
          )}
          {eventDraft && eventIsScheduled && (
            <Button
              disabled={readOnly || busy || Boolean(calculating)}
              onClick={() => void removeFromSchedule(eventDraft.id, "drawer")}
            >
              Unschedule
            </Button>
          )}
          {!readOnly && editor?.kind === "event" && (
            <Button
              appearance="primary"
              disabled={busy || Boolean(calculating)}
              onClick={() => void saveEditor()}
            >
              {savingEditor ? "Saving…" : "Save"}
            </Button>
          )}
          <Button disabled={savingEditor} onClick={close}>
            {readOnly || editor?.kind === "info" || editor?.kind === "day"
              ? "Close"
              : "Cancel"}
          </Button>
        </DrawerFooter>
      </OverlayDrawer>
    </section>
  );
}
