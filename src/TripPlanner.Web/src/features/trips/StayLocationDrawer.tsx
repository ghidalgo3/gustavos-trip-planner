import { useActionToast } from "../../shared/hooks/useActionToast";
import { useCallback, useState } from "react";
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import AsyncAutocomplete from "../../shared/components/AsyncAutocomplete";
import { searchPlaces } from "../../api/api";
import {
  saveStayLocation,
  type Destination,
  type StayLocation,
} from "../activities/activitiesApi";

type Place = Awaited<ReturnType<typeof searchPlaces>>[number] & {
  longitude: number;
  latitude: number;
};
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
  const [busy, setBusy] = useState(false);
  const { notify, toaster } = useActionToast();
  const search = useCallback(
    (text: string, signal: AbortSignal) =>
      searchPlaces(
        text,
        signal,
        destination.geometry.coordinates,
        destination.properties.countryCode,
      ).then((places) =>
        places.filter(
          (place): place is Place =>
            typeof place.longitude === "number" &&
            typeof place.latitude === "number",
        ),
      ),
    [destination],
  );
  async function save(remove = false) {
    if (!remove && !place) return;
    setBusy(true);
    try {
      const feature: StayLocation | null = remove
        ? null
        : {
            type: "Feature",
            id: "stay",
            geometry: {
              type: "Point",
              coordinates: [place!.longitude, place!.latitude],
            },
            properties: { name: (place!.name ?? place!.label).slice(0, 200) },
          };
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
            onInputChange={(value) => {
              setQuery(value);
              setPlace(undefined);
            }}
            onOptionSelect={(item) => {
              setPlace(item);
              setQuery(item.label);
            }}
            debounceMs={300}
          />
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
            disabled={!place || busy}
            onClick={() => void save()}
          >
            Save Stay
          </Button>
        </DrawerFooter>
      </OverlayDrawer>
    </>
  );
}
