import type { Trip } from "../../api/api";
import type { Destination } from "../activities/activitiesApi";

export function conflictingVisit(
  destinations: Destination[],
  arrival: string,
  departure: string,
  excludedStayId?: string,
) {
  const start = arrival || departure;
  const end = departure || arrival;
  if (!start) return;
  for (const destination of destinations) {
    for (const stay of destination.properties.stays) {
      if (stay.id === excludedStayId) continue;
      const otherStart = stay.arrivalDate ?? stay.departureDate;
      const otherEnd = stay.departureDate ?? stay.arrivalDate;
      if (otherStart && otherEnd && start < otherEnd && otherStart < end)
        return { destination, stay };
    }
  }
}

export function parseTripDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) || dateKey(date) !== value
    ? undefined
    : date;
}
export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function formatTripDate(value: string | null, includeYear = true) {
  const date = value && parseTripDate(value);
  return date
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: includeYear ? "numeric" : undefined,
      }).format(date)
    : "Dates open";
}
export function formatStayDates(
  arrival: string | null,
  departure: string | null,
  includeYear = true,
) {
  if (!arrival && !departure) return "Dates to decide";
  if (arrival === departure) return formatTripDate(arrival, includeYear);
  return `${formatTripDate(arrival, includeYear)} – ${formatTripDate(departure, includeYear)}`;
}
export function tripSpansMultipleYears(
  trip: Trip,
  destinations: Destination[],
) {
  const dates = [
    trip.startDate,
    trip.endDate,
    ...destinations.flatMap((destination) =>
      destination.properties.stays.flatMap((stay) => [
        stay.arrivalDate,
        stay.departureDate,
      ]),
    ),
  ];
  const years = dates
    .map((date) => (date ? parseTripDate(date)?.getFullYear() : undefined))
    .filter((year) => year !== undefined);
  return new Set(years).size > 1;
}
export function destinationDates(
  destination: Destination,
  includeYear: boolean,
) {
  return destination.properties.stays
    .map((stay) =>
      formatStayDates(stay.arrivalDate, stay.departureDate, includeYear),
    )
    .join(" · ");
}
