import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  OverlayDrawer,
  Radio,
  RadioGroup,
  Text,
} from "@fluentui/react-components";
import { Dismiss24Regular, Search20Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import ActivityMap from "../../maps/ActivityMap";
import PlaceSearchResult from "../../shared/components/PlaceSearchResult";
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

  function selectResult(index: string) {
    const match = results[Number(index)];
    if (!match?.geometry) return;
    void save(
      {
        type: "Feature",
        id: "stay",
        geometry: match.geometry,
        properties: { name: match.name.slice(0, 200), address: match.address },
      },
      index,
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
            <Field
              label="Stay location"
              hint="Search for a hotel name or address. Selecting a result saves it immediately."
            >
              <Input
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
            <SearchResultsSkeleton label="Searching stays" appearance="stays" />
          )}
          {searched && results.length === 0 && (
            <Text role="status">
              No matching stays found. Try a more specific hotel name or
              address.
            </Text>
          )}
          {results.length > 0 && (
            <RadioGroup
              className="stay-search-results"
              aria-label="Matching stays"
              value={selectedIndex}
              onChange={(_, data) => selectResult(data.value)}
            >
              {results.map((match, index) => (
                <div
                  className={`stay-search-result interactive-card${selectedIndex === String(index) ? " is-selected" : ""}`}
                  key={`${match.name}|${match.address}|${match.geometry?.coordinates.join(",") ?? index}`}
                >
                  <Radio
                    className="card-action"
                    value={String(index)}
                    disabled={busy || !match.geometry}
                    label={
                      <div className="place-search-result">
                        <PlaceSearchResult
                          place={{
                            id: String(index),
                            name: match.name,
                            label: match.name,
                            address: match.address,
                          }}
                        />
                      </div>
                    }
                  />
                </div>
              ))}
            </RadioGroup>
          )}
          <section
            className="stay-location-preview"
            aria-label="Saved stay location"
          >
            <Text>
              {selectedStay
                ? selectedStay.properties.name
                : "Select a matching stay to save its location."}
            </Text>
            <ActivityMap
              center={selectedStay?.geometry ?? destination.geometry}
              destinationName={
                selectedStay?.properties.name ?? destination.properties.name
              }
              zoom={selectedStay ? 15 : 11}
              activities={noActivities}
              stayLocation={selectedStay}
              selectedId="stay"
              onSelect={selectStayMarker}
            />
            {selectedStay && (
              <Text size={200}>
                Selecting a matching stay saves it immediately. You can choose
                another result to change it.
              </Text>
            )}
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
