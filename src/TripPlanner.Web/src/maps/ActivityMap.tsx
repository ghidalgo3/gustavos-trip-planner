import type { ActivityRoutePreview } from "../features/activities/activityRouteApi";
import ContentSkeleton from "../shared/components/ContentSkeleton";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@fluentui/react-components";
import { useSystemDarkMode } from "../shared/hooks/useSystemDarkMode";
import { useReducedMotion } from "../shared/hooks/useReducedMotion";
import {
  activityConnections,
  connectionFeature,
  flowingConnections,
} from "./activityConnections";
import {
  AnimatedMapMarkers,
  type MapMarkerDescription,
} from "./AnimatedMapMarkers";
import { mapsClient } from "./mapsClient";
import type {
  MapControl,
  MapHandle,
  MapOptions,
  MapStyle,
} from "./IMapsClient";
import PersistentMapSurface from "./PersistentMapSurface";
import { DestinationFlight, destinationCamera } from "./destinationFlight";
import type {
  Activity,
  Point,
  StayLocation,
} from "../features/activities/activitiesApi";

export type PlaceSearch = {
  results: { label: string; longitude?: number; latitude?: number }[];
  onSelect: (index: number) => void;
};

export type MapLandmark = {
  id: string;
  label: string;
  pin: string;
  geometry: Point;
};

const noLandmarks: MapLandmark[] = [];
const openStreetMapCountries = new Set(["KR"]);

type ActivityMapProps = {
  stayLocation?: StayLocation | null;
  stayLocations?: StayLocation[];
  center: Point;
  destinationName?: string;
  destinationId?: string;
  countryCodes?: (string | undefined)[];
  activities: Activity[];
  connectActivities?: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
  onPick?: (point: Point) => void;
  placeSearch?: PlaceSearch;
  portalHost?: HTMLElement | null;
  zoom?: number;
  route?: ActivityRoutePreview;
  routeLabel?: string;
  routeLoading?: boolean;
  routeError?: string;
  onClearRoute?: () => void;
  landmarks?: MapLandmark[];
};

export default function ActivityMap(props: ActivityMapProps) {
  const openStreetMap =
    props.countryCodes?.some(
      (code) => code && openStreetMapCountries.has(code.trim().toUpperCase()),
    ) ?? false;

  return (
    <ActivityMapContent
      key={openStreetMap ? "openstreetmap" : "azure"}
      {...props}
      openStreetMap={openStreetMap}
    />
  );
}

function ActivityMapContent({
  center,
  destinationName,
  destinationId,
  openStreetMap,
  activities: savedActivities,
  connectActivities = false,
  selectedId,
  onSelect,
  onPick,
  stayLocation: savedStayLocation,
  stayLocations: savedStayLocations,
  placeSearch,
  portalHost,
  zoom = 11,
  route,
  routeLabel,
  routeLoading,
  routeError,
  onClearRoute,
  landmarks = noLandmarks,
}: ActivityMapProps & { openStreetMap: boolean }) {
  const activities = useMemo(
    () =>
      placeSearch
        ? placeSearch.results.map((place, index) => ({
            id: String(index),
            geometry:
              place.longitude !== undefined && place.latitude !== undefined
                ? {
                    type: "Point" as const,
                    coordinates: [place.longitude, place.latitude] as [
                      number,
                      number,
                    ],
                  }
                : null,
            properties: { name: place.label },
          }))
        : savedActivities,
    [placeSearch, savedActivities],
  );
  const stayLocations = useMemo(
    () =>
      placeSearch
        ? []
        : (savedStayLocations ??
          (savedStayLocation ? [savedStayLocation] : [])),
    [placeSearch, savedStayLocations, savedStayLocation],
  );
  const darkMode = useSystemDarkMode();
  const reducedMotion = useReducedMotion();
  const style = darkMode ? "grayscale_dark" : "grayscale_light";
  const styleRef = useRef<MapStyle["style"]>(style);
  const framedMap = useRef<{
    instance: MapHandle;
    positions: string;
    destination?: string;
  } | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<MapHandle | null>(null);
  const flight = useRef<DestinationFlight | null>(null);
  const destinationKey = destinationId ?? destinationName;
  const routeWasShown = useRef(false);
  const markerTransitions = useRef<AnimatedMapMarkers<
    ReturnType<MapHandle["addMarker"]>
  > | null>(null);
  const centerRef = useRef(center.coordinates);
  const zoomRef = useRef(zoom);
  const callbacks = useRef({ onSelect, onPick, placeSearch });
  const [control, setControl] = useState<MapControl>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const longitude = center.coordinates[0];
  const latitude = center.coordinates[1];
  const locatedCount = activities.filter(
    (activity) => activity.geometry,
  ).length;
  const points = useMemo(
    () => [
      ...(!placeSearch || activities.length === 0
        ? [[longitude, latitude]]
        : []),
      ...stayLocations.map((stay) => stay.geometry.coordinates),
      ...activities.flatMap((activity) =>
        activity.geometry ? [activity.geometry.coordinates] : [],
      ),
      ...(!placeSearch || activities.length === 0
        ? landmarks.map((landmark) => landmark.geometry.coordinates)
        : []),
    ],
    [longitude, latitude, stayLocations, activities, placeSearch, landmarks],
  );
  const positions = JSON.stringify({ points, zoom });
  const fitActivities = useCallback(
    (immediate = false) => {
      const instance = map.current;
      if (!instance || !ready) return;
      flight.current?.cancel();
      instance.setCamera({
        bounds: [
          Math.min(...points.map((point) => point[0])),
          Math.min(...points.map((point) => point[1])),
          Math.max(...points.map((point) => point[0])),
          Math.max(...points.map((point) => point[1])),
        ],
        padding: 48,
        maxZoom: zoom,
        type: reducedMotion || immediate ? "jump" : "ease",
        duration: reducedMotion || immediate ? 0 : 650,
      });
    },
    [points, ready, reducedMotion, zoom],
  );

  useEffect(() => {
    centerRef.current = [longitude, latitude];
    zoomRef.current = zoom;
  }, [longitude, latitude, zoom]);

  useEffect(() => {
    styleRef.current = style;
    if (ready) map.current?.setStyle({ style });
  }, [style, ready]);

  useEffect(() => {
    const instance = map.current;
    if (
      !ready ||
      !instance ||
      (placeSearch && locatedCount === 0) ||
      (framedMap.current?.instance === instance &&
        framedMap.current.positions === positions &&
        framedMap.current.destination === destinationKey)
    )
      return;
    // An empty map starts at its destination already. Later destination changes pan.
    if (
      framedMap.current?.instance !== instance &&
      stayLocations.length === 0 &&
      locatedCount === 0 &&
      landmarks.length === 0
    ) {
      framedMap.current = { instance, positions, destination: destinationKey };
      return;
    }
    const changedDestination =
      framedMap.current?.instance === instance &&
      framedMap.current.destination !== destinationKey;
    const visible = Boolean(
      element.current?.clientWidth && element.current?.clientHeight,
    );
    if (changedDestination && !reducedMotion && visible && flight.current) {
      flight.current.start(points as [number, number][], zoom);
    } else if (flight.current?.active && !reducedMotion) {
      flight.current.retarget(points as [number, number][], zoom);
    } else {
      fitActivities(changedDestination && !visible);
    }
    framedMap.current = { instance, positions, destination: destinationKey };
  }, [
    ready,
    stayLocations,
    locatedCount,
    positions,
    fitActivities,
    placeSearch,
    destinationKey,
    points,
    reducedMotion,
    zoom,
    landmarks,
  ]);

  useEffect(() => {
    callbacks.current = { onSelect, onPick, placeSearch };
  }, [onSelect, onPick, placeSearch]);

  useEffect(() => {
    if (reducedMotion && flight.current?.active) fitActivities();
  }, [reducedMotion, fitActivities]);

  useEffect(() => {
    const surface = element.current;
    if (!ready || !surface) return;
    const cancel = () => flight.current?.cancel();
    surface.addEventListener("pointerdown", cancel);
    surface.addEventListener("wheel", cancel, { passive: true });
    return () => {
      surface.removeEventListener("pointerdown", cancel);
      surface.removeEventListener("wheel", cancel);
    };
  }, [ready]);

  useEffect(() => {
    let active = true;
    const loading = openStreetMap
      ? import("./OpenStreetMapControl").then(
          ({ openStreetMapControl }) => openStreetMapControl,
        )
      : mapsClient.loadControl();
    void loading
      .then((loaded) => {
        if (active) setControl(loaded);
      })
      .catch(() => {
        if (active) setError("Map unavailable. Please retry.");
      });
    return () => {
      active = false;
    };
  }, [openStreetMap, retry]);

  useEffect(() => {
    if (!control || !element.current) return;
    let active = true;
    setError(undefined);
    setReady(false);
    const timeout = window.setTimeout(() => {
      if (active) setError("The map is taking too long to load. Please retry.");
    }, 20_000);
    let observer: ResizeObserver | undefined;
    let resizeFrame = 0;
    const credentials = openStreetMap
      ? Promise.resolve(undefined)
      : mapsClient.getToken(undefined, retry > 0);
    void credentials
      .then((token) => {
        if (!active || !element.current) return;
        const azureOptions: Pick<MapOptions, "view" | "authOptions"> = token
          ? {
              view: "Auto",
              authOptions: {
                authType: "sas",
                sasToken: token.token,
                getToken: (resolve, reject) => {
                  void mapsClient
                    .getToken(undefined, true)
                    .then((fresh) => resolve(fresh.token))
                    .catch((reason: unknown) => {
                      if (active)
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : "The map token could not be refreshed.",
                        );
                      reject(reason);
                    });
                },
              },
            }
          : {};
        const instance = control.createMap(element.current, {
          center: centerRef.current,
          zoom: zoomRef.current,
          style: styleRef.current,
          ...azureOptions,
        });
        map.current = instance;
        flight.current = new DestinationFlight(instance, () => ({
          width: element.current?.clientWidth ?? 0,
          height: element.current?.clientHeight ?? 0,
        }));
        markerTransitions.current = new AnimatedMapMarkers(
          ({ position, button }) =>
            instance.addMarker({
              position,
              htmlContent: button,
            }),
          (marker) => marker.remove(),
        );
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(([entry]) => {
            // Hidden trip tabs have no viewport; wait until the map is visible again.
            if (
              !entry ||
              entry.contentRect.width <= 0 ||
              entry.contentRect.height <= 0
            )
              return;
            window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(() => {
              if (active) instance.resize();
            });
          });
          observer.observe(element.current);
        }
        instance.events.add("ready", () => {
          window.clearTimeout(timeout);
          if (active) {
            instance.resize();
            setReady(true);
          }
        });
        instance.events.add("error", (event) => {
          window.clearTimeout(timeout);
          if (active)
            setError(event.error?.message ?? "Map tiles could not be loaded.");
        });
        instance.events.add("click", (event) => {
          if (event.position && callbacks.current.onPick)
            callbacks.current.onPick({
              type: "Point",
              coordinates: event.position,
            });
        });
      })
      .catch((reason: unknown) => {
        window.clearTimeout(timeout);
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Map unavailable.",
          );
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      observer?.disconnect();
      window.cancelAnimationFrame(resizeFrame);
      markerTransitions.current?.dispose();
      flight.current?.cancel();
      flight.current = null;
      markerTransitions.current = null;
      map.current?.dispose();
      map.current = null;
    };
    // Keep the map alive across destination changes so its camera can animate.
  }, [control, openStreetMap, retry]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    const descriptions: MapMarkerDescription[] = [];
    for (const landmark of landmarks) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "activity-map-marker activity-map-landmark";
      button.textContent = landmark.pin;
      button.title = landmark.label;
      button.setAttribute("aria-label", landmark.label);
      button.onclick = () => callbacks.current.onSelect(landmark.id);
      descriptions.push({
        key: `landmark:${landmark.id}`,
        position: landmark.geometry.coordinates,
        button,
      });
    }
    for (const [index, activity] of activities.entries()) {
      if (!activity.geometry) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "activity-map-marker";
      button.textContent = String(index + 1);
      button.title = `${index + 1}. ${activity.properties.name}`;
      button.setAttribute("aria-label", `Select ${activity.properties.name}`);
      if (!placeSearch && activity.id === selectedId)
        button.dataset.selected = "true";
      button.onclick = () => {
        if (callbacks.current.placeSearch)
          callbacks.current.placeSearch.onSelect(index);
        else callbacks.current.onSelect(activity.id);
      };
      descriptions.push({
        key: placeSearch
          ? `search:${activity.id}:${activity.properties.name}`
          : `activity:${activity.id}`,
        position: activity.geometry.coordinates,
        button,
      });
    }
    for (const stayLocation of stayLocations) {
      const stayKey = savedStayLocations ? `stay:${stayLocation.id}` : "stay";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "activity-map-marker activity-map-stay";
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("width", "20");
      icon.setAttribute("height", "20");
      icon.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", "M3 5v14M21 19v-8H3m0 4h18M7 11V8h4v3m2 0V8h4v3");
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      icon.append(path);
      button.append(icon);
      button.title = `Stay: ${stayLocation.properties.name}`;
      button.setAttribute("aria-label", button.title);
      if (selectedId === stayKey) button.dataset.selected = "true";
      button.onclick = () => callbacks.current.onSelect(stayKey);
      descriptions.push({
        key: stayKey,
        position: stayLocation.geometry.coordinates,
        button,
      });
    }
    markerTransitions.current?.update(descriptions, reducedMotion);
  }, [
    ready,
    activities,
    selectedId,
    stayLocations,
    savedStayLocations,
    placeSearch,
    reducedMotion,
    landmarks,
  ]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !connectActivities || placeSearch || route)
      return;
    const connections = activityConnections(
      activities.map((activity) => activity.geometry),
    );
    if (!connections.length) return;

    const line = instance.addLine([connectionFeature(connections)], {
      strokeColor: darkMode ? "#60cdff" : "#005a9e",
      strokeWidth: 4,
      lineCap: "round",
    });
    let frame = 0;
    const flow = reducedMotion
      ? undefined
      : instance.addLine([], {
          strokeColor: darkMode ? "#ffffff" : "#8aeaff",
          strokeWidth: 3,
          lineCap: "round",
        });
    if (flow) {
      const began = performance.now();
      let lastFrame = began;
      const animate = (time: number) => {
        if (time - lastFrame >= 32) {
          flow.setFeatures(flowingConnections(connections, time - began));
          lastFrame = time;
        }
        frame = requestAnimationFrame(animate);
      };
      frame = requestAnimationFrame(animate);
    }
    return () => {
      cancelAnimationFrame(frame);
      if (map.current !== instance) return;
      flow?.remove();
      line.remove();
    };
  }, [
    ready,
    connectActivities,
    placeSearch,
    route,
    activities,
    darkMode,
    reducedMotion,
  ]);

  const restoreMap = useEffectEvent(() => fitActivities());
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    if (!route) {
      if (routeWasShown.current && !flight.current?.active) restoreMap();
      routeWasShown.current = false;
      return;
    }
    flight.current?.cancel();
    const line = instance.addLine(
      [{ type: "Feature", geometry: route.geometry, properties: {} }],
      {
        strokeColor: darkMode ? "#60cdff" : "#0067c0",
        strokeWidth: 5,
        ...(route.mode === "walking" ? { strokeDashArray: [2, 2] } : {}),
      },
    );
    const points = route.geometry.coordinates.flat();
    // Padding switches Azure to bounds fitting; the flight camera already
    // accounts for padding, so bounds-only options must stay in the other branch.
    instance.setCamera({
      ...(route.mode === "flight"
        ? destinationCamera(
            points,
            {
              width: element.current?.clientWidth ?? 0,
              height: element.current?.clientHeight ?? 0,
            },
            14,
          )
        : {
            bounds: [
              Math.min(...points.map((p) => p[0])),
              Math.min(...points.map((p) => p[1])),
              Math.max(...points.map((p) => p[0])),
              Math.max(...points.map((p) => p[1])),
            ],
            padding: 64,
            maxZoom: 16,
          }),
      type: reducedMotion ? "jump" : "ease",
      duration: reducedMotion ? 0 : 650,
    });
    routeWasShown.current = true;
    return () => {
      if (map.current !== instance) return;
      line.remove();
    };
  }, [ready, route, darkMode, reducedMotion]);

  return (
    <PersistentMapSurface host={portalHost}>
      <div
        ref={element}
        className="activity-map"
        role={openStreetMap ? "region" : "img"}
        aria-label={
          destinationName ? `Map of ${destinationName}` : "Activity map"
        }
        aria-busy={!ready && !error}
      />
      {routeLabel && (
        <section
          className="activity-map-route"
          aria-label="Selected travel route"
          aria-busy={routeLoading}
        >
          <div>
            <strong>{routeLabel}</strong>
            {routeLoading ? (
              <div
                className="activity-route-skeleton"
                role="status"
                aria-label="Loading route"
              >
                <span />
                <span />
              </div>
            ) : routeError ? (
              <p role="alert">{routeError}</p>
            ) : route ? (
              <p>
                {route.mode === "flight"
                  ? "Illustrative flight path"
                  : route.mode === "walking"
                    ? "Walking"
                    : route.mode === "taxi"
                      ? "Taxi / rideshare"
                      : "Driving"}
                {route.mode === "flight" ? "" : " route"}
              </p>
            ) : null}
          </div>
          {onClearRoute && (
            <Button appearance="secondary" size="small" onClick={onClearRoute}>
              Close route
            </Button>
          )}
        </section>
      )}
      {!ready && !error && (
        <div className="activity-map-loading">
          <ContentSkeleton label="Loading map" layout="map" />
        </div>
      )}
      {error && (
        <div className="activity-map-error" role="alert">
          <span>{error}</span>
          <Button
            onClick={() => {
              setError(undefined);
              setReady(false);
              setRetry((current) => current + 1);
            }}
          >
            Retry map
          </Button>
        </div>
      )}
    </PersistentMapSurface>
  );
}
