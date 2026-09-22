import { apiBaseUrl, tripResourceUrl, readTripError, type Trip } from "./api";

export type SearchLocation = {
  code: string;
  timeZone: string;
  label?: string | null;
};
export type DateWindow = {
  earliest: string | null;
  latest: string | null;
  preferred: string | null;
};
export type ConstraintType =
  | "departureWindow"
  | "returnHomeWindow"
  | "presence"
  | "travelTogether"
  | "nonstop"
  | "avoidLayover";
export type PlanningConstraint = {
  id: string;
  userId: string;
  type: ConstraintType;
  window?: DateWindow | null;
  startDate?: string | null;
  endDate?: string | null;
  otherUserId?: string | null;
  locationType?: string | null;
  location?: string | null;
  countryCodes: string[];
  originalInput?: string | null;
};
export type PartySettings = {
  partyId: string;
  origin: SearchLocation | null;
  cabin: string;
  market: string;
  maxJourneyHours: number;
  maxStops: number | null;
  preferredAirlines: string[];
};
export type PlanningDocument = {
  schemaVersion: number;
  travelDates?: { startDate: string | null; endDate: string | null } | null;
  userTimeZone?: string | null;
  destination: SearchLocation | null;
  parties: PartySettings[];
  constraints: PlanningConstraint[];
};
export type PlanningParty = {
  id: string;
  suggestedOrigin?: SearchLocation | null;
  members: { id: string; name: string; homeCity: string | null }[];
};
export type PlanningEditor = {
  document: PlanningDocument;
  parties: PlanningParty[];
};
export type PreparedSearch = {
  body: {
    origin: string;
    destination: string;
    departure_date: string;
    return_date: string;
    adults: number;
    cabin_class: string;
    market: string;
    max_stops?: number;
  };
  cacheKey: string;
  dateDistance: number;
};

export async function getPlanning(
  userId: string,
  tripId: string,
  signal?: AbortSignal,
): Promise<PlanningEditor> {
  const response = await fetch(`${tripResourceUrl(userId, tripId)}/planning`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) await readTripError(response, "loading planning");
  return response.json();
}

export async function saveConstraints(
  userId: string,
  tripId: string,
  document: PlanningDocument,
): Promise<Trip> {
  const response = await fetch(
    `${tripResourceUrl(userId, tripId)}/constraints`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    },
  );
  if (!response.ok) await readTripError(response, "saving constraints");
  return response.json();
}

export type AirportSuggestion = {
  code: string;
  name: string;
  city: string;
  country: string;
  location: SearchLocation;
};
const airportCache = new Map<string, AirportSuggestion[]>();
export async function searchAirports(
  query: string,
  signal?: AbortSignal,
): Promise<AirportSuggestion[]> {
  const key = query.trim().toLowerCase();
  const cached = airportCache.get(key);
  if (cached) return cached;
  const response = await fetch(
    `${apiBaseUrl}/api/airports?q=${encodeURIComponent(key)}`,
    { credentials: "include", signal },
  );
  if (!response.ok)
    throw new Error("Airport search is unavailable. Please try again.");
  const results: AirportSuggestion[] = await response.json();
  if (airportCache.size >= 100)
    airportCache.delete(airportCache.keys().next().value!);
  airportCache.set(key, results);
  return results;
}
