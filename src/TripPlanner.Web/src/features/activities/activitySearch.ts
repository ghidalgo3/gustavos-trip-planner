import type { Activity } from "./activitiesApi";
import { activityStatus } from "./activityStatus";

function fieldValues(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    return Object.values(value).map(fieldValues).join(" ");
  }
  return String(value);
}

export function activityMatchesSearch(activity: Activity, query: string) {
  const search = query.trim().toLocaleLowerCase();
  const searchable = {
    ...activity,
    properties: {
      ...activity.properties,
      state: activityStatus(activity.properties.state).label,
    },
  };
  return (
    !search || fieldValues(searchable).toLocaleLowerCase().includes(search)
  );
}
