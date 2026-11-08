import { tripFetch } from "../../api/tripDocumentStore";
import { apiBaseUrl } from "../../api/api";

export type DailySettings = {
  sleepStart: string;
  sleepEnd: string;
  breakfastDuration: string;
  lunchDuration: string;
  dinnerDuration: string;
  slackDuration: string;
  transportMode: string;
  airportArrivalBufferDuration: string;
  airportDepartureBufferDuration: string;
  airportTransferDuration: string;
};
export type MealPositions = {
  breakfast: number;
  lunch: number;
  dinner: number;
};
export const mealNames = ["breakfast", "lunch", "dinner"] as const;

export type PlanDay = {
  stayId: string;
  date: string;
  activityIds: string[];
  mealPositions?: MealPositions | null;
  settings: DailySettings | null;
  availableFrom: string | null;
  availableUntil: string | null;
  availabilityConfirmed: boolean;
  flightMatches?: {
    travellerId: string;
    direction: string;
    candidateId: string;
  }[];
};
export type PlanRule = {
  activityId: string;
  mustDo: boolean;
  fixedDate: string | null;
  fixedStart: string | null;
  afterActivityId: string | null;
  coversMeal: string | null;
  duration: string | null;
  alwaysAvailable: boolean;
  openingWindows: { date: string; start: string; end: string }[];
  closedDates: string[];
};
export type TransportOverride = {
  date: string;
  fromActivityId: string | null;
  toActivityId: string | null;
  mode: string;
  duration: string | null;
};
export type ActivityPlan = {
  selectedActivityIds: string[];
  excludedActivityIds: string[];
  days: PlanDay[];
  rules: PlanRule[];
  transportOverrides: TransportOverride[];
  settings: DailySettings;
  timeZone: string | null;
};
export type PlanIssue = {
  code: string;
  severity: string;
  message: string;
  date: string | null;
  activityId: string | null;
  duration: string | null;
};
export type ScheduleEntry = {
  activityId: string;
  stayId: string;
  date: string;
  name: string;
  start: string | null;
  end: string | null;
  duration: string;
  provisional: boolean;
};
export type TravelLeg = {
  fromActivityId: string | null;
  toActivityId: string | null;
  mode: string;
  duration: string;
  provisional: boolean;
  source: string;
  walkingDuration: string;
  transfers: number;
  waitingDuration: string;
  departure: string | null;
};
export type DayAssessment = {
  stayId: string;
  date: string;
  availableDuration: string;
  activityDuration: string;
  travelDuration: string;
  mealDuration: string;
  restDuration: string;
  waitingDuration: string;
  slackDuration: string;
  requiredSlackDuration: string;
  overrunDuration: string;
  entries: ScheduleEntry[];
  travel: TravelLeg[];
  flightAvailability?: Availability | null;
  breaks: {
    name: string;
    start: string | null;
    end: string | null;
    duration: string;
  }[];
};
export type PlanAssessment = {
  status: string;
  issues: PlanIssue[];
  days: DayAssessment[];
  travellerFit: {
    userId: string;
    name: string;
    points: number;
    availablePoints: number;
    estimated: boolean;
  }[];
  groupUtility: number;
  evaluatedAt: string;
  conflictCount: number;
  travelDuration: string;
  overrunDuration: string;
  evidence: {
    kind: string;
    activityId: string | null;
    source: string;
    retrievedAt: string;
    applicableDates: string[];
    provisional: boolean;
  }[];
};
export type Availability = {
  stayId: string;
  date: string;
  availableFrom: string | null;
  availableUntil: string | null;
  ambiguous: boolean;
  explanation: string;
  flightChoices: string[];
  availableFromInstant?: string | null;
  availableUntilInstant?: string | null;
  candidates?: {
    id: string;
    travellerId: string;
    travellerName: string;
    direction: string;
    time: string;
    selected?: boolean;
    departureAirport?: string | null;
    arrivalAirport?: string | null;
    departure?: string | null;
    arrival?: string | null;
  }[];
};
export type PlanResponse = {
  plan: ActivityPlan;
  version: number;
  contextVersion: string;
  assessment: PlanAssessment;
  savedAssessment: PlanAssessment | null;
  timingStale: boolean;
  context: {
    visits?: {
      stayId: string;
      arrivalDate: string | null;
      departureDate: string | null;
    }[];
    destinationName: string;
    tripInstructions: string;
    destinationInstructions: string;
    suggestedAvailability: Availability[];
  };
};
export type PlanChoice = {
  id: string;
  title: string;
  plan: ActivityPlan;
  assessment: PlanAssessment;
  explanation?: string;
  fingerprint?: string;
};
export type PlanResult = {
  id: string;
  kind: string;
  status: string;
  basePlanVersion: number;
  contextVersion: string;
  assessment: PlanAssessment;
  alternatives: PlanChoice[];
  suggestions: PlanChoice[];
  warnings: string[];
  suggestedAvailability?: Availability[];
  ruleChanges: {
    activityId: string;
    description: string;
    replacement: PlanRule;
  }[];
  suggestedRules: { description: string; settings: DailySettings }[];
};
export type PlanJob = {
  operationId: string;
  status: string;
  result: PlanResult | null;
  review: { dismissedSuggestionIds: string[] };
  error: string | null;
};
export type Preferences = {
  instructions: string;
  defaults: DailySettings | null;
};
export type CalendarSubscription = {
  id: string;
  createdAt: string;
  revokedAt: string | null;
  url?: string | null;
};
export type Versioned<T> = { data: T; etag: string };

export function activityPlanPath(tripId: string, city: string) {
  return `/trips/${encodeURIComponent(tripId)}/destinations/${encodeURIComponent(city)}/activity-plan`;
}

export async function previewActivityPlan(
  path: string,
  plan: ActivityPlan,
  contextVersion: string,
  signal: AbortSignal,
): Promise<PlanAssessment> {
  const result = await planningRequest<PlanAssessment>(`${path}/previews`, {
    method: "POST",
    body: { plan, contextVersion },
    signal,
  });
  return result.data;
}
export async function planningRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    etag?: string;
    contextVersion?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Versioned<T>> {
  const response = await tripFetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.etag ? { "If-Match": options.etag } : {}),
      ...(options.contextVersion
        ? { "Planning-Context": options.contextVersion }
        : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    if (
      response.status === 409 ||
      response.status === 412 ||
      response.status === 428
    )
      throw new Error(
        "Planning inputs changed. Reload the plan before applying your changes.",
      );
    const data = (await response.json().catch(() => ({}))) as {
      title?: string;
      errors?: Record<string, string[]>;
    };
    throw new Error(
      data.errors
        ? Object.values(data.errors).flat().join(" ")
        : (data.title ?? "Unable to update activity planning."),
    );
  }
  return {
    data:
      response.status === 204
        ? (undefined as T)
        : ((await response.json()) as T),
    etag: response.headers.get("ETag") ?? "",
  };
}

export function chooseActivity(
  plan: ActivityPlan,
  id: string,
  state: "selected" | "idea" | "excluded",
): ActivityPlan {
  return {
    ...plan,
    selectedActivityIds:
      state === "selected"
        ? [...new Set([...plan.selectedActivityIds, id])]
        : plan.selectedActivityIds.filter((x) => x !== id),
    excludedActivityIds:
      state === "excluded"
        ? [...new Set([...plan.excludedActivityIds, id])]
        : plan.excludedActivityIds.filter((x) => x !== id),
    days:
      state === "selected"
        ? plan.days
        : plan.days.map((d) => ({
            ...d,
            activityIds: d.activityIds.filter((x) => x !== id),
            ...(d.mealPositions
              ? { mealPositions: removeFromMeals(d, id) }
              : {}),
          })),
  };
}
// Meal positions count activities before each routine, so a drag records order,
// while the server remains responsible for calculating actual start times.
export function agendaMealPositions(
  plan: ActivityPlan,
  day: PlanDay,
  assessment?: PlanAssessment,
): MealPositions {
  if (day.mealPositions) return day.mealPositions;
  const evaluated = assessment?.days.find(
    (d) => d.stayId === day.stayId && d.date === day.date,
  );
  const inferred = Object.fromEntries(
    mealNames.map((meal) => {
      const mealBreak = evaluated?.breaks.find((b) => b.name === meal);
      if (mealBreak?.start) {
        const next = day.activityIds.findIndex((id) => {
          const start = evaluated?.entries.find(
            (e) => e.activityId === id,
          )?.start;
          return start && Date.parse(start) >= Date.parse(mealBreak.start!);
        });
        return [meal, next < 0 ? day.activityIds.length : next];
      }
      const covering = day.activityIds.findIndex((id) =>
        plan.rules.some((r) => r.activityId === id && r.coversMeal === meal),
      );
      return [
        meal,
        covering >= 0
          ? covering + 1
          : meal === "breakfast"
            ? 0
            : day.activityIds.length,
      ];
    }),
  ) as MealPositions;
  // A meal included in an activity has no assessed break. Keep its virtual
  // routine in meal order so every displayed drop produces a valid timeline.
  return {
    breakfast: inferred.breakfast,
    lunch: Math.max(inferred.breakfast, inferred.lunch),
    dinner: Math.max(inferred.breakfast, inferred.lunch, inferred.dinner),
  };
}

function removeFromMeals(day: PlanDay, id: string): MealPositions {
  const index = day.activityIds.indexOf(id);
  return Object.fromEntries(
    mealNames.map((meal) => {
      const position = day.mealPositions![meal];
      return [meal, position - (index >= 0 && index < position ? 1 : 0)];
    }),
  ) as MealPositions;
}

export function moveActivity(
  plan: ActivityPlan,
  id: string,
  targetDate: string | null,
  index?: number,
  mealsBefore?: number,
  assessment?: PlanAssessment,
): ActivityPlan {
  const selected = chooseActivity(plan, id, "selected");
  return {
    ...selected,
    days: selected.days.map((original) => {
      const involved =
        original.date === targetDate || original.activityIds.includes(id);
      const d =
        mealsBefore !== undefined && involved
          ? {
              ...original,
              mealPositions: agendaMealPositions(plan, original, assessment),
            }
          : original;
      const ids = d.activityIds.filter((x) => x !== id);
      const positions = d.mealPositions ? removeFromMeals(d, id) : null;
      if (d.date === targetDate) {
        const at = Math.max(0, Math.min(index ?? ids.length, ids.length));
        ids.splice(at, 0, id);
        if (positions) {
          mealNames.forEach((meal, mealIndex) => {
            const beforeMeal =
              positions[meal] > at ||
              (positions[meal] === at &&
                mealsBefore !== undefined &&
                mealIndex >= mealsBefore);
            if (beforeMeal) positions[meal]++;
          });
        }
      }
      return {
        ...d,
        activityIds: ids,
        ...(positions ? { mealPositions: positions } : {}),
      };
    }),
  };
}
export function activityRule(plan: ActivityPlan, id: string): PlanRule {
  return (
    plan.rules.find((r) => r.activityId === id) ?? {
      activityId: id,
      mustDo: false,
      fixedDate: null,
      fixedStart: null,
      afterActivityId: null,
      coversMeal: null,
      duration: null,
      alwaysAvailable: false,
      openingWindows: [],
      closedDates: [],
    }
  );
}
