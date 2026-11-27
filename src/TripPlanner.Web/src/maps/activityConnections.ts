import type { Point } from "../features/activities/activitiesApi";
import type { MapLineFeature } from "./IMapsClient";
import { greatCircle } from "./greatCircle";

type Position = Point["coordinates"];
type Connection = [Position, Position];

export function activityConnections(points: (Point | null)[]): Connection[] {
  return points.slice(1).flatMap((point, index) => {
    const from = points[index]?.coordinates;
    const to = point?.coordinates;
    // An activity without a location breaks the line for both of its legs.
    return from && to && (from[0] !== to[0] || from[1] !== to[1])
      ? [[from, to]]
      : [];
  });
}

export function connectionFeature(connections: Connection[]): MapLineFeature {
  return {
    type: "Feature",
    geometry: {
      type: "MultiLineString",
      coordinates: connections.flatMap(([from, to]) => greatCircle(from, to)),
    },
    properties: {},
  };
}

export function flowingConnections(connections: Connection[], elapsed: number) {
  const pulseLength = 0.22;
  const cycle = 2400;
  const segments = connections.flatMap<Connection>(([from, to], index) => {
    const phase = ((elapsed + cycle - ((index * 240) % cycle)) % cycle) / cycle;
    const head = phase * (1 + pulseLength);
    const start = Math.max(0, head - pulseLength);
    const end = Math.min(1, head);
    return end > start
      ? [[interpolate(from, to, start), interpolate(from, to, end)]]
      : [];
  });
  return segments.length ? [connectionFeature(segments)] : [];
}

function interpolate(from: Position, to: Position, fraction: number): Position {
  const delta = ((to[0] - from[0] + 540) % 360) - 180;
  return [
    ((from[0] + delta * fraction + 540) % 360) - 180,
    from[1] + (to[1] - from[1]) * fraction,
  ];
}
