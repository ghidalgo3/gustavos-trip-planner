import { useEffect, useMemo, useState } from "react";
import type { FareLeg } from "../../api/operationsApi";
import { useTripDocumentState } from "../../api/tripDocumentStore";
import { greatCircle } from "../../maps/greatCircle";
import type { MapLandmark } from "../../maps/ActivityMap";
import type { Point } from "../activities/activitiesApi";
import type { ActivityRoutePreview } from "../activities/activityRouteApi";
import { searchAirports } from "./planningApi";

const airportCache = new Map<string, Point>();
const noLandmarks: MapLandmark[] = [];
function point(longitude: unknown, latitude: unknown): Point | undefined {
  return typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180 &&
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90
    ? { type: "Point", coordinates: [longitude, latitude] }
    : undefined;
}

export function useFlightMapPath(flight?: FareLeg) {
  const document = useTripDocumentState();
  const disconnected = document.offline || navigator.onLine === false;
  const topology = JSON.stringify(
    flight?.segments.map((segment) => [
      segment.departure_airport.toUpperCase(),
      segment.arrival_airport.toUpperCase(),
    ]) ?? [],
  );
  const segments = useMemo(
    () => JSON.parse(topology) as [string, string][],
    [topology],
  );
  const codes = [...new Set(segments.flat())].sort();
  const [loaded, setLoaded] = useState<Record<string, Point>>({});
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<{ key: string; attempt: number }>();
  const saved = useMemo(
    () =>
      Object.fromEntries(
        (document.document?.document.places ?? []).flatMap((place) => {
          if (
            typeof place.iataCode !== "string" ||
            !place.location ||
            typeof place.location !== "object"
          )
            return [];
          const geometry = place.location as {
            type?: unknown;
            coordinates?: unknown;
          };
          const coordinates =
            geometry.type === "Point" && Array.isArray(geometry.coordinates)
              ? geometry.coordinates
              : [];
          const location = point(coordinates[0], coordinates[1]);
          return location ? [[place.iataCode.toUpperCase(), location]] : [];
        }),
      ),
    [document.document?.document.places],
  );
  const points = Object.fromEntries(
    codes.flatMap((code) => {
      const location = saved[code] ?? loaded[code] ?? airportCache.get(code);
      return location ? [[code, location]] : [];
    }),
  );
  const missingKey = codes.filter((code) => !points[code]).join(",");
  useEffect(() => {
    if (
      !missingKey ||
      disconnected ||
      (failed?.key === missingKey && failed.attempt === attempt)
    )
      return;
    const controller = new AbortController();
    // Passing across cards should not issue a request for every brief hover.
    const timer = window.setTimeout(() => {
      const requested = missingKey.split(",");
      void Promise.allSettled(
        requested.map(async (code) => {
          const matches = await searchAirports(code, controller.signal);
          const airport = matches.find(
            (airport) => airport.code.toUpperCase() === code,
          );
          return airport
            ? point(airport.longitude, airport.latitude)
            : undefined;
        }),
      ).then((results) => {
        if (controller.signal.aborted) return;
        const found: Record<string, Point> = {};
        const unavailable: string[] = [];
        results.forEach((result, index) => {
          const location =
            result.status === "fulfilled" ? result.value : undefined;
          if (!location) {
            unavailable.push(requested[index]);
            return;
          }
          if (airportCache.size >= 500)
            airportCache.delete(airportCache.keys().next().value!);
          airportCache.set(requested[index], location);
          found[requested[index]] = location;
        });
        setFailed(
          unavailable.length
            ? { key: unavailable.join(","), attempt }
            : undefined,
        );
        setLoaded((previous) => ({ ...previous, ...found }));
      });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [missingKey, disconnected, attempt, failed]);
  const positions = JSON.stringify(points);
  const path = useMemo(() => {
    if (!segments.length) return undefined;
    const locations = JSON.parse(positions) as Record<string, Point>;
    if (segments.flat().some((code) => !locations[code])) return undefined;
    const route: ActivityRoutePreview = {
      mode: "flight",
      geometry: {
        type: "MultiLineString",
        coordinates: segments.flatMap(([from, to]) =>
          greatCircle(locations[from].coordinates, locations[to].coordinates),
        ),
      },
    };
    const landmarks: MapLandmark[] = Object.entries(locations).map(
      ([code, geometry]) => ({
        id: `airport-${code}`,
        label: code,
        pin: code,
        geometry,
      }),
    );
    return { route, landmarks };
  }, [segments, positions]);
  const error = Boolean(
    missingKey &&
    (disconnected ||
      (failed?.key === missingKey && failed.attempt === attempt)),
  );
  return {
    route: path?.route,
    landmarks: path?.landmarks ?? noLandmarks,
    label: segments.length
      ? [
          segments[0][0],
          ...segments.flatMap(([from, to], index) =>
            index > 0 && from !== segments[index - 1][1] ? [from, to] : [to],
          ),
        ].join(" → ")
      : undefined,
    loading: Boolean(missingKey && !error),
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}
