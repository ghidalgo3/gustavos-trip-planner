import { apiBaseUrl, readTripError } from "./api";
import type { FareItinerary, FareSearchResult } from "./operationsApi";
import { legKey } from "./flightFormatting";

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

export type FlightChoiceProgress = {
  partyId: string;
  legKeys: string[];
  nextOrigins: string[];
};

function flightChoicesUrl(tripId: string) {
  return `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/flights/choices`;
}

export async function getFlightChoices(
  tripId: string,
  signal?: AbortSignal,
): Promise<FlightChoiceProgress[]> {
  const response = await fetch(flightChoicesUrl(tripId), {
    credentials: "include",
    signal,
    cache: "no-store",
  });
  if (!response.ok) await readTripError(response, "loading flight choices");
  return response.json();
}

export async function setFlightChoices(
  tripId: string,
  partyId: string,
  legKeys: string[],
): Promise<FlightChoiceProgress> {
  const response = await fetch(
    `${flightChoicesUrl(tripId)}/${encodeURIComponent(partyId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legKeys }),
    },
  );
  if (!response.ok) await readTripError(response, "saving flight choices");
  return response.json();
}

function selectedFlightsUrl(tripId: string) {
  return `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/flights`;
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
  if (response.status === 204) return [];
  return response.json();
}

export async function selectFlight(
  tripId: string,
  partyId: string,
  cacheKey: string,
  itineraryIndex: number,
  itinerary?: FareItinerary,
): Promise<SelectedFlight> {
  const response = await fetch(
    `${selectedFlightsUrl(tripId)}/${encodeURIComponent(partyId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cacheKey,
        itineraryIndex,
        ...(itinerary?.legs?.length && itinerary.price
          ? {
              legKeys: itinerary.legs.map((leg) => legKey(leg)),
              priceAmount: itinerary.price.amount,
              priceCurrency: itinerary.price.currency,
            }
          : {}),
      }),
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
