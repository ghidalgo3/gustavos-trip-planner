export const timeZoneIds = ["UTC", ...Intl.supportedValuesOf("timeZone")];

export function isTimeZoneId(value: string | null | undefined): boolean {
  if (!value) return true;
  // Accept IANA aliases as well as the browser's canonical IDs, but not offsets.
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Resolve a wall clock without letting the device's own zone choose its instant.
// Multiple matches are ambiguous at the autumn transition; no match is a spring gap.
export function localClockInstant(
  date: string,
  clock: string,
  timeZone: string,
): number {
  const wall = Date.parse(`${date}T${clock}:00Z`);
  const zone = new Intl.DateTimeFormat("en", {
    timeZone,
    timeZoneName: "longOffset",
  });
  const offsets = new Set<number>();
  const offsetAt = (instant: number) => {
    const label = zone
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")!.value;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label);
    return match
      ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]))
      : 0;
  };
  for (let hours = -36; hours <= 36; hours += 12)
    offsets.add(offsetAt(wall + hours * 3_600_000));
  const candidates = [...offsets]
    .map((offset) => wall - offset * 60_000)
    .filter((instant) => instant + offsetAt(instant) * 60_000 === wall);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "This clock time occurs twice because of daylight saving time. Choose another time."
        : "This clock time does not exist because of daylight saving time. Choose another time.",
    );
  return candidates[0];
}
