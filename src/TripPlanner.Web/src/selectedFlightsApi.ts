import { apiBaseUrl, readTripError } from "./api";
import type { FareItinerary, FareSearchResult } from "./operationsApi";

export type SelectedFlight = {
  tripId: string;
  partyId: string;
  cacheKey: string;
  itineraryIndex: number;
  request: FareSearchResult["request"];
  itinerary: FareItinerary;
  selectedAt: string;
  purchasedLegs?: boolean[] | null;
};

function selectedFlightsUrl(tripId: string) {
  return `${apiBaseUrl}/api/trips/${encodeURIComponent(tripId)}/selectedFlights`;
}

export async function getSelectedFlights(
  tripId: string,
  signal?: AbortSignal,
): Promise<SelectedFlight[]> {
  const response = await fetch(selectedFlightsUrl(tripId), {
    credentials: "include",
    signal,
    cache: "no-store",
  });
  if (!response.ok) await readTripError(response, "loading selected flights");
  return response.json();
}

export async function selectFlight(
  tripId: string,
  partyId: string,
  cacheKey: string,
  itineraryIndex: number,
): Promise<SelectedFlight> {
  const response = await fetch(
    `${selectedFlightsUrl(tripId)}/${encodeURIComponent(partyId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cacheKey, itineraryIndex }),
    },
  );
  if (!response.ok) await readTripError(response, "selecting the flight");
  return response.json();
}

export async function deselectFlight(
  tripId: string,
  partyId: string,
): Promise<void> {
  const response = await fetch(
    `${selectedFlightsUrl(tripId)}/${encodeURIComponent(partyId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) await readTripError(response, "deselecting the flight");
}

export async function setFlightPurchases(
  tripId: string,
  partyId: string,
  cacheKey: string,
  itineraryIndex: number,
  purchasedLegs: boolean[],
): Promise<SelectedFlight> {
  const response = await fetch(
    `${selectedFlightsUrl(tripId)}/${encodeURIComponent(partyId)}/purchases`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cacheKey, itineraryIndex, purchasedLegs }),
    },
  );
  if (!response.ok) await readTripError(response, "saving flight purchases");
  return response.json();
}
