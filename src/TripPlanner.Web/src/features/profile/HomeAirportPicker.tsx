import { useEffect, useState } from "react";
import { Field, Select, Spinner, Text } from "@fluentui/react-components";
import { apiBaseUrl, resolveCity, type CitySuggestion } from "../../api/api";
import type { AirportSuggestion } from "../flights/planningApi";

export default function HomeAirportPicker({
  city,
  value,
  onChange,
  onReadyChange,
}: {
  city?: CitySuggestion;
  value?: string | null;
  onChange: (value: string | null) => void;
  onReadyChange: (ready: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<{
    key: string;
    airports: AirportSuggestion[];
    error?: string;
  }>();
  const key = city ? `${city.id}:${city.label}` : "";
  useEffect(() => {
    const controller = new AbortController();
    if (city)
      void resolveCity(city)
        .then(async (point) => {
          const query = new URLSearchParams({
            city: city.label,
            longitude: String(point.longitude),
            latitude: String(point.latitude),
          });
          const response = await fetch(`${apiBaseUrl}/airports/home?${query}`, {
            credentials: "include",
            signal: controller.signal,
          });
          if (!response.ok)
            throw new Error(
              "Unable to load your home airports. Select the city again to retry.",
            );
          const airports: AirportSuggestion[] = await response.json();
          if (!controller.signal.aborted) setLoaded({ key, airports });
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setLoaded({
              key,
              airports: [],
              error:
                reason instanceof Error
                  ? reason.message
                  : "Unable to load airports.",
            });
        });
    return () => controller.abort();
  }, [city, key]);
  const current = loaded?.key === key ? loaded : undefined;
  useEffect(() => {
    if (
      current &&
      !current.error &&
      current.airports.length === 1 &&
      value !== current.airports[0].code
    )
      onChange(current.airports[0].code);
    onReadyChange(
      Boolean(
        current &&
        !current.error &&
        (current.airports.length === 0 ||
          current.airports.some((a) => a.code === value)),
      ),
    );
  }, [current, value, onChange, onReadyChange]);
  if (!city) return null;
  if (!current) return <Spinner size="tiny" label="Finding home airports" />;
  if (current.error) return <Text role="alert">{current.error}</Text>;
  if (current.airports.length === 0)
    return (
      <Text>
        No nearby passenger airport found. Choose your departure airport when
        planning a trip.
      </Text>
    );
  return (
    <Field
      label="Preferred home airport"
      required
      hint="City searches still include all airports. Your preferred airport helps rank results."
    >
      <Select
        value={value ?? ""}
        onChange={(_, data) => onChange(data.value || null)}
      >
        <option value="">Choose an airport</option>
        {current.airports.map((a) => (
          <option key={a.code} value={a.code}>
            {a.name} ({a.code})
          </option>
        ))}
      </Select>
    </Field>
  );
}
