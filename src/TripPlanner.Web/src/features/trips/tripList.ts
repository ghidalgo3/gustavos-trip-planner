import type { Trip } from "../../api/api";

export const tripPageSize = 10;

export function localToday(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isPastTrip(trip: Trip, today: string): boolean {
  return !!trip.endDate && trip.endDate < today;
}

export function selectTrips(
  trips: Trip[],
  search: string,
  past: boolean,
  today: string,
): Trip[] {
  return trips
    .filter(
      (trip) =>
        trip.name.toLowerCase().includes(search.trim().toLowerCase()) &&
        isPastTrip(trip, today) === past,
    )
    .sort((left, right) => {
      const a = past ? left.endDate : (left.startDate ?? left.endDate);
      const b = past ? right.endDate : (right.startDate ?? right.endDate);
      const first = a ? (past ? a : a < today ? today : a) : "9999-12-31";
      const second = b ? (past ? b : b < today ? today : b) : "9999-12-31";
      return (
        (past ? second.localeCompare(first) : first.localeCompare(second)) ||
        compareText(left.name.toLowerCase(), right.name.toLowerCase()) ||
        compareText(left.id, right.id)
      );
    });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function formatTripDates(trip: Trip): string | undefined {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const format = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return formatter.format(new Date(year, month - 1, day));
  };
  if (trip.startDate && trip.endDate)
    return trip.startDate === trip.endDate
      ? format(trip.startDate)
      : `${format(trip.startDate)} – ${format(trip.endDate)}`;
  if (trip.startDate) return `From ${format(trip.startDate)}`;
  if (trip.endDate) return `Until ${format(trip.endDate)}`;
}
