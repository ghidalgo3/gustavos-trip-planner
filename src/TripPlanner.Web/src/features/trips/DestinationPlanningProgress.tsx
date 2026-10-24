import { ProgressBar, Text } from "@fluentui/react-components";
import type { PlanResponse } from "../activities/activityPlanApi";
import { durationMinutes } from "../../shared/time/durations";

export default function DestinationPlanningProgress({
  response,
  stayId,
  name,
}: {
  response: PlanResponse;
  stayId: string;
  name: string;
}) {
  // Only saved, scheduled activities count as planning; proposals and unassigned ideas do not.
  if (
    response.version === 0 ||
    !response.plan.days.some(
      (day) => day.stayId === stayId && day.activityIds.length > 0,
    )
  )
    return null;
  const days = response.assessment.days.filter((day) => day.stayId === stayId);
  const available = days.reduce(
    (sum, day) => sum + durationMinutes(day.availableDuration),
    0,
  );
  if (available <= 0) return null;
  // Match the agenda: free time excludes the daily slack allowance, meals and travel.
  const free = days.reduce(
    (sum, day) =>
      sum +
      (durationMinutes(day.overrunDuration) > 0
        ? 0
        : Math.min(
            durationMinutes(day.availableDuration),
            Math.max(
              0,
              durationMinutes(day.slackDuration) -
                durationMinutes(day.requiredSlackDuration),
            ),
          )),
    0,
  );
  const utilization = Math.min(1, Math.max(0, 1 - free / available));
  const color =
    utilization <= 0.6 ? "success" : utilization <= 0.8 ? "warning" : "error";
  const estimated =
    response.timingStale || response.assessment.status !== "fits";
  const label = `${Math.round(utilization * 100)}% utilized · ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(free / 60)} h free${estimated ? " (estimated)" : ""}`;
  return (
    <div className="overview-planning-progress" data-utilization={color}>
      <Text>{label}</Text>
      <ProgressBar
        value={utilization}
        max={1}
        color={color}
        thickness="large"
        aria-label={`Planning utilization for ${name}`}
        aria-valuetext={label}
      />
    </div>
  );
}
