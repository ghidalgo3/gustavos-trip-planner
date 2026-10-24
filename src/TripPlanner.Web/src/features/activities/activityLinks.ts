import type { ActivityLink } from "./activitiesApi";
export function validActivityLink(link: ActivityLink) {
  if (
    !link.url.trim() ||
    link.url.length > 2048 ||
    (link.label?.length ?? 0) > 200
  )
    return false;
  try {
    const url = new URL(link.url);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
