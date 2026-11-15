import { mapsClient } from "../../maps/mapsClient";
import { useActionToast } from "../../shared/hooks/useActionToast";
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
import { Add20Regular, Dismiss24Regular } from "@fluentui/react-icons";
import AsyncAutocomplete from "../../shared/components/AsyncAutocomplete";
import type { CitySuggestion } from "../../api/api";
import {
  addDestination,
  replaceDestinationStay,
  type Stay,
  type Destination,
} from "../activities/activitiesApi";

import TripCalendar from "./TripCalendar";
import { conflictingVisit, formatStayDates, parseTripDate } from "./tripDates";

const searchDestinationCities = async (query: string, signal: AbortSignal) =>
  (await mapsClient.searchCities(query, signal)).filter(
    (city) => city.countryCode,
  );

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
  const { notify, toaster } = useActionToast();
  const dateConflict = conflictingVisit(
    destinations,
    arrivalDate,
    departureDate,
    editing?.stay.id,
  );
  const invalidDates = Boolean(
    dateConflict ||
    (arrivalDate && !parseTripDate(arrivalDate)) ||
    (departureDate && !parseTripDate(departureDate)) ||
    (arrivalDate && departureDate && departureDate < arrivalDate),
  );

  function reset() {
    setQuery("");
    setCity(undefined);
    setArrivalDate(editing?.stay.arrivalDate ?? "");
    setDepartureDate(editing?.stay.departureDate ?? "");
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
        const coordinates = await mapsClient.geocodeCity(city!);
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
      notify(
        reason instanceof Error
          ? reason.message
          : editing
            ? "Could not save visit dates. Try again."
            : "Could not add the destination. Try again.",
        "error",
      );
      setSaving(false);
    }
  }

  return (
    <>
      {toaster}
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
            <fieldset disabled={saving} className="destination-drawer-fields">
              {!editing && (
                <AsyncAutocomplete
                  label="Destination city"
                  hideLabel
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
                  }}
                  onOptionSelect={(option) => {
                    setCity(option);
                    setQuery(option.label);
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
                excludeStayId={editing?.stay.id}
                disabled={saving}
              />
              {dateConflict && (
                <Text role="alert">
                  These dates overlap {dateConflict.destination.properties.name}{" "}
                  (
                  {formatStayDates(
                    dateConflict.stay.arrivalDate,
                    dateConflict.stay.departureDate,
                  )}
                  ). Visits may share only an arrival/departure day.
                </Text>
              )}
            </fieldset>
          </form>
        </DrawerBody>
        <DrawerFooter className="destination-drawer-footer">
          <Button appearance="secondary" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            icon={editing ? undefined : <Add20Regular />}
            type="submit"
            form="add-destination-form"
            disabled={(!editing && !city) || saving || invalidDates}
          >
            {saving ? "Saving…" : editing ? "Save dates" : "Add destination"}
          </Button>
        </DrawerFooter>
      </OverlayDrawer>
    </>
  );
}
