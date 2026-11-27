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
  type ActivityPlan,
  type PlanResponse,
  type Versioned,
} from "./activityPlanApi";
import {
  applyEventTiming,
  calendarClock,
  calendarDateLabel,
  calendarDayKey,
  calendarDays,
  calendarEntries,
  clockMinutes,
  withCalendarDay,
  type CalendarEntry,
  type CalendarTiming,
} from "./activityCalendarModel";
import type {
  ActivityRouteSelection,
  ActivityRouteStep,
} from "./activityRouteApi";
import ActivityCalendar from "./ActivityCalendar";
import DayNameEditor from "./DayNameEditor";
import ActivityCalendarSubscriptions from "./ActivityCalendarSubscriptions";
import { DailyPlanSkeleton } from "./ActivityPlanningSkeletons";
import "./activityPlan.css";

type EventDraft = {
  kind: "event";
  id: string;
  dayKey: string;
  start: string;
  end: string;
  nextDay: boolean;
};
type TravelDraft = {
  kind: "travel";
  step: ActivityRouteStep;
  mode: "driving" | "walking";
  minutes: string;
  calculated?: boolean;
};
type Editor =
  | EventDraft
  | TravelDraft
  | { kind: "day" }
  | { kind: "info"; entry: CalendarEntry };

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
  activities,
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
  destination?: Destination;
  activities: Activity[];
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
  const offline = documentState.offline || navigator.onLine === false;
  const readOnly = providedReadOnly || offline;
  const [resource, setResource] = useState<Versioned<PlanResponse>>();
  const [dayKey, setDayKey] = useState("");
  const [editor, setEditor] = useState<Editor>();
  const [busy, setBusy] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");
  const [editorError, setEditorError] = useState("");
  const [pendingSchedule, setPendingSchedule] = useState<{
    plan: ActivityPlan;
    timing: CalendarTiming;
  }>();
  const operation = useRef(false);
  const active = useRef(true);
  const routeRequest = useRef<AbortController | undefined>(undefined);
  const savedRequest = useRef<AbortController | undefined>(undefined);
  const plan = pendingSchedule?.plan ?? resource?.data.plan;
  const pendingTiming = pendingSchedule?.timing;
  const assessment = resource?.data.assessment;
  const savedVisits = resource?.data.context.visits;
  const visits = useMemo(
    () =>
      savedVisits ??
      destination?.properties.stays.map((stay) => ({
        stayId: stay.id,
        arrivalDate: stay.arrivalDate,
        departureDate: stay.departureDate,
      })) ??
      [],
    [savedVisits, destination],
  );
  const days = useMemo(
    () => (plan ? calendarDays(plan, visits) : []),
    [plan, visits],
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
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      routeRequest.current?.abort();
      savedRequest.current?.abort();
    };
  }, [path]);
  useEffect(() => {
    const abort = new AbortController();
    void planningRequest<PlanResponse>(path, { signal: abort.signal }).then(
      (value) => {
        if (!abort.signal.aborted) setResource(value);
      },
      (reason: Error) => {
        if (!abort.signal.aborted) setError(reason.message);
      },
    );
    return () => {
      abort.abort();
    };
  }, [path, resourceVersion]);
  useEffect(() => {
    if (readOnly) {
      routeRequest.current?.abort();
      savedRequest.current?.abort();
    }
  }, [readOnly]);
  async function reload() {
    if (operation.current) return;
    try {
      const value = await planningRequest<PlanResponse>(path);
      if (active.current) {
        setResource(value);
        setError("");
      }
    } catch (reason) {
      if (active.current) setError((reason as Error).message);
    }
  }
  useExplicitResourceRefresh(path, reload);

  async function persist(
    next: ActivityPlan,
    {
      closeEditor = true,
      timing,
    }: { closeEditor?: boolean; timing?: CalendarTiming } = {},
  ) {
    if (!resource || readOnly || operation.current) return;
    operation.current = true;
    setBusy(true);
    setEditorError("");
    const controller = new AbortController();
    // A dropped card starts a background save that can finish after leaving Schedule.
    if (timing) setPendingSchedule({ plan: next, timing });
    else savedRequest.current = controller;
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
      if (controller.signal.aborted || !active.current) return;
      setResource(value);
      if (timing) setPendingSchedule(undefined);
      if (closeEditor) setEditor(undefined);
      try {
        await onSaved();
      } catch {
        const message = "Calendar saved. Activity details could not refresh.";
        if (timing) onScheduleError(message);
        else if (active.current) setError(message);
      }
    } catch (reason) {
      if (timing) {
        if (active.current) setPendingSchedule(undefined);
        throw reason;
      }
      if (controller.signal.aborted || !active.current) return;
      setEditorError((reason as Error).message);
      throw reason;
    } finally {
      operation.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function saveTiming(timing: CalendarTiming) {
    if (!plan || !day || readOnly || operation.current) return;
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
      await persist(next, { closeEditor: false, timing });
    } catch (reason) {
      const message =
        reason instanceof Error && !(reason instanceof TypeError)
          ? reason.message
          : "Try again.";
      onScheduleError(`Could not save the schedule. ${message}`);
    }
  }
  function openEvent(id?: string) {
    if (!plan || !day) return;
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
    setEditor({
      kind: "event",
      id: selected,
      dayKey: calendarDayKey(assigned),
      start,
      end: calendarClock(endMinute),
      nextDay: endMinute >= 1440,
    });
    setEditorError("");
  }
  function openEntry(entry: CalendarEntry) {
    setEditorError("");
    if (entry.activityId) openEvent(entry.activityId);
    else if (entry.travel && plan) {
      const override = plan.transportOverrides.find(
        (item) =>
          item.date === entry.travel!.date &&
          item.fromActivityId === entry.travel!.fromActivityId &&
          item.toActivityId === entry.travel!.toActivityId,
      );
      const mode = entry.travel.mode === "walking" ? "walking" : "driving";
      setEditor({
        kind: "travel",
        step: entry.travel,
        mode,
        minutes: String(
          durationMinutes(override?.duration) ??
            (entry.detail === "Travel time unknown"
              ? ""
              : durationMinutes(entry.travel.duration)),
        ),
      });
    } else setEditor({ kind: "info", entry });
  }
  function close() {
    if (busy) return;
    routeRequest.current?.abort();
    setEditor(undefined);
    setEditorError("");
  }
  function updateEvent(change: Partial<EventDraft>) {
    setEditor((current) =>
      current?.kind === "event" ? { ...current, ...change } : current,
    );
    setEditorError("");
  }
  function updateTravel(change: Partial<TravelDraft>) {
    setEditor((current) =>
      current?.kind === "travel" ? { ...current, ...change } : current,
    );
    setEditorError("");
  }
  function point(id: string | null, stayId: string): Point | null | undefined {
    return id === null
      ? destination?.properties.stays.find((stay) => stay.id === stayId)
          ?.stayLocation?.geometry
      : activities.find((item) => item.id === id)?.geometry;
  }
  async function calculate() {
    if (editor?.kind !== "travel" || readOnly || calculating) return;
    const from = point(editor.step.fromActivityId, editor.step.stayId);
    const to = point(editor.step.toActivityId, editor.step.stayId);
    if (!from || !to) {
      setEditorError(
        "Set both activity locations before calculating travel time.",
      );
      return;
    }
    const controller = new AbortController();
    routeRequest.current = controller;
    setCalculating(true);
    setEditorError("");
    try {
      const duration = await mapsClient.estimateTravelTime(
        from.coordinates,
        to.coordinates,
        editor.mode,
        controller.signal,
      );
      if (!controller.signal.aborted)
        updateTravel({
          minutes: String(durationMinutes(duration)),
          calculated: true,
        });
    } catch (reason) {
      if (!controller.signal.aborted) setEditorError((reason as Error).message);
    } finally {
      if (active.current) setCalculating(false);
    }
  }
  async function saveEditor() {
    if (!plan || !editor || readOnly || calculating) return;
    try {
      if (editor.kind === "event") {
        const target = days.find(
          (item) => calendarDayKey(item) === editor.dayKey,
        );
        if (!target) throw new Error("Choose a day in this visit.");
        const next = applyEventTiming(
          withCalendarDay(plan, target),
          editor.id,
          target,
          editor.start,
          editor.end,
          editor.nextDay,
          resource?.data.assessment,
        );
        await persist(next);
        setDayKey(calendarDayKey(target));
      } else if (editor.kind === "travel") {
        const minutes = Number(editor.minutes);
        if (
          !editor.minutes.trim() ||
          !Number.isFinite(minutes) ||
          minutes < 0 ||
          minutes > 1440
        )
          throw new Error("Enter a travel time between 0 and 1,440 minutes.");
        await persist(withTravel(plan, editor, durationFromMinutes(minutes)));
      }
    } catch (reason) {
      setEditorError((reason as Error).message);
    }
  }
  if (!plan || !resource)
    return (
      <section className="daily-plan">
        {error ? (
          <div role="alert">
            {error}
            <Button onClick={() => void reload()}>Retry calendar</Button>
          </div>
        ) : (
          <DailyPlanSkeleton />
        )}
      </section>
    );
  const title =
    editor?.kind === "event"
      ? (activities.find((item) => item.id === editor.id)?.properties.name ??
        "Event")
      : editor?.kind === "travel"
        ? "Transportation"
        : editor?.kind === "day"
          ? "Day details"
          : editor?.kind === "info"
            ? editor.entry.title
            : "Event";
  return (
    <section className="daily-plan" aria-label="Activity calendar">
      {error && <p role="alert">{error}</p>}
      {resource.data.timingStale && (
        <p className="calendar-notice">
          Schedule needs review{" "}
          <Button
            disabled={busy || readOnly}
            onClick={() =>
              void persist(plan).catch((reason: Error) =>
                setError(reason.message),
              )
            }
          >
            Update times
          </Button>
        </p>
      )}
      <ActivityCalendar
        tripId={tripId}
        itinerary={
          documentState.tripId === tripId
            ? documentState.document?.document.itinerary
            : undefined
        }
        plan={{ ...plan, days }}
        day={day}
        activities={activities}
        assessment={resource.data.assessment}
        destination={destination}
        readOnly={readOnly}
        busy={busy}
        pendingTiming={pendingTiming}
        onDay={(key) => {
          setDayKey(key);
          onPlanChange?.();
        }}
        onTiming={(timing) => void saveTiming(timing)}
        onEvent={openEvent}
        onEntry={openEntry}
        onDayDetails={() => {
          setEditorError("");
          setEditor({ kind: "day" });
        }}
      />
      {!plan.selectedActivityIds.length && !readOnly && onChooseActivities && (
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
                disabled={busy}
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
              disabled={busy || readOnly}
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
              <span className="calendar-zone">{plan.timeZone}</span>
            </fieldset>
          )}
          {editor?.kind === "travel" && (
            <>
              <p className="calendar-journey-label">{editor.step.label}</p>
              <fieldset
                disabled={busy || calculating || readOnly}
                className="calendar-editor-fields"
              >
                <legend className="visually-hidden">
                  Transportation details
                </legend>
                <label>
                  Travel by
                  <select
                    aria-label="Transportation mode"
                    value={editor.mode}
                    onChange={(event) =>
                      updateTravel({
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
                  appearance={editor.calculated ? "secondary" : "primary"}
                  onClick={() => void calculate()}
                >
                  {calculating ? "Calculating…" : "Calculate travel time"}
                </Button>
                <label>
                  Travel time (minutes)
                  <input
                    aria-label="Travel time (minutes)"
                    type="number"
                    min={0}
                    max={1440}
                    value={editor.minutes}
                    onChange={(event) =>
                      updateTravel({
                        minutes: event.target.value,
                        calculated: false,
                      })
                    }
                  />
                </label>
                {editor.calculated && <p role="status">Azure Maps estimate</p>}
              </fieldset>
              {calculating && <p role="status">Calculating travel time…</p>}
              {onSelectTravel && (
                <Button
                  disabled={busy || calculating || offline}
                  onClick={() => {
                    const minutes = Number(editor.minutes);
                    const duration =
                      editor.minutes.trim() &&
                      Number.isFinite(minutes) &&
                      minutes >= 0 &&
                      minutes <= 1440
                        ? durationFromMinutes(minutes)
                        : null;
                    onSelectTravel({
                      ...editor.step,
                      mode: editor.mode,
                      duration: duration ?? editor.step.duration,
                      plan: withTravel(plan, editor, duration),
                      contextVersion: resource.data.contextVersion,
                    });
                    close();
                  }}
                >
                  View route
                </Button>
              )}
            </>
          )}
          {editor?.kind === "day" && day && (
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
                disabled={busy || calculating || offline}
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
          {!readOnly &&
            (editor?.kind === "event" || editor?.kind === "travel") && (
              <Button
                appearance="primary"
                disabled={busy || calculating}
                onClick={() => void saveEditor()}
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            )}
          <Button disabled={busy} onClick={close}>
            {readOnly || editor?.kind === "info" || editor?.kind === "day"
              ? "Close"
              : "Cancel"}
          </Button>
        </DrawerFooter>
      </OverlayDrawer>
    </section>
  );
}
