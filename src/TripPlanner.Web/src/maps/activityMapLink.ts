import type { Point } from "../features/activities/activitiesApi";

export function activityMapLink(
  point: Point | null,
  name: string,
  userAgent = navigator.userAgent,
): string | undefined {
  if (!point || point.coordinates.length !== 2) return;
  const [longitude, latitude] = point.coordinates;
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  )
    return;
  const coordinates = `${latitude},${longitude}`;
  const apple = /iPhone|iPad|iPod|Macintosh/.test(userAgent);
  if (apple)
    return `https://maps.apple.com/?${new URLSearchParams({ daddr: coordinates, q: name })}`;
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: coordinates, dir_action: "navigate" })}`;
}
