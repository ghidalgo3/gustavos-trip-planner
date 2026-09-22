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
export type FareSegment = {
  departure_airport: string;
  arrival_airport: string;
  departure_time_local: string;
  arrival_time_local: string;
  departure_time_utc?: string;
  arrival_time_utc?: string;
  marketing_carrier_code?: string;
  flight_number?: string;
  duration_minutes?: number;
};
export type FareItinerary = {
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
export type FareSearchResult = {
  partyId: string;
  cacheKey: string;
  request: PreparedSearch["body"];
  response: { itineraries: FareItinerary[] };
  fetchedAt: string;
  expiresAt: string;
};

function flightSearchUrl(tripId: string) {
  return `${apiBaseUrl}/api/trips/${encodeURIComponent(tripId)}/flightSearch`;
}

export async function startFlightSearch(
  tripId: string,
  requestId: string,
): Promise<TrackedOperation> {
  const response = await fetch(flightSearchUrl(tripId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId }),
  });
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
  const response = await fetch(`${apiBaseUrl}/api/operations?${query}`, {
    credentials: "include",
    signal,
    cache: "no-store",
  });
  if (!response.ok) await readTripError(response, "checking operations");
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
  if (!response.ok) await readTripError(response, "loading flight results");
  return response.json();
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
  if (!response.ok) await readTripError(response, "getting a booking link");
  return response.json();
}
