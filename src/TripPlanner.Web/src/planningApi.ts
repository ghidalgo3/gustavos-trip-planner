import { apiBaseUrl, tripResourceUrl, readTripError, type Trip } from "./api";

export type SearchLocation = {
  code: string;
  timeZone: string;
  label?: string | null;
  codes?: string[] | null;
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
  preferredAirport?: string | null;
};
export type PlannedVisit = {
  id: string;
  location: SearchLocation | null;
  nights: number | null;
  presentFrom: string | null;
  presentThrough: string | null;
  afterVisitIds: string[];
  originalInput?: string | null;
};
export type PlanningDocument = {
  visits?: PlannedVisit[];
  searchLimits?: { flexibilityDays: number; maxTripDays: number };
  schemaVersion: number;
  aiPrompt?: string | null;
  aiPromptLocked?: boolean | null;
  aiFormOperationId?: string | null;
  travelDates?: { startDate: string | null; endDate: string | null } | null;
  userTimeZone?: string | null;
  destination: SearchLocation | null;
  parties: PartySettings[];
  constraints: PlanningConstraint[];
};
export type PlanningParty = {
  id: string;
  suggestedOrigin?: SearchLocation | null;
  preferredAirport?: string | null;
  members: { id: string; name: string; homeCity: string | null }[];
};
export type PlanningEditor = {
  document: PlanningDocument;
  parties: PlanningParty[];
};
export type TripFormProposal = {
  document: PlanningDocument;
  warnings: string[];
};

export async function proposeTripForm(
  userId: string,
  tripId: string,
  requestId: string,
  input: string,
  draft: PlanningDocument,
): Promise<import("./operationsApi").TrackedOperation> {
  const response = await fetch(
    `${tripResourceUrl(userId, tripId)}/formProposal`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, input, draft }),
    },
  );
  if (!response.ok) await readTripError(response, "preparing the trip form");
  return response.json();
}

export async function getTripFormProposal(
  userId: string,
  tripId: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<TripFormProposal> {
  const response = await fetch(
    `${tripResourceUrl(userId, tripId)}/formProposal/${encodeURIComponent(operationId)}`,
    { credentials: "include", cache: "no-store", signal },
  );
  if (!response.ok)
    await readTripError(response, "loading the trip form proposal");
  return response.json();
}
export type UserSearchResult = { id: string; name: string; email: string };
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
    searchKind?: string;
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

export async function searchUsers(
  query: string,
  signal?: AbortSignal,
): Promise<UserSearchResult[]> {
  const response = await fetch(
    `${apiBaseUrl}/api/users?query=${encodeURIComponent(query)}`,
    {
      credentials: "include",
      signal,
    },
  );
  if (!response.ok) await readTripError(response, "searching travelers");
  return response.json();
}

export async function changePartyMember(
  userId: string,
  tripId: string,
  partyId: string,
  memberId: string,
  add: boolean,
): Promise<void> {
  const url = `${tripResourceUrl(userId, tripId)}/parties/${encodeURIComponent(partyId)}/members/${encodeURIComponent(memberId)}`;
  const response = await fetch(url, {
    method: add ? "PUT" : "DELETE",
    credentials: "include",
  });
  if (!response.ok)
    await readTripError(
      response,
      add ? "adding a traveler" : "removing a traveler",
    );
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
  cityLocation?: SearchLocation | null;
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
