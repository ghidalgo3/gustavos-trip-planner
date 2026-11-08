import type { CurrentUser, Trip } from "./api";

const userKey = "tripplanner.offline-user.v1";
const catalogPrefix = "tripplanner.trip-catalog.v1:";
export const documentKey = (userId: string, tripId: string) =>
  `tripplanner.document.v1:${userId}:${tripId}`;

function read(key: string): unknown {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
}
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function offlineStorageKeys(): string[] {
  return Object.keys(localStorage);
}
export function readOfflineUser(): CurrentUser | undefined {
  const value = read(userKey) as CurrentUser | undefined;
  if (
    !value?.isAuthenticated ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.completedOnboarding !== "boolean" ||
    !value.profile ||
    !Array.isArray(value.profile.preferredAirlines)
  )
    return undefined;
  return value;
}
// This is a remembered display identity, never an authentication credential.
// Offline views are read-only; every server request still uses the real session.
export function rememberOfflineUser(user: CurrentUser): boolean {
  return write(userKey, {
    isAuthenticated: true,
    id: user.id,
    name: user.name,
    email: user.email,
    provider: user.provider,
    completedOnboarding: user.completedOnboarding,
    featureFlags: user.featureFlags,
    profile: user.profile,
  });
}
export function readTripCatalog(userId: string): Trip[] | undefined {
  const value = read(catalogPrefix + userId);
  if (
    !Array.isArray(value) ||
    !value.every(
      (trip) =>
        trip && typeof trip.id === "string" && typeof trip.name === "string",
    )
  )
    return undefined;
  return value;
}
export function rememberTripCatalog(userId: string, trips: Trip[]): boolean {
  return write(catalogPrefix + userId, trips);
}
export function rememberTrip(userId: string, trip: Trip) {
  const catalog = readTripCatalog(userId) ?? [];
  rememberTripCatalog(userId, [
    trip,
    ...catalog.filter((item) => item.id !== trip.id),
  ]);
}
export function hasOfflineTrip(userId: string, tripId: string): boolean {
  const value = read(documentKey(userId, tripId)) as
    { document?: { schemaVersion?: number; id?: string } } | undefined;
  return value?.document?.schemaVersion === 1 && value.document.id === tripId;
}
export function forgetOfflineTrip(userId: string, tripId: string) {
  try {
    localStorage.removeItem(documentKey(userId, tripId));
    const catalog = readTripCatalog(userId);
    if (catalog)
      rememberTripCatalog(
        userId,
        catalog.filter((trip) => trip.id !== tripId),
      );
  } catch {
    /* Unavailable storage must not prevent an online action. */
  }
}
export function clearOfflineCache() {
  try {
    for (const key of offlineStorageKeys()) {
      if (
        key === userKey ||
        key === "tripplanner.session.v1" ||
        key.startsWith(catalogPrefix) ||
        key.startsWith("tripplanner.document.v1:")
      )
        localStorage.removeItem(key);
    }
  } catch {
    /* Storage can be disabled or full. */
  }
  try {
    sessionStorage.removeItem("tripplanner.session.v1");
  } catch {
    /* Legacy cache. */
  }
}
