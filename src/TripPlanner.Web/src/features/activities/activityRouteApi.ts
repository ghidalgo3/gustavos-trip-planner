import { useEffect, useState } from "react";
import {
  activityPlanPath,
  planningRequest,
  type ActivityPlan,
} from "./activityPlanApi";

export type ActivityRouteStep = {
  stayId: string;
  date: string;
  fromActivityId: string | null;
  toActivityId: string | null;
  mode: string;
  duration: string;
  label: string;
};
export type ActivityRouteSelection = ActivityRouteStep & {
  plan: ActivityPlan;
  contextVersion: string;
};
export type ActivityRoutePreview = {
  mode: string;
  geometry: { type: "MultiLineString"; coordinates: [number, number][][] };
};
export const activityRouteKey = (
  step: Pick<
    ActivityRouteStep,
    "stayId" | "date" | "fromActivityId" | "toActivityId"
  >,
) =>
  `${step.stayId}:${step.date}:${step.fromActivityId ?? "stay"}:${step.toActivityId ?? "stay"}`;

export function useActivityRoute(
  tripId: string,
  cityId: string | undefined,
  selection?: ActivityRouteSelection,
) {
  const key = JSON.stringify([tripId, cityId, selection]);
  const [result, setResult] = useState<{
    key: string;
    route?: ActivityRoutePreview;
    error?: string;
  }>();
  useEffect(() => {
    if (!selection || !cityId) return;
    const abort = new AbortController();
    void planningRequest<ActivityRoutePreview>(
      `${activityPlanPath(tripId, cityId)}/route-previews`,
      {
        method: "POST",
        signal: abort.signal,
        body: {
          plan: selection.plan,
          contextVersion: selection.contextVersion,
          stayId: selection.stayId,
          date: selection.date,
          fromActivityId: selection.fromActivityId,
          toActivityId: selection.toActivityId,
        },
      },
    ).then(
      (value) => {
        if (!abort.signal.aborted) setResult({ key, route: value.data });
      },
      (error: unknown) => {
        if (!abort.signal.aborted)
          setResult({
            key,
            error:
              error instanceof Error
                ? error.message
                : "The route could not be loaded.",
          });
      },
    );
    return () => abort.abort();
  }, [tripId, cityId, selection, key]);
  const current = result?.key === key ? result : undefined;
  return {
    route: selection ? current?.route : undefined,
    error: selection ? current?.error : undefined,
    loading: Boolean(selection && !current),
  };
}
