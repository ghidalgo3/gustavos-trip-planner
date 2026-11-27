import {
  divIcon,
  map as createLeafletMap,
  marker,
  polyline,
  tileLayer,
  type Map as LeafletMap,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import "./openStreetMap.css";
import type { MapCamera, MapControl } from "./IMapsClient";

const tileUrl =
  import.meta.env.VITE_OPENSTREETMAP_TILE_URL ||
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const attribution =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

// The shared camera uses a 512-pixel world at zoom zero; Leaflet uses 256.
const zoomOffset = 1;

export const openStreetMapControl: MapControl = {
  createMap(container, { center, zoom, style }) {
    const map = createLeafletMap(container, {
      zoomControl: false,
      zoomSnap: 0,
      minZoom: zoomOffset,
      maxZoom: 19,
      trackResize: false,
    }).setView(toLatLng(center), zoom + zoomOffset);

    const tiles = tileLayer(tileUrl, { attribution }).addTo(map);
    map.attributionControl?.setPrefix(false);
    setStyle(style === "grayscale_dark");

    function setStyle(dark: boolean) {
      container.classList.toggle("openstreetmap-dark", dark);
    }

    let hasTiles = false;
    tiles.once("tileload", () => {
      hasTiles = true;
    });

    return {
      events: {
        add(event, callback) {
          if (event === "ready") tiles.once("tileload", () => callback({}));
          if (event === "error") {
            tiles.once("load", () => {
              if (!hasTiles)
                callback({
                  error: new Error("Map tiles could not be loaded."),
                });
            });
          }
          if (event === "click")
            map.on("click", ({ latlng }) => {
              callback({ position: [latlng.wrap().lng, latlng.lat] });
            });
        },
      },
      setStyle: ({ style }) => setStyle(style === "grayscale_dark"),
      getCamera() {
        const center = map.getCenter().wrap();
        return {
          center: [center.lng, center.lat],
          zoom: map.getZoom() - zoomOffset,
        };
      },
      setCamera({
        center,
        zoom,
        bounds,
        padding = 0,
        maxZoom,
        type,
        duration = 0,
      }) {
        const options = { animate: type === "ease", duration: duration / 1000 };
        if (bounds) {
          const [west, south, east, north] = bounds;
          const shift = worldOffset((west + east) / 2, map.getCenter().lng);
          map.fitBounds(
            [
              [south, west + shift],
              [north, east + shift],
            ],
            {
              ...options,
              padding: [padding, padding],
              maxZoom: maxZoom === undefined ? undefined : maxZoom + zoomOffset,
            },
          );
        } else if (center && zoom !== undefined) {
          map.setView(
            toLatLng(center, map.getCenter().lng),
            zoom + zoomOffset,
            options,
          );
        }
      },
      stop: () => map.stop(),
      resize: () => map.invalidateSize(),
      dispose() {
        tiles.off();
        map.remove();
        map.off();
        container.classList.remove("openstreetmap-dark");
      },
      addMarker({ position, htmlContent }) {
        const pin = marker(toLatLng(position, map.getCenter().lng), {
          icon: divIcon({
            html: htmlContent,
            className: "openstreetmap-marker",
            iconSize: [44, 44],
          }),
          keyboard: false,
          autoPanOnFocus: false,
        }).addTo(map);
        return updateWithWorldCopy(map, pin, (longitude) =>
          pin.setLatLng(toLatLng(position, longitude)),
        );
      },
      addLine(features, options) {
        const line = polyline([], {
          color: options.strokeColor,
          weight: options.strokeWidth,
          dashArray: options.strokeDashArray?.map(
            (length) => length * options.strokeWidth,
          ),
          lineCap: options.lineCap,
          interactive: false,
        }).addTo(map);
        const draw = (longitude: number) => {
          line.setLatLngs(
            features.flatMap(({ geometry }) =>
              geometry.coordinates.flatMap((segment) => {
                if (!segment.length) return [];
                const shift = worldOffset(segment[0][0], longitude);
                return [
                  segment.map(
                    ([lng, lat]) => [lat, lng + shift] as [number, number],
                  ),
                ];
              }),
            ),
          );
        };
        draw(map.getCenter().lng);
        return {
          ...updateWithWorldCopy(map, line, draw),
          setFeatures(shapes) {
            features = shapes;
            draw(map.getCenter().lng);
          },
        };
      },
    };
  },
};

function toLatLng(
  [lng, lat]: MapCamera["center"],
  near = lng,
): [number, number] {
  return [lat, lng + worldOffset(lng, near)];
}

function worldOffset(lng: number, near: number) {
  return 360 * Math.round((near - lng) / 360);
}

// Tiles repeat at the antimeridian. Keep pins and split flight lines in the
// visible copy of the world when the camera crosses it.
function updateWithWorldCopy(
  map: LeafletMap,
  layer: { remove: () => void },
  update: (longitude: number) => void,
) {
  const move = () => update(map.getCenter().lng);
  map.on("moveend", move);
  return {
    remove() {
      map.off("moveend", move);
      layer.remove();
    },
  };
}
