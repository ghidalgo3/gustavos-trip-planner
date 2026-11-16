type Position = [number, number];
type Vector = [number, number, number];
const radians = Math.PI / 180;
const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vector = ([longitude, latitude]: Position): Vector => [
  Math.cos(latitude * radians) * Math.cos(longitude * radians),
  Math.cos(latitude * radians) * Math.sin(longitude * radians),
  Math.sin(latitude * radians),
];

// Sample the shortest spherical arc. Separate lines at the dateline so a
// Mercator map never draws an artificial line across the rest of the world.
export function greatCircle(from: Position, to: Position): Position[][] {
  const a = vector(from),
    b = vector(to);
  let normal = cross(a, b);
  const length = Math.hypot(...normal);
  const dot = Math.max(
    -1,
    Math.min(
      1,
      a.reduce((sum, value, i) => sum + value * b[i], 0),
    ),
  );
  const angle = Math.atan2(length, dot);
  if (angle < 1e-12) return [[from, to]];
  if (length < 1e-12) {
    // Antipodal points have no unique shortest arc; choose a stable plane.
    normal = cross(a, Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
  }
  const magnitude = Math.hypot(...normal);
  normal = normal.map((value) => value / magnitude) as Vector;
  const tangent = cross(normal, a);
  const steps = Math.max(2, Math.ceil(angle / radians));
  const lines: Position[][] = [[from]];
  for (let step = 1; step <= steps; step++) {
    const theta = (angle * step) / steps;
    const point = a.map(
      (value, i) => value * Math.cos(theta) + tangent[i] * Math.sin(theta),
    );
    const next: Position =
      step === steps
        ? to
        : [
            Math.atan2(point[1], point[0]) / radians,
            Math.atan2(point[2], Math.hypot(point[0], point[1])) / radians,
          ];
    const line = lines.at(-1)!;
    const previous = line.at(-1)!;
    if (Math.abs(next[0] - previous[0]) > 180) {
      const boundary = previous[0] > 0 ? 180 : -180;
      let latitude = Math.atan2(normal[0], normal[2]) / radians;
      if (latitude > 90) latitude -= 180;
      if (latitude < -90) latitude += 180;
      if (Math.abs(normal[2]) < 1e-12)
        latitude = Math.sign(previous[1] + next[1]) * 90;
      line.push([boundary, latitude]);
      lines.push([[-boundary, latitude], next]);
    } else {
      line.push(next);
    }
  }
  return lines;
}
