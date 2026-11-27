import type { Activity, Destination } from "./activitiesApi";
import {
  activityRule,
  chooseActivity,
  namedDayLabel,
  type ActivityPlan,
  type PlanAssessment,
  type PlanDay,
} from "./activityPlanApi";
import type { ActivityRouteStep } from "./activityRouteApi";
import type { Transportation } from "../trips/transportationApi";
import {
  durationFromMinutes,
  durationMinutes,
} from "../../shared/time/durations";
import { localClockInstant } from "../../shared/time/timeZones";

export const calendarDayKey = (day: Pick<PlanDay, "stayId" | "date">) =>
  `${day.stayId}:${day.date}`;

export type CalendarVisit = {
  stayId: string;
  arrivalDate: string | null;
  departureDate: string | null;
};

export type CalendarDayOption = {
  key: string;
  label: string;
  destinationId: string;
};

export function calendarDayOptions(
  destinationId: string,
  days: PlanDay[],
  destinations: Destination[],
  savedDays?: ReadonlyMap<string, CalendarDayDate[]>,
): CalendarDayOption[] {
  const options = destinations.flatMap((destination) => {
    const stayOrder = new Map(
      destination.properties.stays.map((stay) => [stay.id, stay.order]),
    );
    const destinationDays =
      destination.id === destinationId
        ? days
        : calendarDays(
            undefined,
            calendarVisits(destination),
            savedDays?.get(destination.id),
          );
    return destinationDays.map((day) => ({
      day,
      destinationId: destination.id,
      destinationName: destination.properties.name,
      order: stayOrder.get(day.stayId) ?? Number.MAX_SAFE_INTEGER,
    }));
  });
  const destinationByDate = new Map<string, string>();
  const sharedDates = new Set<string>();
  for (const { day, destinationId } of options) {
    const firstDestination = destinationByDate.get(day.date);
    if (firstDestination === undefined)
      destinationByDate.set(day.date, destinationId);
    else if (firstDestination !== destinationId) sharedDates.add(day.date);
  }

  return options
    .sort((a, b) => a.day.date.localeCompare(b.day.date) || a.order - b.order)
    .map(({ day, destinationId, destinationName }) => {
      const date = calendarDateLabel(day.date);
      const label = sharedDates.has(day.date)
        ? `${date} · ${destinationName}`
        : date;
      return {
        key: calendarDayKey(day),
        label: namedDayLabel(day, label),
        destinationId,
      };
    });
}

export function calendarVisits(destination: Destination): CalendarVisit[] {
  return destination.properties.stays.map((stay) => ({
    stayId: stay.id,
    arrivalDate: stay.arrivalDate,
    departureDate: stay.departureDate,
  }));
}

type CalendarDayDate = Pick<PlanDay, "stayId" | "date" | "name">;

// Visit dates can change independently of a saved activity plan. Keep both visible
// without moving or rewriting activities on the old dates.
export function calendarDays(
  plan: Pick<ActivityPlan, "days"> | undefined,
  visits: CalendarVisit[],
  savedDays: CalendarDayDate[] = [],
): PlanDay[] {
  const plannedDays = plan?.days ?? savedDays.map(emptyCalendarDay);
  const days = new Map(plannedDays.map((day) => [calendarDayKey(day), day]));
  for (const day of calendarVisitDays(visits)) {
    const key = calendarDayKey(day);
    if (!days.has(key)) days.set(key, emptyCalendarDay(day));
  }
  return [...days.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.stayId.localeCompare(b.stayId),
  );
}

function emptyCalendarDay(day: CalendarDayDate): PlanDay {
  return {
    ...day,
    activityIds: [],
    settings: null,
    availableFrom: null,
    availableUntil: null,
    availabilityConfirmed: false,
  };
}

function calendarVisitDays(visits: CalendarVisit[]) {
  const days: CalendarDayDate[] = [];
  for (const visit of visits) {
    const start = visit.arrivalDate ?? visit.departureDate;
    const end = visit.departureDate ?? visit.arrivalDate;
    if (!start || !end) continue;
    for (let date = start, count = 0; date <= end && count < 366; count++) {
      days.push({ stayId: visit.stayId, date });
      date = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
  }
  return days;
}

export function withCalendarDay(
  plan: ActivityPlan,
  day: PlanDay,
): ActivityPlan {
  return plan.days.some((item) => calendarDayKey(item) === calendarDayKey(day))
    ? plan
    : {
        ...plan,
        days: [...plan.days, day].sort((a, b) => a.date.localeCompare(b.date)),
      };
}
export const calendarDateLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
export const clockMinutes = (clock: string) =>
  Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
export const calendarClock = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.floor(minutes) % 60).padStart(2, "0")}`;
export function localMinutes(value: string, date: string) {
  // Assessment timestamps already carry destination-local clocks and offsets.
  const dateNumber = (text: string) =>
    Date.parse(`${text.slice(0, 10)}T00:00:00Z`);
  return (
    (dateNumber(value) - dateNumber(date)) / 60_000 +
    clockMinutes(value.slice(11, 16))
  );
}

export type CalendarEntry = {
  id: string;
  kind:
    "activity" | "travel" | "break" | "flight" | "transportation" | "lodging";
  title: string;
  start: number;
  end: number;
  detail?: string;
  activityId?: string;
  travel?: ActivityRouteStep;
  transportation?: Transportation;
  estimated?: boolean;
};

export type CalendarTiming = { activityId: string; start: number; end: number };
export type CalendarGesture = "move" | "start" | "end";

// A gesture edits destination wall-clock time in quarter-hour increments.
export function calendarGestureTiming(
  timing: CalendarTiming,
  mode: CalendarGesture,
  minute: number,
): CalendarTiming {
  const snapped = Math.round(minute / 15) * 15;
  if (mode === "start") {
    return {
      ...timing,
      start: Math.max(0, Math.min(1425, timing.end - 15, snapped)),
    };
  }
  if (mode === "end") {
    return {
      ...timing,
      end: Math.max(timing.start + 15, Math.min(timing.start + 1440, snapped)),
    };
  }
  const start = Math.max(0, Math.min(1425, snapped));
  return { ...timing, start, end: start + timing.end - timing.start };
}

export function calendarEntries(
  plan: ActivityPlan,
  day: PlanDay,
  activities: Activity[],
  assessment?: PlanAssessment,
  destination?: Destination,
  pendingTiming?: CalendarTiming,
): CalendarEntry[] {
  const evaluated = assessment?.days.find(
    (item) => calendarDayKey(item) === calendarDayKey(day),
  );
  const entries: CalendarEntry[] = [];
  const stay = destination?.properties.stays.find(
    (stay) => stay.id === day.stayId,
  );
  if (stay?.stayLocation) {
    const properties = stay.stayLocation.properties;
    const appointments: [string, string | null, string][] = [
      ["Check-in", stay.arrivalDate, properties.checkInTime ?? "16:00:00"],
      ["Check-out", stay.departureDate, properties.checkOutTime ?? "11:00:00"],
    ];
    for (const [action, date, time] of appointments) {
      if (date !== day.date) continue;
      const minute = clockMinutes(time);
      entries.push({
        id: `stay:${stay.id}:${action}`,
        kind: "lodging",
        title: `${action} · ${properties.name}`,
        start: minute,
        end: minute,
      });
    }
  }
  for (const id of day.activityIds) {
    const activity = activities.find((item) => item.id === id);
    const evaluatedEntry = evaluated?.entries.find(
      (item) => item.activityId === id,
    );
    const rule = activityRule(plan, id);
    const pending =
      pendingTiming?.activityId === id ? pendingTiming : undefined;
    const start =
      pending?.start ??
      (evaluatedEntry?.start
        ? localMinutes(evaluatedEntry.start, day.date)
        : rule.fixedStart
          ? clockMinutes(rule.fixedStart)
          : null);
    if (start === null) continue;
    const duration =
      durationMinutes(rule.duration ?? activity?.properties.duration) ?? 60;
    const end =
      pending?.end ??
      (evaluatedEntry?.end
        ? localMinutes(evaluatedEntry.end, day.date)
        : start + duration);
    entries.push({
      id,
      kind: "activity",
      title: activity?.properties.name ?? "Activity",
      activityId: id,
      start,
      end,
      detail: activity?.properties.placeName ?? undefined,
      estimated: !rule.fixedStart,
    });
  }
  for (const { step, minutes, departure, estimated } of calendarTravelLegs(
    plan,
    day,
    activities,
    assessment,
    destination,
  )) {
    const { fromActivityId: from, toActivityId: to, mode } = step;
    const fromEntry = entries.find((item) => item.activityId === from);
    const toEntry = entries.find((item) => item.activityId === to);
    const arrival =
      toEntry && minutes !== null && minutes > 0
        ? { start: toEntry.start - minutes, end: toEntry.start }
        : undefined;
    const start =
      arrival?.start ??
      (departure
        ? localMinutes(departure, day.date)
        : (fromEntry?.end ?? (minutes === 0 ? toEntry?.start : undefined)));
    if (start === undefined) continue;
    entries.push({
      id: `travel:${from}:${to}`,
      kind: "travel",
      start,
      end: arrival?.end ?? start + (minutes ?? 0),
      title:
        mode === "walking"
          ? "Walking"
          : mode === "driving"
            ? "Driving"
            : mode === "taxi"
              ? "Taxi"
              : "Choose transport",
      detail:
        minutes === null ? "Travel time unknown" : `${Math.ceil(minutes)} min`,
      estimated,
      travel: step,
    });
  }
  for (const item of evaluated?.breaks ?? []) {
    if (!item.start || !item.end) continue;
    entries.push({
      id: `break:${item.name}`,
      kind: "break",
      title: item.name.charAt(0).toUpperCase() + item.name.slice(1),
      start: localMinutes(item.start, day.date),
      end: localMinutes(item.end, day.date),
      estimated: true,
    });
  }
  const flights = evaluated?.flightAvailability?.candidates ?? [];
  for (const flight of flights.filter((item) => item.selected)) {
    if (
      !flight.departure ||
      !flight.arrival ||
      (flight.departure.slice(0, 10) !== day.date &&
        flight.arrival.slice(0, 10) !== day.date)
    )
      continue;
    const id = `flight:${flight.travellerId}:${flight.departure}:${flight.arrival}`;
    if (entries.some((entry) => entry.id === id)) continue;
    entries.push({
      id,
      kind: "flight",
      title: `Flight · ${flight.departureAirport ?? ""} → ${flight.arrivalAirport ?? ""}`,
      start: localMinutes(flight.departure, day.date),
      end: localMinutes(flight.arrival, day.date),
      detail: flight.travellerName,
    });
  }
  return entries.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

export function calendarTravelLegs(
  plan: ActivityPlan,
  day: PlanDay,
  activities: Activity[],
  assessment?: PlanAssessment,
  destination?: Destination,
) {
  const stay = destination?.properties.stays.find(
    (item) => item.id === day.stayId,
  )?.stayLocation;
  const stops = stay ? [null, ...day.activityIds, null] : day.activityIds;
  const assessedTravel = assessment?.days.find(
    (item) => calendarDayKey(item) === calendarDayKey(day),
  )?.travel;
  const title = (id: string | null) =>
    id === null
      ? "Stay"
      : (activities.find((activity) => activity.id === id)?.properties.name ??
        "Activity");

  return stops.slice(1).flatMap((to, index) => {
    const from = stops[index];
    if (from === null && to === null) return [];
    const leg = assessedTravel?.find(
      (item) => item.fromActivityId === from && item.toActivityId === to,
    );
    const override = plan.transportOverrides.find(
      (item) =>
        item.date === day.date &&
        item.fromActivityId === from &&
        item.toActivityId === to,
    );
    const duration = override?.duration ?? leg?.duration;
    const step: ActivityRouteStep = {
      stayId: day.stayId,
      date: day.date,
      fromActivityId: from,
      toActivityId: to,
      mode:
        override?.mode ??
        leg?.mode ??
        (day.settings ?? plan.settings).transportMode,
      duration: duration ?? "PT0M",
      label: `${title(from)} → ${title(to)}`,
    };
    return [
      {
        step,
        minutes: durationMinutes(duration),
        departure: leg?.departure,
        estimated: leg?.provisional,
      },
    ];
  });
}

export function applyEventTiming(
  plan: ActivityPlan,
  activityId: string,
  target: PlanDay,
  start: string,
  end: string,
  nextDay: boolean,
  assessment?: PlanAssessment,
): ActivityPlan {
  if (
    !/^\d{2}:\d{2}$/.test(start) ||
    !/^\d{2}:\d{2}$/.test(end) ||
    clockMinutes(start) >= 1440 ||
    clockMinutes(end) >= 1440 ||
    Number(start.slice(3)) > 59 ||
    Number(end.slice(3)) > 59
  )
    throw new Error("Enter valid start and end times.");
  if (!plan.timeZone)
    throw new Error(
      "The destination time zone is unavailable. Refresh the calendar and try again.",
    );
  const endDate = nextDay
    ? new Date(Date.parse(`${target.date}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10)
    : target.date;
  const duration =
    (localClockInstant(endDate, end, plan.timeZone) -
      localClockInstant(target.date, start, plan.timeZone)) /
    60_000;
  if (duration <= 0 || duration > 1440)
    throw new Error("End time must be after start time, within 24 hours.");
  const selected = chooseActivity(plan, activityId, "selected");
  const oldDay = plan.days.find((day) => day.activityIds.includes(activityId));
  const days = selected.days.map((day) => {
    const ids = day.activityIds.filter((id) => id !== activityId);
    if (calendarDayKey(day) === calendarDayKey(target)) {
      const before = ids.findIndex((id) => {
        const rule = activityRule(plan, id);
        const entry = assessment?.days
          .find((item) => calendarDayKey(item) === calendarDayKey(day))
          ?.entries.find((item) => item.activityId === id);
        const otherStart = rule.fixedStart ?? entry?.start?.slice(11, 16);
        return otherStart && otherStart >= start;
      });
      ids.splice(before < 0 ? ids.length : before, 0, activityId);
    }
    // Meal slots are based on activity order; recompute them after changing that order.
    return ids.join() === day.activityIds.join()
      ? day
      : { ...day, activityIds: ids, mealPositions: null };
  });
  return {
    ...selected,
    days,
    rules: [
      ...selected.rules.filter((rule) => rule.activityId !== activityId),
      {
        ...activityRule(plan, activityId),
        fixedDate: target.date,
        fixedStart: `${start}:00`,
        duration: durationFromMinutes(duration),
      },
    ],
    transportOverrides: selected.transportOverrides.filter(
      (item) =>
        !oldDay ||
        oldDay.date === target.date ||
        item.date !== oldDay.date ||
        (item.fromActivityId !== activityId &&
          item.toActivityId !== activityId),
    ),
  };
}

export function calendarLayout(entries: CalendarEntry[]) {
  const activities = new Map(
    entries
      .filter((entry) => entry.kind === "activity")
      .map((entry) => [entry.id, entry]),
  );
  const inboundTravel = new Map<string, CalendarEntry>();
  for (const entry of entries) {
    const activity = activities.get(entry.travel?.toActivityId ?? "");
    if (activity && entry.start < entry.end && entry.end === activity.start) {
      inboundTravel.set(activity.id, entry);
    }
  }

  const extensions = new Set(inboundTravel.values());
  // An activity and its inbound travel occupy one column. Stripe only the
  // actual shared time, since short events may need extra space for their labels.
  const blocks = entries
    .filter((entry) => !extensions.has(entry))
    .map((entry) => {
      const travel = inboundTravel.get(entry.id);
      return {
        entry,
        travel,
        start: travel?.start ?? entry.start,
        displayEnd: Math.max(
          entry.end,
          entry.start + (entry.kind === "travel" ? 30 : 32),
        ),
      };
    })
    .sort((a, b) => a.start - b.start || a.entry.id.localeCompare(b.entry.id));
  const result: (CalendarEntry & {
    lane: number;
    lanes: number;
    isTravelExtension: boolean;
    hasTravelExtension: boolean;
    overlaps: Pick<CalendarEntry, "start" | "end">[];
  })[] = [];
  let group: ((typeof blocks)[number] & { lane: number })[] = [];
  let end = -Infinity;
  const finish = () => {
    const lanes = Math.max(1, ...group.map((item) => item.lane + 1));
    for (const { entry, travel, lane } of group) {
      if (travel) {
        result.push({
          ...travel,
          lane,
          lanes,
          isTravelExtension: true,
          hasTravelExtension: false,
          overlaps: calendarOverlaps(travel, entries),
        });
      }
      result.push({
        ...entry,
        lane,
        lanes,
        isTravelExtension: false,
        hasTravelExtension: Boolean(travel),
        overlaps: calendarOverlaps(entry, entries),
      });
    }
    group = [];
  };
  for (const block of blocks) {
    if (block.start >= end) finish();
    const used = new Set(
      group
        .filter((item) => item.displayEnd > block.start)
        .map((item) => item.lane),
    );
    let lane = 0;
    while (used.has(lane)) lane++;
    group.push({ ...block, lane });
    end = Math.max(end, block.displayEnd);
  }
  finish();
  return result;
}

function calendarOverlaps(entry: CalendarEntry, entries: CalendarEntry[]) {
  const intersections = entries
    .filter(
      (other) =>
        other !== entry && other.start < entry.end && other.end > entry.start,
    )
    .map((other) => ({
      start: Math.max(entry.start, other.start),
      end: Math.min(entry.end, other.end),
    }))
    .filter(({ start, end }) => start < end)
    .sort((a, b) => a.start - b.start);
  const overlaps: typeof intersections = [];
  for (const intersection of intersections) {
    const previous = overlaps.at(-1);
    if (previous && intersection.start <= previous.end) {
      previous.end = Math.max(previous.end, intersection.end);
    } else {
      overlaps.push(intersection);
    }
  }
  return overlaps;
}
