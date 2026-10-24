import { useEffect, useRef, useState } from "react";
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  Link,
  OverlayDrawer,
  Radio,
  RadioGroup,
  Text,
} from "@fluentui/react-components";
import { Dismiss24Regular, Search20Regular } from "@fluentui/react-icons";
import ContentSkeleton from "../../shared/components/ContentSkeleton";
import PlaceSearchResult from "../../shared/components/PlaceSearchResult";
import { useActionToast } from "../../shared/hooks/useActionToast";
import ActivityMap from "../../maps/ActivityMap";
import {
  saveStayLocation,
  researchStayAddress,
  type StayAddressSuggestion,
  type Destination,
  type Activity,
  type StayLocation,
} from "../activities/activitiesApi";

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
  const [selectedStay, setSelectedStay] = useState<StayLocation | null>(
    existing ?? null,
  );
  const [results, setResults] = useState<StayAddressSuggestion[]>([]);
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
    setSelectedStay(null);
    setSelectedIndex("");
    setResults([]);
    setSearched(false);
    try {
      const matches = await researchStayAddress(
        tripId,
        destination.id,
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
    setSelectedIndex(index);
    setSelectedStay({
      type: "Feature",
      id: "stay",
      geometry: match.geometry,
      properties: { name: match.name.slice(0, 200) },
    });
  }

  async function save(remove = false) {
    if (!remove && !selectedStay) return;
    setBusy(true);
    try {
      await saveStayLocation(
        tripId,
        destination.id,
        remove ? null : selectedStay,
      );
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
          <form
            className="stay-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Field
              label="Stay location"
              hint="Enter a hotel name or address, then search the web for matching stays."
            >
              <Input
                value={query}
                placeholder="Hotel name or address"
                maxLength={200}
                disabled={busy || researching}
                onChange={(_, data) => {
                  setQuery(data.value);
                  setSelectedStay(null);
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
          {researching && <ContentSkeleton label="Searching stays" count={2} />}
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
                  className={`stay-search-result${selectedIndex === String(index) ? " is-selected" : ""}`}
                  key={`${match.name}|${match.address}`}
                >
                  <Radio
                    value={String(index)}
                    disabled={busy || !match.geometry}
                    label={
                      <PlaceSearchResult
                        place={{
                          id: String(index),
                          name: match.name,
                          label: match.name,
                          address: match.address,
                        }}
                      />
                    }
                  />
                  <Link
                    href={match.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Source for ${match.name}`}
                  >
                    {match.source.label}
                  </Link>
                  {match.warning && <Text size={200}>{match.warning}</Text>}
                </div>
              ))}
            </RadioGroup>
          )}
          <section
            className="stay-location-preview"
            aria-label="Confirm stay location"
          >
            <Text>
              {selectedStay
                ? selectedStay.properties.name
                : "Select a matching stay to preview its location."}
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
                Check that the pin is where you expect to stay, then choose Save
                Stay to confirm.
              </Text>
            )}
          </section>
        </DrawerBody>
        <DrawerFooter className="activity-drawer-footer">
          {existing && (
            <Button
              disabled={busy || researching}
              onClick={() => void save(true)}
            >
              Remove Stay
            </Button>
          )}
          <Button disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            appearance="primary"
            disabled={!selectedStay || busy || researching}
            onClick={() => void save()}
          >
            Save Stay
          </Button>
        </DrawerFooter>
      </OverlayDrawer>
    </>
  );
}
