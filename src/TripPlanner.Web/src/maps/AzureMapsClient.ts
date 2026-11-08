import { tripFetch } from "../api/tripSnapshot";
import { apiBaseUrl } from "../api/config";
import type {
  CitySuggestion,
  PlaceSuggestion,
  MapToken,
  MapControl,
  MapsClient,
} from "./IMapsClient";

type MapsFeature = {
  id?: string;
  geometry?: { coordinates?: number[] } | null;
  properties?: {
    name?: string;
    address?: {
      locality?: string;
      formattedAddress?: string;
      countryRegionISO2?: string;
      countryRegion?: { ISO?: string; name?: string };
    };
  };
};

type MapsFeatureCollection = { features?: MapsFeature[] };

const usStates: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};
const usStateCodes = new Set(Object.values(usStates));

export function formatCityLabel(label: string, countryCode?: string): string {
  if (countryCode && countryCode.toUpperCase() !== "US") return label;
  const parts = label.split(",").map((part) => part.trim());
  const state = parts[1]?.replace(/\.$/, "").toLowerCase();
  const code = state && (usStates[state] ?? state.toUpperCase());
  if (code && usStateCodes.has(code)) parts[1] = code;
  return parts.join(", ");
}

type Atlas = {
  Map: new (
    container: HTMLElement,
    options: object,
  ) => ReturnType<MapControl["createMap"]>;
  HtmlMarker: new (options: object) => ReturnType<MapControl["createMarker"]>;
  source: { DataSource: new () => ReturnType<MapControl["createRouteSource"]> };
  layer: {
    LineLayer: new (
      source: ReturnType<MapControl["createRouteSource"]>,
      id: string | null,
      options: object,
    ) => ReturnType<MapControl["createRouteLayer"]>;
  };
};

declare global {
  interface Window {
    atlas?: Atlas;
  }
}

export function createAzureMapsClient(): MapsClient {
  let cachedMapToken: MapToken | undefined;
  const controls = new WeakMap<Atlas, MapControl>();
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

  async function getMapToken(
    signal?: AbortSignal,
    forceRefresh = false,
  ): Promise<MapToken> {
    if (
      !forceRefresh &&
      cachedMapToken &&
      Date.parse(cachedMapToken.expiresAt) > Date.now() + 60_000
    ) {
      return cachedMapToken;
    }

    const response = await tripFetch(`${apiBaseUrl}/mapToken`, {
      credentials: "include",
      signal,
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as {
        title?: string;
      } | null;
      throw new Error(
        problem?.title ?? `The map token endpoint returned ${response.status}.`,
      );
    }

    cachedMapToken = (await response.json()) as MapToken;
    return cachedMapToken;
  }

  async function mapsRequest<T = MapsFeatureCollection>(
    path: string,
    parameters: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<T> {
    const mapToken = await getMapToken(signal);
    const response = await tripFetch(
      `${mapToken.endpoint}/${path}?${parameters.toString()}`,
      {
        headers: { Authorization: `jwt-sas ${mapToken.token}` },
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Azure Maps returned ${response.status}.`);
    }

    return response.json() as Promise<T>;
  }

  async function searchCities(
    query: string,
    signal?: AbortSignal,
  ): Promise<CitySuggestion[]> {
    const parameters = new URLSearchParams({
      "api-version": "2026-01-01",
      query,
      resultTypes: "PopulatedPlace",
      bbox: "-180,-90,180,90",
      top: "6",
    });
    const result = await mapsRequest(
      "geocode:autocomplete",
      parameters,
      signal,
    );

    return (result.features ?? []).flatMap((feature, index) => {
      const label =
        feature.properties?.address?.formattedAddress ??
        feature.properties?.address?.locality ??
        feature.properties?.name;
      if (!label) {
        return [];
      }

      const countryCode =
        feature.properties?.address?.countryRegion?.ISO ??
        feature.properties?.address?.countryRegionISO2;
      const coordinates = feature.geometry?.coordinates;
      return [
        {
          id: feature.id ?? `${label}-${index}`,
          label: formatCityLabel(label, countryCode),
          cityName:
            feature.properties?.address?.locality ??
            feature.properties?.name ??
            label.split(",")[0].trim(),
          countryCode,
          longitude: coordinates?.[0],
          latitude: coordinates?.[1],
        },
      ];
    });
  }

  async function geocodeCity(
    suggestion: CitySuggestion,
    signal?: AbortSignal,
  ): Promise<Required<Pick<CitySuggestion, "longitude" | "latitude">>> {
    if (
      suggestion.longitude !== undefined &&
      suggestion.latitude !== undefined
    ) {
      return {
        longitude: suggestion.longitude,
        latitude: suggestion.latitude,
      };
    }

    const parameters = new URLSearchParams({
      "api-version": "2026-01-01",
      query: suggestion.label,
      top: "1",
    });
    const result = await mapsRequest("geocode", parameters, signal);
    const coordinates = result.features?.[0]?.geometry?.coordinates;
    if (coordinates?.[0] === undefined || coordinates[1] === undefined) {
      throw new Error("Azure Maps could not locate that city.");
    }

    return { longitude: coordinates[0], latitude: coordinates[1] };
  }

  async function searchPlaces(
    query: string,
    signal?: AbortSignal,
    center?: [number, number],
    countryCode?: string,
    options: { typeahead?: boolean } = {},
  ): Promise<PlaceSuggestion[]> {
    const parameters = new URLSearchParams({
      "api-version": "1.0",
      query,
      limit: "6",
      // Search venues and addresses without returning city/region centroids.
      idxSet: "POI,PAD,Addr",
      maxFuzzyLevel: "2",
    });
    if (options.typeahead) parameters.set("typeahead", "true");
    if (center) {
      parameters.set("lon", String(center[0]));
      parameters.set("lat", String(center[1]));
      parameters.set("radius", "50000");
    }
    if (countryCode) parameters.set("countrySet", countryCode.toUpperCase());
    const result = await mapsRequest<{
      results?: {
        id?: string;
        poi?: { name?: string };
        address?: { freeformAddress?: string; countryCode?: string };
        position?: { lon?: number; lat?: number };
      }[];
    }>("search/fuzzy/json", parameters, signal);
    return (result.results ?? []).flatMap((place, index) => {
      const longitude = place.position?.lon;
      const latitude = place.position?.lat;
      const name = place.poi?.name;
      if (
        longitude === undefined ||
        latitude === undefined ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) ||
        Math.abs(longitude) > 180 ||
        Math.abs(latitude) > 90
      )
        return [];
      if (
        countryCode &&
        place.address?.countryCode?.toUpperCase() !== countryCode.toUpperCase()
      )
        return [];
      if (center && placeDistanceKm(center, [longitude, latitude]) > 50)
        return [];
      const label = [name, place.address?.freeformAddress]
        .filter(Boolean)
        .join(", ");
      return label && longitude !== undefined && latitude !== undefined
        ? [
            {
              id: place.id ?? `${label}-${index}`,
              label,
              name,
              address: place.address?.freeformAddress,
              longitude,
              latitude,
            },
          ]
        : [];
    });
  }

  function placeDistanceKm(
    [longitude, latitude]: [number, number],
    [targetLongitude, targetLatitude]: [number, number],
  ) {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const a =
      Math.sin(radians(targetLatitude - latitude) / 2) ** 2 +
      Math.cos(radians(latitude)) *
        Math.cos(radians(targetLatitude)) *
        Math.sin(radians(targetLongitude - longitude) / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }

  return {
    getToken: getMapToken,
    searchCities,
    geocodeCity,
    searchPlaces,
    async loadControl() {
      const atlas = await loadAtlas();
      const existing = controls.get(atlas);
      if (existing) return existing;
      const control: MapControl = {
        createMap: (container, options) => new atlas.Map(container, options),
        createMarker: (options) => new atlas.HtmlMarker(options),
        createRouteSource: () => new atlas.source.DataSource(),
        createRouteLayer: (source, options) =>
          new atlas.layer.LineLayer(source, null, options),
      };
      controls.set(atlas, control);
      return control;
    },
  };
}
