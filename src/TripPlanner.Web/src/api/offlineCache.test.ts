import { tripDocumentFixture } from "../test/tripDocumentFixture";
import { memoryStorage } from "../test/memoryStorage";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  openTripDocument,
  cachedTripResource,
  pruneTripDocumentCache,
  clearTripDocumentCache,
} from "./tripDocumentStore";
import {
  readOfflineUser,
  rememberOfflineUser,
  readTripCatalog,
  rememberTripCatalog,
  hasOfflineTrip,
  forgetOfflineTrip,
  documentKey,
} from "./offlineCache";
import type { CurrentUser, Trip } from "./api";
import { listTrips } from "./api";
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

test("loading a trip page preserves other catalog pages and downloaded documents", async () => {
  rememberTripCatalog("owner", [trip]);
  localStorage.setItem(
    documentKey("owner", "trip"),
    JSON.stringify({ document: tripDocumentFixture(trip) }),
  );
  const other = {
    ...trip,
    id: "other",
    name: "Other trip",
    startDate: "2030-06-15",
    endDate: "2030-06-18",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ trips: [other], hasMore: true }),
    })),
  );
  await listTrips("owner", {
    skip: 10,
    search: "Other",
    past: false,
    today: "2030-06-15",
  });
  expect(readTripCatalog("owner")).toEqual([trip, other]);
  expect(hasOfflineTrip("owner", "trip")).toBe(true);
});
test("sign out removes all private offline data while preserving display settings", () => {
  rememberOfflineUser(user);
  rememberTripCatalog("owner", [trip]);
  localStorage.setItem(documentKey("owner", "trip"), "{}");
  localStorage.setItem("tripplanner.color-scheme", "dark");
  clearTripDocumentCache();
  expect(readOfflineUser()).toBeUndefined();
  expect(readTripCatalog("owner")).toBeUndefined();
  expect(localStorage.getItem(documentKey("owner", "trip"))).toBeNull();
  expect(localStorage.getItem("tripplanner.color-scheme")).toBe("dark");
});
test("only a supported saved document is offered as available offline", () => {
  rememberTripCatalog("owner", [trip]);
  expect(hasOfflineTrip("owner", "trip")).toBe(false);
  localStorage.setItem(
    documentKey("owner", "trip"),
    JSON.stringify({
      document: tripDocumentFixture(trip),
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
    vi.fn().mockResolvedValue(Response.json(tripDocumentFixture(trip))),
  );
  await openTripDocument("owner", "trip", "");
  expect(hasOfflineTrip("owner", "trip")).toBe(true);
  pruneTripDocumentCache("owner", new Set());
  expect(hasOfflineTrip("owner", "trip")).toBe(false);
  expect(cachedTripResource(path)).toBeUndefined();
});
