import { useEffect, useMemo, useState } from "react";
import type { FareLeg } from "../../api/operationsApi";
import { useFlightMapPath } from "../flights/useFlightMapPath";
import {
  Button,
  Skeleton,
  SkeletonItem,
  Text,
} from "@fluentui/react-components";
import ActivityMap, { type MapLandmark } from "../../maps/ActivityMap";
import { mapsClient } from "../../maps/mapsClient";
import type { Activity, Point } from "../activities/activitiesApi";
import type { ActivityRoutePreview } from "../activities/activityRouteApi";
import type { TransportationFeature } from "./transportationApi";
import type {
  StationMapSearch,
  TransportStop,
} from "./destinationTransportModel";

const noActivities: Activity[] = [];
const selectLandmark = () => {};
export default function TransportMap({
  from,
  to,
  stations,
  search,
  route,
  flight,
}: {
  from: TransportStop;
  to: TransportStop;
  stations: TransportationFeature[];
  search?: StationMapSearch;
  route?: ActivityRoutePreview;
  flight?: FareLeg;
}) {
  const flightPath = useFlightMapPath(flight);
  const [resolved, setResolved] = useState<{
    key: string;
    points: (Point | undefined)[];
    error: string;
  }>();
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([
    from.city,
    from.destination?.geometry,
    to.city,
    to.destination?.geometry,
  ]);
  useEffect(() => {
    const controller = new AbortController();
    async function resolve(stop: TransportStop): Promise<Point> {
      if (stop.destination) return stop.destination.geometry;
      if (!stop.city)
        throw new Error("Set your home city to show both destinations.");
      const matches = await mapsClient.searchCities(
        stop.city,
        controller.signal,
      );
      if (!matches[0]) throw new Error(`Could not locate ${stop.city}.`);
      const point = await mapsClient.geocodeCity(matches[0], controller.signal);
      return { type: "Point", coordinates: [point.longitude, point.latitude] };
    }
    void Promise.allSettled([resolve(from), resolve(to)]).then((results) => {
      if (controller.signal.aborted) return;
      setResolved({
        key,
        points: results.map((result) =>
          result.status === "fulfilled" ? result.value : undefined,
        ),
        error: results
          .flatMap((result) =>
            result.status === "rejected"
              ? [(result.reason as Error).message]
              : [],
          )
          .join(" "),
      });
    });
    return () => controller.abort();
  }, [key, retry, from, to]);
  const current = resolved?.key === key ? resolved : undefined;
  const origin = from.destination?.geometry ?? current?.points[0];
  const destination = to.destination?.geometry ?? current?.points[1];
  const landmarks = useMemo<MapLandmark[]>(
    () =>
      flightPath.route
        ? flightPath.landmarks
        : [
            ...(origin
              ? [
                  {
                    id: "origin",
                    pin: "A",
                    label: from.city ?? "Home",
                    geometry: origin,
                  },
                ]
              : []),
            ...(destination
              ? [
                  {
                    id: "destination",
                    pin: "B",
                    label: to.city ?? "Home",
                    geometry: destination,
                  },
                ]
              : []),
            ...stations.flatMap((feature) =>
              feature.geometry?.type === "Point"
                ? [
                    {
                      id: feature.id,
                      pin: feature.id === "from" ? "↑" : "↓",
                      label: `${feature.id === "from" ? "Departure" : "Arrival"} station: ${feature.properties.name}`,
                      geometry: feature.geometry,
                    },
                  ]
                : [],
            ),
          ],
    [
      origin,
      destination,
      from.city,
      to.city,
      stations,
      flightPath.route,
      flightPath.landmarks,
    ],
  );
  return (
    <section className="transport-map" aria-label="Transportation map">
      {origin || destination || flightPath.landmarks[0] ? (
        <ActivityMap
          center={(origin ?? destination ?? flightPath.landmarks[0]?.geometry)!}
          destinationName={`${from.city ?? "Home"} to ${to.city ?? "Home"}`}
          zoom={14}
          activities={noActivities}
          landmarks={landmarks}
          onSelect={selectLandmark}
          placeSearch={
            search && search.results.length
              ? { results: search.results, onSelect: search.onSelect }
              : undefined
          }
          route={
            flight
              ? flightPath.route
              : search?.results.length
                ? undefined
                : route
          }
        />
      ) : (
        <Skeleton
          aria-label="Loading destination map"
          className="transport-map-skeleton"
        >
          <SkeletonItem style={{ height: "100%", width: "100%" }} />
        </Skeleton>
      )}
      {current?.error && !flightPath.route && (
        <div className="transport-map-error">
          <Text role="alert">{current.error}</Text>
          <Button onClick={() => setRetry((n) => n + 1)}>
            Retry map locations
          </Button>
        </div>
      )}
      {flightPath.error && (
        <div className="transport-map-error">
          <Text role="status">
            Airport locations unavailable for this flight path.
          </Text>
          <Button onClick={flightPath.retry}>Retry flight path</Button>
        </div>
      )}
    </section>
  );
}
