import type { TripDocument } from "../../api/tripDocument";
import type { Activity, Destination } from "./activitiesApi";
import type { PlanDay, PlanResponse } from "./activityPlanApi";
import { calendarEntries, calendarDayKey } from "./activityCalendarModel";
import { scheduledTravelEntries } from "./scheduledTravel";

export function dayPlanningReview(
  response: PlanResponse,
  day: PlanDay,
  destination: Destination,
  activities: Activity[],
  itinerary?: TripDocument["itinerary"],
) {
  const { plan, assessment } = response;
  const dayEntries = calendarEntries(
    plan,
    day,
    activities,
    assessment,
    destination,
  );
  const travel = scheduledTravelEntries(
    itinerary?.items ?? [],
    day,
    plan.timeZone ?? destination.properties.timeZone ?? null,
  );
  const entries = [
    ...dayEntries.filter(
      (entry) =>
        entry.kind !== "flight" ||
        !travel.some((item) => item.kind === "flight"),
    ),
    ...travel,
  ];
  const scheduled = new Set(
    entries.flatMap((entry) => (entry.activityId ? [entry.activityId] : [])),
  );
  const issue = assessment.issues.find(
    (item) =>
      item.severity === "conflict" &&
      (item.activityId
        ? day.activityIds.includes(item.activityId)
        : item.date === day.date),
  );
  const scheduledActivities = entries.filter(
    (entry) => entry.kind === "activity",
  );
  const travelConflict = travel.find((leg) =>
    scheduledActivities.some((entry) => {
      const beforeArrival =
        leg.transportation?.destinationStayId === day.stayId &&
        entry.start < leg.end;
      const afterDeparture =
        leg.transportation?.originStayId === day.stayId &&
        entry.end > leg.start;
      const overlap = entry.start < leg.end && leg.start < entry.end;
      return beforeArrival || afterDeparture || overlap;
    }),
  );
  const conflict =
    issue?.message ??
    (travelConflict && `An activity conflicts with ${travelConflict.title}.`);
  const visit = destination.properties.stays.find(
    (stay) => stay.id === day.stayId,
  );
  const missingTiming = day.activityIds.some((id) => !scheduled.has(id));
  const canReview =
    !!(
      visit?.arrivalDate &&
      visit.departureDate &&
      day.date >= visit.arrivalDate &&
      day.date <= visit.departureDate
    ) &&
    !conflict &&
    !missingTiming;
  const kind = day.activityIds.length ? "planned" : "open";
  const token = `${kind}:${scheduleFingerprint([
    calendarDayKey(day),
    visit?.arrivalDate,
    visit?.departureDate,
    plan.timeZone,
    entries.map(({ id, start, end }) => [id, start, end]),
  ])}`;
  return {
    token,
    canReview,
    planned: canReview && day.review === token,
    open: kind === "open",
    conflict,
    missingTiming,
    activities: scheduledActivities,
  };
}

// This version marker compares saved calendar content locally and works offline.
function scheduleFingerprint(content: unknown) {
  let hash = 0xcbf29ce484222325n;
  for (const character of JSON.stringify(content)) {
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n,
    );
  }
  return hash.toString(16).padStart(16, "0");
}
