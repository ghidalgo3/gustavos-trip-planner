import { mapsClient } from "../maps/mapsClient";
import { apiBaseUrl } from "./config";
import { HttpResponseError } from "./httpErrors";
import {
  forgetOfflineTrip,
  readTripCatalog,
  rememberTrip,
  rememberTripCatalog,
} from "./offlineCache";
import {
  rememberResourceEtag,
  ResourceConflictError,
  tripFetch,
} from "./tripDocumentStore";
export { formatCityLabel } from "../maps/AzureMapsClient";
export type { CitySuggestion, PlaceSuggestion } from "../maps/IMapsClient";
export { apiBaseUrl } from "./config";
export const {
  getToken: getMapToken,
  searchCities,
  geocodeCity: resolveCity,
  searchPlaces,
} = mapsClient;

export type CurrentUser = {
  isAuthenticated: boolean;
  id?: string;
  name?: string;
  email?: string;
  provider?: string;
  completedOnboarding: boolean;
  profile: UserProfile;
};

export type ActivityLogEntry = {
  id: string;
  occurredAt: string;
  actorUserId: string;
  actorName: string;
  source: string;
  action: string;
  tripId: string;
  tripName: string;
  resourceId: string | null;
  description: string;
};

export async function getMcpAccess(
  signal?: AbortSignal,
): Promise<{ enabled: boolean; connected: boolean }> {
  const response = await tripFetch(`${apiBaseUrl}/user/mcp-access`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) throw new Error("Unable to load connected agents.");
  return response.json();
}

export async function revokeMcpAccess(): Promise<void> {
  const response = await tripFetch(`${apiBaseUrl}/user/mcp-access`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Unable to disconnect ChatGPT. Try again.");
}

export async function getActivityLog(
  skip = 0,
  signal?: AbortSignal,
): Promise<{
  entries: ActivityLogEntry[];
  hasMore: boolean;
}> {
  const response = await tripFetch(
    `${apiBaseUrl}/user/activity-log?skip=${skip}`,
    {
      credentials: "include",
      signal,
    },
  );
  if (!response.ok) await readTripError(response, "loading the activity log");
  const page = await response.json();
  if (!Array.isArray(page.entries) || typeof page.hasMore !== "boolean")
    throw new Error("Unable to load the activity log.");
  return page;
}

export type UserProfile = {
  homeCity: { name: string; longitude: number; latitude: number } | null;
  preferredAirlines: string[];
  preferredAirport?: string | null;
};

export type Trip = {
  etag?: string;
  id: string;
  ownerUserId: string;
  canPlan?: boolean;
  name: string;
  description: string;
  constraints: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startDate?: string | null;
  endDate?: string | null;
};

export type TripListPage = { trips: Trip[]; hasMore: boolean };

export type TripInput = {
  name: string;
  description: string;
};

export async function getCurrentUser(
  signal?: AbortSignal,
): Promise<CurrentUser> {
  const response = await tripFetch(`${apiBaseUrl}/user`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new HttpResponseError(
      `The API returned ${response.status}.`,
      response.status,
    );
  }

  return response.json() as Promise<CurrentUser>;
}

export async function saveUserProfile(
  profile: UserProfile,
  signal?: AbortSignal,
): Promise<CurrentUser> {
  const response = await tripFetch(`${apiBaseUrl}/user/profile`, {
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
  if ([409, 412, 428].includes(response.status))
    throw new ResourceConflictError(message, response.status);
  throw new HttpResponseError(message, response.status);
}

export async function listTrips(
  userId: string,
  query: { skip: number; search: string; past: boolean; today: string },
  signal?: AbortSignal,
): Promise<TripListPage> {
  const params = new URLSearchParams({
    skip: String(query.skip),
    search: query.search,
    past: String(query.past),
    today: query.today,
  });
  const response = await tripFetch(`${tripResourceUrl(userId)}?${params}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    await readTripError(response, "loading trips");
  }
  const page = (await response.json()) as TripListPage;
  if (!Array.isArray(page.trips) || typeof page.hasMore !== "boolean")
    throw new Error("Unable to load trips.");
  // A page is only part of the catalog; keep other pages and downloaded documents.
  const catalog = new Map(
    (readTripCatalog(userId) ?? []).map((trip) => [trip.id, trip]),
  );
  for (const trip of page.trips) catalog.set(trip.id, trip);
  rememberTripCatalog(userId, [...catalog.values()]);
  for (const trip of page.trips)
    if (trip.etag) rememberResourceEtag(`/trips/${trip.id}`, trip.etag);
  return page;
}

export async function getTrip(
  userId: string,
  tripId: string,
  signal?: AbortSignal,
  refresh = false,
): Promise<Trip> {
  const response = await tripFetch(tripResourceUrl(userId, tripId), {
    credentials: "include",
    signal,
    ...(refresh ? { cache: "reload" as const } : {}),
  });
  if (!response.ok) await readTripError(response, "loading the trip");
  return response.json() as Promise<Trip>;
}

export async function createTrip(
  userId: string,
  input: TripInput,
): Promise<Trip> {
  const response = await tripFetch(tripResourceUrl(userId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    await readTripError(response, "creating the trip");
  }
  const trip = (await response.json()) as Trip;
  rememberTrip(userId, trip);
  return trip;
}

export async function updateTrip(
  userId: string,
  tripId: string,
  input: TripInput,
): Promise<Trip> {
  const response = await tripFetch(tripResourceUrl(userId, tripId), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    await readTripError(response, "updating the trip");
  }
  const trip = (await response.json()) as Trip;
  rememberTrip(userId, trip);
  return trip;
}

export async function deleteTrip(
  userId: string,
  tripId: string,
): Promise<void> {
  const response = await tripFetch(tripResourceUrl(userId, tripId), {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    await readTripError(response, "deleting the trip");
  }
  forgetOfflineTrip(userId, tripId);
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
