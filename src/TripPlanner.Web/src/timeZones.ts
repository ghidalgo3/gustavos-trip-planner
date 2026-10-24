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
