import { apiBaseUrl, readTripError } from "./api";
import type { PreparedSearch } from "./planningApi";

export type TrackedOperation = {
  id: string;
  resourceId: string | null;
  type: string;
  status: "pending" | "InProgress" | "Completed" | "Failed";
  progress: { items: number; completedItems: number; failedItems: number };
  createdAt: string;
  updatedAt: string;
  pollingUrl: string;
};

export type FlightSearchIssue = {
  code: string;
  message: string;
  partyId: string | null;
  constraintIds: string[];
};

export class FlightSearchValidationError extends Error {
  constructor(public readonly issues: FlightSearchIssue[]) {
    super("Travel dates need attention before searching.");
  }
}
export type FareSegment = {
  departure_airport: string;
  arrival_airport: string;
  departure_time_local: string;
  arrival_time_local: string;
  departure_time_utc?: string;
  arrival_time_utc?: string;
  marketing_carrier_code?: string;
  operating_carrier_name?: string;
  flight_number?: string;
  duration_minutes?: number;
};
export type FareLeg = {
  carrier?: string;
  duration_minutes?: number;
  segments: FareSegment[];
};
export type FareItinerary = {
  legs?: FareLeg[];
  bookingOffers?: {
    ignavId: string;
    legIndexes: number[];
    price?: { amount: number; currency: string };
  }[];
  stops?: number;
  durationMinutes?: number;
  preferredAirlineSegments?: number;
  preferredHomeAirport?: boolean;
  separateTickets?: boolean;
  price?: { amount: number; currency: string; status?: string };
  ignav_id?: string;
  outbound?: {
    carrier?: string;
    duration_minutes?: number;
    segments: FareSegment[];
  };
  inbound?: {
    carrier?: string;
    duration_minutes?: number;
    segments: FareSegment[];
  };
};
export type FareEvaluation = {
  status: "Eligible" | "Rejected" | "Unverifiable";
  issues: { code: string; message: string; constraintIds: string[] }[];
};
export type FareSearchResult = {
  partyId: string;
  cacheKey: string;
  request: PreparedSearch["body"];
  response: { itineraries: FareItinerary[] };
  evaluations: FareEvaluation[];
  fetchedAt: string;
  expiresAt: string;
};

function flightSearchUrl(tripId: string) {
  return `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/flights/search`;
}

function startFlightSearchUrl(tripId: string) {
  return `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/flights:search`;
}

export async function startFlightSearch(
  tripId: string,
  requestId: string,
): Promise<TrackedOperation> {
  const response = await fetch(startFlightSearchUrl(tripId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId }),
  });
  if (response.status === 400) {
    const problem = (await response
      .clone()
      .json()
      .catch(() => null)) as { issues?: FlightSearchIssue[] } | null;
    if (Array.isArray(problem?.issues))
      throw new FlightSearchValidationError(problem.issues);
  }
  if (!response.ok) await readTripError(response, "starting the flight search");
  return response.json();
}

export async function getOperations(
  signal: AbortSignal,
  options: { top?: number; skip?: number; type?: string } = {},
): Promise<TrackedOperation[]> {
  const query = new URLSearchParams({
    top: String(options.top ?? 50),
    skip: String(options.skip ?? 0),
  });
  if (options.type) query.set("type", options.type);
  const response = await fetch(`${apiBaseUrl}/operations?${query}`, {
    credentials: "include",
    signal,
    cache: "no-store",
  });
  if (!response.ok) await readTripError(response, "checking operations");
  return response.json();
}

export async function getOperation(
  operationId: string,
  signal?: AbortSignal,
): Promise<TrackedOperation> {
  const response = await fetch(
    `${apiBaseUrl}/operations/${encodeURIComponent(operationId)}`,
    { credentials: "include", signal, cache: "no-store" },
  );
  if (!response.ok)
    await readTripError(response, "checking the trip form fill");
  return response.json();
}

export async function getFlightSearchResults(
  tripId: string,
  signal: AbortSignal,
): Promise<FareSearchResult[]> {
  const response = await fetch(flightSearchUrl(tripId), {
    credentials: "include",
    signal,
    cache: "no-store",
  });
  if (response.status === 404)
    throw new Error(
      "These trip details need a new flight search. Choose Find flights.",
    );
  if (!response.ok) await readTripError(response, "loading flight results");
  const results: unknown = await response.json();
  if (
    !Array.isArray(results) ||
    !results.every(
      (result) =>
        result &&
        typeof result === "object" &&
        "response" in result &&
        result.response &&
        typeof result.response === "object" &&
        "itineraries" in result.response &&
        Array.isArray(result.response.itineraries) &&
        "evaluations" in result &&
        Array.isArray(result.evaluations) &&
        result.evaluations.length === result.response.itineraries.length,
    )
  )
    throw new Error(
      "The API returned flights without requirement checks. Restart the API service and reload this page.",
    );
  return results as FareSearchResult[];
}

export async function getBookingLinks(
  tripId: string,
  cacheKey: string,
  ignavId: string,
): Promise<unknown> {
  const response = await fetch(
    `${flightSearchUrl(tripId)}/${encodeURIComponent(cacheKey)}/bookingLinks`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ignavId }),
    },
  );
  if (response.status === 404)
    throw new Error(
      "These flight results have expired. Find flights again to refresh airline booking options.",
    );
  if (!response.ok) await readTripError(response, "getting a booking link");
  return response.json();
}
