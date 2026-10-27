import { memoryStorage } from "../test/memoryStorage";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  openTripSnapshot,
  cachedTripResource,
  pruneTripSnapshotCache,
  clearTripSnapshotCache,
} from "./tripSnapshot";
import {
  readOfflineUser,
  rememberOfflineUser,
  readTripCatalog,
  rememberTripCatalog,
  hasOfflineTrip,
  forgetOfflineTrip,
  snapshotKey,
} from "./offlineCache";
import type { CurrentUser, Trip } from "./api";
const user: CurrentUser = {
  isAuthenticated: true,
  id: "owner",
  completedOnboarding: true,
  name: "Traveller",
  profile: { homeCity: null, preferredAirlines: [] },
};
const trip: Trip = {
  id: "trip",
  ownerUserId: "owner",
  name: "Trip",
  description: "",
  constraints: {},
  createdAt: "",
  updatedAt: "",
};
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  localStorage.clear();
  sessionStorage.clear();
});
test("offline identity and the account-scoped catalog survive a fresh session", () => {
  rememberOfflineUser(user);
  rememberTripCatalog("owner", [trip]);
  sessionStorage.clear();
  expect(readOfflineUser()).toEqual(user);
  expect(readTripCatalog("owner")).toEqual([trip]);
  expect(readTripCatalog("another-user")).toBeUndefined();
});
test("sign out removes all private offline data while preserving display settings", () => {
  rememberOfflineUser(user);
  rememberTripCatalog("owner", [trip]);
  localStorage.setItem(snapshotKey("owner", "trip"), "{}");
  localStorage.setItem("tripplanner.color-scheme", "dark");
  clearTripSnapshotCache();
  expect(readOfflineUser()).toBeUndefined();
  expect(readTripCatalog("owner")).toBeUndefined();
  expect(localStorage.getItem(snapshotKey("owner", "trip"))).toBeNull();
  expect(localStorage.getItem("tripplanner.color-scheme")).toBe("dark");
});
test("only a supported saved snapshot is offered as available offline", () => {
  rememberTripCatalog("owner", [trip]);
  expect(hasOfflineTrip("owner", "trip")).toBe(false);
  localStorage.setItem(
    snapshotKey("owner", "trip"),
    JSON.stringify({
      snapshot: {
        schemaVersion: 1,
        "@id": "urn:uuid:trip",
        resources: { "/trips/trip": { data: trip } },
      },
    }),
  );
  expect(hasOfflineTrip("owner", "trip")).toBe(true);
  expect(hasOfflineTrip("another-user", "trip")).toBe(false);
  forgetOfflineTrip("owner", "trip");
  expect(hasOfflineTrip("owner", "trip")).toBe(false);
  expect(readTripCatalog("owner")).toEqual([]);
});
test("damaged identity and catalog storage do not impersonate an offline account", () => {
  localStorage.setItem(
    "tripplanner.offline-user.v1",
    '{"isAuthenticated":true}',
  );
  localStorage.setItem("tripplanner.trip-catalog.v1:owner", "{}");
  expect(readOfflineUser()).toBeUndefined();
  expect(readTripCatalog("owner")).toBeUndefined();
});

afterEach(() => vi.unstubAllGlobals());

test("a verified trip list prunes revoked trips from storage and current memory", async () => {
  const path = "/trips/trip";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        "@type": "Trip",
        "@id": "urn:uuid:trip",
        schemaVersion: 1,
        name: trip.name,
        revision: "1",
        resources: {
          [path]: {
            href: path,
            etag: '"1"',
            status: 200,
            contentType: "application/json",
            data: trip,
          },
        },
      }),
    ),
  );
  await openTripSnapshot("owner", "trip", "");
  expect(hasOfflineTrip("owner", "trip")).toBe(true);
  pruneTripSnapshotCache("owner", new Set());
  expect(hasOfflineTrip("owner", "trip")).toBe(false);
  expect(cachedTripResource(path)).toBeUndefined();
});
