import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  OverlayDrawer,
  SearchBox,
  Select,
  Tab,
  TabList,
  Tag,
  TagGroup,
  Text,
  Title2,
  ToggleButton,
  useId,
} from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowExpand24Regular,
  Delete24Regular,
  Dismiss24Regular,
  Share24Regular,
  Search24Regular,
} from "@fluentui/react-icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { PlaceSuggestion, Trip } from "../../api/api";
import {
  useExplicitResourceRefresh,
  useTripResourceVersion,
} from "../../api/tripDocumentStore";
import ActivityMap from "../../maps/ActivityMap";
import { activityMapLink } from "../../maps/activityMapLink";
import { mapsClient } from "../../maps/mapsClient";
import PlaceSearchResultButton from "../../shared/components/PlaceSearchResultButton";
import SearchResultsSkeleton from "../../shared/components/SearchResultsSkeleton";
import { useActionToast } from "../../shared/hooks/useActionToast";
import { durationMinutes } from "../../shared/time/durations";
import { trackBehavior } from "../../telemetry/telemetry";
import { destinationDates, tripSpansMultipleYears } from "../trips/tripDates";
import CityIcon from "../../shared/components/CityIcon";
import { ActivityDetailsEvidence } from "./ActivityDetailsEvidence";
import ActivityTextField from "./ActivityTextField";
import ActivityDurationSlider from "./ActivityDurationSlider";
import ActivityLinksEditor from "./ActivityLinksEditor";
import ActivityKindsPicker from "./ActivityKindsPicker";
import { ActivityWorkspaceSkeleton } from "./ActivityPlanningSkeletons";
import DailyActivityPlan from "./DailyActivityPlan";
import ResizableActivityWorkspace from "./ResizableActivityWorkspace";
import { activityMatchesSearch } from "./activitySearch";
import { activityStatus, activityStatuses } from "./activityStatus";
import {
  deleteActivity,
  getActivities,
  getActivity,
  getDestinations,
  saveActivity,
  type Activity,
  type ActivityCollection,
  type ActivityCost,
  type ActivityInput,
  type ActivityLink,
  type Destination,
  type DestinationCollection,
} from "./activitiesApi";
import { validActivityKinds, type TicketRequirement } from "./activityKinds";
import { validActivityLink } from "./activityLinks";
import {
  useActivityRoute,
  type ActivityRouteSelection,
} from "./activityRouteApi";

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
    notes: "",
    cost: null,
    state: "Maybe",
    kinds: [],
    address: null,
    ticketRequirement: "Unknown",
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
  onDestinationChange,
  active = true,
}: {
  trip: Trip;
  readOnly: boolean;
  onDestinationChange?: (destination: Destination | undefined) => void;
  active?: boolean;
}) {
  const documentVersion = useTripResourceVersion(
    `/trips/${trip.id}/destinations`,
  );
  const [query, setQuery] = useSearchParams();
  const [activityView, setActivityView] = useState("ideas");
  const [excludedStatuses, setExcludedStatuses] = useState<Set<string>>(
    new Set(),
  );
  const [destinations, setDestinations] =
    useState<DestinationCollection | null>();
  const [activityData, setActivityData] = useState<{
    cityId: string;
    collection: ActivityCollection;
  }>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

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
  const [activitySearch, setActivitySearch] = useState("");
  const [activitySearchOpen, setActivitySearchOpen] = useState(false);
  const activitySearchInput = useRef<HTMLInputElement>(null);
  const activitySearchButton = useRef<HTMLButtonElement>(null);
  const activityList = useRef<HTMLUListElement>(null);
  const activityHeading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activitySearchOpen && activityView === "ideas" && active) {
      activitySearchInput.current?.focus();
    }
  }, [activitySearchOpen, activityView, active]);
  const mapPanelId = useId("activity-map-panel");
  const mapPanel = useRef<HTMLDivElement>(null);
  const [fullscreenContainer, setFullscreenContainer] =
    useState<HTMLDivElement | null>(null);
  const [fullscreenMapHost, setFullscreenMapHost] =
    useState<HTMLDivElement | null>(null);
  const { notify, toaster } = useActionToast();
  const [showMapCard, setShowMapCard] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [searching, setSearching] = useState(false);

  const [chosenPlace, setChosenPlace] = useState<ActivityPlaceResult>();
  const [placeSearchActive, setPlaceSearchActive] = useState(false);
  const placeAbort = useRef<AbortController | undefined>(undefined);
  const [placeQuery, setPlaceQuery] = useState("");
  const [places, setPlaces] = useState<ActivityPlaceResult[]>([]);

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
  useLayoutEffect(() => {
    const list = activityList.current;
    const heading = activityHeading.current;
    if (!list || !heading) return;
    // Match the actual list width inside its scrollbar across browser settings.
    const measure = () => {
      heading.style.width =
        list.clientWidth > 0 ? `${list.clientWidth}px` : "100%";
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [active, activityView, cityId, loading]);
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
  const searchText = activitySearch.trim().toLocaleLowerCase();
  const matchingActivities = activities.features
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => activityMatchesSearch(item, searchText));
  const visibleActivities = matchingActivities.filter(
    ({ item }) => !excludedStatuses.has(item.properties.state),
  );
  const selected = activities.features.find((item) => item.id === selectedId);
  const canEdit = !readOnly && destination?.properties.isActive === true;
  const editorStatus = activityStatus(
    editor?.value.properties.state ?? "Maybe",
  );

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
  }, [trip.id, active, documentVersion]);

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
  }, [trip.id, cityId, active, documentVersion]);

  useEffect(
    () => () => {
      placeAbort.current?.abort();
    },
    [],
  );

  const savedActivitiesForMap =
    activityView === "daily"
      ? activities.features.filter(
          (activity) => activity.properties.state === "Yes",
        )
      : activities.features;
  const draftOnMap =
    editor && editor.value.geometry
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
    editor && canEdit && placeSearchActive
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

  function dismissActivitySearch() {
    setActivitySearch("");
    setActivitySearchOpen(false);
    requestAnimationFrame(() => activitySearchButton.current?.focus());
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
    if (
      !destination ||
      !editor ||
      busy ||
      !editor.value.properties.name.trim() ||
      !validActivityKinds(editor.value.properties.kinds)
    )
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

  async function searchPlace() {
    if (!destination || !placeQuery.trim() || busy || searching) return;
    setPlaceSearchActive(true);
    setShowMapCard(false);
    placeAbort.current?.abort();
    const controller = new AbortController();
    placeAbort.current = controller;
    setSearching(true);
    setError(undefined);
    setPlaces([]);
    setChosenPlace(undefined);
    try {
      const results = await mapsClient.searchPlaces(
        placeQuery.trim(),
        controller.signal,
        destination.geometry.coordinates,
        destination.properties.countryCode,
      );
      if (!controller.signal.aborted) {
        setPlaces(results);
        if (!results.length)
          setError("No matching places found. Try another name or address.");
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
      address: place.address ?? null,
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
  }
  function openAdd() {
    trackBehavior("activity_creation_started");
    placeAbort.current?.abort();
    setSearching(false);
    setError(undefined);

    setPlaces([]);
    setChosenPlace(undefined);
    setPlaceSearchActive(false);
    setPlaceQuery("");

    setEditor({ value: emptyActivity() });
  }

  function selectActivity(id: string) {
    setSelectedTravel(undefined);
    setSelectedId(id);
    setShowMapCard(true);
  }

  function openIdea(item: Activity) {
    if (busy) return;
    if (canEdit) void openEdit(item);
    else selectActivity(item.id);
  }

  function renderActivityMenu(item: Activity) {
    const status = activityStatus(item.properties.state);
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
            icon={<status.Icon />}
            aria-label={`Status for ${item.properties.name}: ${status.label}`}
          >
            <span className="activity-status-label">{status.label}</span>
          </MenuButton>
        </MenuTrigger>
        <MenuPopover onClick={(event) => event.stopPropagation()}>
          <MenuList className="activity-status-menu" hasCheckmarks={false}>
            {activityStatuses.map((status) => (
              <MenuItemRadio
                key={status.value}
                name="state"
                value={status.value}
                checkmark={null}
                icon={<status.Icon />}
              >
                {status.label}
              </MenuItemRadio>
            ))}
            <MenuDivider />
            <MenuItem
              className="activity-delete-menu-item"
              aria-label="Remove activity"
              icon={<Delete24Regular />}
              disabled={busy}
              onClick={() => {
                // Let the menu close and restore focus before opening a modal.
                window.setTimeout(() => setDeleteTarget(item), 0);
              }}
            >
              Remove
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    ) : (
      <span className="activity-state">
        <status.Icon aria-hidden="true" />
        {status.label}
      </span>
    );
  }

  function renderActivityCard(item: Activity, index: number) {
    const mapLink = activityMapLink(item.geometry, item.properties.name);
    return (
      <li
        key={item.id}
        className={`activity-card interactive-card${selectedId === item.id ? " selected" : ""}`}
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("a, button")
          )
            return;
          selectActivity(item.id);
        }}
      >
        <button
          type="button"
          className="card-action card-overlay"
          aria-label={`Show ${item.properties.name} on map`}
          onClick={() => selectActivity(item.id)}
        />
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
        <TagGroup
          className="activity-kinds"
          aria-label="Activity kinds"
          size="small"
        >
          {item.properties.kinds.map((kind) => (
            <Tag
              key={kind}
              value={kind}
              appearance="outline"
              className="activity-kind-tag"
            >
              {kind}
            </Tag>
          ))}
        </TagGroup>
        {item.properties.address && <p>{item.properties.address}</p>}
        {!item.geometry && (
          <small className="activity-location-missing">Needs location</small>
        )}
        {item.properties.description && (
          <p className="activity-card-description">
            {item.properties.description}
          </p>
        )}
        {item.properties.notes && (
          <div className="activity-card-notes">
            <strong>Notes</strong>
            <p>{item.properties.notes}</p>
          </div>
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
        <p>
          Tickets:{" "}
          {item.properties.ticketRequirement === "NotRequired"
            ? "Not required"
            : item.properties.ticketRequirement}
        </p>
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
        {error && <Text role="alert">{error}</Text>}
        {editor && (
          <fieldset disabled={busy} className="activity-drawer-fields">
            {
              <div className="activity-editor">
                <label>
                  Activity name
                  <Input
                    value={editor.value.properties.name}
                    maxLength={200}
                    onChange={(_, data) => updateEditor({ name: data.value })}
                  />
                </label>
                <Field label="Find a place">
                  <SearchBox
                    placeholder="Search attractions, restaurants, or places"
                    maxLength={200}
                    value={placeQuery}
                    onChange={(_, data) => {
                      placeAbort.current?.abort();
                      setSearching(false);

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

                  {editor.value.geometry && <Text>Location selected</Text>}
                </div>
                {searching && (
                  <SearchResultsSkeleton
                    label={"Loading place results"}
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
                    className="place-search-results"
                    aria-label="Place results"
                  >
                    {places.map((place, index) => (
                      <div
                        className="place-search-result-row"
                        key={`${index}-${place.label}`}
                      >
                        <PlaceSearchResultButton
                          place={place}
                          index={index}
                          disabled={
                            place.longitude === undefined ||
                            place.latitude === undefined
                          }
                          onClick={() => choosePlace(place)}
                        />
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
                <ActivityKindsPicker
                  value={editor.value.properties.kinds}
                  disabled={busy}
                  onChange={(kinds) => updateEditor({ kinds })}
                />
                <label>
                  Address
                  <Input
                    value={editor.value.properties.address ?? ""}
                    maxLength={2000}
                    onChange={(_, data) =>
                      updateEditor({ address: data.value || null })
                    }
                  />
                </label>
                <label>
                  Tickets
                  <Select
                    value={editor.value.properties.ticketRequirement}
                    onChange={(_, data) =>
                      updateEditor({
                        ticketRequirement: data.value as TicketRequirement,
                      })
                    }
                  >
                    <option value="Unknown">Unknown</option>
                    <option value="Required">Required</option>
                    <option value="NotRequired">Not required</option>
                  </Select>
                </label>
                <ActivityTextField
                  label="Description"
                  value={editor.value.properties.description}
                  onChange={(description) => updateEditor({ description })}
                />
                <ActivityTextField
                  label="Notes"
                  value={editor.value.properties.notes}
                  onChange={(notes) => updateEditor({ notes })}
                />

                <ActivityDetailsEvidence properties={editor.value.properties} />
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
                    <span id="activity-state-label">Status</span>
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
                          aria-label={`Status: ${editorStatus.label}`}
                          aria-labelledby="activity-state-label activity-state-value"
                          icon={<editorStatus.Icon />}
                        >
                          <span id="activity-state-value">
                            {editorStatus.label}
                          </span>
                        </MenuButton>
                      </MenuTrigger>
                      <MenuPopover>
                        <MenuList
                          className="activity-status-menu"
                          hasCheckmarks={false}
                        >
                          {activityStatuses.map((status) => (
                            <MenuItemRadio
                              key={status.value}
                              name="state"
                              value={status.value}
                              checkmark={null}
                              icon={<status.Icon />}
                            >
                              {status.label}
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
            }
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
            {<Text>Saving activity…</Text>}
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
        {
          <Button
            appearance="primary"
            disabled={
              busy ||
              !editor?.value.properties.name.trim() ||
              !validActivityKinds(editor?.value.properties.kinds) ||
              (editor?.value.properties.links ?? []).some(
                (link) => !validActivityLink(link),
              )
            }
            onClick={() => void save()}
          >
            Save activity
          </Button>
        }
      </DrawerFooter>
    </OverlayDrawer>
  );

  const includeDestinationYears = tripSpansMultipleYears(
    trip,
    destinations.features,
  );
  return (
    <section
      className={`activity-planning${activityView === "daily" ? " activity-calendar-view" : ""}`}
      aria-label="Activity planning"
    >
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
              <CityIcon
                name={item.properties.name}
                countryCode={item.properties.countryCode}
              />
              <strong>{item.properties.name}</strong>
              <small>{destinationDates(item, includeDestinationYears)}</small>
            </span>
          </Tab>
        ))}
      </TabList>
      <TabList
        aria-label="Activity views"
        appearance="filled-circular"
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
      <ResizableActivityWorkspace mapPanelId={mapPanelId}>
        <div ref={mapPanel} id={mapPanelId} className="activity-map-panel">
          <ActivityMap
            center={destination.geometry}
            destinationName={destination.properties.name}
            destinationId={destination.id}
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

              onSelect={selectActivity}
              onPlanChange={() => setSelectedTravel(undefined)}
              onSelectTravel={(selection) => {
                setSelectedTravel({ cityId: destination.id, selection });
                setSelectedId(undefined);
                setShowMapCard(false);
              }}
              onChooseActivities={() => setActivityView("ideas")}
              onSaved={async () => {
                const collection = await getActivities(trip.id, destination.id);
                setActivityData({ cityId: destination.id, collection });
              }}
            />
          ) : (
            <>
              <div ref={activityHeading} className="activity-cards-heading">
                <div
                  className="activity-cards-toolbar"
                  aria-hidden={activitySearchOpen || undefined}
                  inert={activitySearchOpen}
                >
                  <Title2 as="h2">Activities</Title2>
                  <div className="activity-cards-actions">
                    {canEdit && (
                      <Button
                        appearance="primary"
                        icon={<Add24Regular />}
                        disabled={busy}
                        onClick={openAdd}
                      >
                        Add activity
                      </Button>
                    )}
                    <Button
                      ref={activitySearchButton}
                      appearance="outline"
                      icon={<Search24Regular />}
                      aria-label="Search activities"
                      title="Search activities"
                      onClick={() => setActivitySearchOpen(true)}
                    />
                  </div>
                </div>
                {activitySearchOpen && (
                  <div className="activity-search-toolbar">
                    <SearchBox
                      ref={activitySearchInput}
                      className="activity-list-search"
                      aria-label="Search activities"
                      placeholder="Search activities"
                      dismiss={null}
                      value={activitySearch}
                      onChange={(_, data) => setActivitySearch(data.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          dismissActivitySearch();
                        }
                      }}
                    />
                    <Button
                      appearance="outline"
                      icon={<Dismiss24Regular />}
                      aria-label="Clear and dismiss activity search"
                      title="Clear and dismiss search"
                      onClick={dismissActivitySearch}
                    />
                  </div>
                )}
                <div
                  className="activity-status-filters"
                  role="group"
                  aria-label="Filter activities by status"
                >
                  {activityStatuses.map((status) => {
                    const count = matchingActivities.filter(
                      ({ item }) => item.properties.state === status.value,
                    ).length;
                    return (
                      <ToggleButton
                        key={status.value}
                        className="activity-status-filter"
                        shape="circular"
                        icon={<status.Icon />}
                        checked={!excludedStatuses.has(status.value)}
                        aria-label={`${status.label} activities: ${count}`}
                        onClick={() =>
                          setExcludedStatuses((current) => {
                            const next = new Set(current);
                            if (next.has(status.value))
                              next.delete(status.value);
                            else next.add(status.value);
                            return next;
                          })
                        }
                      >
                        {status.label}
                        <span className="activity-status-filter-count">
                          {count}
                        </span>
                      </ToggleButton>
                    );
                  })}
                </div>
              </div>
              <ul
                ref={activityList}
                className="activity-cards"
                aria-label={`${destination.properties.name} activities`}
              >
                {visibleActivities.map(({ item, index }) => (
                  <li
                    key={item.id}
                    className="activity-list-item interactive-card"
                    onClick={(event) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest("a, button")
                      )
                        return;
                      openIdea(item);
                    }}
                  >
                    <button
                      type="button"
                      className="card-action card-overlay"
                      aria-label={item.properties.name}
                      aria-pressed={selectedId === item.id}
                      disabled={busy}
                      onClick={() => openIdea(item)}
                    />
                    <div className="activity-list-heading">
                      <span className="activity-list-title">
                        <span className="activity-number" aria-hidden="true">
                          {index + 1}
                        </span>
                        <span>{item.properties.name}</span>
                      </span>
                      {renderActivityMenu(item)}
                    </div>
                    <TagGroup
                      className="activity-kinds"
                      aria-label="Activity kinds"
                      size="small"
                    >
                      {item.properties.kinds.map((kind) => (
                        <Tag
                          key={kind}
                          value={kind}
                          appearance="outline"
                          className="activity-kind-tag"
                        >
                          {kind}
                        </Tag>
                      ))}
                    </TagGroup>
                    {item.properties.address && (
                      <p>{item.properties.address}</p>
                    )}
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
              {activities.features.length > 0 &&
                visibleActivities.length === 0 && (
                  <Text className="activity-empty" role="status">
                    {excludedStatuses.size > 0
                      ? "No activities match your filters."
                      : "No activities match your search."}
                  </Text>
                )}
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
