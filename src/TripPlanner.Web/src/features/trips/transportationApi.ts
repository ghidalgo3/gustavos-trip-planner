import type { Point } from "../activities/activitiesApi";
import { planningRequest } from "../activities/activityPlanApi";

export type TransportationReference = {
  kind: "activity" | "airport" | "hotel" | "home";
  id: string;
};
export type TransportationFeature = {
  type: "Feature";
  id: string;
  geometry:
    | Point
    | { type: "LineString"; coordinates: number[][] }
    | { type: "MultiLineString"; coordinates: number[][][] }
    | null;
  properties: {
    name?: string | null;
    address?: string | null;
    reference?: TransportationReference | null;
    sequence?: number | null;
    mode?: string | null;
    line?: string | null;
    direction?: string | null;
    instructions?: string | null;
    duration?: string | null;
  };
};
export type Transportation = {
  type: "FeatureCollection";
  id: string;
  name: string;
  notes: string;
  features: TransportationFeature[];
  mode: string | null;
  departureDate: string | null;
  departureTime: string | null;
  timeZone: string | null;
  duration: string | null;
  etag: string;
  version: number;
  routeStale: boolean;
};

export function transportationRequest(value: Transportation) {
  return {
    type: value.type,
    name: value.name,
    notes: value.notes,
    features: value.features,
    mode: value.mode,
    departureDate: value.departureDate,
    departureTime: value.departureTime,
    timeZone: value.timeZone,
    duration: value.duration,
  };
}

export async function saveTransportation(
  tripId: string,
  value: Transportation,
  create: boolean,
) {
  return planningRequest<Transportation>(
    `/trips/${tripId}/transportation${create ? "" : `/${value.id}`}`,
    {
      method: create ? "POST" : "PUT",
      ...(create ? {} : { etag: `"${value.etag}"` }),
      body: transportationRequest(value),
    },
  );
}

export const listTransportation = (tripId: string) =>
  planningRequest<Transportation[]>(
    `/trips/${encodeURIComponent(tripId)}/transportation`,
  );
export const getTransportation = (tripId: string, id: string) =>
  planningRequest<Transportation>(
    `/trips/${encodeURIComponent(tripId)}/transportation/${encodeURIComponent(id)}`,
  );
export const deleteTransportation = (tripId: string, value: Transportation) =>
  planningRequest(
    `/trips/${encodeURIComponent(tripId)}/transportation/${value.id}`,
    { method: "DELETE", etag: `"${value.etag}"` },
  );
