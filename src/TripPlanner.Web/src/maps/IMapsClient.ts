export type CitySuggestion = {
  id: string;
  label: string;
  cityName?: string;
  countryCode?: string;
  longitude?: number;
  latitude?: number;
};

export type PlaceSuggestion = CitySuggestion & {
  name?: string;
  address?: string;
};

export type MapToken = {
  token: string;
  endpoint: string;
  expiresAt: string;
};

type Marker = { getElement?: () => HTMLElement };
type MapEvent = { position?: [number, number]; error?: Error };
type RouteSource = {
  add: (feature: object) => void;
  setShapes: (features: object[]) => void;
};
type RouteLayer = object;
export type MapCamera = { center: [number, number]; zoom: number };
export type MapHandle = {
  events: {
    add: (event: string, callback: (event: MapEvent) => void) => void;
  };
  markers: { add: (marker: Marker) => void; remove: (marker: Marker) => void };
  sources: {
    add: (source: RouteSource) => void;
    remove: (source: RouteSource) => void;
  };
  layers: {
    add: (layer: RouteLayer) => void;
    remove: (layer: RouteLayer) => void;
  };
  setCamera: (options: object) => void;
  getCamera: () => MapCamera;
  stop: () => void;
  setStyle: (options: object) => void;
  dispose: () => void;
  resize: () => void;
};
export interface MapControl {
  createMap(container: HTMLElement, options: object): MapHandle;
  createMarker(options: object): Marker;
  createRouteSource(): RouteSource;
  createRouteLayer(source: RouteSource, options: object): RouteLayer;
}

export interface MapsClient {
  estimateTravelTime(
    from: [number, number],
    to: [number, number],
    mode: "driving" | "walking",
    signal?: AbortSignal,
  ): Promise<string>;
  getToken(signal?: AbortSignal, forceRefresh?: boolean): Promise<MapToken>;
  searchCities(query: string, signal?: AbortSignal): Promise<CitySuggestion[]>;
  geocodeCity(
    suggestion: CitySuggestion,
    signal?: AbortSignal,
  ): Promise<Required<Pick<CitySuggestion, "longitude" | "latitude">>>;
  searchPlaces(
    query: string,
    signal?: AbortSignal,
    center?: [number, number],
    countryCode?: string,
    options?: { typeahead?: boolean; category?: "railwayStation" },
  ): Promise<PlaceSuggestion[]>;
  loadControl(): Promise<MapControl>;
}
