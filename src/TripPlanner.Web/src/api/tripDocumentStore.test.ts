import { tripDocumentFixture } from "../test/tripDocumentFixture";
import type { TripDocument } from "./tripDocument";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cachedTripResource,
  clearTripDocumentCache,
  openTripDocument,
  refreshTripDocument,
  tripFetch,
} from "./tripDocumentStore";
const tripId = "11111111-1111-1111-1111-111111111111";
const path = `/trips/${tripId}`;
function fixture(name = "Original", version = "1"): TripDocument {
  return tripDocumentFixture(
    { id: tripId, name },
    {
      revision: version,
      canPlan: true,
      etag: `resource-${version}`,
    },
  );
}
function response(document = fixture()) {
  return new Response(JSON.stringify(document), {
    headers: { ETag: `"document-${document.revision}"` },
  });
}
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  clearTripDocumentCache();
});
afterEach(() => {
  clearTripDocumentCache();
  vi.unstubAllGlobals();
});

test("one document supplies resource GETs and edits use its resource ETag", async () => {
  const network = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(new Response(JSON.stringify({ name: "Normalized" })))
    .mockResolvedValueOnce(response(fixture("Normalized", "2")));
  vi.stubGlobal("fetch", network);
  await openTripDocument("owner", tripId, "");
  expect(await (await tripFetch(path)).json()).toMatchObject({
    name: "Original",
  });
  expect(network).toHaveBeenCalledTimes(1);
  const result = await tripFetch(path, {
    method: "PUT",
    body: JSON.stringify({ name: " new " }),
  });
  expect(result.ok).toBe(true);
  expect(new Headers(network.mock.calls[1][1].headers).get("If-Match")).toBe(
    '"resource-1"',
  );
  expect(cachedTripResource(path)).toMatchObject({ name: "Normalized" });
});

test("conflicts leave confirmed state intact and refresh never replays the write", async () => {
  const network = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "resource_changed" }), {
        status: 412,
      }),
    )
    .mockResolvedValueOnce(response(fixture("Someone else's edit", "2")));
  vi.stubGlobal("fetch", network);
  await openTripDocument("owner", tripId, "");
  const result = await tripFetch(path, {
    method: "PUT",
    body: JSON.stringify({ name: "My draft" }),
  });
  expect(result.status).toBe(412);
  expect(cachedTripResource(path)).toMatchObject({ name: "Original" });
  expect(network).toHaveBeenCalledTimes(2);
  await refreshTripDocument();
  expect(cachedTripResource(path)).toMatchObject({
    name: "Someone else's edit",
  });
  expect(
    network.mock.calls.filter(([, init]) => init?.method === "PUT"),
  ).toHaveLength(1);
});

test("cached trips remain readable offline and disconnected edits are blocked", async () => {
  const network = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockRejectedValue(new TypeError("Offline"));
  vi.stubGlobal("fetch", network);
  await openTripDocument("owner", tripId, "");
  await openTripDocument("owner", tripId, "");
  expect(await (await tripFetch(path)).json()).toMatchObject({
    name: "Original",
  });
  await expect(tripFetch(path, { method: "PUT", body: "{}" })).rejects.toThrow(
    "Connect to the internet",
  );
});

test("a successful save remains successful if the subsequent refresh fails", async () => {
  const network = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    .mockRejectedValue(new TypeError("Offline"));
  vi.stubGlobal("fetch", network);
  await openTripDocument("owner", tripId, "");
  expect((await tripFetch(path, { method: "PUT", body: "{}" })).ok).toBe(true);
  expect(
    network.mock.calls.filter(([, init]) => init?.method === "PUT"),
  ).toHaveLength(1);
});

test.each(["current", "newer plan", "newer context"])(
  "a saved activity plan survives offline navigation only when its document is current: %s",
  async (outcome) => {
    const planPath = `${path}/destinations/tokyo-jp/activity-plan`;
    const document = fixture("Named days", "2");
    document.places.push({
      id: "tokyo",
      name: "Tokyo",
      type: "Place",
      destinationId: "tokyo-jp",
      location: null,
      active: true,
      etag: "1",
      activitiesEtag: "1",
    });
    document.preferences.destinations = [
      {
        destinationId: "tokyo-jp",
        constraints: {},
        activities: { instructions: "", defaults: null },
        schedule: {
          etag: outcome === "newer plan" ? "3" : "2",
          contextVersion:
            outcome === "newer context" ? "context-3" : "context-2",
          days: [{ name: "EPCOT Visit" }],
        },
      },
    ];
    const saved = {
      plan: { days: [{ name: "EPCOT Visit" }] },
      contextVersion: "context-2",
      version: 2,
    };
    const network = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        new Response(JSON.stringify(saved), {
          headers: { ETag: '"2"', "Planning-Context": "context-2" },
        }),
      )
      .mockResolvedValueOnce(response(document))
      .mockRejectedValue(new TypeError("Offline"));
    vi.stubGlobal("fetch", network);
    await openTripDocument("owner", tripId, "");
    await tripFetch(planPath, {
      method: "PUT",
      body: JSON.stringify({ plan: saved.plan }),
      headers: { "If-Match": '"1"' },
    });
    if (outcome === "current")
      expect(cachedTripResource(planPath)).toEqual(saved);
    else expect(cachedTripResource(planPath)).toBeUndefined();
    const envelope = storage.get(`tripplanner.document.v1:owner:${tripId}`)!;
    clearTripDocumentCache();
    storage.set(`tripplanner.document.v1:owner:${tripId}`, envelope);
    await openTripDocument("owner", tripId, "");
    if (outcome === "current")
      expect(await (await tripFetch(planPath)).json()).toEqual(saved);
    else
      await expect(tripFetch(planPath)).rejects.toThrow(
        "not been saved offline",
      );
  },
);

test("a document requested before a save cannot replace newer confirmed state", async () => {
  let completeOld!: (value: Response) => void;
  const network = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          completeOld = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response("{}"))
    .mockResolvedValueOnce(response(fixture("New", "2")));
  vi.stubGlobal("fetch", network);
  await openTripDocument("owner", tripId, "");
  const oldRead = refreshTripDocument();
  await tripFetch(path, { method: "PUT", body: "{}" });
  completeOld(response(fixture("Old", "1")));
  await oldRead;
  expect(cachedTripResource(path)).toMatchObject({ name: "New" });
});

test("revoked access clears cached trip data rather than displaying it as offline", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response(null, { status: 403 })),
  );
  await openTripDocument("owner", tripId, "");
  await expect(refreshTripDocument()).rejects.toThrow("no longer available");
  expect(cachedTripResource(path)).toBeUndefined();
  expect(storage.has(`tripplanner.document.v1:owner:${tripId}`)).toBe(false);
});

test("one account never receives another account's cached trip", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValue(new TypeError("Offline")),
  );
  await openTripDocument("owner", tripId, "");
  await expect(openTripDocument("another-user", tripId, "")).rejects.toThrow();
  expect(cachedTripResource(path)).toBeUndefined();
});

test("queued writes are cancelled when the active account changes", async () => {
  let complete!: (value: Response) => void;
  const network = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValueOnce(response(fixture("Other account", "2")));
  vi.stubGlobal("fetch", network);
  await openTripDocument("owner", tripId, "");
  const first = tripFetch(path, { method: "PUT", body: "{}" });
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2));
  const queued = tripFetch(path, { method: "PUT", body: "{}" });
  const rejected = expect(queued).rejects.toThrow("trip session changed");
  await openTripDocument("another-user", tripId, "");
  complete(new Response("{}"));
  await first;
  await rejected;
  expect(
    network.mock.calls.filter(([, init]) => init?.method === "PUT"),
  ).toHaveLength(1);
  expect(cachedTripResource(path)).toMatchObject({ name: "Other account" });
});
