import { mapsClient } from "../../maps/mapsClient";
import { useState } from "react";
import { Button } from "@fluentui/react-components";
import HomeAirportPicker from "./HomeAirportPicker";
import { trackBehavior } from "../../telemetry/telemetry";
import AsyncAutocomplete from "../../shared/components/AsyncAutocomplete";
import {
  saveUserProfile,
  type CitySuggestion,
  type CurrentUser,
} from "../../api/api";

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
      const location = await mapsClient.geocodeCity(selectedCity);
      onSaved(
        await saveUserProfile({
          homeCity: { name: selectedCity.label, ...location },
          preferredAirlines: [],
          preferredAirport,
        }),
      );
      trackBehavior("onboarding_completed");
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
        search={mapsClient.searchCities}
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
