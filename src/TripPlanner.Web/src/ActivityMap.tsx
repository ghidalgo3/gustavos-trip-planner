import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@fluentui/react-components";
import { useSystemDarkMode } from "./useSystemDarkMode";
import { getMapToken } from "./api";
import type { Activity, Point, StayLocation } from "./activitiesApi";

type Marker = { getElement?: () => HTMLElement };
type MapEvent = { position?: [number, number]; error?: Error };
type MapHandle = {
  events: {
    add: (event: string, callback: (event: MapEvent) => void) => void;
  };
  markers: { add: (marker: Marker) => void; clear: () => void };
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
  activities,
  selectedId,
  onSelect,
  onPick,
  stayLocation,
}: {
  stayLocation?: StayLocation | null;
  center: Point;
  destinationName?: string;
  activities: Activity[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onPick?: (point: Point) => void;
}) {
  const darkMode = useSystemDarkMode();
  const style = darkMode ? "grayscale_dark" : "grayscale_light";
  const styleRef = useRef(style);
  const framedMap = useRef<MapHandle | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<MapHandle | null>(null);
  const callbacks = useRef({ onSelect, onPick });
  const [atlas, setAtlas] = useState<Atlas>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const longitude = center.coordinates[0];
  const latitude = center.coordinates[1];

  useEffect(() => {
    styleRef.current = style;
    if (ready) map.current?.setStyle({ style });
  }, [style, ready]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !stayLocation || framedMap.current === instance)
      return;
    const points = [
      center.coordinates,
      stayLocation.geometry.coordinates,
      ...activities.flatMap((activity) =>
        activity.geometry ? [activity.geometry.coordinates] : [],
      ),
    ];
    instance.setCamera({
      bounds: [
        Math.min(...points.map((point) => point[0])),
        Math.min(...points.map((point) => point[1])),
        Math.max(...points.map((point) => point[0])),
        Math.max(...points.map((point) => point[1])),
      ],
      padding: 48,
      maxZoom: 11,
    });
    framedMap.current = instance;
  }, [ready, stayLocation, activities, center]);

  useEffect(() => {
    callbacks.current = { onSelect, onPick };
  }, [onSelect, onPick]);

  useEffect(() => {
    let active = true;
    void loadAtlas()
      .then((loaded) => {
        if (active) setAtlas(loaded);
      })
      .catch(() => {
        if (active)
          setError("Map unavailable. Activities remain available in the list.");
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
    void getMapToken(undefined, retry > 0)
      .then((token) => {
        if (!active || !element.current) return;
        const instance = new atlas.Map(element.current, {
          center: [longitude, latitude],
          zoom: 11,
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
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(() => instance.resize());
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
      map.current?.dispose();
      map.current = null;
    };
    // Recreate only when the destination or SDK changes.
  }, [atlas, longitude, latitude, retry]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !atlas || !ready) return;
    instance.markers.clear();
    for (const [index, activity] of activities.entries()) {
      if (!activity.geometry) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "activity-map-marker";
      button.textContent = String(index + 1);
      button.title = `${index + 1}. ${activity.properties.name}`;
      button.setAttribute("aria-label", `Select ${activity.properties.name}`);
      if (activity.id === selectedId) button.dataset.selected = "true";
      button.onclick = () => callbacks.current.onSelect(activity.id);
      instance.markers.add(
        new atlas.HtmlMarker({
          position: activity.geometry.coordinates,
          htmlContent: button,
        }),
      );
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
      instance.markers.add(
        new atlas.HtmlMarker({
          position: stayLocation.geometry.coordinates,
          htmlContent: button,
        }),
      );
    }
  }, [atlas, ready, activities, selectedId, stayLocation]);

  return (
    <div className="activity-map-shell">
      <div
        ref={element}
        className="activity-map"
        role="img"
        aria-label={
          destinationName ? `Map of ${destinationName}` : "Activity map"
        }
        aria-busy={!ready && !error}
      />
      {!ready && !error && (
        <div className="activity-map-loading" role="status">
          <Spinner label="Loading map" />
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
    </div>
  );
}
