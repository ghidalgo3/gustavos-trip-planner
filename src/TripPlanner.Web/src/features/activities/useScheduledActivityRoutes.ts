import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { Activity, Destination } from "./activitiesApi";
import type { PlanDay, PlanResponse } from "./activityPlanApi";
import {
  activityRouteKey,
  activityRouteLegKey,
  activityRoutePoint,
  requestActivityRoute,
  type ActivityRoutePreview,
  type ActivityRouteStep,
} from "./activityRouteApi";

export function useScheduledActivityRoutes(
  path: string,
  resource: PlanResponse | undefined,
  day: PlanDay | undefined,
  activities: Activity[],
  destination: Destination,
  offline: boolean,
) {
  const [routes, setRoutes] = useState<Record<string, ActivityRoutePreview>>(
    {},
  );
  const wanted = useMemo(() => {
    if (!day || !resource) return [];
    const stay = activityRoutePoint(null, day.stayId, activities, destination);
    const stops = stay ? [null, ...day.activityIds, null] : day.activityIds;
    return stops.slice(1).flatMap((to, index) => {
      const from = stops[index];
      const override = resource.plan.transportOverrides.find(
        (item) =>
          item.date === day.date &&
          item.fromActivityId === from &&
          item.toActivityId === to,
      );
      if (!override) return [];
      const selection = {
        ...override,
        stayId: day.stayId,
        label: "",
        duration: override.duration ?? "PT0M",
        plan: resource.plan,
        contextVersion: resource.contextVersion,
      };
      const key = routeCacheKey(path, selection, activities, destination);
      return key
        ? [{ key, selection, leg: activityRouteLegKey(from, to) }]
        : [];
    });
  }, [path, resource, day, activities, destination]);
  const load = useEffectEvent((signal: AbortSignal) => {
    for (const { selection, key } of wanted) {
      if (routes[key]) continue;
      void requestActivityRoute(path, selection, signal).then(
        ({ data }) => {
          if (data?.geometry?.coordinates.length && !signal.aborted)
            setRoutes((previous) => ({ ...previous, [key]: data }));
        },
        () => {
          // Saved travel stays readable during a provider failure.
        },
      );
    }
  });
  useEffect(() => {
    if (offline || !wanted.length) return;
    const abort = new AbortController();
    load(abort.signal);
    return () => abort.abort();
  }, [offline, wanted]);

  const activeRoutes = useMemo(
    () =>
      new Map(
        wanted.flatMap(({ key, leg }) =>
          routes[key] ? [[leg, routes[key]]] : [],
        ),
      ),
    [wanted, routes],
  );

  function rememberRoute(step: ActivityRouteStep, route: ActivityRoutePreview) {
    const key = routeCacheKey(path, step, activities, destination);
    if (key) setRoutes((previous) => ({ ...previous, [key]: route }));
  }

  return { activeRoutes, rememberRoute };
}

function routeCacheKey(
  path: string,
  step: ActivityRouteStep,
  activities: Activity[],
  destination: Destination,
) {
  const from = activityRoutePoint(
    step.fromActivityId,
    step.stayId,
    activities,
    destination,
  );
  const to = activityRoutePoint(
    step.toActivityId,
    step.stayId,
    activities,
    destination,
  );
  if (!from || !to) return undefined;
  return JSON.stringify([
    path,
    activityRouteKey(step),
    step.mode,
    from.coordinates,
    to.coordinates,
  ]);
}
