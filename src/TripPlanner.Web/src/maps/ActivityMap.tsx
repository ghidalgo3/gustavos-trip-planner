import ContentSkeleton from "../shared/components/ContentSkeleton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { useSystemDarkMode } from "../shared/hooks/useSystemDarkMode";
import { useReducedMotion } from "../shared/hooks/useReducedMotion";
import {
  AnimatedMapMarkers,
  type MapMarkerDescription,
} from "./AnimatedMapMarkers";
import { getMapToken } from "../api/api";
import PersistentMapSurface from "./PersistentMapSurface";
import type {
  Activity,
  Point,
  StayLocation,
} from "../features/activities/activitiesApi";

export type PlaceSearch = {
  results: { label: string; longitude?: number; latitude?: number }[];
  onSelect: (index: number) => void;
};

type Marker = { getElement?: () => HTMLElement };
type MapEvent = { position?: [number, number]; error?: Error };
type MapHandle = {
  events: {
    add: (event: string, callback: (event: MapEvent) => void) => void;
  };
  markers: { add: (marker: Marker) => void; remove: (marker: Marker) => void };
  setCamera: (options: object) => void;
  setStyle: (options: object) => void;
  dispose: () => void;
  resize: () => void;
};
type Atlas = {
  Map: new (container: HTMLElement, options: object) => MapHandle;
  HtmlMarker: new (options: object) => Marker;
};

let atlasPromise: Promise<Atlas> | undefined;
function loadAtlas(): Promise<Atlas> {
  if (window.atlas) return Promise.resolve(window.atlas);
  if (!atlasPromise)
    atlasPromise = new Promise<Atlas>((resolve, reject) => {
      if (!document.querySelector('link[data-azure-map="true"]')) {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href =
          "https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.css";
        css.dataset.azureMap = "true";
        document.head.append(css);
      }
      const script = document.createElement("script");
      script.src =
        "https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.js";
      const fail = () => {
        window.clearTimeout(timeout);
        script.remove();
        reject(new Error("Map controls did not load."));
      };
      const timeout = window.setTimeout(fail, 15_000);
      script.onload = () => {
        window.clearTimeout(timeout);
        if (window.atlas) resolve(window.atlas);
        else fail();
      };
      script.onerror = fail;
      document.head.append(script);
    }).catch((reason: unknown) => {
      atlasPromise = undefined;
      throw reason;
    });
  return atlasPromise!;
}

declare global {
  interface Window {
    atlas?: Atlas;
  }
}

export default function ActivityMap({
  center,
  destinationName,
  activities: savedActivities,
  selectedId,
  onSelect,
  onPick,
  stayLocation: savedStayLocation,
  placeSearch,
  portalHost,
  zoom = 11,
}: {
  stayLocation?: StayLocation | null;
  center: Point;
  destinationName?: string;
  activities: Activity[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onPick?: (point: Point) => void;
  placeSearch?: PlaceSearch;
  portalHost?: HTMLElement | null;
  zoom?: number;
}) {
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
  const stayLocation = placeSearch ? undefined : savedStayLocation;
  const darkMode = useSystemDarkMode();
  const reducedMotion = useReducedMotion();
  const style = darkMode ? "grayscale_dark" : "grayscale_light";
  const styleRef = useRef(style);
  const framedMap = useRef<{ instance: MapHandle; positions: string } | null>(
    null,
  );
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<MapHandle | null>(null);
  const markerTransitions = useRef<AnimatedMapMarkers<Marker> | null>(null);
  const centerRef = useRef(center.coordinates);
  const zoomRef = useRef(zoom);
  const callbacks = useRef({ onSelect, onPick, placeSearch });
  const [atlas, setAtlas] = useState<Atlas>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const longitude = center.coordinates[0];
  const latitude = center.coordinates[1];
  const locatedCount = activities.filter(
    (activity) => activity.geometry,
  ).length;
  const missingCount = activities.length - locatedCount;
  const points = useMemo(
    () => [
      ...(!placeSearch || activities.length === 0
        ? [[longitude, latitude]]
        : []),
      ...(stayLocation ? [stayLocation.geometry.coordinates] : []),
      ...activities.flatMap((activity) =>
        activity.geometry ? [activity.geometry.coordinates] : [],
      ),
    ],
    [longitude, latitude, stayLocation, activities, placeSearch],
  );
  const positions = JSON.stringify({ points, zoom });
  const fitActivities = useCallback(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    instance.setCamera({
      bounds: [
        Math.min(...points.map((point) => point[0])),
        Math.min(...points.map((point) => point[1])),
        Math.max(...points.map((point) => point[0])),
        Math.max(...points.map((point) => point[1])),
      ],
      padding: 48,
      maxZoom: zoom,
      type: reducedMotion ? "jump" : "ease",
      duration: reducedMotion ? 0 : 650,
    });
  }, [points, ready, reducedMotion, zoom]);

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
        framedMap.current.positions === positions)
    )
      return;
    // An empty map starts at its destination already. Later destination changes pan.
    if (
      framedMap.current?.instance !== instance &&
      !stayLocation &&
      locatedCount === 0
    ) {
      framedMap.current = { instance, positions };
      return;
    }
    fitActivities();
    framedMap.current = { instance, positions };
  }, [
    ready,
    stayLocation,
    locatedCount,
    positions,
    fitActivities,
    placeSearch,
  ]);

  useEffect(() => {
    callbacks.current = { onSelect, onPick, placeSearch };
  }, [onSelect, onPick, placeSearch]);

  useEffect(() => {
    let active = true;
    void loadAtlas()
      .then((loaded) => {
        if (active) setAtlas(loaded);
      })
      .catch(() => {
        if (active) setError("Map unavailable. Please retry.");
      });
    return () => {
      active = false;
    };
  }, [retry]);

  useEffect(() => {
    if (!atlas || !element.current) return;
    let active = true;
    setError(undefined);
    setReady(false);
    const timeout = window.setTimeout(() => {
      if (active) setError("The map is taking too long to load. Please retry.");
    }, 20_000);
    let observer: ResizeObserver | undefined;
    let resizeFrame = 0;
    void getMapToken(undefined, retry > 0)
      .then((token) => {
        if (!active || !element.current) return;
        const instance = new atlas.Map(element.current, {
          center: centerRef.current,
          zoom: zoomRef.current,
          style: styleRef.current,
          view: "Auto",
          authOptions: {
            authType: "sas",
            sasToken: token.token,
            getToken: (
              resolve: (token: string) => void,
              reject: (error: unknown) => void,
            ) => {
              void getMapToken(undefined, true)
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
        });
        map.current = instance;
        markerTransitions.current = new AnimatedMapMarkers(
          ({ position, button }) => {
            const marker = new atlas.HtmlMarker({
              position,
              htmlContent: button,
            });
            instance.markers.add(marker);
            return marker;
          },
          (marker) => instance.markers.remove(marker),
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
      markerTransitions.current = null;
      map.current?.dispose();
      map.current = null;
    };
    // Keep the map alive across destination changes so its camera can animate.
  }, [atlas, retry]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !atlas || !ready) return;
    const descriptions: MapMarkerDescription[] = [];
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
    if (stayLocation) {
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
      if (selectedId === "stay") button.dataset.selected = "true";
      button.onclick = () => callbacks.current.onSelect("stay");
      descriptions.push({
        key: "stay",
        position: stayLocation.geometry.coordinates,
        button,
      });
    }
    markerTransitions.current?.update(descriptions, reducedMotion);
  }, [
    atlas,
    ready,
    activities,
    selectedId,
    stayLocation,
    placeSearch,
    reducedMotion,
  ]);

  return (
    <PersistentMapSurface host={portalHost}>
      <div
        ref={element}
        className="activity-map"
        role="img"
        aria-label={
          destinationName ? `Map of ${destinationName}` : "Activity map"
        }
        aria-busy={!ready && !error}
      />
      {ready && !error && activities.length > 0 && (
        <div className="activity-map-summary">
          <span>
            {placeSearch
              ? `${activities.length} search results`
              : `${locatedCount} of ${activities.length} activities located`}
          </span>
          {missingCount > 0 && (
            <span>
              {missingCount} {missingCount === 1 ? "needs" : "need"} a location
              to appear on the map.
            </span>
          )}
          {locatedCount > 0 && (
            <Button appearance="secondary" size="small" onClick={fitActivities}>
              Show all locations
            </Button>
          )}
        </div>
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
