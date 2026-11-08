import { tripFetch } from "../../api/tripDocumentStore";
import { apiBaseUrl, tripResourceUrl, readTripError } from "../../api/api";

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
  arrivalFlexibilityDays?: number | null;
  departureFlexibilityDays?: number | null;
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
  members: {
    id: string;
    name: string;
    homeCity: string | null;
    role?: "Traveller" | "Planner";
  }[];
};
export type TripFlightPlanningData = {
  document: PlanningDocument;
  parties: PlanningParty[];
};
export type TripFormProposal = {
  document: PlanningDocument;
  warnings: string[];
};

export async function proposeTripForm(
  tripId: string,
  requestId: string,
  input: string,
  constraints: PlanningDocument,
): Promise<import("../../api/operationsApi").TrackedOperation> {
  const response = await tripFetch(
    `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/flights:prompt`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, input, constraints }),
    },
  );
  if (!response.ok)
    await readTripError(response, "translating the trip prompt");
  return response.json();
}

export async function getTripFormProposal(
  tripId: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<TripFormProposal> {
  const response = await tripFetch(
    `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/flights/prompts/${encodeURIComponent(operationId)}`,
    { credentials: "include", cache: "no-store", signal },
  );
  if (!response.ok) await readTripError(response, "loading the prompt result");
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
    searchPriority?: number;
  };
  cacheKey: string;
  dateDistance: number;
};

export async function getTripFlightPlanningData(
  tripId: string,
  signal?: AbortSignal,
): Promise<TripFlightPlanningData> {
  const base = `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}`;
  const [constraintsResponse, partiesResponse] = await Promise.all([
    tripFetch(`${base}/flights/constraints`, {
      credentials: "include",
      signal,
      cache: "no-store",
    }),
    tripFetch(`${base}/parties`, {
      credentials: "include",
      signal,
      cache: "no-store",
    }),
  ]);
  if (!constraintsResponse.ok)
    await readTripError(constraintsResponse, "loading flight constraints");
  if (!partiesResponse.ok)
    await readTripError(partiesResponse, "loading trip parties");
  return {
    document: await constraintsResponse.json(),
    parties: await partiesResponse.json(),
  };
}

export async function getTripParties(
  tripId: string,
  signal?: AbortSignal,
): Promise<PlanningParty[]> {
  const response = await tripFetch(
    `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/parties`,
    { credentials: "include", cache: "no-store", signal },
  );
  if (!response.ok) await readTripError(response, "loading trip travelers");
  return response.json();
}

export async function searchUsers(
  query: string,
  signal?: AbortSignal,
): Promise<UserSearchResult[]> {
  const response = await tripFetch(
    `${apiBaseUrl}/users?query=${encodeURIComponent(query)}`,
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
  role: "Traveller" | "Planner" = "Traveller",
): Promise<void> {
  const url = `${tripResourceUrl(userId, tripId)}/parties/${encodeURIComponent(partyId)}/members/${encodeURIComponent(memberId)}`;
  const response = await tripFetch(url, {
    method: add ? "PUT" : "DELETE",
    credentials: "include",
    ...(add
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }
      : {}),
  });
  if (!response.ok)
    await readTripError(
      response,
      add ? "adding a traveler" : "removing a traveler",
    );
}

export async function saveConstraints(
  tripId: string,
  document: PlanningDocument,
): Promise<PlanningDocument> {
  const response = await tripFetch(
    `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/flights/constraints`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    },
  );
  if (!response.ok) await readTripError(response, "saving flight constraints");
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
  const response = await tripFetch(
    `${apiBaseUrl}/airports?q=${encodeURIComponent(key)}`,
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
