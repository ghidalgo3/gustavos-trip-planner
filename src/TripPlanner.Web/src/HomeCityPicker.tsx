import { useState } from "react";
import { Button } from "@fluentui/react-components";
import HomeAirportPicker from "./HomeAirportPicker";
import AsyncAutocomplete from "./AsyncAutocomplete";
import {
  resolveCity,
  saveUserProfile,
  searchCities,
  type CitySuggestion,
  type CurrentUser,
} from "./api";

type HomeCityPickerProps = {
  onSaved: (user: CurrentUser) => void;
};

export default function HomeCityPicker({ onSaved }: HomeCityPickerProps) {
  const [query, setQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState<CitySuggestion>();
  const [preferredAirport, setPreferredAirport] = useState<string | null>(null);
  const [airportsReady, setAirportsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    if (!selectedCity) {
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const location = await resolveCity(selectedCity);
      onSaved(
        await saveUserProfile({
          homeCity: { name: selectedCity.label, ...location },
          preferredAirlines: [],
          preferredAirport,
        }),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Your home city was not saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="home-city-form">
      <AsyncAutocomplete
        label="Home city"
        placeholder="Start typing a city"
        inputValue={query}
        selectedOptionValue={selectedCity?.id}
        selectedOptionLabel={selectedCity?.label}
        search={searchCities}
        getOptionValue={(city) => city.id}
        getOptionText={(city) => city.label}
        onInputChange={(value) => {
          setQuery(value);
          setSelectedCity(undefined);
          setPreferredAirport(null);
          setError(undefined);
        }}
        onOptionSelect={(city) => {
          setSelectedCity(city);
          setPreferredAirport(null);
          setQuery(city.label);
          setError(undefined);
        }}
        error={error}
        debounceMs={300}
      />
      <HomeAirportPicker
        city={selectedCity}
        value={preferredAirport}
        onChange={setPreferredAirport}
        onReadyChange={setAirportsReady}
      />
      <Button
        appearance="primary"
        disabled={!selectedCity || saving || !airportsReady}
        onClick={submit}
      >
        {saving ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
