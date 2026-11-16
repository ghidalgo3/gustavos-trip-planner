import type { PlaceSuggestion } from "../../api/api";
import type { ActivityRoutePreview } from "../activities/activityRouteApi";
import type { Destination, Point } from "../activities/activitiesApi";
import type {
  Transportation,
  TransportationFeature,
} from "./transportationApi";
import { durationMinutes } from "../../shared/time/durations";
export type TransportStop = {
  city: string | null;
  stayId?: string;
  destination?: Destination;
  date?: string | null;
};
export function transportForLeg(
  values: Transportation[],
  from?: string,
  to?: string,
) {
  return values.find(
    (v) =>
      (v.originStayId ?? undefined) === from &&
      (v.destinationStayId ?? undefined) === to &&
      (from || to),
  );
}
export function transportDuration(value: string | null) {
  const minutes = durationMinutes(value);
  if (minutes == null) return "";
  const total = Math.round(minutes);
  return `${Math.floor(total / 60) ? `${Math.floor(total / 60)}h ` : ""}${total % 60}m`;
}

export type StationMapSearch = {
  id: string;
  results: PlaceSuggestion[];
  onSelect: (index: number) => void;
};
export function transportEndpoint(
  id: string,
  name: string,
  geometry: Point,
): TransportationFeature {
  return { type: "Feature", id, geometry, properties: { name } };
}
export function transportRoute(
  value?: Transportation,
): ActivityRoutePreview | undefined {
  if (!value || value.routeStale) return undefined;
  const coordinates = value.features.flatMap((feature) => {
    if (feature.geometry?.type === "LineString")
      return [feature.geometry.coordinates as [number, number][]];
    if (feature.geometry?.type === "MultiLineString")
      return feature.geometry.coordinates as [number, number][][];
    return [];
  });
  return coordinates.length
    ? {
        mode:
          value.mode === "walk"
            ? "walking"
            : value.mode === "car"
              ? "driving"
              : (value.mode ?? "train"),
        geometry: { type: "MultiLineString", coordinates },
      }
    : undefined;
}
