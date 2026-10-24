import type { FlightChoiceProgress } from "./selectedFlightsApi";

// A partial route can be booked before it has a complete path. Keep shared
// fares together, compare their total against separate tickets, and retain
// purchased offers even if a cheaper quote arrives later.
export function partialFlightBookings(
  progress: FlightChoiceProgress | undefined,
  chosen: (string | null)[],
  currency?: string,
) {
  const bookings = (progress?.bookings ?? []).filter((booking) =>
    booking.legIndexes.every(
      (index, i) => chosen[index] === booking.legKeys[i],
    ),
  );
  const selectedCurrency =
    currency ?? bookings.map((booking) => booking.price.currency).sort()[0];
  const purchased = new Set(progress?.purchasedOfferIds);
  const result = new Map<number, (typeof bookings)[number]>();
  for (const booking of bookings.filter((booking) =>
    purchased.has(booking.ignavId),
  )) {
    for (const index of booking.legIndexes) result.set(index, booking);
  }
  const available = bookings
    .filter((booking) => booking.price.currency === selectedCurrency)
    .sort((a, b) => a.price.amount - b.price.amount);
  for (const booking of available.filter(
    (booking) => booking.legIndexes.length === 1,
  )) {
    const index = booking.legIndexes[0];
    if (!result.has(index)) result.set(index, booking);
  }
  for (const booking of available.filter(
    (booking) => booking.legIndexes.length > 1,
  )) {
    const current = booking.legIndexes.map((index) => result.get(index));
    if (current.some((offer) => offer && purchased.has(offer.ignavId)))
      continue;
    const total = current.some((offer) => !offer)
      ? Infinity
      : [...new Set(current)].reduce(
          (sum, offer) => sum + offer!.price.amount,
          0,
        );
    if (booking.price.amount <= total) {
      for (const index of booking.legIndexes) result.set(index, booking);
    }
  }
  return result;
}
