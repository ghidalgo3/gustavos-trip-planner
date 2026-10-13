import { useState, type FormEvent } from "react";
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Text,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import AsyncAutocomplete from "./AsyncAutocomplete";
import { resolveCity, searchCities, type CitySuggestion } from "./api";
import {
  addDestination,
  replaceDestinationStay,
  type Stay,
  type Destination,
} from "./activitiesApi";

import TripDatePicker from "./TripDatePicker";
import { parseTripDate } from "./tripDates";

const searchDestinationCities = async (query: string, signal: AbortSignal) =>
  (await searchCities(query, signal)).filter((city) => city.countryCode);

export default function AddDestinationDrawer({
  tripId,
  open,
  onClose,
  onAdded,
  destinations = [],
  editing,
}: {
  destinations?: Destination[];
  editing?: { destination: Destination; stay: Stay };
  tripId: string;
  open: boolean;
  onClose: () => void;
  onAdded: (destination: Destination) => void;
}) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState<CitySuggestion>();
  const [arrivalDate, setArrivalDate] = useState(
    editing?.stay.arrivalDate ?? "",
  );
  const [departureDate, setDepartureDate] = useState(
    editing?.stay.departureDate ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const invalidDates = Boolean(
    (arrivalDate && !parseTripDate(arrivalDate)) ||
    (departureDate && !parseTripDate(departureDate)) ||
    (arrivalDate && departureDate && departureDate < arrivalDate),
  );

  function reset() {
    setQuery("");
    setCity(undefined);
    setArrivalDate(editing?.stay.arrivalDate ?? "");
    setDepartureDate(editing?.stay.departureDate ?? "");
    setError(undefined);
    setSaving(false);
  }

  function close() {
    if (saving) return;
    onClose();
    reset();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((!editing && !city?.countryCode) || invalidDates || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      let destination: Destination;
      if (editing) {
        destination = await replaceDestinationStay(
          tripId,
          editing.destination.id,
          editing.stay.id,
          {
            arrivalDate: arrivalDate || null,
            departureDate: departureDate || null,
          },
        );
      } else {
        const coordinates = await resolveCity(city!);
        destination = await addDestination(tripId, {
          name: city!.cityName ?? city!.label.split(",")[0].trim(),
          countryCode: city!.countryCode!,
          ...coordinates,
          arrivalDate: arrivalDate || null,
          departureDate: departureDate || null,
        });
      }
      onAdded(destination);
      reset();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : editing
            ? "Could not save visit dates. Try again."
            : "Could not add the destination. Try again.",
      );
      setSaving(false);
    }
  }

  return (
    <OverlayDrawer
      open={open}
      position="end"
      className="destination-drawer"
      onOpenChange={(_, data) => {
        if (!data.open) close();
      }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              aria-label="Close destination drawer"
              icon={<Dismiss24Regular />}
              disabled={saving}
              onClick={close}
            />
          }
        >
          {editing
            ? `Edit dates: ${editing.destination.properties.name}`
            : "Add destination"}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <form
          id="add-destination-form"
          className="destination-drawer-form"
          onSubmit={submit}
        >
          <Text className="destination-drawer-description">
            {editing
              ? "Choose visit dates. The calendar shows stays in other cities."
              : "Where would you like to go? Add a city to start shaping your trip."}
          </Text>
          <fieldset disabled={saving} className="destination-drawer-fields">
            {!editing && (
              <AsyncAutocomplete
                label="Destination city"
                placeholder="Search for a city"
                inputValue={query}
                selectedOptionValue={city?.id}
                selectedOptionLabel={city?.label}
                search={searchDestinationCities}
                getOptionValue={(option) => option.id}
                getOptionText={(option) => option.label}
                onInputChange={(value) => {
                  setQuery(value);
                  setCity(undefined);
                  setError(undefined);
                }}
                onOptionSelect={(option) => {
                  setCity(option);
                  setQuery(option.label);
                  setError(undefined);
                }}
                emptyMessage="No cities found. Try another name."
              />
            )}
            <div className="destination-drawer-dates">
              <TripDatePicker
                label="Arrival date"
                value={arrivalDate}
                onChange={setArrivalDate}
                destinations={destinations}
                excludeCityId={
                  editing?.destination.id ??
                  destinations.find(
                    (item) =>
                      item.properties.name === city?.cityName &&
                      item.properties.countryCode === city?.countryCode,
                  )?.id
                }
                disabled={saving}
                invalid={Boolean(arrivalDate && !parseTripDate(arrivalDate))}
              />
              <TripDatePicker
                label="Departure date"
                value={departureDate}
                onChange={setDepartureDate}
                destinations={destinations}
                excludeCityId={
                  editing?.destination.id ??
                  destinations.find(
                    (item) =>
                      item.properties.name === city?.cityName &&
                      item.properties.countryCode === city?.countryCode,
                  )?.id
                }
                min={arrivalDate || undefined}
                disabled={saving}
                invalid={invalidDates}
              />
            </div>
          </fieldset>
          {error && <Text role="alert">{error}</Text>}
        </form>
      </DrawerBody>
      <DrawerFooter className="destination-drawer-footer">
        <Button appearance="secondary" disabled={saving} onClick={close}>
          Cancel
        </Button>
        <Button
          appearance="primary"
          type="submit"
          form="add-destination-form"
          disabled={(!editing && !city) || saving || invalidDates}
        >
          {saving ? "Saving…" : editing ? "Save dates" : "Add destination"}
        </Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
}
