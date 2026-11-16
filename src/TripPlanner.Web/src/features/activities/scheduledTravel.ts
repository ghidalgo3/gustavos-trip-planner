import type { TripDocument } from "../../api/tripDocument";
import { durationMinutes } from "../../shared/time/durations";
import type { Transportation } from "../trips/transportationApi";
import type { PlanDay } from "./activityPlanApi";
import { localMinutes, type CalendarEntry } from "./activityCalendarModel";

// Trip travel is timed independently of activity plans, including on empty days.
export function scheduledTravelEntries(
  items: TripDocument["itinerary"]["items"],
  day: PlanDay,
  timeZone: string | null,
): CalendarEntry[] {
  if (!timeZone) return [];
  const local = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const value = (name: string) =>
      parts.find((part) => part.type === name)!.value;
    return localMinutes(
      `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`,
      day.date,
    );
  };
  const entries = items.flatMap((item): CalendarEntry[] => {
    if (item.kind !== "flight" && item.kind !== "transportation") return [];
    if (typeof item.start !== "string") return [];
    if (
      item.kind === "flight" &&
      (item.originVisitId || item.destinationVisitId) &&
      item.originVisitId !== day.stayId &&
      item.destinationVisitId !== day.stayId
    )
      return [];
    const departure = Date.parse(item.start);
    const duration = durationMinutes(
      typeof item.duration === "string" ? item.duration : null,
    );
    const arrival =
      typeof item.end === "string"
        ? Date.parse(item.end)
        : departure + (duration ?? 0) * 60_000;
    if (
      !Number.isFinite(departure) ||
      !Number.isFinite(arrival) ||
      arrival < departure
    )
      return [];
    const start = local(departure),
      end = local(arrival);
    if (start >= 1440 || end < 0 || (end === 0 && start < 0)) return [];
    return [
      {
        id: `scheduled:${item.kind === "flight" ? (item.serviceId ?? item.id) : item.id}`,
        kind: item.kind,
        title:
          typeof item.name === "string"
            ? item.name
            : item.kind === "flight"
              ? "Flight"
              : "Transportation",
        start: Math.max(0, start),
        end: Math.min(1440, end),
        transportation:
          item.kind === "transportation"
            ? (item.transportation as Transportation)
            : undefined,
      },
    ];
  });
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}
