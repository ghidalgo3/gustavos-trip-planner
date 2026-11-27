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

type MapEvent = { position?: [number, number]; error?: Error };
type Position = [number, number];
export type MapCamera = { center: Position; zoom: number };
export type MapCameraOptions = Partial<MapCamera> & {
  bounds?: [west: number, south: number, east: number, north: number];
  padding?: number;
  maxZoom?: number;
  type?: "jump" | "ease";
  duration?: number;
};
export type MapStyle = { style: "grayscale_dark" | "grayscale_light" };
export type MapOptions = MapCamera &
  MapStyle & {
    view?: "Auto";
    authOptions?: {
      authType: "sas";
      sasToken: string;
      getToken: (
        resolve: (token: string) => void,
        reject: (error: unknown) => void,
      ) => void;
    };
  };
export type MapMarkerOptions = { position: Position; htmlContent: HTMLElement };
export type MapLineFeature = {
  type: "Feature";
  geometry: { type: "MultiLineString"; coordinates: Position[][] };
  properties: Record<string, never>;
};
export type MapLineOptions = {
  strokeColor: string;
  strokeWidth: number;
  lineCap?: "round";
  strokeDashArray?: number[];
};
export type MapLine = {
  setFeatures: (features: MapLineFeature[]) => void;
  remove: () => void;
};
export type MapHandle = {
  events: {
    add: (event: string, callback: (event: MapEvent) => void) => void;
  };
  addMarker: (options: MapMarkerOptions) => { remove: () => void };
  addLine: (features: MapLineFeature[], options: MapLineOptions) => MapLine;
  setCamera: (options: MapCameraOptions) => void;
  getCamera: () => MapCamera;
  stop: () => void;
  setStyle: (options: MapStyle) => void;
  dispose: () => void;
  resize: () => void;
};
export interface MapControl {
  createMap(container: HTMLElement, options: MapOptions): MapHandle;
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
