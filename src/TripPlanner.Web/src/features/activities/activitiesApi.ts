import { apiBaseUrl, readTripError } from "../../api/api";
import { tripFetch } from "../../api/tripDocumentStore";
import { mapsClient } from "../../maps/mapsClient";
import { trackBehavior } from "../../telemetry/telemetry";
import type { ActivityKind, TicketRequirement } from "./activityKinds";

export type Point = { type: "Point"; coordinates: [number, number] };
export type Stay = {
  id: string;
  order: number;
  arrivalDate: string | null;
  departureDate: string | null;
  arrivalAt: string;
  departureAt: string;
  stayLocation?: StayLocation | null;
};
export type StayLocation = {
  type: "Feature";
  id: string;
  geometry: Point;
  properties: { name: string };
};
export type Destination = {
  type: "Feature";
  id: string;
  geometry: Point;
  properties: {
    name: string;
    countryCode: string;
    timeZone: string | null;
    contextVersion: string;
    arrivalDate: string | null;
    departureDate: string | null;
    stays: Stay[];
    isActive: boolean;
    constraints?: Record<string, unknown>;
  };
};
export type DestinationCollection = {
  type: "FeatureCollection";
  features: Destination[];
  route: { destinationId: string; stayId: string }[];
};
export type ActivityCost = {
  amount: number;
  currency: string;
  basis: "perPerson" | "total";
};
export type ActivityLink = { url: string; label?: string | null };
export type ActivityLocationSuggestion = {
  venueName: string;
  geometry: Point;
  source: ActivityLink;
  retrievedAt: string;
};
export type ActivityResearchEvidence = {
  notes: string;
  source: ActivityLink;
  researchedAt: string;
};

export type ActivityProperties = {
  kinds: ActivityKind[];
  address: string | null;
  ticketRequirement: TicketRequirement;
  durationEvidence?: ActivityResearchEvidence | null;
  costEvidence?: ActivityResearchEvidence | null;
  locationSuggestion?: ActivityLocationSuggestion | null;
  links?: ActivityLink[];
  name: string;
  duration: string | null;
  description: string;
  notes: string;
  cost: ActivityCost | null;
  state: string;
  placeName: string | null;
};
export type Activity = {
  type: "Feature";
  id: string;
  geometry: Point | null;
  properties: ActivityProperties;
};
export type ActivityInput = {
  type: "Feature";
  id?: string;
  geometry: Point | null;
  properties: ActivityProperties;
};
export type ActivityCollection = {
  type: "FeatureCollection";
  features: Activity[];
};

function collectionUrl(tripId: string) {
  return `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/destinations`;
}

function destinationUrl(tripId: string, cityId: string) {
  return `${collectionUrl(tripId)}/${encodeURIComponent(cityId)}`;
}

export async function getDestinations(
  tripId: string,
  signal?: AbortSignal,
  includeInactive = false,
): Promise<DestinationCollection | null> {
  const response = await tripFetch(
    `${collectionUrl(tripId)}${includeInactive ? "?includeInactive=true" : ""}`,
    { credentials: "include", signal, cache: "no-store" },
  );
  if (response.status === 204) return null;
  if (!response.ok) await readTripError(response, "loading destinations");
  return response.json();
}

export async function addDestination(
  tripId: string,
  input: {
    name: string;
    countryCode: string;
    longitude: number;
    latitude: number;
    arrivalDate: string | null;
    departureDate: string | null;
    constraints?: Record<string, unknown>;
  },
): Promise<Destination> {
  const response = await tripFetch(collectionUrl(tripId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [input.longitude, input.latitude],
      },
      properties: {
        name: input.name,
        countryCode: input.countryCode,
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate,
        constraints: input.constraints ?? {},
      },
    }),
  });
  if (!response.ok) await readTripError(response, "adding the destination");
  const destination = await response.json();
  trackBehavior("destination_added");
  return destination;
}

export async function replaceDestinationPlace(
  tripId: string,
  destination: Destination,
  constraints: Record<string, unknown>,
): Promise<Destination> {
  const response = await tripFetch(destinationUrl(tripId, destination.id), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "Feature",
      id: destination.id,
      geometry: destination.geometry,
      properties: {
        name: destination.properties.name,
        countryCode: destination.properties.countryCode,
        timeZone: destination.properties.timeZone,
        constraints,
      },
    }),
  });
  if (!response.ok)
    await readTripError(response, "saving destination constraints");
  return response.json();
}

export async function deleteDestination(
  tripId: string,
  cityId: string,
): Promise<void> {
  const response = await tripFetch(destinationUrl(tripId, cityId), {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) await readTripError(response, "deleting the destination");
}

export async function deleteDestinationStay(
  tripId: string,
  cityId: string,
  stayId: string,
): Promise<void> {
  const response = await tripFetch(
    `${destinationUrl(tripId, cityId)}/stays/${encodeURIComponent(stayId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok)
    await readTripError(response, "removing the destination visit");
}

export async function replaceDestinationStay(
  tripId: string,
  cityId: string,
  stayId: string,
  input: { arrivalDate: string | null; departureDate: string | null },
): Promise<Destination> {
  const response = await tripFetch(
    `${destinationUrl(tripId, cityId)}/stays/${encodeURIComponent(stayId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) await readTripError(response, "saving destination dates");
  return response.json();
}

export async function getActivities(
  tripId: string,
  cityId: string,
  signal?: AbortSignal,
): Promise<ActivityCollection> {
  const response = await tripFetch(
    `${destinationUrl(tripId, cityId)}/activities`,
    {
      credentials: "include",
      signal,
      cache: "no-store",
    },
  );
  if (!response.ok) await readTripError(response, "loading activities");
  return response.json();
}

export async function getActivity(
  tripId: string,
  cityId: string,
  id: string,
  signal?: AbortSignal,
): Promise<{ activity: Activity; etag: string }> {
  const response = await tripFetch(
    `${destinationUrl(tripId, cityId)}/activities/${encodeURIComponent(id)}`,
    { credentials: "include", cache: "no-store", signal },
  );
  if (!response.ok) await readTripError(response, "loading the activity");
  return {
    activity: await response.json(),
    etag: response.headers.get("ETag") ?? "",
  };
}

export async function saveActivity(
  tripId: string,
  destination: Destination,
  activity: ActivityInput,
  etag?: string,
  signal?: AbortSignal,
): Promise<Activity> {
  const url = `${destinationUrl(tripId, destination.id)}/activities${activity.id ? `/${encodeURIComponent(activity.id)}` : ""}`;
  const response = await tripFetch(url, {
    method: activity.id ? "PUT" : "POST",
    signal,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Destination-Context": destination.properties.contextVersion,
      ...(etag ? { "If-Match": etag } : {}),
    },
    body: JSON.stringify(activity),
  });
  if (!response.ok) await readTripError(response, "saving the activity");
  return response.json();
}

export async function deleteActivity(
  tripId: string,
  destination: Destination,
  id: string,
  etag: string,
): Promise<void> {
  const response = await tripFetch(
    `${destinationUrl(tripId, destination.id)}/activities/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Destination-Context": destination.properties.contextVersion,
        "If-Match": etag,
      },
    },
  );
  if (!response.ok) await readTripError(response, "deleting the activity");
}

export async function saveStayLocation(
  tripId: string,
  cityId: string,
  stayId: string,
  feature: StayLocation | null,
): Promise<void> {
  const response = await tripFetch(
    `${apiBaseUrl}/trips/${encodeURIComponent(tripId)}/destinations/${encodeURIComponent(cityId)}/stays/${encodeURIComponent(stayId)}/location`,
    {
      method: feature ? "PUT" : "DELETE",
      credentials: "include",
      ...(feature
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(feature),
          }
        : {}),
    },
  );
  if (!response.ok) await readTripError(response, "saving Stay location");
}

export type StayPlaceResult = {
  name: string;
  address: string;
  geometry: Point | null;
};
export async function searchStayPlaces(
  destination: Destination,
  query: string,
  signal?: AbortSignal,
): Promise<StayPlaceResult[]> {
  const matches = await mapsClient.searchPlaces(
    query,
    signal,
    destination.geometry.coordinates,
    destination.properties.countryCode,
  );
  return matches.map((place) => ({
    name: place.name ?? place.label,
    address: place.address ?? place.label,
    geometry:
      place.longitude == null || place.latitude == null
        ? null
        : { type: "Point", coordinates: [place.longitude, place.latitude] },
  }));
}
