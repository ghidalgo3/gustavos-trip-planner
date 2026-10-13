import type { FareItinerary, FareLeg } from "./operationsApi";

export type AirportCities = Record<string, string>;

export function sameItineraryFlights(
  left: FareItinerary,
  right: FareItinerary,
): boolean {
  const leftLegs =
    left.legs ??
    [left.outbound, left.inbound].filter((leg): leg is FareLeg => Boolean(leg));
  const rightLegs =
    right.legs ??
    [right.outbound, right.inbound].filter((leg): leg is FareLeg =>
      Boolean(leg),
    );
  return (
    leftLegs.length > 0 &&
    leftLegs.length === rightLegs.length &&
    leftLegs.every((leg, index) => legKey(leg) === legKey(rightLegs[index]))
  );
}

export function flightNumbers(leg: FareLeg): string {
  return leg.segments
    .map((segment) => {
      const number = segment.flight_number?.trim();
      if (!number) return "Flight number unavailable";
      const carrier = segment.marketing_carrier_code?.trim() ?? "";
      return carrier && !number.toUpperCase().startsWith(carrier.toUpperCase())
        ? `${carrier} ${number}`
        : number;
    })
    .join(" · ");
}

export function legRoute(leg?: FareLeg): string {
  const origin = leg?.segments[0]?.departure_airport;
  const destination = leg?.segments.at(-1)?.arrival_airport;
  return origin && destination ? `${origin} → ${destination}` : "";
}

export function legUsesPreferredAirline(
  leg: FareLeg,
  preferredAirlines: readonly string[],
): boolean {
  if (preferredAirlines.length === 0) return false;
  const preferred = new Set(
    preferredAirlines.map((code) => code.trim().toUpperCase()),
  );
  return leg.segments.some((segment) =>
    preferred.has(segment.marketing_carrier_code?.trim().toUpperCase() ?? ""),
  );
}

export function legKey(leg?: FareLeg): string {
  return JSON.stringify(
    leg?.segments.map((segment) => [
      segment.departure_airport,
      segment.arrival_airport,
      segment.departure_time_utc ?? segment.departure_time_local,
      segment.arrival_time_utc ?? segment.arrival_time_local,
      segment.marketing_carrier_code,
      segment.flight_number,
    ]) ?? [],
  );
}

export function airportLabel(code: string, cities: AirportCities = {}): string {
  const city = cities[code];
  return city ? `${city} (${code})` : code;
}

export function priceLabel(price?: FareItinerary["price"]): string {
  if (!price || !Number.isFinite(price.amount)) return "Price unavailable";
  try {
    const amount = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: price.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(price.amount);
    return `${price.currency} ${amount}`;
  } catch {
    return `${price.currency} ${price.amount.toLocaleString()}`;
  }
}

export function stayNights(previous: FareLeg, next: FareLeg): number | null {
  const arrive = previous.segments.at(-1)?.arrival_time_local?.slice(0, 10);
  const leave = next.segments[0]?.departure_time_local?.slice(0, 10);
  if (!arrive || !leave) return null;
  const first = Date.parse(`${arrive}T00:00:00Z`);
  const last = Date.parse(`${leave}T00:00:00Z`);
  const nights = (last - first) / 86_400_000;
  return Number.isInteger(nights) && nights >= 0 ? nights : null;
}
