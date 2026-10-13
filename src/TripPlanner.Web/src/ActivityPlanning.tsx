import { useEffect, useRef, useState } from "react";
import {
  Button,
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
import { Dismiss24Regular } from "@fluentui/react-icons";
import { destinationDates } from "./tripDates";
import { Link, useSearchParams } from "react-router";
import { searchPlaces, type Trip } from "./api";
import ActivityMap from "./ActivityMap";
import {
  deleteActivity,
  getActivities,
  getActivity,
  getDestinations,
  getSuggestionResult,
  importActivityImage,
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
  const [editor, setEditor] = useState<Editor>();
  const [searching, setSearching] = useState(false);
  const placeAbort = useRef<AbortController | undefined>(undefined);
  const [placeQuery, setPlaceQuery] = useState("");
  const [places, setPlaces] = useState<
    { label: string; name?: string; longitude?: number; latitude?: number }[]
  >([]);
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<File>();
  const [imagePreview, setImagePreview] = useState<string>();
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
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

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
      );
      if (!controller.signal.aborted) {
        setPlaces(results);
        if (!results.length) setError("No places found. Try another name.");
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
      (kind === "image" && !image) ||
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
          ? await importActivityImage(trip.id, destination, image!, prompt)
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
      chooseImage(undefined);
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

  function chooseImage(file: File | undefined) {
    setImage(file);
    setImagePreview(file ? URL.createObjectURL(file) : undefined);
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
    chooseImage(undefined);
  }
  function openAdd() {
    placeAbort.current?.abort();
    setSearching(false);
    setError(undefined);
    setPrompt("");
    chooseImage(undefined);
    setPlaces([]);
    setPlaceQuery("");
    setEntryMode("lookup");
    setEditor({ value: emptyActivity() });
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
          <ActivityMap
            center={destination.geometry}
            destinationName={destination.properties.name}
            activities={activitiesForMap}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selected && (
            <div className="activity-selection">
              <strong>{selected.properties.name}</strong>
              <span>
                {selected.properties.description || "No description yet."}
              </span>
              {canEdit && (
                <Button onClick={() => void openEdit(selected)}>
                  Edit activity
                </Button>
              )}
            </div>
          )}
        </div>
        <section
          className="activity-table-section"
          aria-label="Destination activities"
        >
          <div className="activity-table-heading">
            <Title2 as="h2">Activities</Title2>
            {canEdit && (
              <Button appearance="primary" onClick={openAdd}>
                Add activity
              </Button>
            )}
          </div>
          <div className="activity-table-wrap">
            <table
              className="activity-table"
              aria-label={`${destination.properties.name} activities`}
            >
              <caption className="visually-hidden">
                {destination.properties.name} activities
              </caption>
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Duration</th>
                  <th>Cost</th>
                  <th>State</th>
                  {canEdit && (
                    <th>
                      <span className="visually-hidden">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {activities.features.map((item) => (
                  <tr
                    key={item.id}
                    className={selectedId === item.id ? "selected" : ""}
                  >
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                      >
                        {item.properties.name}
                      </button>
                      {!item.geometry && <small>Needs location</small>}
                    </td>
                    <td>{formatDuration(item.properties.durationMinutes)}</td>
                    <td>{formatCost(item.properties.cost)}</td>
                    <td>
                      <span className="activity-state">
                        {item.properties.state}
                      </span>
                    </td>
                    {canEdit && (
                      <td>
                        <Button
                          appearance="subtle"
                          aria-label={`Edit activity: ${item.properties.name}`}
                          onClick={() => void openEdit(item)}
                        >
                          Edit
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {activities.features.length === 0 && (
            <Text className="activity-empty">
              {canEdit
                ? "No activities yet. Add an activity to start planning."
                : "No activities yet."}
            </Text>
          )}
        </section>
      </div>
      <OverlayDrawer
        open={Boolean(editor && canEdit)}
        position="end"
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
                Image
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
                    placeholder="Find relaxed art and food activities"
                    value={prompt}
                    onChange={(_, data) => setPrompt(data.value)}
                  />
                  {entryMode === "image" && (
                    <>
                      <Button onClick={() => imageInput.current?.click()}>
                        Choose image
                      </Button>
                      <input
                        ref={imageInput}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(event) =>
                          chooseImage(event.target.files?.[0])
                        }
                        className="activity-file-input"
                        aria-label="Activity image"
                      />
                      {image && (
                        <div className="activity-upload-preview">
                          {imagePreview && (
                            <img
                              src={imagePreview}
                              alt="Selected activity source"
                            />
                          )}
                          <span>{image.name}</span>
                          <Button onClick={() => chooseImage(undefined)}>
                            Remove image
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                  <Text size={200}>
                    AI saves suggested activities immediately with state
                    Proposed.
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
              disabled={busy || !editor?.value.properties.name.trim()}
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
                (entryMode === "prompt" ? !prompt.trim() : !image)
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
