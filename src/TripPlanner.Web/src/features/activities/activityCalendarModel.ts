import type { Activity, Destination } from "./activitiesApi";
import {
  activityRule,
  chooseActivity,
  type ActivityPlan,
  type PlanAssessment,
  type PlanDay,
} from "./activityPlanApi";
import type { ActivityRouteStep } from "./activityRouteApi";
import {
  durationFromMinutes,
  durationMinutes,
} from "../../shared/time/durations";
import { localClockInstant } from "../../shared/time/timeZones";

export const calendarDayKey = (day: Pick<PlanDay, "stayId" | "date">) =>
  `${day.stayId}:${day.date}`;
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
  kind: "activity" | "travel" | "break" | "flight";
  title: string;
  start: number;
  end: number;
  detail?: string;
  activityId?: string;
  travel?: ActivityRouteStep;
  estimated?: boolean;
};

export function calendarEntries(
  plan: ActivityPlan,
  day: PlanDay,
  activities: Activity[],
  assessment?: PlanAssessment,
  destination?: Destination,
): CalendarEntry[] {
  const evaluated = assessment?.days.find(
    (item) => calendarDayKey(item) === calendarDayKey(day),
  );
  const entries: CalendarEntry[] = [];
  const title = (id: string | null) =>
    id === null
      ? "Stay"
      : (activities.find((activity) => activity.id === id)?.properties.name ??
        "Activity");
  for (const id of day.activityIds) {
    const activity = activities.find((item) => item.id === id);
    const evaluatedEntry = evaluated?.entries.find(
      (item) => item.activityId === id,
    );
    const rule = activityRule(plan, id);
    const start = evaluatedEntry?.start
      ? localMinutes(evaluatedEntry.start, day.date)
      : rule.fixedStart
        ? clockMinutes(rule.fixedStart)
        : null;
    if (start === null) continue;
    const duration =
      durationMinutes(rule.duration ?? activity?.properties.duration) ?? 60;
    const end = evaluatedEntry?.end
      ? localMinutes(evaluatedEntry.end, day.date)
      : start + duration;
    entries.push({
      id,
      kind: "activity",
      title: title(id),
      activityId: id,
      start,
      end,
      detail: activity?.properties.placeName ?? undefined,
      estimated: !rule.fixedStart,
    });
  }
  const hasStay = destination?.properties.stays.some(
    (stay) => stay.id === day.stayId && stay.stayLocation,
  );
  const pairs: [string | null, string | null][] = day.activityIds.flatMap<
    [string | null, string | null]
  >((id, index) =>
    index > 0
      ? [[day.activityIds[index - 1], id] as [string, string]]
      : hasStay
        ? [[null, id] as [null, string]]
        : [],
  );
  if (hasStay && day.activityIds.length)
    pairs.push([day.activityIds.at(-1)!, null]);
  for (const [from, to] of pairs) {
    const leg = evaluated?.travel.find(
      (item) => item.fromActivityId === from && item.toActivityId === to,
    );
    const override = plan.transportOverrides.find(
      (item) =>
        item.date === day.date &&
        item.fromActivityId === from &&
        item.toActivityId === to,
    );
    const fromEntry = entries.find((item) => item.activityId === from);
    const toEntry = entries.find((item) => item.activityId === to);
    const duration = override?.duration ?? leg?.duration;
    const minutes = durationMinutes(duration);
    const start = leg?.departure
      ? localMinutes(leg.departure, day.date)
      : (fromEntry?.end ??
        (toEntry && minutes !== null ? toEntry.start - minutes : undefined));
    if (start === undefined) continue;
    const mode =
      override?.mode ??
      leg?.mode ??
      (day.settings ?? plan.settings).transportMode;
    entries.push({
      id: `travel:${from}:${to}`,
      kind: "travel",
      start,
      end: start + (minutes ?? 0),
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
      estimated: leg?.provisional,
      travel: {
        stayId: day.stayId,
        date: day.date,
        fromActivityId: from,
        toActivityId: to,
        mode,
        duration: duration ?? "PT0M",
        label: `${title(from)} → ${title(to)}`,
      },
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

// Assign overlapping blocks separate columns, including short, tappable travel blocks.
export function calendarLayout(entries: CalendarEntry[]) {
  const result: (CalendarEntry & { lane: number; lanes: number })[] = [];
  let group: typeof result = [];
  let end = -Infinity;
  const finish = () => {
    const lanes = Math.max(1, ...group.map((item) => item.lane + 1));
    result.push(...group.map((item) => ({ ...item, lanes })));
    group = [];
  };
  for (const entry of entries) {
    if (entry.start >= end) finish();
    const displayEnd = Math.max(
      entry.end,
      entry.start + (entry.kind === "travel" ? 30 : 32),
    );
    const used = new Set(
      group
        .filter(
          (item) =>
            Math.max(
              item.end,
              item.start + (item.kind === "travel" ? 30 : 32),
            ) > entry.start,
        )
        .map((item) => item.lane),
    );
    let lane = 0;
    while (used.has(lane)) lane++;
    group.push({ ...entry, lane, lanes: 1 });
    end = Math.max(group.length === 1 ? -Infinity : end, displayEnd);
  }
  finish();
  return result;
}
