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
  Title3,
} from "@fluentui/react-components";
import { useSearchParams } from "react-router";
import {
  resolveCity,
  searchCities,
  searchPlaces,
  type CitySuggestion,
  type Trip,
} from "./api";
import AsyncAutocomplete from "./AsyncAutocomplete";
import ActivityMap from "./ActivityMap";
import {
  addDestination,
  deleteActivity,
  deleteDestinationStay,
  getActivities,
  getActivity,
  getDestinations,
  getSuggestionResult,
  importActivityImage,
  replaceDestinationStay,
  saveActivity,
  suggestActivities,
  waitForActivityJob,
  type Activity,
  type ActivityCollection,
  type ActivityCost,
  type ActivityInput,
  type Destination,
  type DestinationCollection,
  type Point,
} from "./activitiesApi";

type Editor = { value: ActivityInput; etag?: string };
const searchDestinationCities = async (query: string, signal: AbortSignal) =>
  (await searchCities(query, signal)).filter((city) => city.countryCode);

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

function stayLabel(destination: Destination) {
  return destination.properties.stays
    .map((stay) =>
      stay.arrivalDate || stay.departureDate
        ? `${stay.arrivalDate ?? "?"}–${stay.departureDate ?? "?"}`
        : "Dates not set",
    )
    .join(" · ");
}

export default function ActivityPlanning({
  trip,
  readOnly,
  featureFlags,
}: {
  trip: Trip;
  readOnly: boolean;
  featureFlags: string[];
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
  const [placeQuery, setPlaceQuery] = useState("");
  const [places, setPlaces] = useState<
    { label: string; longitude?: number; latitude?: number }[]
  >([]);
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<File>();
  const [imagePreview, setImagePreview] = useState<string>();
  const [showPast, setShowPast] = useState(false);
  const [cityName, setCityName] = useState("");
  const [selectedDestinationCity, setSelectedDestinationCity] =
    useState<CitySuggestion>();
  const [arrivalDate, setArrivalDate] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [editingStay, setEditingStay] = useState<{
    id: string;
    arrivalDate: string;
    departureDate: string;
  }>();
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
    const controller = new AbortController();
    void getDestinations(trip.id, controller.signal, showPast)
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
  }, [trip.id, showPast]);

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

  useEffect(() => () => operationAbort.current?.abort(), []);

  const activitiesForMap = activities.features;

  function selectDestination(cityId: string) {
    if ((editor || editingStay) && !window.confirm("Discard unsaved changes?"))
      return;
    setSelectedId(undefined);
    setEditor(undefined);
    setEditingStay(undefined);
    setQuery((current) => {
      const next = new URLSearchParams(current);
      next.set("destination", cityId);
      return next;
    });
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
    if (!destination || !editor) return;
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
    setError(undefined);
    try {
      setPlaces(
        await searchPlaces(
          `${placeQuery}, ${destination.properties.name}, ${destination.properties.countryCode}`,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not search places.",
      );
    }
  }

  function choosePlace(place: {
    label: string;
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
    updateEditor({ placeName: place.label });
    setPlaceQuery(place.label);
    setPlaces([]);
  }

  function pickMapPoint(point: Point) {
    setEditor((current) =>
      current
        ? { ...current, value: { ...current.value, geometry: point } }
        : current,
    );
    setMessage("Map location selected. Save the activity to keep it.");
  }

  async function generate(kind: "text" | "image") {
    if (!destination || (kind === "image" && !image)) return;
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

  async function addCity() {
    if (!selectedDestinationCity?.countryCode) return;
    setBusy(true);
    setError(undefined);
    try {
      const coordinates = await resolveCity(selectedDestinationCity);
      const city = await addDestination(trip.id, {
        name:
          selectedDestinationCity.cityName ??
          selectedDestinationCity.label.split(",")[0].trim(),
        countryCode: selectedDestinationCity.countryCode,
        longitude: coordinates.longitude,
        latitude: coordinates.latitude,
        arrivalDate: arrivalDate || null,
        departureDate: departureDate || null,
      });
      setDestinations(await getDestinations(trip.id, undefined, showPast));
      setQuery((current) => {
        const next = new URLSearchParams(current);
        next.set("destination", city.id);
        return next;
      });
      setCityName("");
      setSelectedDestinationCity(undefined);
      setArrivalDate("");
      setDepartureDate("");
      setMessage(
        "Destination added. You can plan activities now or choose flights later.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not add the destination.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeStay(stayId: string) {
    if (
      !destination ||
      !window.confirm(
        "Remove this destination visit? Its city activities will be kept.",
      )
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteDestinationStay(trip.id, destination.id, stayId);
      setDestinations(await getDestinations(trip.id, undefined, showPast));
      setMessage("Destination visit removed. Its activities are kept.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not remove the visit.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveStayDates() {
    if (!destination || !editingStay) return;
    setBusy(true);
    setError(undefined);
    try {
      await replaceDestinationStay(trip.id, destination.id, editingStay.id, {
        arrivalDate: editingStay.arrivalDate || null,
        departureDate: editingStay.departureDate || null,
      });
      setDestinations(await getDestinations(trip.id, undefined, showPast));
      setEditingStay(undefined);
      setMessage("Visit dates saved.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save visit dates.",
      );
    } finally {
      setBusy(false);
    }
  }

  const destinationForm = !readOnly && (
    <div
      className="activity-destination-form"
      role="group"
      aria-label="Add destination"
    >
      <AsyncAutocomplete
        label="City"
        placeholder="Start typing a city"
        inputValue={cityName}
        selectedOptionValue={selectedDestinationCity?.id}
        selectedOptionLabel={selectedDestinationCity?.label}
        search={searchDestinationCities}
        getOptionValue={(city) => city.id}
        getOptionText={(city) => city.label}
        onInputChange={(value) => {
          setCityName(value);
          setSelectedDestinationCity(undefined);
        }}
        onOptionSelect={(city) => {
          setSelectedDestinationCity(city);
          setCityName(city.label);
        }}
        hint="Select a city from the suggestions"
        emptyMessage="No matching cities found"
        debounceMs={300}
      />
      <label>
        Arrival date (optional)
        <Input
          type="date"
          value={arrivalDate}
          onChange={(_, data) => setArrivalDate(data.value)}
        />
      </label>
      <label>
        Departure date (optional)
        <Input
          type="date"
          value={departureDate}
          onChange={(_, data) => setDepartureDate(data.value)}
        />
      </label>
      <Button
        appearance="primary"
        disabled={busy || !selectedDestinationCity?.countryCode}
        onClick={() => void addCity()}
      >
        Add destination
      </Button>
    </div>
  );

  if (loading) return <Spinner label="Loading destinations" />;
  if (!destinations || destinations.features.length === 0)
    return (
      <section className="activity-planning">
        <Title2>Destinations & activities</Title2>
        <Text>
          Add a destination to start planning your trip and activities. Dates
          and flights can come later.
        </Text>
        {destinationForm}
        {!showPast && (
          <Button onClick={() => setShowPast(true)}>
            View past destinations
          </Button>
        )}
        {error && <Text role="alert">{error}</Text>}
      </section>
    );
  if (!destination)
    return (
      <section className="activity-planning">
        <Text>No destinations yet.</Text>
      </section>
    );

  return (
    <section className="activity-planning" aria-label="Activity planning">
      <Title2>Destinations & activities</Title2>
      {destinationForm}
      {destinations.route.length > 0 && (
        <Text>
          {destinations.route
            .map(
              (item) =>
                destinations.features.find(
                  (feature) => feature.id === item.destinationId,
                )?.properties.name,
            )
            .join(" → ")}
        </Text>
      )}
      {!showPast && (
        <Button onClick={() => setShowPast(true)}>
          View past destinations
        </Button>
      )}
      <TabList
        aria-label="Destinations"
        selectedValue={destination.id}
        onTabSelect={(_, data) => selectDestination(String(data.value))}
        className="activity-destination-tabs"
      >
        {destinations.features.map((item) => (
          <Tab value={item.id} key={item.id}>
            {item.properties.name}
            {item.properties.stays.length > 1
              ? ` · ${item.properties.stays.length} stays`
              : ""}
          </Tab>
        ))}
      </TabList>
      <Text className="activity-stay-dates">
        {destination.properties.isActive
          ? stayLabel(destination)
          : "Past destination · activities are read-only until this city is added again"}
      </Text>
      {destination.properties.isActive && !readOnly && (
        <div className="activity-stay-actions">
          {destination.properties.stays.map((stay) => (
            <div key={stay.id} className="activity-stay-controls">
              <Text>
                Visit {stay.order + 1}: {stay.arrivalDate ?? "Dates open"}
                {stay.departureDate ? `–${stay.departureDate}` : ""}
              </Text>
              <Button
                disabled={busy}
                onClick={() =>
                  setEditingStay({
                    id: stay.id,
                    arrivalDate: stay.arrivalDate ?? "",
                    departureDate: stay.departureDate ?? "",
                  })
                }
              >
                Edit dates
              </Button>
              <Button disabled={busy} onClick={() => void removeStay(stay.id)}>
                Remove visit
              </Button>
            </div>
          ))}
        </div>
      )}
      {editingStay && destination.properties.isActive && (
        <div
          className="activity-destination-form"
          role="group"
          aria-label="Edit visit dates"
        >
          <label>
            Arrival date
            <Input
              type="date"
              value={editingStay.arrivalDate}
              onChange={(_, data) =>
                setEditingStay({ ...editingStay, arrivalDate: data.value })
              }
            />
          </label>
          <label>
            Departure date
            <Input
              type="date"
              value={editingStay.departureDate}
              onChange={(_, data) =>
                setEditingStay({ ...editingStay, departureDate: data.value })
              }
            />
          </label>
          <Button
            appearance="primary"
            disabled={busy}
            onClick={() => void saveStayDates()}
          >
            Save dates
          </Button>
          <Button onClick={() => setEditingStay(undefined)}>Cancel</Button>
        </div>
      )}
      {error && <Text role="alert">{error}</Text>}
      {message && <Text role="status">{message}</Text>}
      <div className="activity-workspace">
        <div className="activity-map-panel">
          <ActivityMap
            center={destination.geometry}
            activities={activitiesForMap}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPick={editor && canEdit ? pickMapPoint : undefined}
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
        <div className="activity-table-wrap">
          <table className="activity-table">
            <caption>{destination.properties.name} activities</caption>
            <thead>
              <tr>
                <th>Activity</th>
                <th>Duration</th>
                <th>Cost</th>
                <th>State</th>
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
                </tr>
              ))}
            </tbody>
          </table>
          {activities.features.length === 0 && (
            <Text>No activities yet. Add one or ask for ideas.</Text>
          )}
        </div>
      </div>
      {editor && canEdit && (
        <div
          className="activity-editor"
          role="group"
          aria-label={editor.value.id ? "Edit activity" : "Add activity"}
        >
          <Title3>{editor.value.id ? "Edit activity" : "Add activity"}</Title3>
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
              onChange={(_, data) => updateEditor({ description: data.value })}
            />
          </label>
          <div className="activity-editor-grid">
            <label>
              Duration, minutes
              <Input
                type="number"
                min={1}
                value={
                  editor.value.properties.durationMinutes?.toString() ?? ""
                }
                onChange={(_, data) =>
                  updateEditor({
                    durationMinutes: data.value ? Number(data.value) : null,
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
                value={editor.value.properties.cost?.amount.toString() ?? ""}
                onChange={(_, data) =>
                  updateEditor({
                    cost: data.value
                      ? {
                          amount: Number(data.value),
                          currency:
                            editor.value.properties.cost?.currency ?? "USD",
                          basis:
                            editor.value.properties.cost?.basis ?? "perPerson",
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
                value={editor.value.properties.cost?.basis ?? "perPerson"}
                disabled={!editor.value.properties.cost}
                onChange={(event) =>
                  updateEditor({
                    cost: editor.value.properties.cost
                      ? {
                          ...editor.value.properties.cost,
                          basis: event.target.value as ActivityCost["basis"],
                        }
                      : null,
                  })
                }
              >
                <option value="perPerson">Per person</option>
                <option value="total">Total</option>
              </select>
            </label>
            <label>
              State
              <Input
                list="activity-state-options"
                value={editor.value.properties.state}
                onChange={(_, data) => updateEditor({ state: data.value })}
              />
            </label>
            <datalist id="activity-state-options">
              <option value="Proposed" />
              <option value="Planned" />
              <option value="Rejected" />
            </datalist>
          </div>
          <label>
            Place or address
            <Input
              value={placeQuery}
              onChange={(_, data) => setPlaceQuery(data.value)}
            />
          </label>
          <div className="activity-place-actions">
            <Button onClick={() => void searchPlace()}>Find place</Button>
            {editor.value.geometry && <Text>Location selected</Text>}
          </div>
          {places.length > 0 && (
            <div className="activity-place-results" aria-label="Place results">
              {places.map((place) => (
                <Button key={place.label} onClick={() => choosePlace(place)}>
                  {place.label}
                </Button>
              ))}
            </div>
          )}
          <Text size={200}>You can also tap the map to choose a location.</Text>
          <div className="activity-actions">
            <Button
              appearance="primary"
              disabled={busy}
              onClick={() => void save()}
            >
              Save activity
            </Button>
            <Button disabled={busy} onClick={() => setEditor(undefined)}>
              Cancel
            </Button>
            {editor.value.id && (
              <Button disabled={busy} onClick={() => void remove()}>
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
      {canEdit && (
        <div className="activity-composer">
          <label htmlFor="activity-prompt">What would you like to do?</label>
          <Textarea
            id="activity-prompt"
            placeholder="Find relaxed art and food activities"
            value={prompt}
            onChange={(_, data) => setPrompt(data.value)}
          />
          <div className="activity-actions">
            {canGenerate && (
              <Button
                appearance="primary"
                disabled={busy || !prompt.trim()}
                onClick={() => void generate("text")}
              >
                Suggest activities
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() => {
                setEditor({
                  value: {
                    ...emptyActivity(),
                    properties: {
                      ...emptyActivity().properties,
                      name: prompt.slice(0, 200),
                    },
                  },
                });
                setPlaceQuery("");
                setPlaces([]);
              }}
            >
              Add activity
            </Button>
            {canGenerate && (
              <>
                <Button
                  disabled={busy}
                  onClick={() => imageInput.current?.click()}
                >
                  Choose image
                </Button>
                <input
                  ref={imageInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => chooseImage(event.target.files?.[0])}
                  className="activity-file-input"
                  aria-label="Activity image"
                />
              </>
            )}
          </div>
          {image && (
            <div className="activity-upload-preview">
              {imagePreview && (
                <img src={imagePreview} alt="Selected activity source" />
              )}
              <span>{image.name}</span>
              <Button disabled={busy} onClick={() => chooseImage(undefined)}>
                Remove image
              </Button>
              <Button
                appearance="primary"
                disabled={busy}
                onClick={() => void generate("image")}
              >
                Extract activities
              </Button>
            </div>
          )}
          {canGenerate && (
            <Text size={200}>
              AI will process the prompt or image and save found activities as
              Proposed.
            </Text>
          )}
        </div>
      )}
    </section>
  );
}
