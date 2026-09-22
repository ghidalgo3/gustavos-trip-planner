import { useState } from "react";
import { Button } from "@fluentui/react-components";
import AsyncAutocomplete from "./AsyncAutocomplete";
import {
  saveHomeCity,
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit() {
    if (!selectedCity) {
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      onSaved(await saveHomeCity(selectedCity));
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
          setError(undefined);
        }}
        onOptionSelect={(city) => {
          setSelectedCity(city);
          setQuery(city.label);
          setError(undefined);
        }}
        error={error}
        debounceMs={300}
      />
      <Button
        appearance="primary"
        disabled={!selectedCity || saving}
        onClick={submit}
      >
        {saving ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
