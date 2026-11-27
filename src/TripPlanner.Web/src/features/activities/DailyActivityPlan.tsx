import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
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
import type { ActivityMapSchedule } from "../../maps/ActivityMap";
import { estimateTransportation } from "../trips/transportationApi";
import {
  durationFromMinutes,
  durationMinutes,
} from "../../shared/time/durations";
import type { Activity, Destination } from "./activitiesApi";
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
  activityRoutePoint,
  type ActivityRoutePreview,
  type ActivityRouteSelection,
  type ActivityRouteStep,
} from "./activityRouteApi";
import { useScheduledActivityRoutes } from "./useScheduledActivityRoutes";
import DestinationPlanningProgress from "../trips/DestinationPlanningProgress";
import ActivityCalendar from "./ActivityCalendar";
import { dayPlanningReview } from "./dayPlanningReview";
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
  route?: ActivityRoutePreview;
  routeError?: string;
  departure?: string | null;
};
type Editor =
  | EventDraft
  | { kind: "day" }
  | { kind: "notices" }
  | { kind: "info"; entry: CalendarEntry };
type CalendarRequests = {
  path: string;
  writing: boolean;
  route?: AbortController;
  save?: AbortController;
  timingContext?: string;
};

const inlineScheduleNoticeLimit = 5;

export type DailyActivityPlanHandle = {
  openActivity: (id: string) => boolean;
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
  ref,
  tripId,
  destinationId,
  destination,
  tripCalendar,
  activities,
  activitiesLoading = false,
  mapPanel,
  active = true,
  readOnly: providedReadOnly,
  onSelect,
  onSaved,
  onScheduleError,
  onChooseActivities,
  onSelectTravel,
  onTravelMapChange,
  onPlanChange,
  onMapScheduleChange,
}: {
  ref?: Ref<DailyActivityPlanHandle>;
  tripId: string;
  destinationId: string;
  destination: Destination;
  tripCalendar?: {
    destinations: Destination[];
    initialDayKey?: string;
    openDayDetails?: boolean;
    showUnscheduled?: boolean;
    onDestinationDay: (destinationId: string, key: string) => void;
  };
  activities: Activity[];
  activitiesLoading?: boolean;
  mapPanel?: RefObject<HTMLDivElement | null>;
  active?: boolean;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onSaved: () => Promise<void>;
  onScheduleError: (message: string) => void;
  onChooseActivities?: () => void;
  onSelectTravel?: (selection: ActivityRouteSelection) => void;
  onTravelMapChange?: (route: ActivityRoutePreview | undefined) => void;
  onPlanChange?: () => void;
  onMapScheduleChange?: (schedule: ActivityMapSchedule) => void;
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
  const initialEditor: Editor | undefined = tripCalendar?.openDayDetails
    ? { kind: "day" }
    : undefined;
  const [editor, setEditor] = useState<Editor | undefined>(initialEditor);
  const scheduleSection = useRef<HTMLElement>(null);
  const [saving, setSaving] = useState<"calendar" | "editor" | "timing">();
  const busy = saving !== undefined;
  const savingEditor = saving === "editor";
  const [previewTravelKey, setPreviewTravelKey] = useState<string>();
  const [calculating, setCalculating] = useState<string>();
  const [error, setError] = useState("");
  const [timingError, setTimingError] = useState("");
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
    setEditor(initialEditor);
    setSaving(undefined);
    setCalculating(undefined);
    setError("");
    setTimingError("");
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
  const { activeRoutes, rememberRoute } = useScheduledActivityRoutes(
    path,
    resource?.data,
    day,
    activities,
    destination,
    offline,
  );
  const dayReview =
    editor?.kind === "day" && day && resource && !activitiesLoading
      ? dayPlanningReview(
          resource.data,
          day,
          destination,
          activities,
          tripDocument?.itinerary,
        )
      : undefined;
  const scheduleNotices = (assessment?.issues ?? [])
    .filter(
      (item) =>
        item.code !== "unscheduled" &&
        item.code !== "hours_unknown" &&
        (!item.date || item.date === day?.date),
    )
    .sort(
      (a, b) =>
        Number(b.severity === "conflict") - Number(a.severity === "conflict"),
    );
  const moreNotices = scheduleNotices.slice(inlineScheduleNoticeLimit);
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
            ({ step, minutes, departure }): TravelDraft =>
              eventDraft.travelEdits[activityRouteKey(step)] ?? {
                step,
                departure,
                mode: step.mode === "walking" ? "walking" : "driving",
                minutes: minutes === null ? "" : String(minutes),
              },
          )
      : [];
  const travelPreview = travelDrafts.find(
    ({ step }) => activityRouteKey(step) === previewTravelKey,
  )?.route;
  const showTravelMap = useEffectEvent(
    (route: ActivityRoutePreview | undefined) => onTravelMapChange?.(route),
  );
  useLayoutEffect(() => {
    if (!travelPreview) return;
    showTravelMap(travelPreview);
    return () => showTravelMap(undefined);
  }, [travelPreview]);
  const showScheduleOnMap = useEffectEvent((schedule: ActivityMapSchedule) =>
    onMapScheduleChange?.(schedule),
  );
  useLayoutEffect(() => {
    if (!plan || !day) {
      showScheduleOnMap({ activeActivityIds: [], scheduledActivityIds: [] });
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
    showScheduleOnMap({
      activeActivityIds: [
        ...timed,
        ...day.activityIds.filter((id) => !timed.has(id)),
      ],
      scheduledActivityIds: plan.days.flatMap((item) => item.activityIds),
      ...(activeRoutes.size ? { routes: activeRoutes } : {}),
    });
  }, [plan, day, activities, assessment, pendingTiming, activeRoutes]);
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
  async function reload(retryTiming = false) {
    const requests = currentRequests();
    if (!requests || requests.writing) return;
    const controller = retryTiming ? new AbortController() : undefined;
    if (controller) {
      requests.writing = true;
      requests.save = controller;
      setSaving("timing");
    }
    if (!resource) setError("");
    try {
      const value = await planningRequest<PlanResponse>(path, {
        signal: controller?.signal,
      });
      if (controller?.signal.aborted) return;
      if (activeRequests.current === requests) {
        if (retryTiming) {
          requests.timingContext = undefined;
          setTimingError("");
        }
        setResource(value);
        setError("");
      }
    } catch (reason) {
      if (!controller?.signal.aborted && activeRequests.current === requests) {
        if (retryTiming) setTimingError((reason as Error).message);
        else setError((reason as Error).message);
      }
    } finally {
      if (controller) {
        requests.writing = false;
        requests.save = undefined;
        if (activeRequests.current === requests) setSaving(undefined);
      }
    }
  }
  useExplicitResourceRefresh(path, () =>
    reload(resource?.data.timingStale === true),
  );

  const refreshTiming = useEffectEvent(async () => {
    const requests = currentRequests();
    if (
      !resource?.data.timingStale ||
      !requests ||
      requests.writing ||
      requests.timingContext === resource.data.contextVersion
    )
      return;
    requests.timingContext = resource.data.contextVersion;
    setTimingError("");
    try {
      const saved = await persist(resource.data.plan, {
        closeEditor: false,
        refreshingTiming: true,
      });
      if (activeRequests.current !== requests) return;
      if (!saved) requests.timingContext = undefined;
      else if (saved.data.timingStale)
        setTimingError("The saved times are still out of date.");
    } catch (reason) {
      if (activeRequests.current === requests)
        setTimingError(reason instanceof Error ? reason.message : "Try again.");
    }
  });
  const editingEvent = editor?.kind === "event";
  useEffect(() => {
    if (
      !active ||
      readOnly ||
      busy ||
      editingEvent ||
      !resource?.data.timingStale
    )
      return;
    const timer = window.setTimeout(() => void refreshTiming(), 0);
    return () => window.clearTimeout(timer);
  }, [active, readOnly, busy, editingEvent, resource]);

  useImperativeHandle(ref, () => ({ openActivity: openEvent }));

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
      onCommit,
      refreshingTiming = false,
    }: {
      closeEditor?: boolean;
      background?: { timing?: CalendarTiming };
      onCommit?: () => void;
      refreshingTiming?: boolean;
    } = {},
  ) {
    const requests = currentRequests();
    if (!resource || readOnly || !requests || requests.writing) return;
    requests.writing = true;
    setSaving(
      refreshingTiming
        ? "timing"
        : editor && !background
          ? "editor"
          : "calendar",
    );
    setEditorError("");
    const controller = new AbortController();
    // Calendar drops and refreshes can finish after leaving Schedule.
    if (background)
      setPendingSchedule({ plan: next, timing: background.timing });
    else if (!refreshingTiming) requests.save = controller;
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
      onCommit?.();
      setResource(value);
      if (background) setPendingSchedule(undefined);
      if (closeEditor) setEditor(undefined);
      if (refreshingTiming) return value;
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
      if (editor && !refreshingTiming)
        setEditorError((reason as Error).message);
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
    if (!plan || !day || !requests || requests.writing) return false;
    const selected =
      id ??
      plan.selectedActivityIds.find(
        (item) => !plan.days.some((d) => d.activityIds.includes(item)),
      ) ??
      plan.selectedActivityIds[0] ??
      activities[0]?.id;
    if (!selected) return false;
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
    return true;
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
  async function calculateRoute(travel: TravelDraft, mode = travel.mode) {
    const requests = currentRequests();
    if (readOnly || !requests || requests.writing) return;
    requests.route?.abort();
    const key = activityRouteKey(travel.step);
    const draft: TravelDraft = {
      ...travel,
      mode,
      minutes: mode === travel.mode ? travel.minutes : "",
      route: undefined,
      routeError: undefined,
    };
    const { step } = draft;
    const from = activityRoutePoint(
      step.fromActivityId,
      step.stayId,
      activities,
      destination,
    );
    const to = activityRoutePoint(
      step.toActivityId,
      step.stayId,
      activities,
      destination,
    );
    setPreviewTravelKey(key);
    if (!from || !to) {
      setCalculating(undefined);
      updateTravel(draft, {
        routeError: "Set both locations before calculating the route.",
      });
      return;
    }
    const controller = new AbortController();
    requests.route = controller;
    updateTravel(draft, {});
    setCalculating(key);
    try {
      const departure =
        draft.departure && Date.parse(draft.departure) > Date.now()
          ? draft.departure
          : undefined;
      const { data } = await estimateTransportation(
        tripId,
        from,
        to,
        mode === "walking" ? "walk" : "car",
        controller.signal,
        departure,
      );
      if (controller.signal.aborted || activeRequests.current !== requests)
        return;
      const minutes = durationMinutes(data?.duration);
      if (minutes == null || !data?.geometry?.coordinates.length)
        throw new Error("The route could not be calculated.");
      const route = { mode, geometry: data.geometry };
      updateTravel(draft, { minutes: String(minutes), route });
    } catch (reason) {
      if (!controller.signal.aborted && activeRequests.current === requests)
        updateTravel(draft, {
          routeError:
            reason instanceof Error
              ? reason.message
              : "The route could not be calculated.",
        });
    } finally {
      if (
        activeRequests.current === requests &&
        requests.route === controller
      ) {
        requests.route = undefined;
        setCalculating(undefined);
      }
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
      await persist(next, {
        onCommit: () => {
          for (const { step, mode, route } of editedTravel) {
            if (route) rememberRoute({ ...step, mode }, route);
          }
        },
      });
      if (activeRequests.current === requests) setDayKey(eventDraft.dayKey);
    } catch (reason) {
      if (activeRequests.current === requests)
        setEditorError((reason as Error).message);
    }
  }
  async function confirmDay(day: PlanDay, token: string) {
    if (!plan) return;
    const updated = withCalendarDay(plan, day);
    await persist(
      {
        ...updated,
        days: updated.days.map((item) =>
          calendarDayKey(item) === calendarDayKey(day)
            ? { ...item, review: token }
            : item,
        ),
      },
      { closeEditor: false },
    );
  }
  const calendarReady = !!resource && !activitiesLoading;
  useLayoutEffect(() => {
    if (tripCalendar?.showUnscheduled && calendarReady) {
      scheduleSection.current?.scrollIntoView?.({ block: "start" });
    }
  }, [tripCalendar?.showUnscheduled, calendarReady]);
  const title =
    editor?.kind === "event"
      ? (activities.find((item) => item.id === editor.id)?.properties.name ??
        "Event")
      : editor?.kind === "info"
        ? editor.entry.title
        : editor?.kind === "notices"
          ? "More schedule notices"
          : "Day details";
  return (
    <section
      className="daily-plan"
      aria-label="Activity calendar"
      ref={scheduleSection}
    >
      <ActivityCalendar
        tripId={tripId}
        itinerary={tripDocument?.itinerary}
        plan={plan && { ...plan, days }}
        day={day}
        dayOptions={dayOptions}
        activities={activities}
        activitiesLoading={activitiesLoading}
        mapPanel={mapPanel}
        planLoading={!resource && !error}
        assessment={assessment}
        destination={destination}
        readOnly={readOnly}
        busy={busy}
        pendingTiming={pendingTiming}
        scheduleNotices={scheduleNotices.slice(0, inlineScheduleNoticeLimit)}
        moreNoticeCount={moreNotices.length}
        onMoreNotices={() => setEditor({ kind: "notices" })}
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
            {saving === "timing" && (
              <p className="calendar-timing-update" role="status">
                Updating schedule times…
              </p>
            )}
            {resource?.data.timingStale &&
              timingError &&
              documentState.conflict !== path &&
              !readOnly &&
              saving !== "timing" && (
                <div className="calendar-notice" role="alert">
                  <p>Couldn’t update schedule times. {timingError}</p>
                  <Button disabled={busy} onClick={() => void reload(true)}>
                    Retry
                  </Button>
                </div>
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
        position={travelDrafts.length ? "start" : "end"}
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
                aria-label={
                  editor?.kind === "event" || editor?.kind === "info"
                    ? "Close event"
                    : "Close drawer"
                }
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
                onToggle={(event) => {
                  if (event.currentTarget.open) {
                    if (travel.route) setPreviewTravelKey(key);
                  } else {
                    setPreviewTravelKey((current) =>
                      current === key ? undefined : current,
                    );
                  }
                }}
              >
                <summary>{heading}</summary>
                <p className="calendar-journey-label">{travel.step.label}</p>
                <fieldset
                  disabled={
                    busy || (Boolean(calculating) && !estimating) || readOnly
                  }
                  className="calendar-editor-fields"
                >
                  <legend className="visually-hidden">{heading} details</legend>
                  <label>
                    Travel by
                    <select
                      aria-label="Transportation mode"
                      value={travel.mode}
                      onChange={(event) =>
                        void calculateRoute(
                          travel,
                          event.target.value as TravelDraft["mode"],
                        )
                      }
                    >
                      <option value="driving">Driving</option>
                      <option value="walking">Walking</option>
                    </select>
                  </label>
                  <label>
                    Travel time (minutes)
                    <input
                      aria-label="Travel time (minutes)"
                      aria-busy={estimating}
                      disabled={estimating}
                      placeholder={estimating ? "Calculating…" : undefined}
                      type="number"
                      min={0}
                      max={1440}
                      value={travel.minutes}
                      onChange={(event) =>
                        updateTravel(travel, { minutes: event.target.value })
                      }
                    />
                  </label>
                  {travel.routeError && (
                    <>
                      <p role="alert">{travel.routeError}</p>
                      <Button
                        appearance="secondary"
                        onClick={() => void calculateRoute(travel)}
                      >
                        Retry route
                      </Button>
                    </>
                  )}
                </fieldset>
                {!travel.route &&
                  !travel.routeError &&
                  !estimating &&
                  onSelectTravel &&
                  resource &&
                  travelPlan && (
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
          {editor?.kind === "notices" && (
            <ul className="calendar-notice-list">
              {moreNotices.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          )}
          {editor?.kind === "day" && day && plan && (
            <>
              <p>{calendarDateLabel(day.date)}</p>
              {resource && (
                <DestinationPlanningProgress
                  response={resource.data}
                  stayId={day.stayId}
                  date={day.date}
                  name={destination.properties.name}
                />
              )}

              {dayReview?.conflict && <p role="alert">{dayReview.conflict}</p>}
              {dayReview?.missingTiming && (
                <p>
                  Schedule the activities on this day before marking it planned.
                </p>
              )}
              {dayReview?.planned && (
                <p>{dayReview.open ? "Open by choice" : "Day planned"}</p>
              )}
              {dayReview?.canReview && !dayReview.planned && !readOnly && (
                <Button
                  appearance="primary"
                  disabled={busy}
                  onClick={() =>
                    void confirmDay(day, dayReview.token).catch(() => {})
                  }
                >
                  {dayReview.open ? "Keep day open" : "Mark day planned"}
                </Button>
              )}
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
          {savingEditor && editor?.kind !== "event" && (
            <p role="status">Saving day review…</p>
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
            {readOnly ||
            editor?.kind === "info" ||
            editor?.kind === "day" ||
            editor?.kind === "notices"
              ? "Close"
              : "Cancel"}
          </Button>
        </DrawerFooter>
      </OverlayDrawer>
    </section>
  );
}
