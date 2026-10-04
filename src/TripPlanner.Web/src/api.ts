export type CurrentUser = {
  isAuthenticated: boolean;
  id?: string;
  name?: string;
  email?: string;
  provider?: string;
  completedOnboarding: boolean;
  featureFlags?: string[];
  profile: UserProfile;
};

export type UserProfile = {
  homeCity: { name: string; longitude: number; latitude: number } | null;
  preferredAirlines: string[];
  preferredAirport?: string | null;
};

export type CitySuggestion = {
  id: string;
  label: string;
  longitude?: number;
  latitude?: number;
};

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

export type Trip = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  constraints: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type TripInput = {
  name: string;
  description: string;
};

type MapToken = {
  token: string;
  endpoint: string;
  expiresAt: string;
};

type MapsFeature = {
  id?: string;
  geometry?: { coordinates?: number[] } | null;
  properties?: {
    name?: string;
    address?: {
      locality?: string;
      formattedAddress?: string;
      countryRegionISO2?: string;
    };
  };
};

type MapsFeatureCollection = { features?: MapsFeature[] };

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);
let cachedMapToken: MapToken | undefined;

export async function getCurrentUser(
  signal?: AbortSignal,
): Promise<CurrentUser> {
  const response = await fetch(`${apiBaseUrl}/user`, {
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    throw new Error(`The API returned ${response.status}.`);
  }

  return response.json() as Promise<CurrentUser>;
}

async function getMapToken(signal?: AbortSignal): Promise<MapToken> {
  if (
    cachedMapToken &&
    Date.parse(cachedMapToken.expiresAt) > Date.now() + 60_000
  ) {
    return cachedMapToken;
  }

  const response = await fetch(`${apiBaseUrl}/mapToken`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    throw new Error(`The map token endpoint returned ${response.status}.`);
  }

  cachedMapToken = (await response.json()) as MapToken;
  return cachedMapToken;
}

async function mapsRequest(
  path: string,
  parameters: URLSearchParams,
  signal?: AbortSignal,
): Promise<MapsFeatureCollection> {
  const mapToken = await getMapToken(signal);
  const response = await fetch(
    `${mapToken.endpoint}/${path}?${parameters.toString()}`,
    {
      headers: { Authorization: `jwt-sas ${mapToken.token}` },
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(`Azure Maps returned ${response.status}.`);
  }

  return response.json() as Promise<MapsFeatureCollection>;
}

export async function searchCities(
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
  const result = await mapsRequest("geocode:autocomplete", parameters, signal);

  return (result.features ?? []).flatMap((feature, index) => {
    const label =
      feature.properties?.address?.formattedAddress ??
      feature.properties?.address?.locality ??
      feature.properties?.name;
    if (!label) {
      return [];
    }

    const coordinates = feature.geometry?.coordinates;
    return [
      {
        id: feature.id ?? `${label}-${index}`,
        label: formatCityLabel(
          label,
          feature.properties?.address?.countryRegionISO2,
        ),
        longitude: coordinates?.[0],
        latitude: coordinates?.[1],
      },
    ];
  });
}

export async function resolveCity(
  suggestion: CitySuggestion,
  signal?: AbortSignal,
): Promise<Required<Pick<CitySuggestion, "longitude" | "latitude">>> {
  if (suggestion.longitude !== undefined && suggestion.latitude !== undefined) {
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

export async function saveUserProfile(
  profile: UserProfile,
  signal?: AbortSignal,
): Promise<CurrentUser> {
  const response = await fetch(`${apiBaseUrl}/user/profile`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `The API returned ${response.status} while saving your profile.`,
    );
  }

  return response.json() as Promise<CurrentUser>;
}

export function tripResourceUrl(userId: string, tripId?: string): string {
  const collection = `${apiBaseUrl}/user/${encodeURIComponent(userId)}/trips`;
  return tripId ? `${collection}/${encodeURIComponent(tripId)}` : collection;
}

export async function readTripError(response: Response, action: string) {
  let message = `The API returned ${response.status} while ${action}.`;
  try {
    const problem = (await response.json()) as {
      title?: string;
      message?: string;
      errors?: Record<string, string[]>;
      issues?: { message: string }[];
    };
    const validationMessage = Object.values(problem.errors ?? {}).flat()[0];
    message =
      validationMessage ??
      (problem.issues?.map((issue) => issue.message).join(" ") ||
        problem.title ||
        problem.message ||
        message);
  } catch {
    // Keep the status-based message when the response has no JSON body.
  }
  throw new Error(message);
}

export async function listTrips(
  userId: string,
  signal?: AbortSignal,
): Promise<Trip[]> {
  const response = await fetch(tripResourceUrl(userId), {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    await readTripError(response, "loading trips");
  }
  return response.json() as Promise<Trip[]>;
}

export async function getTrip(
  userId: string,
  tripId: string,
  signal?: AbortSignal,
): Promise<Trip> {
  const response = await fetch(tripResourceUrl(userId, tripId), {
    credentials: "include",
    signal,
  });
  if (!response.ok) await readTripError(response, "loading the trip");
  return response.json() as Promise<Trip>;
}

export async function createTrip(
  userId: string,
  input: TripInput,
): Promise<Trip> {
  const response = await fetch(tripResourceUrl(userId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    await readTripError(response, "creating the trip");
  }
  return response.json() as Promise<Trip>;
}

export async function updateTrip(
  userId: string,
  tripId: string,
  input: TripInput,
): Promise<Trip> {
  const response = await fetch(tripResourceUrl(userId, tripId), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    await readTripError(response, "updating the trip");
  }
  return response.json() as Promise<Trip>;
}

export async function deleteTrip(
  userId: string,
  tripId: string,
): Promise<void> {
  const response = await fetch(tripResourceUrl(userId, tripId), {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    await readTripError(response, "deleting the trip");
  }
}

export function loginUrl(provider: "google" | "aad"): string {
  const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return `${apiBaseUrl}/.auth/login/${provider}?post_login_redirect_uri=${encodeURIComponent(returnTo)}`;
}

export function logoutUrl(): string {
  const returnTo = `${window.location.origin}/`;
  return `${apiBaseUrl}/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(returnTo)}`;
}

export function profileImageUrl(): string {
  return `${apiBaseUrl}/user/avatar`;
}
