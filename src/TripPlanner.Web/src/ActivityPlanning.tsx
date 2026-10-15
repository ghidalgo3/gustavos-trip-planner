import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogSurface,
  Input,
  Spinner,
  Tab,
  TabList,
  Text,
  Textarea,
  Title2,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  DrawerFooter,
  OverlayDrawer,
  Menu,
  MenuTrigger,
  MenuButton,
  MenuPopover,
  MenuList,
  MenuItemRadio,
} from "@fluentui/react-components";
import {
  ArrowExpand24Regular,
  Dismiss24Regular,
  Share24Regular,
} from "@fluentui/react-icons";
import { destinationDates } from "./tripDates";
import { Link, useSearchParams } from "react-router";
import { searchPlaces, type Trip } from "./api";
import { activityMapLink } from "./activityMapLink";
import ActivityLinksEditor from "./ActivityLinksEditor";
import { validActivityLink } from "./activityLinks";
import ActivityMap from "./ActivityMap";
import {
  deleteActivity,
  getActivities,
  getActivity,
  getDestinations,
  getSuggestionResult,
  importActivityImages,
  saveActivity,
  suggestActivities,
  waitForActivityJob,
  type Activity,
  type ActivityCollection,
  type ActivityCost,
  type ActivityInput,
  type Destination,
  type DestinationCollection,
} from "./activitiesApi";

type Editor = { value: ActivityInput; etag?: string };
const emptyActivity = (): ActivityInput => ({
  type: "Feature",
  geometry: null,
  properties: {
    name: "",
    durationMinutes: null,
    description: "",
    cost: null,
    state: "Proposed",
    placeName: null,
    links: [],
  },
});
const emptyCollection: ActivityCollection = {
  type: "FeatureCollection",
  features: [],
};

function formatDuration(minutes: number | null) {
  if (minutes === null) return "Duration unknown";
  const hours = Math.floor(minutes / 60);
  return hours
    ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
    : `${minutes}m`;
}

function formatCost(cost: ActivityCost | null) {
  return cost
    ? `${cost.currency} ${cost.amount.toFixed(2)}${cost.basis === "perPerson" ? " / person" : " total"}`
    : "Cost unknown";
}

export default function ActivityPlanning({
  trip,
  readOnly,
  featureFlags,
  onDestinationChange,
}: {
  trip: Trip;
  readOnly: boolean;
  featureFlags: string[];
  onDestinationChange?: (destination: Destination | undefined) => void;
}) {
  const [query, setQuery] = useSearchParams();
  const [destinations, setDestinations] =
    useState<DestinationCollection | null>();
  const [activityData, setActivityData] = useState<{
    cityId: string;
    collection: ActivityCollection;
  }>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [mapExpanded, setMapExpanded] = useState(false);
  const [fullscreenContainer, setFullscreenContainer] =
    useState<HTMLDivElement | null>(null);
  const [showMapCard, setShowMapCard] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [searching, setSearching] = useState(false);
  const placeAbort = useRef<AbortController | undefined>(undefined);
  const [placeQuery, setPlaceQuery] = useState("");
  const [places, setPlaces] = useState<
    { label: string; name?: string; longitude?: number; latitude?: number }[]
  >([]);
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [entryMode, setEntryMode] = useState<"lookup" | "prompt" | "image">(
    "lookup",
  );
  const operationAbort = useRef<AbortController | undefined>(undefined);
  const imageInput = useRef<HTMLInputElement>(null);
  const selectedCity = query.get("destination") ?? undefined;
  const destination =
    destinations?.features.find((item) => item.id === selectedCity) ??
    destinations?.features[0];
  const cityId = destination?.id;
  const activities =
    activityData && activityData.cityId === cityId
      ? activityData.collection
      : emptyCollection;
  const selected = activities.features.find((item) => item.id === selectedId);
  const canEdit = !readOnly && destination?.properties.isActive === true;
  const canGenerate = canEdit && featureFlags.includes("LLM");

  useEffect(() => {
    onDestinationChange?.(destination);
  }, [destination, onDestinationChange]);

  useEffect(() => {
    const controller = new AbortController();
    void getDestinations(trip.id, controller.signal)
      .then(setDestinations)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load destinations.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [trip.id]);

  useEffect(() => {
    if (!cityId) return;
    const controller = new AbortController();
    void getActivities(trip.id, cityId, controller.signal)
      .then((collection) => setActivityData({ cityId, collection }))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load activities.",
          );
      });
    return () => controller.abort();
  }, [trip.id, cityId]);

  useEffect(() => {
    return () => {
      imagePreviews.forEach(URL.revokeObjectURL);
    };
  }, [imagePreviews]);

  useEffect(
    () => () => {
      operationAbort.current?.abort();
      placeAbort.current?.abort();
    },
    [],
  );

  const activitiesForMap = activities.features;

  function selectDestination(cityId: string) {
    if (editor && !window.confirm("Discard unsaved changes?")) return;
    setSelectedId(undefined);
    setEditor(undefined);
    setQuery(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("destination", cityId);
        return next;
      },
      { preventScrollReset: true },
    );
    setError(undefined);
    setMessage(undefined);
  }

  function updateEditor(changes: Partial<ActivityInput["properties"]>) {
    setEditor((current) =>
      current
        ? {
            ...current,
            value: {
              ...current.value,
              properties: { ...current.value.properties, ...changes },
            },
          }
        : current,
    );
  }

  async function openEdit(item: Activity) {
    if (!destination) return;
    setError(undefined);
    try {
      const current = await getActivity(trip.id, destination.id, item.id);
      setEntryMode("lookup");
      setPlaces([]);
      setEditor({ value: current.activity, etag: current.etag });
      setPlaceQuery(current.activity.properties.placeName ?? "");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load the activity.",
      );
    }
  }

  async function save() {
    if (!destination || !editor || busy || !editor.value.properties.name.trim())
      return;
    if (
      (editor.value.properties.links ?? []).some(
        (link) => !validActivityLink(link),
      )
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await saveActivity(
        trip.id,
        destination,
        editor.value,
        editor.etag,
      );
      setActivityData({
        cityId: destination.id,
        collection: await getActivities(trip.id, destination.id),
      });
      setSelectedId(saved.id);
      setEditor(undefined);
      setMessage("Activity saved.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save the activity.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!destination || !editor?.value.id || !editor.etag) return;
    if (!window.confirm("Delete this activity?")) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteActivity(trip.id, destination, editor.value.id, editor.etag);
      setActivityData({
        cityId: destination.id,
        collection: await getActivities(trip.id, destination.id),
      });
      setSelectedId(undefined);
      setEditor(undefined);
      setMessage("Activity deleted.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not delete the activity.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function searchPlace() {
    if (!destination || !placeQuery.trim()) return;
    placeAbort.current?.abort();
    const controller = new AbortController();
    placeAbort.current = controller;
    setSearching(true);
    setError(undefined);
    setPlaces([]);
    try {
      const results = await searchPlaces(
        placeQuery.trim(),
        controller.signal,
        destination.geometry.coordinates,
        destination.properties.countryCode,
      );
      if (!controller.signal.aborted) {
        setPlaces(results);
        if (!results.length)
          setError(
            `No places found within 50 km of ${destination.properties.name}. Try another name.`,
          );
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "Could not search places.",
        );
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  function choosePlace(place: {
    label: string;
    name?: string;
    longitude?: number;
    latitude?: number;
  }) {
    if (place.longitude === undefined || place.latitude === undefined) return;
    setEditor((current) =>
      current
        ? {
            ...current,
            value: {
              ...current.value,
              geometry: {
                type: "Point",
                coordinates: [place.longitude!, place.latitude!],
              },
            },
          }
        : current,
    );
    updateEditor({
      placeName: place.label,
      ...(!editor?.value.properties.name.trim()
        ? { name: place.name ?? place.label.split(",")[0] }
        : {}),
    });
    setPlaceQuery(place.label);
    setPlaces([]);
  }

  async function generate(kind: "text" | "image") {
    if (
      !destination ||
      busy ||
      (kind === "image" && images.length === 0) ||
      (kind === "text" && !prompt.trim())
    )
      return;
    const cityId = destination.id;
    setBusy(true);
    setError(undefined);
    setMessage("Generating activities…");
    const controller = new AbortController();
    operationAbort.current = controller;
    try {
      const operation =
        kind === "image"
          ? await importActivityImages(trip.id, destination, images, prompt)
          : await suggestActivities(trip.id, destination, prompt);
      const completed = await waitForActivityJob(
        operation.id,
        controller.signal,
      );
      if (completed.status === "Failed")
        throw new Error(
          "Activity generation failed. Check the destination and try again.",
        );
      const result = await getSuggestionResult(trip.id, cityId, operation.id);
      if (destination.id === cityId)
        setActivityData({
          cityId,
          collection: await getActivities(trip.id, cityId),
        });
      setMessage(
        `${result.activities.features.length} activities added as Proposed.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`,
      );
      chooseImages([]);
      setPrompt("");
      setEditor(undefined);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError"))
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not generate activities.",
        );
      setMessage(undefined);
    } finally {
      setBusy(false);
      operationAbort.current = undefined;
    }
  }

  function chooseImages(files: File[]) {
    if (
      files.length > 10 ||
      files.some((file) => file.size > 10_000_000) ||
      files.reduce((sum, file) => sum + file.size, 0) > 25_000_000
    ) {
      setError(
        "Choose up to 10 images, at most 10 MB each and 25 MB in total.",
      );
      return;
    }
    if (
      files.some(
        (file) =>
          !["image/jpeg", "image/png", "image/webp"].includes(file.type),
      )
    ) {
      setError("Choose JPEG, PNG, or WebP images.");
      return;
    }
    setImages(files);
    setImagePreviews(files.map((file) => URL.createObjectURL(file)));
    setError(undefined);
    if (imageInput.current) imageInput.current.value = "";
  }

  function closeDrawer() {
    if (busy) return;
    placeAbort.current?.abort();
    setSearching(false);
    setEditor(undefined);
    setError(undefined);
    setPlaces([]);
    setPlaceQuery("");
    setPrompt("");
    chooseImages([]);
  }
  function openAdd() {
    placeAbort.current?.abort();
    setSearching(false);
    setError(undefined);
    setPrompt("");
    chooseImages([]);
    setPlaces([]);
    setPlaceQuery("");
    setEntryMode("lookup");
    setEditor({ value: emptyActivity() });
  }

  function selectActivity(id: string) {
    setSelectedId(id);
    setShowMapCard(true);
  }

  function renderActivityCard(item: Activity, index: number) {
    const mapLink = activityMapLink(item.geometry, item.properties.name);
    return (
      <li
        key={item.id}
        className={`activity-card${selectedId === item.id ? " selected" : ""}`}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("a, button")
          )
            return;
          selectActivity(item.id);
        }}
      >
        <div className="activity-card-heading">
          <span
            className="activity-number"
            aria-label={`Activity ${index + 1}`}
          >
            {index + 1}
          </span>
          <h3>
            <button
              type="button"
              aria-pressed={selectedId === item.id}
              onClick={() => selectActivity(item.id)}
            >
              {item.properties.name}
            </button>
          </h3>
          <span className="activity-state">{item.properties.state}</span>
        </div>
        {!item.geometry && (
          <small className="activity-location-missing">Needs location</small>
        )}
        {item.properties.description && (
          <p className="activity-card-description">
            {item.properties.description}
          </p>
        )}
        <dl className="activity-card-facts">
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(item.properties.durationMinutes)}</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>{formatCost(item.properties.cost)}</dd>
          </div>
        </dl>
        {(item.properties.links ?? []).some(validActivityLink) && (
          <ul
            className="activity-links"
            aria-label={`${item.properties.name} links`}
          >
            {(item.properties.links ?? [])
              .filter(validActivityLink)
              .map((link, index) => (
                <li key={index}>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    {link.label || link.url}
                  </a>
                </li>
              ))}
          </ul>
        )}
        <div className="activity-card-actions">
          {mapLink && (
            <Button
              as="a"
              href={mapLink}
              target="_blank"
              rel="noopener noreferrer"
              appearance="secondary"
              aria-label={`Direction to ${item.properties.name}`}
              icon={<Share24Regular />}
            >
              Direction
            </Button>
          )}
          {canEdit && (
            <Button
              appearance="subtle"
              aria-label={`Edit activity: ${item.properties.name}`}
              onClick={() => void openEdit(item)}
            >
              Edit
            </Button>
          )}
        </div>
      </li>
    );
  }

  function renderMapDetails() {
    const stay = destination?.properties.stayLocation;
    if (showMapCard && selectedId === "stay" && stay && !editor) {
      const directions = activityMapLink(stay.geometry, stay.properties.name);
      return (
        <section className="activity-map-bottom-card" aria-label="Stay details">
          <Button
            className="activity-map-card-close"
            appearance="subtle"
            icon={<Dismiss24Regular />}
            aria-label="Close Stay details"
            onClick={() => setShowMapCard(false)}
          />
          <div className="activity-card">
            <h3>{stay.properties.name}</h3>
            <Text>Stay</Text>
            {directions && (
              <Button
                as="a"
                href={directions}
                target="_blank"
                rel="noopener noreferrer"
                icon={<Share24Regular />}
              >
                Direction
              </Button>
            )}
          </div>
        </section>
      );
    }
    return showMapCard && selected && !editor ? (
      <section
        key={selected.id}
        className="activity-map-bottom-card"
        aria-label="Selected activity details"
      >
        <Button
          className="activity-map-card-close"
          appearance="subtle"
          icon={<Dismiss24Regular />}
          aria-label="Close activity details"
          onClick={() => setShowMapCard(false)}
        />
        <ul className="activity-map-card-list">
          {renderActivityCard(
            selected,
            activities.features.findIndex((item) => item.id === selected.id),
          )}
        </ul>
      </section>
    ) : null;
  }

  if (loading) return <Spinner label="Loading destinations" />;
  if (!destinations || !destination)
    return (
      <section className="activity-planning">
        {error ? (
          <Text role="alert">{error}</Text>
        ) : (
          <Text>
            Add a destination on Overview to start planning activities.
          </Text>
        )}
        <Link to={`/trips/${encodeURIComponent(trip.id)}`}>Go to Overview</Link>
      </section>
    );

  return (
    <section className="activity-planning" aria-label="Activity planning">
      <TabList
        aria-label="Destinations"
        selectedValue={destination.id}
        onTabSelect={(_, data) => selectDestination(String(data.value))}
        className="activity-destination-tabs"
      >
        {destinations.features.map((item) => (
          <Tab value={item.id} key={item.id}>
            <span className="activity-tab-label">
              <strong>{item.properties.name}</strong>
              <small>{destinationDates(item)}</small>
            </span>
          </Tab>
        ))}
      </TabList>
      {error && !editor && <Text role="alert">{error}</Text>}
      {message && <Text role="status">{message}</Text>}
      <div className="activity-workspace">
        <div className="activity-map-panel">
          {!mapExpanded && (
            <ActivityMap
              center={destination.geometry}
              destinationName={destination.properties.name}
              stayLocation={destination.properties.stayLocation}
              activities={activitiesForMap}
              selectedId={selectedId}
              onSelect={selectActivity}
            />
          )}
          {!mapExpanded && renderMapDetails()}
          <Button
            className="activity-map-expand"
            aria-label="Explore map full screen"
            title="Explore map full screen"
            icon={<ArrowExpand24Regular />}
            onClick={() => {
              setShowMapCard(false);
              setMapExpanded(true);
            }}
          />
        </div>
        <section
          className="activity-cards-section"
          aria-label="Destination activities"
        >
          <div className="activity-cards-heading">
            <Title2 as="h2">Activities</Title2>
            {canEdit && (
              <Button appearance="primary" onClick={openAdd}>
                Add activity
              </Button>
            )}
          </div>
          <ul
            className="activity-cards"
            aria-label={`${destination.properties.name} activities`}
          >
            {activities.features.map((item, index) => (
              <li key={item.id} className="activity-list-item">
                <button
                  type="button"
                  className="activity-list-select"
                  aria-label={item.properties.name}
                  aria-pressed={selectedId === item.id}
                  onClick={() => selectActivity(item.id)}
                >
                  <span className="activity-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span>{item.properties.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {activities.features.length === 0 && (
            <Text className="activity-empty">
              {canEdit
                ? "No activities yet. Add an activity to start planning."
                : "No activities yet."}
            </Text>
          )}
        </section>
      </div>
      <Dialog
        open={mapExpanded}
        onOpenChange={(_, data) => {
          if (!editor) setMapExpanded(data.open);
        }}
      >
        <DialogSurface
          ref={setFullscreenContainer}
          className="activity-fullscreen-map"
          aria-label={`Map of ${destination.properties.name}`}
        >
          <div className="activity-fullscreen-header">
            <Title2 as="h2">{destination.properties.name}</Title2>
            <Button
              icon={<Dismiss24Regular />}
              aria-label="Exit full-screen map"
              onClick={() => setMapExpanded(false)}
            />
          </div>
          <div className="activity-fullscreen-canvas">
            {mapExpanded && (
              <ActivityMap
                center={destination.geometry}
                destinationName={destination.properties.name}
                stayLocation={destination.properties.stayLocation}
                activities={activitiesForMap}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setShowMapCard(true);
                }}
              />
            )}
            {renderMapDetails()}
          </div>
        </DialogSurface>
      </Dialog>
      <OverlayDrawer
        mountNode={mapExpanded ? (fullscreenContainer ?? undefined) : undefined}
        modalType={mapExpanded ? "modal" : "non-modal"}
        backdrop={null}
        open={Boolean(editor && canEdit)}
        position="start"
        className="activity-drawer"
        onOpenChange={(_, data) => {
          if (!data.open) closeDrawer();
        }}
      >
        <DrawerHeader>
          <DrawerHeaderTitle
            action={
              <Button
                appearance="subtle"
                aria-label="Close activity drawer"
                icon={<Dismiss24Regular />}
                disabled={busy}
                onClick={closeDrawer}
              />
            }
          >
            {editor?.value.id ? "Edit activity" : "Add activity"}
          </DrawerHeaderTitle>
        </DrawerHeader>
        <DrawerBody className="activity-drawer-body">
          {!editor?.value.id && (
            <TabList
              aria-label="Add activity method"
              selectedValue={entryMode}
              onTabSelect={(_, data) =>
                setEntryMode(data.value as typeof entryMode)
              }
            >
              <Tab value="lookup" disabled={busy}>
                Place lookup
              </Tab>
              <Tab value="prompt" disabled={busy || !canGenerate}>
                AI prompt
              </Tab>
              <Tab value="image" disabled={busy || !canGenerate}>
                Images
              </Tab>
            </TabList>
          )}
          {!canGenerate && !editor?.value.id && (
            <Text size={200}>
              Enable AI in your profile to generate suggestions or import an
              image.
            </Text>
          )}
          {error && <Text role="alert">{error}</Text>}
          {busy && (
            <Spinner
              label={
                entryMode === "lookup"
                  ? "Saving activity"
                  : "Generating activities"
              }
            />
          )}
          {editor && (
            <fieldset disabled={busy} className="activity-drawer-fields">
              {entryMode === "lookup" ? (
                <div className="activity-editor">
                  <label>
                    Activity or place name
                    <Input
                      placeholder="Search attractions, restaurants, or places"
                      value={placeQuery}
                      onChange={(_, data) => setPlaceQuery(data.value)}
                    />
                  </label>
                  <div className="activity-place-actions">
                    <Button
                      disabled={searching || !placeQuery.trim()}
                      onClick={() => void searchPlace()}
                    >
                      {searching ? "Searching…" : "Search Azure Maps"}
                    </Button>
                    {editor.value.geometry && <Text>Location selected</Text>}
                  </div>
                  {places.length > 0 && (
                    <div
                      className="activity-place-results"
                      aria-label="Place results"
                    >
                      {places.map((place) => (
                        <Button
                          key={place.label}
                          onClick={() => choosePlace(place)}
                        >
                          {place.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  <label>
                    Name
                    <Input
                      value={editor.value.properties.name}
                      maxLength={200}
                      onChange={(_, data) => updateEditor({ name: data.value })}
                    />
                  </label>
                  <label>
                    Description
                    <Textarea
                      value={editor.value.properties.description}
                      onChange={(_, data) =>
                        updateEditor({ description: data.value })
                      }
                    />
                  </label>
                  <div className="activity-editor-grid">
                    <label>
                      Duration, minutes
                      <Input
                        type="number"
                        min={1}
                        value={
                          editor.value.properties.durationMinutes?.toString() ??
                          ""
                        }
                        onChange={(_, data) =>
                          updateEditor({
                            durationMinutes: data.value
                              ? Number(data.value)
                              : null,
                          })
                        }
                      />
                    </label>
                    <label>
                      Cost amount
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={
                          editor.value.properties.cost?.amount.toString() ?? ""
                        }
                        onChange={(_, data) =>
                          updateEditor({
                            cost: data.value
                              ? {
                                  amount: Number(data.value),
                                  currency:
                                    editor.value.properties.cost?.currency ??
                                    "USD",
                                  basis:
                                    editor.value.properties.cost?.basis ??
                                    "perPerson",
                                }
                              : null,
                          })
                        }
                      />
                    </label>
                    <label>
                      Currency
                      <Input
                        maxLength={3}
                        value={editor.value.properties.cost?.currency ?? ""}
                        disabled={!editor.value.properties.cost}
                        onChange={(_, data) =>
                          updateEditor({
                            cost: editor.value.properties.cost
                              ? {
                                  ...editor.value.properties.cost,
                                  currency: data.value.toUpperCase(),
                                }
                              : null,
                          })
                        }
                      />
                    </label>
                    <label>
                      Cost basis
                      <select
                        value={
                          editor.value.properties.cost?.basis ?? "perPerson"
                        }
                        disabled={!editor.value.properties.cost}
                        onChange={(event) =>
                          updateEditor({
                            cost: editor.value.properties.cost
                              ? {
                                  ...editor.value.properties.cost,
                                  basis: event.target
                                    .value as ActivityCost["basis"],
                                }
                              : null,
                          })
                        }
                      >
                        <option value="perPerson">Per person</option>
                        <option value="total">Total</option>
                      </select>
                    </label>
                    <div className="activity-state-picker">
                      <span id="activity-state-label">State</span>
                      <Menu
                        checkedValues={{
                          state: [editor.value.properties.state],
                        }}
                        onCheckedValueChange={(_, data) => {
                          const state = data.checkedItems[0];
                          if (state) updateEditor({ state });
                        }}
                      >
                        <MenuTrigger disableButtonEnhancement>
                          <MenuButton
                            aria-label={`State: ${editor.value.properties.state}`}
                            aria-labelledby="activity-state-label activity-state-value"
                          >
                            <span id="activity-state-value">
                              {editor.value.properties.state}
                            </span>
                          </MenuButton>
                        </MenuTrigger>
                        <MenuPopover>
                          <MenuList>
                            {Array.from(
                              new Set([
                                "Proposed",
                                "Planned",
                                "Rejected",
                                editor.value.properties.state,
                              ]),
                            ).map((state) => (
                              <MenuItemRadio
                                key={state}
                                name="state"
                                value={state}
                              >
                                {state}
                              </MenuItemRadio>
                            ))}
                          </MenuList>
                        </MenuPopover>
                      </Menu>
                    </div>
                  </div>
                  <ActivityLinksEditor
                    links={editor.value.properties.links ?? []}
                    onChange={(links) => updateEditor({ links })}
                  />
                </div>
              ) : (
                <div className="activity-composer">
                  <label htmlFor="activity-prompt">
                    {entryMode === "prompt"
                      ? "What would you like to do?"
                      : "Image instructions (optional)"}
                  </label>
                  <Textarea
                    id="activity-prompt"
                    placeholder={
                      entryMode === "image"
                        ? "Optional: extract only food activities mentioned in these images"
                        : "Find relaxed art and food activities"
                    }
                    value={prompt}
                    onChange={(_, data) => setPrompt(data.value)}
                  />
                  {entryMode === "image" && (
                    <>
                      <Button onClick={() => imageInput.current?.click()}>
                        Choose images
                      </Button>
                      <Text size={200}>
                        Up to 10 images · 10 MB each · 25 MB total. Only
                        activities explicitly mentioned in the images will be
                        extracted.
                      </Text>
                      <input
                        ref={imageInput}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={(event) =>
                          chooseImages([
                            ...images,
                            ...Array.from(event.target.files ?? []),
                          ])
                        }
                        className="activity-file-input"
                        aria-label="Activity images"
                      />
                      {images.map((file, index) => (
                        <div
                          className="activity-upload-preview"
                          key={`${index}-${file.name}`}
                        >
                          {imagePreviews[index] && (
                            <img
                              src={imagePreviews[index]}
                              alt={`Activity source ${index + 1}: ${file.name}`}
                            />
                          )}
                          <span>{file.name}</span>
                          <Button
                            aria-label={`Remove image ${index + 1}: ${file.name}`}
                            onClick={() =>
                              chooseImages(
                                images.filter(
                                  (_, imageIndex) => imageIndex !== index,
                                ),
                              )
                            }
                          >
                            Remove image
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                  <Text size={200}>
                    AI saves activities immediately with state Proposed.
                  </Text>
                </div>
              )}
            </fieldset>
          )}
        </DrawerBody>
        <DrawerFooter className="activity-drawer-footer">
          {editor?.value.id && (
            <Button disabled={busy} onClick={() => void remove()}>
              Delete activity
            </Button>
          )}
          <Button disabled={busy} onClick={closeDrawer}>
            Cancel
          </Button>
          {entryMode === "lookup" ? (
            <Button
              appearance="primary"
              disabled={
                busy ||
                !editor?.value.properties.name.trim() ||
                (editor?.value.properties.links ?? []).some(
                  (link) => !validActivityLink(link),
                )
              }
              onClick={() => void save()}
            >
              Save activity
            </Button>
          ) : (
            <Button
              appearance="primary"
              disabled={
                busy ||
                !canGenerate ||
                (entryMode === "prompt" ? !prompt.trim() : images.length === 0)
              }
              onClick={() =>
                void generate(entryMode === "image" ? "image" : "text")
              }
            >
              {entryMode === "image"
                ? "Extract activities"
                : "Suggest activities"}
            </Button>
          )}
        </DrawerFooter>
      </OverlayDrawer>
    </section>
  );
}
