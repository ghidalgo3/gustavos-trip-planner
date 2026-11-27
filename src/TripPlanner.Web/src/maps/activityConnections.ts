import type { ActivityRoutePreview } from "../features/activities/activityRouteApi";
import { activityRouteLegKey } from "../features/activities/activityRouteApi";
import type { Point } from "../features/activities/activitiesApi";
import type { MapLineFeature } from "./IMapsClient";
import { greatCircle } from "./greatCircle";

type Position = Point["coordinates"];
type Route = Position[][];
type Segment = { from: Position; to: Position; start: number; end: number };

export function activityRoutes(
  ids: readonly string[],
  locations: ReadonlyMap<string, Point | null>,
  routes?: ReadonlyMap<string, ActivityRoutePreview>,
): Route[] {
  const stops: (string | null)[] = [...ids];
  if (!ids.length) return [];
  if (routes?.has(activityRouteLegKey(null, ids[0]))) stops.unshift(null);
  if (routes?.has(activityRouteLegKey(ids.at(-1)!, null))) stops.push(null);
  return stops.slice(1).flatMap((to, index) => {
    const from = stops[index];
    const routed = routes?.get(activityRouteLegKey(from, to));
    if (routed) return [routed.geometry.coordinates];
    const start = from === null ? null : locations.get(from)?.coordinates;
    const end = to === null ? null : locations.get(to)?.coordinates;
    // Leave a gap when an activity has no location.
    return start && end && (start[0] !== end[0] || start[1] !== end[1])
      ? [greatCircle(start, end)]
      : [];
  });
}

export function routeFeature(coordinates: Route): MapLineFeature {
  return {
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates },
    properties: {},
  };
}

export function animateAlongRoutes(
  routes: Route[],
  draw: (features: MapLineFeature[]) => void,
) {
  const paths = routes.map(measureRoute);
  const began = performance.now();
  let lastFrame = began;
  let frame = requestAnimationFrame(animate);
  function animate(time: number) {
    if (time - lastFrame >= 32) {
      const coordinates = paths.flatMap((path, index) =>
        flowingPath(path, time - began, index),
      );
      draw(coordinates.length ? [routeFeature(coordinates)] : []);
      lastFrame = time;
    }
    frame = requestAnimationFrame(animate);
  }
  return () => cancelAnimationFrame(frame);
}

function measureRoute(route: Route) {
  let length = 0;
  const lines = route.map((line) =>
    line.slice(1).flatMap((to, index) => {
      const from = line[index];
      const latitude = ((from[1] + to[1]) * Math.PI) / 360;
      const start = length;
      length += Math.hypot(
        longitudeDelta(from, to) * Math.cos(latitude),
        to[1] - from[1],
      );
      return length > start ? [{ from, to, start, end: length }] : [];
    }),
  );
  return { lines, length };
}

function flowingPath(
  path: ReturnType<typeof measureRoute>,
  elapsed: number,
  index: number,
) {
  const pulseLength = 0.22;
  const cycle = 2400;
  const phase = ((elapsed + cycle - ((index * 240) % cycle)) % cycle) / cycle;
  const head = phase * (1 + pulseLength);
  const start = Math.max(0, head - pulseLength) * path.length;
  const end = Math.min(1, head) * path.length;
  return path.lines.flatMap((line) => {
    const points: Position[] = [];
    for (const segment of line) {
      if (segment.end <= start) continue;
      if (segment.start >= end) break;
      if (!points.length)
        points.push(pointAt(segment, Math.max(start, segment.start)));
      points.push(pointAt(segment, Math.min(end, segment.end)));
    }
    return points.length >= 2 ? [points] : [];
  });
}

function longitudeDelta(from: Position, to: Position) {
  return ((to[0] - from[0] + 540) % 360) - 180;
}

function pointAt(segment: Segment, distance: number): Position {
  const { from, to, start, end } = segment;
  if (distance === start) return from;
  if (distance === end) return to;
  const fraction = (distance - start) / (end - start);
  return [
    ((from[0] + longitudeDelta(from, to) * fraction + 540) % 360) - 180,
    from[1] + (to[1] - from[1]) * fraction,
  ];
}
