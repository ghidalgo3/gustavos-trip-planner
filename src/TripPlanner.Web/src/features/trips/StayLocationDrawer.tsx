import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  OverlayDrawer,
  SearchBox,
  Text,
} from "@fluentui/react-components";
import { Dismiss24Regular, Search20Regular } from "@fluentui/react-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import ActivityMap from "../../maps/ActivityMap";
import PlaceSearchResultButton from "../../shared/components/PlaceSearchResultButton";
import SearchResultsSkeleton from "../../shared/components/SearchResultsSkeleton";
import { useActionToast } from "../../shared/hooks/useActionToast";
import {
  saveStayLocation,
  searchStayPlaces,
  type Activity,
  type Destination,
  type Stay,
  type StayLocation,
  type StayPlaceResult,
} from "../activities/activitiesApi";

const noActivities: Activity[] = [];
const selectStayMarker = () => {};

export default function StayLocationDrawer({
  tripId,
  destination,
  visit,
  onClose,
  onSaved,
}: {
  tripId: string;
  destination: Destination;
  visit: Stay;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const existing = visit.stayLocation;
  const [query, setQuery] = useState(existing?.properties.name ?? "");
  const [selectedStay, setSelectedStay] = useState<StayLocation | null>(
    existing ?? null,
  );
  const [savedStay, setSavedStay] = useState<StayLocation | null>(
    existing ?? null,
  );
  const [failedSelection, setFailedSelection] = useState<{
    location: StayLocation | null;
    index: string;
  }>();
  const [results, setResults] = useState<StayPlaceResult[]>([]);
  const places = useMemo(
    () =>
      results.map((match, index) => ({
        id: String(index),
        name: match.name,
        label:
          match.address && match.address !== match.name
            ? `${match.name}, ${match.address}`
            : match.name,
        address: match.address,
        longitude: match.geometry?.coordinates[0],
        latitude: match.geometry?.coordinates[1],
      })),
    [results],
  );
  const [selectedIndex, setSelectedIndex] = useState<string>("");
  const [searched, setSearched] = useState(false);
  const [researching, setResearching] = useState(false);
  const researchRequest = useRef<AbortController | null>(null);
  useEffect(() => () => researchRequest.current?.abort(), []);
  const [busy, setBusy] = useState(false);
  const { notify, toaster } = useActionToast();

  async function search() {
    if (busy || researching || !query.trim()) return;
    const controller = new AbortController();
    researchRequest.current = controller;
    setResearching(true);
    setSelectedIndex("");
    setResults([]);
    setSearched(false);
    try {
      const matches = await searchStayPlaces(
        destination,
        query.trim(),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResults(matches);
      setSearched(true);
    } catch (reason) {
      if (!controller.signal.aborted)
        notify(
          reason instanceof Error
            ? reason.message
            : "Could not search for stays.",
          "error",
        );
    } finally {
      if (!controller.signal.aborted) setResearching(false);
    }
  }

  function selectResult(index: number) {
    const match = results[index];
    if (!match?.geometry || selectedIndex === String(index)) return;
    void save(
      {
        type: "Feature",
        id: "stay",
        geometry: match.geometry,
        properties: { name: match.name.slice(0, 200), address: match.address },
      },
      String(index),
    );
  }

  async function save(location: StayLocation | null, index = "") {
    if (busy || researching) return;
    setBusy(true);
    setFailedSelection(undefined);
    try {
      await saveStayLocation(tripId, destination.id, visit.id, location);
      setSavedStay(location);
      setSelectedStay(location);
      setSelectedIndex(index);
      await onSaved();
    } catch (reason) {
      setFailedSelection({ location, index });
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
          <Text block>
            {visit.arrivalDate ?? "Arrival not set"} –{" "}
            {visit.departureDate ?? "Departure not set"}
          </Text>
          <form
            className="stay-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Field label="Stay location">
              <SearchBox
                value={query}
                placeholder="Hotel name or address"
                maxLength={200}
                disabled={busy || researching}
                onChange={(_, data) => {
                  setQuery(data.value);
                  setSelectedIndex("");
                  setResults([]);
                  setSearched(false);
                }}
              />
            </Field>
            <Button
              type="submit"
              appearance="primary"
              icon={<Search20Regular />}
              disabled={busy || researching || !query.trim()}
            >
              Search
            </Button>
          </form>
          {researching && (
            <SearchResultsSkeleton
              label="Searching stays"
              appearance="places"
            />
          )}
          {searched && results.length === 0 && (
            <Text role="status">
              No matching stays found. Try a more specific hotel name or
              address.
            </Text>
          )}
          {results.length > 0 && (
            <div
              className="place-search-results"
              role="group"
              aria-label="Matching stays"
            >
              {places.map((place, index) => (
                <div
                  className="place-search-result-row"
                  key={`${index}-${place.label}`}
                >
                  <PlaceSearchResultButton
                    place={place}
                    index={index}
                    disabled={busy || !results[index].geometry}
                    selected={selectedIndex === String(index)}
                    onClick={() => selectResult(index)}
                  />
                </div>
              ))}
            </div>
          )}
          <section
            className="stay-location-preview"
            aria-label="Stay location map"
          >
            {selectedStay && <Text>{selectedStay.properties.name}</Text>}
            <ActivityMap
              center={selectedStay?.geometry ?? destination.geometry}
              destinationName={
                places.length > 0
                  ? destination.properties.name
                  : (selectedStay?.properties.name ??
                    destination.properties.name)
              }
              zoom={selectedStay ? 15 : 11}
              activities={noActivities}
              stayLocation={selectedStay}
              selectedId="stay"
              onSelect={selectStayMarker}
              placeSearch={
                places.length > 0
                  ? {
                      results: places,
                      onSelect: selectResult,
                    }
                  : undefined
              }
            />
          </section>
        </DrawerBody>
        <DrawerFooter className="activity-drawer-footer">
          {savedStay && (
            <Button
              disabled={busy || researching}
              onClick={() => void save(null)}
            >
              Remove Stay
            </Button>
          )}
          <Button disabled={busy} onClick={onClose}>
            Done
          </Button>
          {busy && <Text role="status">Saving stay…</Text>}
          {failedSelection && (
            <Button
              disabled={busy}
              onClick={() =>
                void save(failedSelection.location, failedSelection.index)
              }
            >
              Retry stay selection
            </Button>
          )}
        </DrawerFooter>
      </OverlayDrawer>
    </>
  );
}
