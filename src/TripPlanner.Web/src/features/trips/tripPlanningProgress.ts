import type { TripDocument } from "../../api/tripDocument";
import type { Activity, Destination, Stay } from "../activities/activitiesApi";
import type { PlanResponse } from "../activities/activityPlanApi";
import { calendarDays } from "../activities/activityCalendarModel";
import { dayPlanningReview } from "../activities/dayPlanningReview";
import { transportForLeg } from "./destinationTransportModel";
import type { Transportation } from "./transportationApi";

type Visit = { destination: Destination; stay: Stay };
type PendingAction =
  | { kind: "dates" | "choose"; visit: Visit }
  | { kind: "conflict"; visit: Visit; date: string }
  | { kind: "schedule"; visit: Visit; count: number }
  | { kind: "transport"; leg: PlanningLeg };

export type PlanningLeg = {
  from?: string;
  to?: string;
  fromCity: string;
  toCity: string;
  hasFlight: boolean;
};

export function tripPlanningProgress(
  visits: Visit[],
  plans: Record<string, PlanResponse | null>,
  activities: Record<string, { items?: Activity[] }>,
  legs: PlanningLeg[],
  transportation: Transportation[] | undefined,
  itinerary?: TripDocument["itinerary"],
) {
  const missingByDestination = new Map<string, number>();
  const progress = visits.map((visit) => {
    const { destination, stay } = visit;
    const plan = plans[destination.id];
    const items = activities[destination.id]?.items;
    const dated = !!(stay.arrivalDate && stay.departureDate);
    if (!plan || !items) return { visit, dated };
    const days = calendarDays(plan.plan, [
      {
        stayId: stay.id,
        arrivalDate: stay.arrivalDate,
        departureDate: stay.departureDate,
      },
    ])
      .filter(
        (day) =>
          day.stayId === stay.id &&
          (!stay.arrivalDate || day.date >= stay.arrivalDate) &&
          (!stay.departureDate || day.date <= stay.departureDate),
      )
      .map((day) => ({
        day,
        ...dayPlanningReview(plan, day, destination, items, itinerary),
      }));
    if (!missingByDestination.has(destination.id)) {
      const scheduled = new Set(
        plan.plan.days.flatMap((day) =>
          dayPlanningReview(
            plan,
            day,
            destination,
            items,
            itinerary,
          ).activities.map((activity) => activity.activityId),
        ),
      );
      const selected = selectedActivities(plan, items);
      missingByDestination.set(
        destination.id,
        selected.filter((id) => !scheduled.has(id)).length,
      );
    }
    const reviewed = days.filter((day) => day.planned).length;
    const conflict = days.find((day) => day.conflict);
    const waitingForActivities =
      days.every(({ day }) => !day.review) &&
      items.some((item) => item.properties.state === "Maybe") &&
      selectedActivities(plan, items).length === 0;
    return { visit, dated, days, reviewed, conflict, waitingForActivities };
  });

  const arranged = legs.filter(({ from, to, hasFlight }) => {
    const saved = transportForLeg(transportation ?? [], from, to);
    if (saved?.mode === "flight" || !saved?.mode) return hasFlight;
    return !saved.routeStale;
  });
  const visitProgress = progress.map((item, index) => {
    const city = item.visit.destination.id;
    const firstVisit =
      progress.findIndex(
        (candidate) => candidate.visit.destination.id === city,
      ) === index;
    const missing = firstVisit ? (missingByDestination.get(city) ?? 0) : 0;
    return {
      ...item,
      missing,
      planned:
        item.dated &&
        !!item.days?.length &&
        item.days.length === item.reviewed &&
        missing === 0,
    };
  });

  let next: PendingAction | undefined;
  const conflict = visitProgress.find((item) => item.conflict);
  const undated = visitProgress.find((item) => !item.dated);
  const choose = visitProgress.find((item) => item.waitingForActivities);
  const unscheduled = visitProgress.find((item) => item.missing);
  const missingLeg =
    transportation && legs.find((leg) => !arranged.includes(leg));
  const allVisitsPlanned = visitProgress.every((item) => item.planned);
  if (conflict?.conflict)
    next = {
      kind: "conflict",
      visit: conflict.visit,
      date: conflict.conflict.day.date,
    };
  else if (undated) next = { kind: "dates", visit: undated.visit };
  else if (choose) next = { kind: "choose", visit: choose.visit };
  else if (unscheduled)
    next = {
      kind: "schedule",
      visit: unscheduled.visit,
      count: unscheduled.missing,
    };
  else if (missingLeg && allVisitsPlanned)
    next = { kind: "transport", leg: missingLeg };

  return {
    next,
    planned:
      visits.length > 0 &&
      allVisitsPlanned &&
      transportation !== undefined &&
      legs.length === arranged.length,
  };
}

function selectedActivities(plan: PlanResponse, activities: Activity[]) {
  const selected = new Set(plan.plan.selectedActivityIds);
  return activities
    .filter(
      (activity) =>
        !plan.plan.excludedActivityIds.includes(activity.id) &&
        (selected.has(activity.id) || activity.properties.state === "Yes"),
    )
    .map((activity) => activity.id);
}
