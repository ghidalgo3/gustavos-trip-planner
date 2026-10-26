import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cachedTripResource,
  clearTripSnapshotCache,
  openTripSnapshot,
  refreshTripSnapshot,
  tripFetch,
  type TripSnapshot,
} from "./tripSnapshot";
const tripId = "11111111-1111-1111-1111-111111111111";
const path = `/trips/${tripId}`;
function fixture(name = "Original", version = "1"): TripSnapshot {
  return {
    "@id": `urn:uuid:${tripId}`,
    "@type": "Trip",
    schemaVersion: 1,
    name,
    revision: version,
    resources: {
      [path]: {
        href: path,
        etag: `"resource-${version}"`,
        status: 200,
        contentType: "application/json",
        data: { id: tripId, name },
      },
    },
  };
}
function response(snapshot = fixture()) {
  return new Response(JSON.stringify(snapshot), {
    headers: { ETag: `"snapshot-${snapshot.revision}"` },
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
  clearTripSnapshotCache();
});
afterEach(() => {
  clearTripSnapshotCache();
  vi.unstubAllGlobals();
});

test("one snapshot supplies resource GETs and edits use its resource ETag", async () => {
  const network = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(new Response(JSON.stringify({ name: "Normalized" })))
    .mockResolvedValueOnce(response(fixture("Normalized", "2")));
  vi.stubGlobal("fetch", network);
  await openTripSnapshot("owner", tripId, "");
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
  await openTripSnapshot("owner", tripId, "");
  const result = await tripFetch(path, {
    method: "PUT",
    body: JSON.stringify({ name: "My draft" }),
  });
  expect(result.status).toBe(412);
  expect(cachedTripResource(path)).toMatchObject({ name: "Original" });
  expect(network).toHaveBeenCalledTimes(2);
  await refreshTripSnapshot();
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
  await openTripSnapshot("owner", tripId, "");
  await openTripSnapshot("owner", tripId, "");
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
  await openTripSnapshot("owner", tripId, "");
  expect((await tripFetch(path, { method: "PUT", body: "{}" })).ok).toBe(true);
  expect(
    network.mock.calls.filter(([, init]) => init?.method === "PUT"),
  ).toHaveLength(1);
});

test("a snapshot requested before a save cannot replace newer confirmed state", async () => {
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
  await openTripSnapshot("owner", tripId, "");
  const oldRead = refreshTripSnapshot();
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
  await openTripSnapshot("owner", tripId, "");
  await expect(refreshTripSnapshot()).rejects.toThrow("no longer available");
  expect(cachedTripResource(path)).toBeUndefined();
  expect(storage.has(`tripplanner.snapshot.v1:owner:${tripId}`)).toBe(false);
});

test("one account never receives another account's cached trip", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValue(new TypeError("Offline")),
  );
  await openTripSnapshot("owner", tripId, "");
  await expect(openTripSnapshot("another-user", tripId, "")).rejects.toThrow();
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
  await openTripSnapshot("owner", tripId, "");
  const first = tripFetch(path, { method: "PUT", body: "{}" });
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2));
  const queued = tripFetch(path, { method: "PUT", body: "{}" });
  const rejected = expect(queued).rejects.toThrow("trip session changed");
  await openTripSnapshot("another-user", tripId, "");
  complete(new Response("{}"));
  await first;
  await rejected;
  expect(
    network.mock.calls.filter(([, init]) => init?.method === "PUT"),
  ).toHaveLength(1);
  expect(cachedTripResource(path)).toMatchObject({ name: "Other account" });
});
