import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FareLeg } from "../../api/operationsApi";
import { FlightMapPreviewContext } from "../flights/FlightMapPreviewContext";
import {
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Skeleton,
  SkeletonItem,
  Tab,
  TabList,
  Text,
} from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import {
  useExplicitResourceRefresh,
  useTripResourceVersion,
} from "../../api/tripDocumentStore";
import type { Point } from "../activities/activitiesApi";
import type { ActivityRoutePreview } from "../activities/activityRouteApi";
import { mapsClient } from "../../maps/mapsClient";
import TripPlanning from "../flights/TripPlanning";
import TrainTransportForm from "./TrainTransportForm";
import TransportMap from "./TransportMap";
import {
  transportEndpoint,
  transportForLeg,
  transportRoute,
  transportDuration,
  type StationMapSearch,
  type TransportStop,
} from "./destinationTransportModel";
import {
  estimateTransportation,
  listTransportation,
  saveTransportation,
  type Transportation,
  type TransportationFeature,
} from "./transportationApi";
import "./transportation.css";
const modes = {
  flight: "Flight",
  train: "Train",
  car: "Car",
  walk: "Walking",
  "arranged-separately": "Arranged separately",
};
type Mode = keyof typeof modes;

export default function DestinationTransport({
  tripId,
  from,
  to,
  readOnly,
  flights,
  homeUserId,
  nextAction,
}: {
  tripId: string;
  from: TransportStop;
  to: TransportStop;
  readOnly: boolean;
  flights: string;
  homeUserId: string;
  nextAction?: boolean;
}) {
  const version = useTripResourceVersion(`/trips/${tripId}`);
  const tabsId = useId();
  const [value, setValue] = useState<Transportation>();
  const [editBase, setEditBase] = useState<Transportation>();
  const refreshEditor = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [open, setOpen] = useState(false);
  const [draftMode, setDraftMode] = useState<Mode>();
  const [retry, setRetry] = useState(0);
  const [stationSearch, setStationSearch] = useState<StationMapSearch>();
  const [hoveredFlight, setHoveredFlight] = useState<FareLeg>();
  const [focusedFlight, setFocusedFlight] = useState<FareLeg>();
  const flightPreviewCallbacks = useMemo(
    () => ({ onHover: setHoveredFlight, onFocus: setFocusedFlight }),
    [],
  );
  const [trainEndpoints, setTrainEndpoints] = useState<TransportationFeature[]>(
    [],
  );
  const [preview, setPreview] = useState<{
    mode: Mode;
    route: ActivityRoutePreview;
  }>();
  const title = `${from.city ?? "Home"} → ${to.city ?? "Home"}`;
  useEffect(() => {
    let active = true;
    listTransportation(tripId)
      .then((result) => {
        if (!active) return;
        const current = transportForLeg(
          Array.isArray(result?.data) ? result.data : [],
          from.stayId,
          to.stayId,
        );
        setValue(current);
        if (refreshEditor.current) {
          setEditBase(current);
          refreshEditor.current = false;
        }
        setLoaded(true);
        setError("");
      })
      .catch(() => {
        if (active) {
          setError("Could not load transportation.");
          setLoaded(false);
        }
      });
    return () => {
      active = false;
    };
  }, [tripId, from.stayId, to.stayId, retry, version]);
  useExplicitResourceRefresh(
    `/trips/${tripId}/transportation/${value?.id ?? ""}`,
    () => {
      refreshEditor.current = true;
      setLoaded(false);
      setRetry((n) => n + 1);
    },
  );
  const mode = value?.mode ?? (flights ? "flight" : null);
  async function location(stop: TransportStop): Promise<Point> {
    if (stop.destination) return stop.destination.geometry;
    if (!stop.city)
      throw new Error("Set your home city before choosing transportation.");
    const candidates = await mapsClient.searchCities(stop.city);
    if (!candidates[0]) throw new Error("Could not locate your home city.");
    const point = await mapsClient.geocodeCity(candidates[0]);
    return { type: "Point", coordinates: [point.longitude, point.latitude] };
  }
  async function makeEndpoint(
    id: string,
    stop: TransportStop,
    mode: Mode,
  ): Promise<TransportationFeature> {
    if ((mode === "flight" || mode === "arranged-separately") && !stop.stayId)
      return {
        type: "Feature",
        id,
        geometry: null,
        properties: { reference: { kind: "home", id: homeUserId } },
      };
    return transportEndpoint(id, stop.city ?? "Home", await location(stop));
  }
  async function save(
    mode: Mode,
    train?: {
      features: TransportationFeature[];
      departureAt: string;
      arrivalAt: string;
    },
  ) {
    if (writing.current || readOnly || !loaded) return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const previous = editBase;
      const sameMode = previous?.mode === mode;
      let features =
        train?.features ??
        (sameMode
          ? previous.features
          : [
              await makeEndpoint("from", from, mode),
              await makeEndpoint("to", to, mode),
            ]);
      let duration = sameMode ? previous.duration : null;
      if (mode === "car" || mode === "walk") {
        const routePoint = (id: string, stop: TransportStop) => {
          const geometry = features.find(
            (feature) => feature.id === id,
          )?.geometry;
          return geometry?.type === "Point" ? geometry : location(stop);
        };
        const estimate = await estimateTransportation(
          tripId,
          await routePoint("from", from),
          await routePoint("to", to),
          mode,
        );
        if (!estimate.data)
          throw new Error("Travel time unavailable. Try again.");
        duration = estimate.data.duration;
        if (!estimate.data.geometry)
          throw new Error("The route could not be loaded. Try again.");
        const route = {
          mode: mode === "walk" ? "walking" : "driving",
          geometry: estimate.data.geometry,
        };
        setPreview({ mode, route });
        if (
          !sameMode ||
          !features.some(
            (feature) => feature.id !== "from" && feature.id !== "to",
          )
        ) {
          features = [
            ...features,
            {
              type: "Feature",
              id: "road-route",
              geometry: route.geometry,
              properties: { sequence: 0, mode, duration },
            },
          ];
        }
      }
      const request: Transportation = {
        ...(previous ?? {
          type: "FeatureCollection",
          id: "",
          notes: "",
          version: 0,
          etag: "",
          routeStale: false,
        }),
        name: previous?.name ?? title,
        mode,
        features,
        duration,
        departureDate: sameMode ? previous.departureDate : null,
        departureTime: sameMode ? previous.departureTime : null,
        timeZone: train
          ? (from.destination?.properties.timeZone ?? "UTC")
          : sameMode
            ? previous.timeZone
            : null,
        originStayId: from.stayId ?? null,
        destinationStayId: to.stayId ?? null,
        departureAt:
          train?.departureAt ?? (sameMode ? previous.departureAt : null),
        arrivalAt: train?.arrivalAt ?? (sameMode ? previous.arrivalAt : null),
      };
      const result = await saveTransportation(tripId, request, !previous);
      if (!result.data) throw new Error("Transportation could not be saved.");
      setValue(result.data);
      setEditBase(result.data);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save transportation. Try again.",
      );
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  function openDrawer() {
    setHoveredFlight(undefined);
    setFocusedFlight(undefined);
    setEditBase(value);
    setDraftMode(mode && mode in modes ? (mode as Mode) : undefined);
    setStationSearch(undefined);
    setPreview(undefined);
    setTrainEndpoints(
      value?.mode === "train"
        ? value.features.filter(
            (feature) => feature.id === "from" || feature.id === "to",
          )
        : [],
    );
    setOpen(true);
  }
  const route =
    preview && preview.mode === draftMode
      ? preview.route
      : draftMode === value?.mode
        ? transportRoute(value)
        : undefined;
  return (
    <li
      className="overview-transport"
      aria-label={`Transportation from ${from.city ?? "Home"} to ${to.city ?? "Home"}`}
      data-selected={!!mode}
    >
      {!loaded && !value && !error ? (
        <Skeleton
          aria-label="Loading transportation"
          className="transport-card-skeleton"
        >
          <SkeletonItem style={{ width: "65%", height: 20 }} />
          <SkeletonItem style={{ width: "35%", height: 20 }} />
        </Skeleton>
      ) : (
        <button
          type="button"
          className="overview-transport-card"
          data-next-action={nextAction || undefined}
          disabled={busy || !loaded}
          onClick={openDrawer}
        >
          <span className="transport-card-title">{title}</span>
          <span className="transport-summary">
            <span className="transport-mode-label" data-unfinished={!mode}>
              {mode ? (modes[mode as Mode] ?? mode) : "Choose transportation"}
            </span>
            {mode === "flight" && flights && (
              <span className="transport-flight-numbers">{flights}</span>
            )}
            {value?.duration && (
              <span>
                {transportDuration(value.duration)}
                {mode === "car" || mode === "walk" ? " estimated" : ""}
              </span>
            )}
          </span>
          {value?.mode === "train" && (
            <span>
              {value.features
                .filter(
                  (feature) => feature.id === "from" || feature.id === "to",
                )
                .map((feature) => feature.properties.name)
                .join(" → ")}
            </span>
          )}
          {value?.departureAt && (
            <span>
              Departure{" "}
              {new Date(value.departureAt).toLocaleString(undefined, {
                timeZone: value.timeZone ?? "UTC",
              })}{" "}
              ({value.timeZone ?? "UTC"})
            </span>
          )}
          {value?.arrivalAt && (
            <span>
              Arrival{" "}
              {new Date(value.arrivalAt).toLocaleString(undefined, {
                timeZone: to.destination?.properties.timeZone ?? "UTC",
              })}{" "}
              ({to.destination?.properties.timeZone ?? "UTC"})
            </span>
          )}
        </button>
      )}
      {error && !open && (
        <div className="transport-card-error">
          <Text role="alert">{error}</Text>
          <Button
            onClick={() => {
              if (!loaded) setRetry((n) => n + 1);
              else openDrawer();
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {open && (
        <OverlayDrawer
          open
          position="start"
          className="transport-drawer"
          onOpenChange={(_, data) => {
            if (!data.open && !busy) setOpen(false);
          }}
        >
          <DrawerHeader>
            <DrawerHeaderTitle
              action={
                <Button
                  className="transport-dismiss"
                  icon={<Dismiss24Regular />}
                  aria-label="Close transportation"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                />
              }
            >
              {title}
            </DrawerHeaderTitle>
          </DrawerHeader>
          <DrawerBody className="transport-drawer-body">
            <TabList
              className="transport-mode-tabs"
              aria-label="Transportation mode"
              selectedValue={draftMode ?? null}
              disabled={busy || !loaded}
              onTabSelect={(_, data) => {
                const selectedMode = data.value as Mode;
                setDraftMode(selectedMode);
                setHoveredFlight(undefined);
                setFocusedFlight(undefined);
                setStationSearch(undefined);
              }}
            >
              {Object.entries(modes).map(([key, label]) => (
                <Tab
                  key={key}
                  id={`${tabsId}-${key}`}
                  value={key}
                  aria-controls={`${tabsId}-panel`}
                >
                  {label}
                </Tab>
              ))}
            </TabList>
            <TransportMap
              flight={
                draftMode === "flight"
                  ? (hoveredFlight ?? focusedFlight)
                  : undefined
              }
              from={from}
              to={to}
              stations={draftMode === "train" ? trainEndpoints : []}
              search={draftMode === "train" ? stationSearch : undefined}
              route={route}
            />
            <div
              className="transport-editor"
              id={`${tabsId}-panel`}
              role="tabpanel"
              aria-labelledby={draftMode ? `${tabsId}-${draftMode}` : undefined}
            >
              {error && <Text role="alert">{error}</Text>}
              {busy && <Text role="status">Saving transportation…</Text>}
              {value?.duration && draftMode === value.mode && (
                <Text block>
                  {transportDuration(value.duration)}
                  {draftMode === "car" || draftMode === "walk"
                    ? " estimated"
                    : ""}
                </Text>
              )}
              {draftMode === "train" && (
                <TrainTransportForm
                  key={editBase?.etag ?? "new"}
                  from={from}
                  to={to}
                  existing={editBase?.mode === "train" ? editBase : undefined}
                  disabled={readOnly || busy || !loaded}
                  onEndpoints={setTrainEndpoints}
                  onMapSearch={setStationSearch}
                  activeSearchId={stationSearch?.id}
                  onSave={(details) => void save("train", details)}
                />
              )}
              {draftMode === "flight" && (
                <FlightMapPreviewContext.Provider
                  value={flightPreviewCallbacks}
                >
                  <TripPlanning
                    trip={{ id: tripId }}
                    readOnly={
                      readOnly || busy || (value?.mode !== "flight" && !flights)
                    }
                    onBack={() => setOpen(false)}
                  />
                </FlightMapPreviewContext.Provider>
              )}
              {value?.routeStale && draftMode === value.mode && (
                <Text role="status">Route details need review.</Text>
              )}
            </div>
          </DrawerBody>
          {draftMode && draftMode !== "train" && (
            <DrawerFooter>
              <Button
                appearance="primary"
                disabled={readOnly || busy || !loaded}
                onClick={() => void save(draftMode)}
              >
                Save
              </Button>
            </DrawerFooter>
          )}
        </OverlayDrawer>
      )}
    </li>
  );
}
