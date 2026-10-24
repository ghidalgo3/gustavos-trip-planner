import { useActionToast } from "../../shared/hooks/useActionToast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Link,
  Text,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import AsyncAutocomplete from "../../shared/components/AsyncAutocomplete";
import PlaceSearchResult from "../../shared/components/PlaceSearchResult";
import ContentSkeleton from "../../shared/components/ContentSkeleton";
import ActivityMap from "../../maps/ActivityMap";
import { searchPlaces } from "../../api/api";
import {
  saveStayLocation,
  researchStayAddress,
  type StayAddressSuggestion,
  type Destination,
  type Activity,
  type StayLocation,
} from "../activities/activitiesApi";

type Place = Awaited<ReturnType<typeof searchPlaces>>[number] & {
  longitude: number;
  latitude: number;
};
const noActivities: Activity[] = [];
const selectStayMarker = () => {};

export default function StayLocationDrawer({
  tripId,
  destination,
  onClose,
  onSaved,
}: {
  tripId: string;
  destination: Destination;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const existing = destination.properties.stayLocation;
  const [query, setQuery] = useState(existing?.properties.name ?? "");
  const [place, setPlace] = useState<Place | undefined>(
    existing
      ? {
          id: "stay",
          label: existing.properties.name,
          name: existing.properties.name,
          longitude: existing.geometry.coordinates[0],
          latitude: existing.geometry.coordinates[1],
        }
      : undefined,
  );
  const [researching, setResearching] = useState(false);
  const [suggestion, setSuggestion] = useState<StayAddressSuggestion | null>(
    null,
  );
  const researchRequest = useRef<AbortController | null>(null);
  useEffect(() => () => researchRequest.current?.abort(), []);
  const [busy, setBusy] = useState(false);
  const { notify, toaster } = useActionToast();
  const search = useCallback(
    (text: string, signal: AbortSignal) =>
      searchPlaces(
        text,
        signal,
        destination.geometry.coordinates,
        destination.properties.countryCode,
        { typeahead: true },
      ).then((places) =>
        places.filter(
          (place): place is Place =>
            typeof place.longitude === "number" &&
            typeof place.latitude === "number",
        ),
      ),
    [destination],
  );
  const selectedStay = useMemo<StayLocation | null>(
    () =>
      place
        ? {
            type: "Feature",
            id: "stay",
            geometry: {
              type: "Point",
              coordinates: [place.longitude, place.latitude],
            },
            properties: { name: (place.name ?? place.label).slice(0, 200) },
          }
        : null,
    [place],
  );
  async function searchAddress() {
    const controller = new AbortController();
    researchRequest.current = controller;
    setResearching(true);
    setPlace(undefined);
    setSuggestion(null);
    try {
      const result = await researchStayAddress(
        tripId,
        destination.id,
        (place?.name ?? query).trim(),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSuggestion(result);
      if (result?.geometry) {
        const label = `${result.name}, ${result.address}`;
        setPlace({
          id: "researched-stay",
          name: result.name,
          address: result.address,
          label,
          longitude: result.geometry.coordinates[0],
          latitude: result.geometry.coordinates[1],
        });
        setQuery(label);
      } else if (!result) {
        notify(
          "No confirmed address found. Try a more specific hotel name or address.",
          "error",
        );
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        notify(
          reason instanceof Error
            ? reason.message
            : "Could not search the stay address.",
          "error",
        );
    } finally {
      if (!controller.signal.aborted) setResearching(false);
    }
  }
  async function save(remove = false) {
    if (!remove && !selectedStay) return;
    setBusy(true);
    try {
      const feature = remove ? null : selectedStay;
      await saveStayLocation(tripId, destination.id, feature);
      await onSaved();
      onClose();
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not save Stay location.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {toaster}
      <OverlayDrawer
        open
        position="start"
        modalType="non-modal"
        className="activity-drawer"
        onOpenChange={(_, data) => {
          if (!data.open && !busy) onClose();
        }}
      >
        <DrawerHeader>
          <DrawerHeaderTitle
            action={
              <Button
                appearance="subtle"
                icon={<Dismiss24Regular />}
                aria-label="Close Stay drawer"
                disabled={busy}
                onClick={onClose}
              />
            }
          >
            Stay in {destination.properties.name}
          </DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody>
          <AsyncAutocomplete
            disabled={busy || researching}
            label="Stay location"
            placeholder="Search hotels or accommodation"
            inputValue={query}
            selectedOptionValue={
              place ? `${place.longitude},${place.latitude}` : undefined
            }
            selectedOptionLabel={place?.label}
            search={search}
            getOptionValue={(item) => `${item.longitude},${item.latitude}`}
            getOptionText={(item) => item.label}
            renderOption={(item) => <PlaceSearchResult place={item} />}
            onInputChange={(value) => {
              setQuery(value);
              setPlace(undefined);
              setSuggestion(null);
            }}
            onOptionSelect={(item) => {
              setPlace(item);
              setQuery(item.label);
              setSuggestion(null);
            }}
            debounceMs={300}
            hint="Search by hotel name or address. Use Search Address to research it on the web."
            emptyMessage="No stays found nearby. Try another name or address."
          />
          <section
            className="stay-location-preview"
            aria-label="Confirm stay location"
          >
            <Text>
              {suggestion
                ? suggestion.address
                : place
                  ? place.label
                  : "Choose a stay to preview its location."}
            </Text>
            <Button
              disabled={busy || researching || !query.trim()}
              onClick={() => void searchAddress()}
            >
              Search Address
            </Button>
            {researching && (
              <ContentSkeleton label="Searching stay address" count={1} />
            )}
            {suggestion && (
              <>
                <Link
                  href={suggestion.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {suggestion.source.label}
                </Link>
                {suggestion.warning && (
                  <Text role="status">{suggestion.warning}</Text>
                )}
              </>
            )}
            <ActivityMap
              center={selectedStay?.geometry ?? destination.geometry}
              destinationName={
                place?.name ?? place?.label ?? destination.properties.name
              }
              zoom={place ? 15 : 11}
              activities={noActivities}
              stayLocation={selectedStay}
              selectedId="stay"
              onSelect={selectStayMarker}
            />
            {place && (
              <Text size={200}>
                Check that the pin is where you expect to stay, then choose Save
                Stay to confirm.
              </Text>
            )}
          </section>
        </DrawerBody>
        <DrawerFooter className="activity-drawer-footer">
          {existing && (
            <Button disabled={busy} onClick={() => void save(true)}>
              Remove Stay
            </Button>
          )}
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            disabled={!place || busy || researching}
            onClick={() => void save()}
          >
            Save Stay
          </Button>
        </DrawerFooter>
      </OverlayDrawer>
    </>
  );
}
