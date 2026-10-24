import { useEffect, useState } from "react";
import {
  previewActivityPlan,
  type ActivityPlan,
  type PlanAssessment,
} from "./activityPlanApi";

export function useActivityPlanPreview(
  path: string,
  plan: ActivityPlan | undefined,
  contextVersion: string | undefined,
  enabled: boolean,
) {
  const key = JSON.stringify([path, contextVersion, plan]);
  const [result, setResult] = useState<{
    key: string;
    assessment?: PlanAssessment;
    error?: string;
  }>();
  useEffect(() => {
    if (!enabled || !plan || !contextVersion) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void previewActivityPlan(path, plan, contextVersion, abort.signal).then(
        (assessment) => {
          if (!abort.signal.aborted) setResult({ key, assessment });
        },
        (error: unknown) => {
          if (!abort.signal.aborted)
            setResult({
              key,
              error:
                error instanceof Error
                  ? error.message
                  : "Could not calculate free time.",
            });
        },
      );
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [path, plan, contextVersion, enabled, key]);
  return enabled && result?.key === key ? result : undefined;
}
