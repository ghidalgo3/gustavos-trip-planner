import { useState } from "react";
import AsyncAutocomplete from "./AsyncAutocomplete";
import {
  searchAirports,
  type AirportSuggestion,
  type SearchLocation,
} from "./planningApi";

export default function AirportPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SearchLocation | null;
  onChange: (value: SearchLocation | null) => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const selectedLabel = value?.label ?? value?.code ?? "";
  return (
    <AsyncAutocomplete<AirportSuggestion>
      label={label}
      placeholder="City or airport"
      inputValue={query ?? selectedLabel}
      selectedOptionValue={value?.code}
      selectedOptionLabel={selectedLabel}
      search={searchAirports}
      getOptionValue={(airport) => airport.code}
      getOptionText={(airport) => airport.location.label ?? airport.code}
      renderOption={(airport) => (
        <>
          {airport.location.label} · {airport.country}
        </>
      )}
      onInputChange={(nextQuery) => {
        setQuery(nextQuery);
        onChange(null);
      }}
      onOptionSelect={(airport) => {
        onChange(airport.location);
        setQuery(null);
      }}
      hint={
        query
          ? "Choose an airport from the suggestions to continue"
          : "Search by city, airport name, or airport code"
      }
      emptyMessage="No airports found. Try a nearby city or an airport code."
    />
  );
}
