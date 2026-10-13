import { useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
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
  replaceDestinationPlace,
  type Stay,
  type Destination,
} from "./activitiesApi";

import TripCalendar from "./TripCalendar";
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
  const existingCity = destinations.find(
    (item) =>
      item.properties.name === city?.cityName &&
      item.properties.countryCode === city?.countryCode,
  );
  const originalConstraints =
    editing?.destination.properties.constraints ??
    existingCity?.properties.constraints ??
    {};
  const initialArrivalFlex = Number(
    originalConstraints.arrivalFlexibilityDays ?? 0,
  );
  const initialDepartureFlex = Number(
    originalConstraints.departureFlexibilityDays ?? 0,
  );
  const initialKeepOrder = originalConstraints.keepAfterPrevious !== false;
  const [arrivalFlex, setArrivalFlex] = useState(initialArrivalFlex);
  const [departureFlex, setDepartureFlex] = useState(initialDepartureFlex);
  const [keepOrder, setKeepOrder] = useState(initialKeepOrder);
  const constraintsChanged =
    arrivalFlex !== initialArrivalFlex ||
    departureFlex !== initialDepartureFlex ||
    keepOrder !== initialKeepOrder;
  const invalidFlex =
    !Number.isInteger(arrivalFlex) ||
    !Number.isInteger(departureFlex) ||
    arrivalFlex < 0 ||
    departureFlex < 0 ||
    arrivalFlex > 5 ||
    departureFlex > 5;
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
    setArrivalFlex(initialArrivalFlex);
    setDepartureFlex(initialDepartureFlex);
    setKeepOrder(initialKeepOrder);
  }

  function close() {
    if (saving) return;
    onClose();
    reset();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      (!editing && !city?.countryCode) ||
      invalidDates ||
      invalidFlex ||
      saving
    )
      return;
    setSaving(true);
    setError(undefined);
    try {
      const constraints = {
        ...originalConstraints,
        arrivalFlexibilityDays: arrivalFlex,
        departureFlexibilityDays: departureFlex,
        keepAfterPrevious: keepOrder,
      };
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
        if (constraintsChanged)
          destination = await replaceDestinationPlace(
            tripId,
            destination,
            constraints,
          );
      } else {
        const coordinates = await resolveCity(city!);
        destination = await addDestination(tripId, {
          name: city!.cityName ?? city!.label.split(",")[0].trim(),
          countryCode: city!.countryCode!,
          ...coordinates,
          arrivalDate: arrivalDate || null,
          departureDate: departureDate || null,
          ...(constraintsChanged ? { constraints } : {}),
        });
        if (constraintsChanged && existingCity)
          destination = await replaceDestinationPlace(
            tripId,
            destination,
            constraints,
          );
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
                  const existing = destinations.find(
                    (item) =>
                      item.properties.name === option.cityName &&
                      item.properties.countryCode === option.countryCode,
                  )?.properties.constraints;
                  setArrivalFlex(Number(existing?.arrivalFlexibilityDays ?? 0));
                  setDepartureFlex(
                    Number(existing?.departureFlexibilityDays ?? 0),
                  );
                  setKeepOrder(existing?.keepAfterPrevious !== false);
                  setCity(option);
                  setQuery(option.label);
                  setError(undefined);
                }}
                emptyMessage="No cities found. Try another name."
              />
            )}
            <TripCalendar
              arrivalDate={arrivalDate}
              departureDate={departureDate}
              onChange={(arrival, departure) => {
                setArrivalDate(arrival);
                setDepartureDate(departure);
              }}
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
            />
            <div className="destination-flight-constraints">
              <strong>Flight flexibility and ordering</strong>
              <Text size={200}>
                These constraints apply to every visit to this city.
              </Text>
              <Field
                label="Arrival flexibility (± days)"
                hint="0–5 days around the selected arrival date"
              >
                <Input
                  type="number"
                  min={0}
                  max={5}
                  value={String(arrivalFlex)}
                  onChange={(_, data) => setArrivalFlex(Number(data.value))}
                />
              </Field>
              <Field
                label="Departure flexibility (± days)"
                hint="0–5 days around the selected departure date"
              >
                <Input
                  type="number"
                  min={0}
                  max={5}
                  value={String(departureFlex)}
                  onChange={(_, data) => setDepartureFlex(Number(data.value))}
                />
              </Field>
              <Checkbox
                label="Keep this destination after the previous one"
                checked={keepOrder}
                onChange={(_, data) => setKeepOrder(Boolean(data.checked))}
              />
              {invalidFlex && (
                <Text role="alert">Choose whole numbers from 0 to 5 days.</Text>
              )}
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
          disabled={
            (!editing && !city) || saving || invalidDates || invalidFlex
          }
        >
          {saving ? "Saving…" : editing ? "Save dates" : "Add destination"}
        </Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
}
