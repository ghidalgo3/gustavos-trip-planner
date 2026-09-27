import { useState } from "react";
import { Button, Text } from "@fluentui/react-components";
import AsyncAutocomplete from "./AsyncAutocomplete";
import {
  searchAirports,
  type AirportSuggestion,
  type SearchLocation,
} from "./planningApi";

type Suggestion =
  | { kind: "airport"; airport: AirportSuggestion }
  | {
      kind: "city";
      city: string;
      country: string;
      airports: AirportSuggestion[];
    };

export default function FlightAirportPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SearchLocation | null;
  onChange: (value: SearchLocation | null) => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const codes = value?.codes?.length ? value.codes : value ? [value.code] : [];
  const selectedLabel = value?.label ?? codes.join(", ");
  return (
    <div className="flight-airport-picker">
      <AsyncAutocomplete<Suggestion>
        label={label}
        placeholder="City or airport"
        inputValue={query ?? selectedLabel}
        selectedOptionValue={value?.code}
        selectedOptionLabel={selectedLabel}
        search={async (input, signal) => {
          const airports = await searchAirports(input, signal);
          const exactCity = airports.filter(
            (airport) =>
              airport.city.toLocaleLowerCase() ===
                input.trim().toLocaleLowerCase() ||
              airport.city
                .toLocaleLowerCase()
                .startsWith(`${input.trim().toLocaleLowerCase()} (`) ||
              airport.city
                .toLocaleLowerCase()
                .startsWith(`${input.trim().toLocaleLowerCase()},`),
          );
          const cityGroups = new Map<string, AirportSuggestion[]>();
          for (const airport of exactCity) {
            const key = `${input.trim().toLocaleLowerCase()}|${airport.country}`;
            cityGroups.set(key, [...(cityGroups.get(key) ?? []), airport]);
          }
          const cities: Suggestion[] = [...cityGroups.values()]
            .filter((group) => group.length > 1)
            .map((group) => ({
              kind: "city",
              city: input.trim(),
              country: group[0].country,
              airports: group,
            }));
          return [
            ...cities,
            ...airports.map((airport): Suggestion => ({
              kind: "airport",
              airport,
            })),
          ];
        }}
        getOptionValue={(option) =>
          option.kind === "city"
            ? `city:${option.city}:${option.country}`
            : option.airport.code
        }
        getOptionText={(option) =>
          option.kind === "city"
            ? `${option.city}, ${option.country} · all airports`
            : (option.airport.location.label ?? option.airport.code)
        }
        renderOption={(option) =>
          option.kind === "city"
            ? `${option.city}, ${option.country} · all airports (${option.airports.map((airport) => airport.code).join(", ")})`
            : `${option.airport.location.label} · ${option.airport.country}`
        }
        onInputChange={setQuery}
        onOptionSelect={(option) => {
          if (option.kind === "city") {
            const airportCodes = option.airports.map((airport) => airport.code);
            onChange({
              code: airportCodes[0],
              codes: airportCodes,
              timeZone: option.airports[0].location.timeZone,
              label: `${option.city}, ${option.country} (${airportCodes.join(", ")})`,
            });
          } else {
            const airport = option.airport;
            const nextCodes = [
              ...new Set([...(adding ? codes : []), airport.code]),
            ];
            onChange({
              code: nextCodes[0],
              codes: nextCodes,
              timeZone: value?.timeZone ?? airport.location.timeZone,
              label:
                nextCodes.length === 1
                  ? airport.location.label
                  : nextCodes.join(", "),
            });
          }
          setQuery(null);
          setAdding(false);
        }}
        hint={
          adding
            ? "Choose another airport to add to this search"
            : "Choose a city for all its airports, or choose a specific airport"
        }
        emptyMessage="No airports found. Try a nearby city or an airport code."
      />
      {codes.length > 0 && (
        <div
          className="selected-airports"
          aria-label={`${label} selected airports`}
        >
          <Text size={200}>Searching {codes.join(", ")}</Text>
          <Button
            size="small"
            appearance="subtle"
            onClick={() => {
              setAdding(true);
              setQuery("");
            }}
          >
            Add airport
          </Button>
          {codes.map((code) => (
            <Button
              key={code}
              size="small"
              appearance="subtle"
              aria-label={`Remove ${code} from ${label}`}
              onClick={() => {
                const remaining = codes.filter((selected) => selected !== code);
                onChange(
                  remaining.length
                    ? {
                        ...value!,
                        code: remaining[0],
                        codes: remaining,
                        label: remaining.join(", "),
                      }
                    : null,
                );
                setQuery(null);
              }}
            >
              {code} ×
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
