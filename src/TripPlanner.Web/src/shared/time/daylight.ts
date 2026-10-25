import { getTimes } from "suncalc";

export type SolarLocation = {
  latitude: number;
  longitude: number;
  timeZone: string | null;
};

export type SunEvent = {
  name: "Sunrise" | "Sunset";
  instant: string;
  localTime: string;
};

export function daylight(date: string, location: SolarLocation) {
  const { latitude, longitude, timeZone } = location;
  if (
    !timeZone ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  )
    return undefined;
  try {
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const offsetFormat = new Intl.DateTimeFormat("en", {
      timeZone,
      timeZoneName: "longOffset",
    });
    const offsetAt = (instant: number) => {
      const offset = offsetFormat
        .formatToParts(instant)
        .find((p) => p.type === "timeZoneName")!.value;
      const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
      return match
        ? (match[1] === "+" ? 1 : -1) * (+match[2] * 60 + +match[3])
        : 0;
    };
    // Resolve local noon explicitly: the traveller's browser zone must not
    // choose the solar date. Recheck the offset for DST and the date line.
    const utcNoon = Date.parse(`${date}T12:00:00Z`);
    let offset = offsetAt(utcNoon);
    offset = offsetAt(utcNoon - offset * 60_000);
    const times = getTimes(
      new Date(utcNoon - offset * 60_000),
      latitude,
      longitude,
      0,
      offset,
    );
    const events: SunEvent[] = [];
    for (const [key, name] of [
      ["sunrise", "Sunrise"],
      ["sunset", "Sunset"],
    ] as const) {
      const instant = times[key];
      if (instant && Number.isFinite(instant.getTime())) {
        events.push({
          name,
          instant: instant.toISOString(),
          localTime: `${date}T${clock.format(instant)}`,
        });
      }
    }
    return {
      events: events.sort((a, b) => a.localTime.localeCompare(b.localTime)),
      note: times.alwaysUp
        ? "Midnight sun · No sunset"
        : times.alwaysDown
          ? "Polar night · No sunrise"
          : undefined,
    };
  } catch {
    // Missing/invalid destination metadata must never invent a solar time.
    return undefined;
  }
}
