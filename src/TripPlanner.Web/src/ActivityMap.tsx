import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { getMapToken } from "./api";
import type { Activity, Point } from "./activitiesApi";

type Marker = { getElement?: () => HTMLElement };
type MapEvent = { position?: [number, number]; error?: Error };
type MapHandle = {
  events: {
    add: (event: string, callback: (event: MapEvent) => void) => void;
  };
  markers: { add: (marker: Marker) => void; clear: () => void };
  setCamera: (options: object) => void;
  dispose: () => void;
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
      script.onload = () =>
        window.atlas
          ? resolve(window.atlas)
          : reject(new Error("Map controls did not load."));
      script.onerror = () => reject(new Error("Map controls did not load."));
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
  activities,
  selectedId,
  onSelect,
  onPick,
}: {
  center: Point;
  activities: Activity[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onPick?: (point: Point) => void;
}) {
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
    void getMapToken()
      .then((token) => {
        if (!active || !element.current) return;
        const instance = new atlas.Map(element.current, {
          center: [longitude, latitude],
          zoom: 11,
          view: "Auto",
          authOptions: {
            authType: "sas",
            sasToken: token.token,
            getToken: (
              resolve: (token: string) => void,
              reject: (error: unknown) => void,
            ) => {
              void getMapToken()
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
        instance.events.add("ready", () => {
          if (active) setReady(true);
        });
        instance.events.add("error", (event) => {
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
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Map unavailable.",
          );
      });
    return () => {
      active = false;
      map.current?.dispose();
      map.current = null;
    };
    // Recreate only when the destination or SDK changes.
  }, [atlas, longitude, latitude, retry]);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !atlas || !ready) return;
    instance.markers.clear();
    for (const activity of activities) {
      if (!activity.geometry) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "activity-map-marker";
      button.textContent = activity.properties.name;
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
  }, [atlas, ready, activities, selectedId]);

  return (
    <div className="activity-map-shell">
      <div
        ref={element}
        className="activity-map"
        role="img"
        aria-label="Activity map"
      />
      {error && (
        <div className="activity-map-error" role="alert">
          <span>{error}</span>
          <Button onClick={() => setRetry((current) => current + 1)}>
            Retry map
          </Button>
        </div>
      )}
    </div>
  );
}
