import { mapsClient } from "../../maps/mapsClient";
import {
  useExplicitResourceRefresh,
  useTripResourceVersion,
} from "../../api/tripSnapshot";
import { ActivityWorkspaceSkeleton } from "./ActivityPlanningSkeletons";
import SearchResultsSkeleton from "../../shared/components/SearchResultsSkeleton";
import { trackBehavior } from "../../telemetry/telemetry";
import { findActivityLocations } from "./findActivityLocations";
import { useActionToast } from "../../shared/hooks/useActionToast";
import { durationMinutes } from "../../shared/time/durations";
import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Input,
  Field,
  SearchBox,
  Spinner,
  Toast,
  ToastTitle,
  ToastBody,
  ToastTrigger,
  useId,
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
  MenuItem,
  MenuDivider,
} from "@fluentui/react-components";
import {
  ArrowExpand24Regular,
  ChevronDown24Regular,
  ChevronUp24Regular,
  ChevronRight24Regular,
  Dismiss24Regular,
  Delete24Regular,
  Share24Regular,
} from "@fluentui/react-icons";
import { destinationDates } from "../trips/tripDates";
import { Link, useSearchParams } from "react-router";
import PlaceSearchResult from "../../shared/components/PlaceSearchResult";
import type { PlaceSuggestion, Trip } from "../../api/api";
import { activityMapLink } from "../../maps/activityMapLink";
import ActivityDetailsResearch, {
  ActivityDetailsEvidence,
} from "./ActivityDetailsResearch";
import ActivityLinksEditor from "./ActivityLinksEditor";
import ActivityDurationSlider from "./ActivityDurationSlider";
import { validActivityLink } from "./activityLinks";
import {
  activityRouteKey,
  useActivityRoute,
  type ActivityRouteSelection,
} from "./activityRouteApi";
import ActivityMap from "../../maps/ActivityMap";
import DailyActivityPlan from "./DailyActivityPlan";
import ResizableActivityWorkspace from "./ResizableActivityWorkspace";
import {
  deleteActivity,
  getActivities,
  getActivity,
  getDestinations,
  getSuggestionResult,
  importActivityImages,
  saveActivity,
  researchActivityLocation,
  researchActivityPlaces,
  type ActivityLink,
  suggestActivities,
  waitForActivityJob,
  type Activity,
  type ActivityCollection,
  type ActivityCost,
  type ActivityInput,
  type Destination,
  type DestinationCollection,
} from "./activitiesApi";

const currencyNames = new Intl.DisplayNames(["en"], { type: "currency" });
const currencies = Intl.supportedValuesOf("currency");

type ActivityPlaceResult = PlaceSuggestion & {
  source?: ActivityLink;
  locationSource?: ActivityLink | null;
  warning?: string | null;
  mapAddress?: string | null;
};

type Editor = { value: ActivityInput; etag?: string };
const emptyActivity = (): ActivityInput => ({
  type: "Feature",
  geometry: null,
  properties: {
    name: "",
    duration: null,
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

function formatDuration(duration: string | null) {
  const minutes = durationMinutes(duration);
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
  active = true,
}: {
  trip: Trip;
  readOnly: boolean;
  featureFlags: string[];
  onDestinationChange?: (destination: Destination | undefined) => void;
  active?: boolean;
}) {
  const snapshotVersion = useTripResourceVersion(
    `/trips/${trip.id}/destinations`,
  );
  const [query, setQuery] = useSearchParams();
  const [activityView, setActivityView] = useState("ideas");
  const [collapsedStates, setCollapsedStates] = useState<Set<string>>(
    new Set(),
  );
  const stateGroupsId = useId("activity-state-groups");
  const [destinations, setDestinations] =
    useState<DestinationCollection | null>();
  const [activityData, setActivityData] = useState<{
    cityId: string;
    collection: ActivityCollection;
  }>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const locationAbort = useRef<AbortController | undefined>(undefined);
  const [locationProgress, setLocationProgress] = useState<{
    completed: number;
    total: number;
  }>();
  const [deleteTarget, setDeleteTarget] = useState<Activity>();
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const editorCloseRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string>();
  const [selectedTravel, setSelectedTravel] = useState<{
    cityId: string;
    selection: ActivityRouteSelection;
  }>();
  const [selectedId, setSelectedId] = useState<string>();
  const [mapExpanded, setMapExpanded] = useState(false);
  const [mapCollapsed, setMapCollapsed] = useState(false);
  const mapPanelId = useId("activity-map-panel");
  const mapPanel = useRef<HTMLDivElement>(null);
  const [fullscreenContainer, setFullscreenContainer] =
    useState<HTMLDivElement | null>(null);
  const [fullscreenMapHost, setFullscreenMapHost] =
    useState<HTMLDivElement | null>(null);
  const { notify, dispatchToast, toaster } = useActionToast();
  const [showMapCard, setShowMapCard] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [searching, setSearching] = useState(false);
  const [researchingPlaces, setResearchingPlaces] = useState(false);
  const [chosenPlace, setChosenPlace] = useState<ActivityPlaceResult>();
  const [placeSearchActive, setPlaceSearchActive] = useState(false);
  const placeAbort = useRef<AbortController | undefined>(undefined);
  const [placeQuery, setPlaceQuery] = useState("");
  const [places, setPlaces] = useState<ActivityPlaceResult[]>([]);
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [imageWarnings, setImageWarnings] = useState<string[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [entryMode, setEntryMode] = useState<"lookup" | "prompt" | "image">(
    "lookup",
  );
  const operationAbort = useRef<AbortController | undefined>(undefined);
  const imageInput = useRef<HTMLInputElement>(null);
  const [selectedCity, setSelectedCity] = useState(
    query.get("destination") ?? undefined,
  );
  const requestedCity = active ? query.get("destination") : null;
  if (requestedCity && requestedCity !== selectedCity)
    setSelectedCity(requestedCity);
  const destination =
    destinations?.features.find((item) => item.id === selectedCity) ??
    destinations?.features[0];
  const cityId = destination?.id;
  const routeSelection =
    activityView === "daily" &&
    !editor &&
    selectedTravel &&
    selectedTravel.cityId === cityId
      ? selectedTravel.selection
      : undefined;
  const routePreview = useActivityRoute(trip.id, cityId, routeSelection);
  useEffect(() => {
    if (!routeSelection) return;
    const frame = requestAnimationFrame(() =>
      mapPanel.current?.scrollIntoView?.({ block: "nearest" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [routeSelection]);
  const activities =
    activityData && activityData.cityId === cityId
      ? activityData.collection
      : emptyCollection;
  const groups = new Map<string, { item: Activity; index: number }[]>();
  activities.features.forEach((item, index) => {
    const group = groups.get(item.properties.state) ?? [];
    group.push({ item, index });
    groups.set(item.properties.state, group);
  });
  const stateOrder = ["Proposed", "Planned", "Rejected"];
  const groupedActivities = [...groups].sort(([a], [b]) => {
    const rank = (state: string) =>
      stateOrder.includes(state)
        ? stateOrder.indexOf(state)
        : stateOrder.length;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const selected = activities.features.find((item) => item.id === selectedId);
  const canEdit = !readOnly && destination?.properties.isActive === true;
  const canGenerate = canEdit && featureFlags.includes("LLM");
  const missingLocations = activities.features.some((item) => !item.geometry);
  useEffect(() => () => locationAbort.current?.abort(), [trip.id, cityId]);
  const deleteOpen = Boolean(deleteTarget && active);
  const editorOpen = Boolean(editor && canEdit && active);

  useEffect(() => {
    // Changing the parent map's modal type runs its own initial-focus effect.
    // Give the child overlay final ownership of focus after that transition.
    if (deleteOpen) deleteCancelRef.current?.focus();
    else if (editorOpen) editorCloseRef.current?.focus();
  }, [deleteOpen, editorOpen]);

  useEffect(() => {
    onDestinationChange?.(destination);
  }, [destination, onDestinationChange]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void getDestinations(trip.id, controller.signal)
      .then((collection) => {
        if (!controller.signal.aborted) setDestinations(collection);
      })
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
  }, [trip.id, active, snapshotVersion]);

  useEffect(() => {
    if (!cityId || !active) return;
    const controller = new AbortController();
    void getActivities(trip.id, cityId, controller.signal)
      .then((collection) => {
        if (!controller.signal.aborted) setActivityData({ cityId, collection });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load activities.",
          );
      });
    return () => controller.abort();
  }, [trip.id, cityId, active, snapshotVersion]);

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

  const savedActivitiesForMap =
    activityView === "daily"
      ? activities.features.filter(
          (activity) => activity.properties.state === "Planned",
        )
      : activities.features;
  const draftOnMap =
    editor && entryMode === "lookup" && editor.value.geometry
      ? { ...editor.value, id: editor.value.id ?? "draft-activity" }
      : undefined;
  const activitiesForMap = draftOnMap
    ? savedActivitiesForMap.some((activity) => activity.id === draftOnMap.id)
      ? savedActivitiesForMap.map((activity) =>
          activity.id === draftOnMap.id ? draftOnMap : activity,
        )
      : [...savedActivitiesForMap, draftOnMap]
    : savedActivitiesForMap;
  const placeSearch =
    editor && canEdit && entryMode === "lookup" && placeSearchActive
      ? {
          results: places,
          onSelect: (index: number) => choosePlace(places[index]),
        }
      : undefined;

  function selectDestination(cityId: string) {
    if (editor && !window.confirm("Discard unsaved changes?")) return;
    setSelectedId(undefined);
    setSelectedTravel(undefined);
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
  }

  function updateEditor(changes: Partial<ActivityInput["properties"]>) {
    setEditor((current) =>
      current
        ? {
            ...current,
            value: {
              ...current.value,
              properties: {
                ...current.value.properties,
                ...("duration" in changes ? { durationEvidence: null } : {}),
                ...("cost" in changes ? { costEvidence: null } : {}),
                ...changes,
              },
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
      setChosenPlace(undefined);
      setPlaceSearchActive(false);
      setEditor({ value: current.activity, etag: current.etag });
      setPlaceQuery(current.activity.properties.placeName ?? "");
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not load the activity.",
        "error",
      );
    }
  }

  useExplicitResourceRefresh(
    `/trips/${trip.id}/destinations/${encodeURIComponent(destination?.id ?? "")}/activities/${editor?.value.id ?? ""}`,
    async () => {
      if (editor?.value.id) await openEdit(editor.value as Activity);
    },
  );

  async function findMissingLocations() {
    if (!destination || !canGenerate || busy || !missingLocations) return;
    const controller = new AbortController();
    locationAbort.current = controller;
    setBusy(true);
    setLocationProgress({
      completed: 0,
      total: activities.features.filter((item) => !item.geometry).length,
    });
    try {
      const counts = await findActivityLocations({
        tripId: trip.id,
        destination,
        activities: activities.features,
        signal: controller.signal,
        onSaved: (saved) =>
          setActivityData((current) =>
            current?.cityId === destination.id
              ? {
                  ...current,
                  collection: {
                    ...current.collection,
                    features: current.collection.features.map((item) =>
                      item.id === saved.id ? saved : item,
                    ),
                  },
                }
              : current,
          ),
        onProgress: (completed, total) =>
          setLocationProgress({ completed, total }),
      });
      if (!controller.signal.aborted) {
        notify(
          `${counts.found} location${counts.found === 1 ? "" : "s"} found and saved.${counts.skipped ? ` ${counts.skipped} already located.` : ""}${counts.unresolved ? ` ${counts.unresolved} could not be verified.` : ""}${counts.failed ? ` ${counts.failed} failed; try again.` : ""}`,
          counts.failed ? "error" : counts.unresolved ? "info" : "success",
        );
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        notify(
          reason instanceof Error
            ? reason.message
            : "Could not find activity locations.",
          "error",
        );
    } finally {
      if (locationAbort.current === controller) {
        locationAbort.current = undefined;
        setLocationProgress(undefined);
        setBusy(false);
      }
    }
  }

  async function researchLocation() {
    if (!destination || !editor?.value.id || !editor.etag || busy) return;
    setBusy(true);
    try {
      const suggestion = await researchActivityLocation(
        trip.id,
        destination,
        editor.value.id,
        editor.etag,
      );
      updateEditor({ locationSuggestion: suggestion });
      if (!suggestion)
        notify(
          "No published location could be verified. Try Azure Maps or select a location manually.",
          "error",
        );
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not research the location.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  function useSuggestedLocation() {
    const suggestion = editor?.value.properties.locationSuggestion;
    if (!editor || !suggestion) return;
    const links = editor.value.properties.links ?? [];
    if (
      links.length >= 20 &&
      !links.some((link) => link.url === suggestion.source.url)
    ) {
      notify(
        "Remove a link before adding the location source (20 links maximum).",
        "error",
      );
      return;
    }
    setEditor({
      ...editor,
      value: {
        ...editor.value,
        geometry: suggestion.geometry,
        properties: {
          ...editor.value.properties,
          locationSuggestion: null,
          links: links.some((link) => link.url === suggestion.source.url)
            ? links
            : [...links, suggestion.source],
        },
      },
    });
    notify("Location selected. Save the activity to apply it.");
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
      trackBehavior("activity_saved");
      setActivityData({
        cityId: destination.id,
        collection: await getActivities(trip.id, destination.id),
      });
      setSelectedId(saved.id);
      setEditor(undefined);
      notify("Activity saved.");
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not save the activity.",
        "error",
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
      notify("Activity deleted.");
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not delete the activity.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeActivityState(item: Activity, state: string) {
    if (!destination || busy || state === item.properties.state) return;
    setBusy(true);
    setError(undefined);
    try {
      const current = await getActivity(trip.id, destination.id, item.id);
      const saved = await saveActivity(
        trip.id,
        destination,
        {
          ...current.activity,
          properties: { ...current.activity.properties, state },
        },
        current.etag,
      );
      setActivityData({
        cityId: destination.id,
        collection: {
          ...activities,
          features: activities.features.map((activity) =>
            activity.id === saved.id ? saved : activity,
          ),
        },
      });
      notify("Activity state updated.");
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not update activity state.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmActivityDeletion() {
    if (!destination || !deleteTarget || busy) return;
    setBusy(true);
    try {
      const current = await getActivity(
        trip.id,
        destination.id,
        deleteTarget.id,
      );
      await deleteActivity(trip.id, destination, deleteTarget.id, current.etag);
      setActivityData({
        cityId: destination.id,
        collection: {
          ...activities,
          features: activities.features.filter(
            (activity) => activity.id !== deleteTarget.id,
          ),
        },
      });
      if (selectedId === deleteTarget.id) {
        setSelectedId(undefined);
        setShowMapCard(false);
      }
      setDeleteTarget(undefined);
      notify("Activity deleted.");
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not delete the activity.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  async function searchPlace(webOnly = false) {
    if (
      !destination ||
      !placeQuery.trim() ||
      busy ||
      searching ||
      (webOnly && !canGenerate)
    )
      return;
    setPlaceSearchActive(true);
    setMapCollapsed(false);
    setShowMapCard(false);
    placeAbort.current?.abort();
    const controller = new AbortController();
    placeAbort.current = controller;
    setSearching(true);
    setResearchingPlaces(webOnly);
    setError(undefined);
    setPlaces([]);
    setChosenPlace(undefined);
    try {
      let results: ActivityPlaceResult[] = [];
      if (!webOnly) {
        try {
          results = await mapsClient.searchPlaces(
            placeQuery.trim(),
            controller.signal,
            destination.geometry.coordinates,
            destination.properties.countryCode,
          );
        } catch (reason) {
          if (controller.signal.aborted || !canGenerate) throw reason;
        }
      }
      if (controller.signal.aborted) return;
      if (!results.length && canGenerate) {
        setResearchingPlaces(true);
        const matches = await researchActivityPlaces(
          trip.id,
          destination.id,
          placeQuery.trim(),
          controller.signal,
        );
        results = matches.map((match, index) => ({
          id: `researched-${index}`,
          name: match.name,
          label: `${match.name}, ${match.address}`,
          address: match.address,
          longitude: match.geometry?.coordinates[0],
          latitude: match.geometry?.coordinates[1],
          source: match.source,
          locationSource: match.locationSource,
          warning: match.warning,
          mapAddress: match.mapAddress,
        }));
      }
      if (!controller.signal.aborted) {
        setPlaces(results);
        if (!results.length)
          setError(
            `No matching places found near ${destination.properties.name}. Try another name or address.${!canGenerate ? " Enable AI in your profile to search venue websites too." : ""}`,
          );
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "Could not search places.",
        );
    } finally {
      if (!controller.signal.aborted) {
        setSearching(false);
        setResearchingPlaces(false);
      }
    }
  }

  function choosePlace(place: ActivityPlaceResult) {
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
    const links = editor?.value.properties.links ?? [];
    updateEditor({
      placeName: place.label.slice(0, 200),
      locationSuggestion: null,
      links: [place.source, place.locationSource].reduce(
        (current, source) =>
          source &&
          current.length < 20 &&
          !current.some((link) => link.url === source.url)
            ? [...current, source]
            : current,
        links,
      ),
      ...(!editor?.value.properties.name.trim()
        ? { name: (place.name ?? place.label.split(",")[0]).slice(0, 200) }
        : {}),
    });
    setPlaceQuery(place.label.slice(0, 200));
    setPlaces([]);
    setChosenPlace(place);
    setPlaceSearchActive(false);
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
    trackBehavior("activity_suggestions_started");
    setBusy(true);
    setError(undefined);
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
      trackBehavior("activity_suggestions_completed");
      if (destination.id === cityId)
        setActivityData({
          cityId,
          collection: await getActivities(trip.id, cityId),
        });
      dispatchToast(
        <Toast>
          <ToastTitle
            action={
              <ToastTrigger>
                <Button
                  aria-label="Dismiss activity summary"
                  icon={<Dismiss24Regular />}
                />
              </ToastTrigger>
            }
          >
            {kind === "image"
              ? "Photo import complete"
              : "Activity suggestions complete"}
          </ToastTitle>
          <ToastBody>
            {result.activities.features.length} activities added as Proposed.
            {result.warnings.length > 0 && (
              <ul>
                {result.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}
          </ToastBody>
        </Toast>,
        { intent: result.warnings.length ? "warning" : "success", timeout: -1 },
      );
      chooseImages([]);
      setPrompt("");
      setEditor(undefined);
    } catch (reason) {
      trackBehavior("activity_suggestions_failed");
      if (!(reason instanceof DOMException && reason.name === "AbortError"))
        notify(
          reason instanceof Error
            ? reason.message
            : "Could not generate activities.",
          "error",
        );
    } finally {
      setBusy(false);
      operationAbort.current = undefined;
    }
  }

  function chooseImages(files: File[]) {
    const accepted: File[] = [];
    const warnings: string[] = [];
    let totalBytes = 0;
    if (files.length > 10) {
      warnings.push(
        "Only the first 10 photos were accepted. Additional photos were not added (maximum 10).",
      );
    }
    for (const file of files.slice(0, 10)) {
      let reason: string | undefined;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        reason = "unsupported format. Choose JPEG, PNG, or WebP.";
      } else if (file.size === 0) {
        reason = "the file is empty.";
      } else if (file.size > 10_000_000) {
        reason = "exceeds the 10 MB limit per photo.";
      } else if (totalBytes + file.size > 50_000_000) {
        reason = "would exceed the 50 MB total upload limit.";
      }
      if (reason) {
        warnings.push(`${file.name}: not added because ${reason}`);
      } else {
        accepted.push(file);
        totalBytes += file.size;
      }
    }
    setImageWarnings(warnings);
    setImages(accepted);
    setImagePreviews(accepted.map((file) => URL.createObjectURL(file)));
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
    setChosenPlace(undefined);
    setPlaceSearchActive(false);
    setPlaceQuery("");
    setPrompt("");
    chooseImages([]);
  }
  function openAdd() {
    trackBehavior("activity_creation_started");
    placeAbort.current?.abort();
    setSearching(false);
    setError(undefined);
    setPrompt("");
    chooseImages([]);
    setPlaces([]);
    setChosenPlace(undefined);
    setPlaceSearchActive(false);
    setPlaceQuery("");
    setEntryMode("lookup");
    setEditor({ value: emptyActivity() });
  }

  function selectActivity(id: string) {
    setSelectedTravel(undefined);
    setMapCollapsed(false);
    setSelectedId(id);
    setShowMapCard(true);
  }

  function renderActivityMenu(item: Activity) {
    return canEdit ? (
      <Menu
        checkedValues={{ state: [item.properties.state] }}
        onCheckedValueChange={(_, data) => {
          if (data.checkedItems[0])
            void changeActivityState(item, data.checkedItems[0]);
        }}
      >
        <MenuTrigger disableButtonEnhancement>
          <MenuButton
            className="activity-state-menu-button"
            appearance="secondary"
            disabled={busy}
            aria-label={`State for ${item.properties.name}: ${item.properties.state}`}
          >
            {item.properties.state}
          </MenuButton>
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {Array.from(new Set(["Proposed", "Planned", "Rejected"])).map(
              (state) => (
                <MenuItemRadio key={state} name="state" value={state}>
                  {state}
                </MenuItemRadio>
              ),
            )}
            <MenuDivider />
            <MenuItem
              className="activity-delete-menu-item"
              icon={<Delete24Regular />}
              disabled={busy}
              onClick={() => {
                // Let the menu close and restore focus before opening a modal.
                window.setTimeout(() => setDeleteTarget(item), 0);
              }}
            >
              Delete activity
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    ) : (
      <span className="activity-state">{item.properties.state}</span>
    );
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
          <h3>{item.properties.name}</h3>
          {renderActivityMenu(item)}
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
            <dd>{formatDuration(item.properties.duration)}</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>{formatCost(item.properties.cost)}</dd>
          </div>
        </dl>
        <ActivityDetailsEvidence properties={item.properties} />
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
              appearance="secondary"
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
    const stay = destination?.properties.stays.find(
      (visit) => `stay:${visit.id}` === selectedId,
    )?.stayLocation;
    if (showMapCard && stay && !editor) {
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

  if (loading) return <ActivityWorkspaceSkeleton />;
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

  const deletionDialog = (
    <Dialog
      open={deleteOpen}
      onOpenChange={(_, data) => {
        if (!data.open && !busy) setDeleteTarget(undefined);
      }}
    >
      <DialogSurface
        mountNode={mapExpanded ? (fullscreenContainer ?? undefined) : undefined}
      >
        <DialogBody>
          <DialogTitle>Delete {deleteTarget?.properties.name}?</DialogTitle>
          <DialogContent>
            <p>
              This deletes the activity from the trip. This cannot be undone.
            </p>
          </DialogContent>
          <DialogActions>
            <Button
              ref={deleteCancelRef}
              disabled={busy}
              onClick={() => setDeleteTarget(undefined)}
            >
              Cancel
            </Button>
            <Button
              className="activity-delete-button"
              disabled={busy}
              onClick={() => void confirmActivityDeletion()}
            >
              {busy ? "Deleting…" : "Delete activity"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
  const activityDrawer = (
    <OverlayDrawer
      mountNode={mapExpanded ? (fullscreenContainer ?? undefined) : undefined}
      modalType={mapExpanded ? "modal" : "non-modal"}
      backdrop={null}
      open={editorOpen}
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
              ref={editorCloseRef}
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
        {editor && (
          <fieldset disabled={busy} className="activity-drawer-fields">
            {entryMode === "lookup" ? (
              <div className="activity-editor">
                <Field label="Activity or place name">
                  <SearchBox
                    placeholder="Search attractions, restaurants, or places"
                    maxLength={200}
                    value={placeQuery}
                    onChange={(_, data) => {
                      placeAbort.current?.abort();
                      setSearching(false);
                      setResearchingPlaces(false);
                      setPlaceQuery(data.value);
                      setPlaces([]);
                      setChosenPlace(undefined);
                      setError(undefined);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key !== "Enter" ||
                        event.nativeEvent.isComposing
                      )
                        return;
                      event.preventDefault();
                      if (!busy && !searching && placeQuery.trim())
                        void searchPlace();
                    }}
                  />
                </Field>
                <div className="activity-place-actions">
                  <Button
                    disabled={searching || !placeQuery.trim()}
                    onClick={() => void searchPlace()}
                  >
                    {searching ? "Searching…" : "Search places"}
                  </Button>
                  {canGenerate && (
                    <Button
                      disabled={searching || !placeQuery.trim()}
                      onClick={() => void searchPlace(true)}
                    >
                      Search web
                    </Button>
                  )}
                  {canGenerate && editor.value.id && !editor.value.geometry && (
                    <Button
                      disabled={busy || searching}
                      onClick={() => void researchLocation()}
                    >
                      {busy ? "Working…" : "Research saved activity location"}
                    </Button>
                  )}
                  {editor.value.geometry && <Text>Location selected</Text>}
                </div>
                {searching && (
                  <SearchResultsSkeleton
                    label={
                      researchingPlaces
                        ? "Researching places and addresses"
                        : "Loading place results"
                    }
                    appearance="places"
                  />
                )}
                {chosenPlace?.warning && <Text>{chosenPlace.warning}</Text>}
                {editor.value.properties.locationSuggestion &&
                  !editor.value.geometry && (
                    <section
                      className="activity-location-suggestion"
                      aria-label="Suggested location"
                    >
                      <Text weight="semibold">
                        Suggested location:{" "}
                        {editor.value.properties.locationSuggestion.venueName}
                      </Text>
                      <Text>
                        Published coordinates; entrance not verified. Review the
                        pin before saving.
                      </Text>
                      <Text>
                        {editor.value.properties.locationSuggestion.geometry.coordinates[1].toFixed(
                          6,
                        )}
                        ,{" "}
                        {editor.value.properties.locationSuggestion.geometry.coordinates[0].toFixed(
                          6,
                        )}
                      </Text>
                      <div className="activity-place-actions">
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={
                            editor.value.properties.locationSuggestion.source
                              .url
                          }
                        >
                          View coordinate source
                        </a>
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={activityMapLink(
                            editor.value.properties.locationSuggestion.geometry,
                            editor.value.properties.locationSuggestion
                              .venueName,
                          )}
                        >
                          Preview on map
                        </a>
                      </div>
                      <div className="activity-place-actions">
                        <Button
                          appearance="primary"
                          onClick={useSuggestedLocation}
                        >
                          Use this location
                        </Button>
                        <Button
                          onClick={() =>
                            updateEditor({ locationSuggestion: null })
                          }
                        >
                          Dismiss location
                        </Button>
                      </div>
                    </section>
                  )}
                {places.length > 0 && (
                  <div
                    className="activity-place-results"
                    aria-label="Place results"
                  >
                    {places.map((place, index) => (
                      <div
                        className="activity-place-result"
                        key={`${index}-${place.label}`}
                      >
                        <Button
                          aria-label={`${index + 1}. ${place.label}`}
                          disabled={
                            place.longitude === undefined ||
                            place.latitude === undefined
                          }
                          onClick={() => choosePlace(place)}
                        >
                          <span aria-hidden="true">{index + 1}.</span>
                          <PlaceSearchResult place={place} />
                        </Button>
                        {place.mapAddress &&
                          place.mapAddress !== place.address && (
                            <Text size={200}>
                              Map address: {place.mapAddress}
                            </Text>
                          )}
                        {place.warning && (
                          <Text size={200}>{place.warning}</Text>
                        )}
                        {place.source && (
                          <a
                            href={place.source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Source for {place.name ?? place.label}
                          </a>
                        )}
                        {place.locationSource && (
                          <a
                            href={place.locationSource.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Map location source for {place.name ?? place.label}
                          </a>
                        )}
                      </div>
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
                <ActivityDetailsResearch
                  key={editor.value.id ?? "new"}
                  tripId={trip.id}
                  destination={destination}
                  activity={editor.value}
                  etag={editor.etag}
                  canResearch={canGenerate}
                  busy={busy}
                  onBusyChange={setBusy}
                  onChange={updateEditor}
                  notify={notify}
                />
                <div className="activity-editor-grid">
                  <ActivityDurationSlider
                    value={editor.value.properties.duration}
                    disabled={busy}
                    onChange={(duration) => updateEditor({ duration })}
                  />
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
                    <select
                      value={editor.value.properties.cost?.currency ?? ""}
                      disabled={!editor.value.properties.cost}
                      onChange={(event) =>
                        updateEditor({
                          cost: editor.value.properties.cost
                            ? {
                                ...editor.value.properties.cost,
                                currency: event.target.value,
                              }
                            : null,
                        })
                      }
                    >
                      <option value="" disabled>
                        Select currency
                      </option>
                      {currencies.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency} — {currencyNames.of(currency)}
                        </option>
                      ))}
                    </select>
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
                            new Set(["Proposed", "Planned", "Rejected"]),
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
                      Up to 10 images · 10 MB each · 50 MB total. Only
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
                    {imageWarnings.length > 0 && (
                      <div role="alert">
                        {imageWarnings.map((warning) => (
                          <p key={warning}>{warning}</p>
                        ))}
                      </div>
                    )}
                    {images.length > 0 && (
                      <Text role="status">
                        {images.length} of 10 photos ready to upload
                      </Text>
                    )}
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
        {busy && (
          <div
            className="activity-drawer-progress"
            role="status"
            aria-live="polite"
          >
            {entryMode === "lookup" ? (
              <Text>Saving activity…</Text>
            ) : (
              <Spinner
                size="small"
                label={
                  entryMode === "image"
                    ? "Extracting activities from your photos…"
                    : "Generating activities…"
                }
              />
            )}
            {entryMode !== "lookup" && (
              <Text size={200}>
                Please wait while we find activities and resolve their
                locations.
              </Text>
            )}
          </div>
        )}
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
  );

  return (
    <section className="activity-planning" aria-label="Activity planning">
      {toaster}
      <TabList
        aria-label="Destinations"
        selectedValue={destination.id}
        onTabSelect={(_, data) => selectDestination(String(data.value))}
        className="activity-destination-tabs"
      >
        {destinations.features.map((item) => (
          <Tab value={item.id} key={item.id} disabled={busy}>
            <span className="activity-tab-label">
              <strong>{item.properties.name}</strong>
              <small>{destinationDates(item)}</small>
            </span>
          </Tab>
        ))}
      </TabList>
      <TabList
        aria-label="Activity views"
        selectedValue={activityView}
        onTabSelect={(_, data) => {
          setActivityView(String(data.value));
          setSelectedTravel(undefined);
          setShowMapCard(false);
        }}
      >
        <Tab value="ideas">Ideas</Tab>
        <Tab value="daily">Plan</Tab>
      </TabList>
      {error && !editor && <Text role="alert">{error}</Text>}
      <Button
        className="activity-map-toggle"
        aria-expanded={!mapCollapsed}
        aria-controls={mapPanelId}
        icon={mapCollapsed ? <ChevronDown24Regular /> : <ChevronUp24Regular />}
        onClick={() => setMapCollapsed((collapsed) => !collapsed)}
      >
        {mapCollapsed ? "Show map" : "Hide map"}
      </Button>
      <ResizableActivityWorkspace
        mapCollapsed={mapCollapsed}
        mapPanelId={mapPanelId}
      >
        <div ref={mapPanel} id={mapPanelId} className="activity-map-panel">
          <ActivityMap
            center={destination.geometry}
            destinationName={destination.properties.name}
            stayLocations={destination.properties.stays.flatMap((visit) =>
              visit.stayLocation
                ? [{ ...visit.stayLocation, id: visit.id }]
                : [],
            )}
            activities={activitiesForMap}
            placeSearch={placeSearch}
            portalHost={mapExpanded && active ? fullscreenMapHost : undefined}
            route={routePreview.route}
            routeLoading={routePreview.loading}
            routeError={routePreview.error}
            routeLabel={routeSelection?.label}
            onClearRoute={
              routeSelection ? () => setSelectedTravel(undefined) : undefined
            }
            selectedId={chosenPlace && draftOnMap ? draftOnMap.id : selectedId}
            onSelect={selectActivity}
          />
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
          {activityView === "daily" ? (
            <DailyActivityPlan
              key={`${trip.id}-${destination.id}`}
              tripId={trip.id}
              destinationId={destination.id}
              destination={destination}
              activities={activities.features}
              readOnly={!canEdit}
              useAiAllowed={canGenerate}
              onSelect={selectActivity}
              selectedRouteKey={
                routeSelection ? activityRouteKey(routeSelection) : undefined
              }
              onPlanChange={() => setSelectedTravel(undefined)}
              onSelectTravel={(selection) => {
                setSelectedTravel({ cityId: destination.id, selection });
                setSelectedId(undefined);
                setShowMapCard(false);
                setMapCollapsed(false);
              }}
              onChooseActivities={() => setActivityView("ideas")}
              onSaved={async () => {
                const collection = await getActivities(trip.id, destination.id);
                setActivityData({ cityId: destination.id, collection });
              }}
            />
          ) : (
            <>
              <div className="activity-cards-heading">
                <Title2 as="h2">Activities</Title2>
                {canEdit && (
                  <div className="activity-cards-actions">
                    <Button
                      appearance="primary"
                      disabled={busy}
                      onClick={openAdd}
                    >
                      Add activity
                    </Button>
                    {canGenerate && missingLocations && (
                      <Button
                        appearance="secondary"
                        disabled={busy}
                        onClick={() => void findMissingLocations()}
                      >
                        Find location
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {locationProgress && (
                <p role="status">
                  Finding locations: {locationProgress.completed} of{" "}
                  {locationProgress.total}
                </p>
              )}
              <ul
                className="activity-cards activity-state-groups"
                aria-label={`${destination.properties.name} activities`}
              >
                {groupedActivities.map(([state, items], groupIndex) => {
                  const key = JSON.stringify([cityId, state]);
                  const expanded = !collapsedStates.has(key);
                  const contentId = `${stateGroupsId}-${groupIndex}`;
                  return (
                    <li key={state} className="activity-state-group">
                      <h3>
                        <Button
                          className="activity-state-group-toggle"
                          appearance="secondary"
                          icon={
                            expanded ? (
                              <ChevronDown24Regular />
                            ) : (
                              <ChevronRight24Regular />
                            )
                          }
                          aria-label={`${state} activities`}
                          aria-expanded={expanded}
                          aria-controls={contentId}
                          onClick={() =>
                            setCollapsedStates((current) => {
                              const next = new Set(current);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        >
                          <span>{state}</span>
                          <span className="activity-state-group-count">
                            {items.length}
                          </span>
                        </Button>
                      </h3>
                      <ul
                        id={contentId}
                        className="activity-state-group-items"
                        aria-label={`${state} activities`}
                        hidden={!expanded}
                      >
                        {items.map(({ item, index }) => (
                          <li key={item.id} className="activity-list-item">
                            <div className="activity-list-heading">
                              <button
                                type="button"
                                className="activity-list-select"
                                aria-label={item.properties.name}
                                aria-pressed={selectedId === item.id}
                                onClick={() => selectActivity(item.id)}
                              >
                                <span
                                  className="activity-number"
                                  aria-hidden="true"
                                >
                                  {index + 1}
                                </span>
                                <span>{item.properties.name}</span>
                              </button>
                              {renderActivityMenu(item)}
                            </div>
                            {!item.geometry && (
                              <div className="activity-list-location">
                                <span>Needs location · Not on map</span>
                                {canEdit && (
                                  <Button
                                    appearance="secondary"
                                    size="small"
                                    disabled={busy}
                                    aria-label={`${item.properties.locationSuggestion ? "Review" : "Set"} location for ${item.properties.name}`}
                                    onClick={() => void openEdit(item)}
                                  >
                                    {item.properties.locationSuggestion
                                      ? "Review location"
                                      : "Set location"}
                                  </Button>
                                )}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
              {activities.features.length === 0 && (
                <Text className="activity-empty">
                  {canEdit
                    ? "No activities yet. Add an activity to start planning."
                    : "No activities yet."}
                </Text>
              )}
            </>
          )}
        </section>
      </ResizableActivityWorkspace>
      {!mapExpanded && deletionDialog}
      <Dialog
        open={mapExpanded && active}
        modalType={editor || deleteTarget ? "non-modal" : "modal"}
        onOpenChange={(_, data) => {
          if (!editor && !deleteTarget) setMapExpanded(data.open);
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
              disabled={Boolean(editor || deleteTarget)}
              onClick={() => setMapExpanded(false)}
            />
          </div>
          <div
            className="activity-fullscreen-canvas"
            ref={setFullscreenMapHost}
          >
            {renderMapDetails()}
          </div>
          {/* Portal overlays must share the map's React parent as well as its DOM parent. */}
          {mapExpanded && deletionDialog}
          {mapExpanded && activityDrawer}
        </DialogSurface>
      </Dialog>
      {!mapExpanded && activityDrawer}
    </section>
  );
}
