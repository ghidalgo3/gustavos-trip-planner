export type TicketRequirement = "Unknown" | "Required" | "NotRequired";

export function validActivityKinds(kinds: unknown): kinds is string[] {
  return (
    Array.isArray(kinds) &&
    kinds.every(
      (kind: unknown) =>
        typeof kind === "string" &&
        kind.trim().length > 0 &&
        kind.length <= 200,
    ) &&
    new Set(kinds).size === kinds.length
  );
}
