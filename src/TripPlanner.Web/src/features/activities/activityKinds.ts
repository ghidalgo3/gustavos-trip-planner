export const activityKinds = [
  "Food",
  "Shopping",
  "Culture",
  "Music",
  "Art",
  "Nature",
  "Relax",
  "Event",
  "Holiday",
] as const;
export type ActivityKind = (typeof activityKinds)[number];
export type TicketRequirement = "Unknown" | "Required" | "NotRequired";
