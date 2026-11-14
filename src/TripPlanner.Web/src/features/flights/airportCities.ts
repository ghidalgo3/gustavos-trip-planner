import { useTripDocumentState } from "../../api/tripDocumentStore";
import { useEffect, useState } from "react";
import { apiBaseUrl } from "../../api/api";
import type { AirportCities } from "./flightFormatting";
import type { FareLeg } from "../../api/operationsApi";

export function flightAirportCodes(legs: FareLeg[]): string[] {
  return [
    ...new Set(
      legs.flatMap((leg) =>
        leg.segments.flatMap((segment) => [
          segment.departure_airport,
          segment.arrival_airport,
        ]),
      ),
    ),
  ].sort();
}

export function useAirportCities(codes: string[]): AirportCities {
  const document = useTripDocumentState();
  const saved: AirportCities = Object.fromEntries(
    (document.document?.places ?? []).flatMap((place) => {
      const address = place.address;
      return place.iataCode &&
        address &&
        typeof address === "object" &&
        address.addressLocality
        ? [[place.iataCode, address.addressLocality]]
        : [];
    }),
  );
  const key = [...new Set(codes)]
    .filter((code) => !saved[code])
    .sort()
    .join(",");
  const disconnected = document.offline || navigator.onLine === false;
  const [value, setValue] = useState<{ key: string; cities: AirportCities }>();
  useEffect(() => {
    if (!key || disconnected) return;
    const controller = new AbortController();
    const requested = key.split(",");
    const batches: string[][] = [];
    for (let index = 0; index < requested.length; index += 50)
      batches.push(requested.slice(index, index + 50));
    void Promise.all(
      batches.map(async (batch) => {
        const response = await fetch(
          `${apiBaseUrl}/airports/cities?codes=${encodeURIComponent(batch.join(","))}`,
          { credentials: "include", signal: controller.signal },
        );
        return response.ok ? ((await response.json()) as AirportCities) : {};
      }),
    )
      .then((parts) => {
        if (!controller.signal.aborted)
          setValue({
            key,
            cities: Object.assign({}, ...parts),
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setValue({ key, cities: {} });
      });
    return () => controller.abort();
  }, [key, disconnected]);
  return { ...(value?.key === key ? value.cities : {}), ...saved };
}
