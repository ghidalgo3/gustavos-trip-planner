import { FormEvent, useState } from "react";
import { Button, Card, Field, Text, Title1 } from "@fluentui/react-components";
import { useNavigate } from "react-router";
import HomeAirportPicker from "./HomeAirportPicker";
import AsyncAutocomplete from "./AsyncAutocomplete";
import AirlineCombobox from "./AirlineCombobox";
import {
  resolveCity,
  saveUserProfile,
  searchCities,
  type CitySuggestion,
  type CurrentUser,
} from "./api";

export default function ProfilePage({
  user,
  onSaved,
}: {
  user: CurrentUser;
  onSaved: (user: CurrentUser) => void;
}) {
  const navigate = useNavigate();
  const [cityQuery, setCityQuery] = useState(user.profile.homeCity?.name ?? "");
  const [selectedCity, setSelectedCity] = useState<CitySuggestion | undefined>(
    () => {
      const home = user.profile.homeCity;
      return home
        ? {
            id: `saved:${home.name}`,
            label: home.name,
            longitude: home.longitude,
            latitude: home.latitude,
          }
        : undefined;
    },
  );
  const [cityChanged, setCityChanged] = useState(false);
  const [airlines, setAirlines] = useState(user.profile.preferredAirlines);
  const [preferredAirport, setPreferredAirport] = useState<string | null>(
    user.profile.preferredAirport ?? null,
  );
  const [airportsReady, setAirportsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const currentCity = user.profile.homeCity;
    if (cityChanged && !selectedCity) {
      setError("Choose a home city from the suggestions.");
      return;
    }
    if (!selectedCity && !currentCity) {
      setError("Choose a home city.");
      return;
    }
    const preferredAirlines = [
      ...new Set(
        airlines
          .map((code) => code.trim())
          .map((code) => code.toUpperCase())
          .filter(Boolean),
      ),
    ].sort();
    if (
      preferredAirlines.length > 20 ||
      preferredAirlines.some((code) => !/^[A-Z0-9]{2}$/.test(code))
    ) {
      setError(
        "Choose up to 20 airlines, or enter a two-character airline code.",
      );
      return;
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const homeCity = selectedCity
        ? { name: selectedCity.label, ...(await resolveCity(selectedCity)) }
        : currentCity;
      const saved = await saveUserProfile({
        homeCity,
        preferredAirlines,
        preferredAirport,
      });
      onSaved(saved);
      setCityChanged(false);
      setSelectedCity(
        saved.profile.homeCity
          ? {
              id: `saved:${saved.profile.homeCity.name}`,
              label: saved.profile.homeCity.name,
              longitude: saved.profile.homeCity.longitude,
              latitude: saved.profile.homeCity.latitude,
            }
          : undefined,
      );
      setCityQuery(saved.profile.homeCity?.name ?? "");
      setAirlines(saved.profile.preferredAirlines);
      setNotice("Profile saved.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save your profile.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="profile-page" aria-label="Your profile">
      <Button appearance="subtle" onClick={() => navigate("/")}>
        Back to trips
      </Button>
      <Title1 as="h1">Your profile</Title1>
      <Text>
        Set your home city and the airlines you prefer when planning trips.
      </Text>
      <Card>
        <form className="profile-form" onSubmit={submit}>
          <AsyncAutocomplete
            label="Home city"
            placeholder="Start typing a city"
            inputValue={cityQuery}
            selectedOptionValue={selectedCity?.id}
            selectedOptionLabel={selectedCity?.label}
            search={searchCities}
            getOptionValue={(city) => city.id}
            getOptionText={(city) => city.label}
            onInputChange={(value) => {
              setCityQuery(value);
              setSelectedCity(undefined);
              setPreferredAirport(null);
              setCityChanged(true);
              setError(undefined);
              setNotice(undefined);
            }}
            onOptionSelect={(city) => {
              setSelectedCity(city);
              setPreferredAirport(null);
              setCityQuery(city.label);
              setCityChanged(true);
              setError(undefined);
              setNotice(undefined);
            }}
            debounceMs={300}
          />
          <HomeAirportPicker
            city={selectedCity}
            value={preferredAirport}
            onChange={setPreferredAirport}
            onReadyChange={setAirportsReady}
          />
          <Field
            label="Preferred airlines"
            hint="Search by airline name or code. These are preferences, not exclusions."
          >
            <AirlineCombobox
              value={airlines}
              onChange={(codes) => {
                setAirlines(codes);
                setNotice(undefined);
              }}
            />
          </Field>
          {error && <Text role="alert">{error}</Text>}
          {notice && <Text role="status">{notice}</Text>}
          <Button
            type="submit"
            appearance="primary"
            disabled={saving || !airportsReady}
          >
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </form>
      </Card>
    </section>
  );
}
