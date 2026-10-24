// API resources carry ISO 8601 durations; form controls and labels use minutes.
export function durationFromMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) throw new Error("Enter a finite duration.");
  const sign = minutes < 0 ? "-" : "";
  const absolute = Math.abs(minutes);
  return Number.isInteger(absolute)
    ? `${sign}PT${absolute}M`
    : `${sign}PT${Number((absolute * 60).toFixed(7))}S`;
}

export function durationMinutes(value: string): number;
export function durationMinutes(
  value: string | null | undefined,
): number | null;
export function durationMinutes(
  value: string | null | undefined,
): number | null {
  if (value == null) return null;
  const match =
    /^(-)?P(?=\d|T\d)(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,7})?)S)?)?$/.exec(
      value,
    );
  if (!match) throw new Error("Invalid ISO 8601 elapsed duration.");
  return (
    (match[1] ? -1 : 1) *
    (Number(match[2] ?? 0) * 1440 +
      Number(match[3] ?? 0) * 60 +
      Number(match[4] ?? 0) +
      Number(match[5] ?? 0) / 60)
  );
}
