import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  hydrateTripDocument,
  validateTripDocument,
  tripDocumentValidators,
} from "./tripDocument";
import { isTripApiResult, type ClientResource } from "./tripDocumentStore";

const before = JSON.parse(readFileSync("../../docs/before.json", "utf8")) as {
  resources: Record<string, ClientResource>;
};
const after = JSON.parse(readFileSync("../../docs/after.json", "utf8"));

test.each(
  Object.entries(before.resources).filter(([path]) => !isTripApiResult(path)),
)("document adapter preserves REST view %s", (path, expected) => {
  const actual = hydrateTripDocument(validateTripDocument(after, after.id))
    .resources[path];
  expect(actual).toBeDefined();
  if (actual.etag) expect(actual.etag).toEqual(expected.etag);
  expect(actual.status).toEqual(expected.status);
  expect(actual.data).toEqual(
    path === `/trips/${after.id}`
      ? {
          ...(expected.data as object),
          startDate: "2026-12-25",
          endDate: "2027-01-07",
        }
      : expected.data,
  );
});

test.each(Object.keys(before.resources).filter(isTripApiResult))(
  "computed view %s is fetched through its API instead of reconstructed from the document",
  (path) => {
    expect(after.assessments).toBeUndefined();
    expect(
      hydrateTripDocument(validateTripDocument(after, after.id)).resources[
        path
      ],
    ).toBeUndefined();
  },
);

test("a portable document supplies read-only views without synchronization metadata", () => {
  const portable = JSON.parse(
    JSON.stringify(after, (key, value) =>
      [
        "etag",
        "contextVersion",
        "version",
        "canPlan",
        "connectionsVersion",
        "memberEtags",
      ].includes(key) || key.endsWith("Etag")
        ? undefined
        : value,
    ),
  );
  const hydrated = hydrateTripDocument(
    validateTripDocument(portable, portable.id),
  );
  expect(hydrated.resources[`/trips/${portable.id}`].data).toMatchObject({
    canPlan: false,
  });
  expect(
    hydrated.resources[`/trips/${portable.id}/destinations`].data,
  ).toMatchObject({ type: "FeatureCollection" });
  expect(hydrated.resources[`/trips/${portable.id}`].etag).toBe("");
});

test.each([
  "identity",
  "version",
  "route-metadata",
  "embedded-body",
  "weak-validator",
  "quoted-validator",
  "day-name-type",
  "day-name-length",
])("invalid document %s is rejected", (change) => {
  const value = structuredClone(after);
  if (change === "identity") value.id = "another-trip";
  if (change === "version") value.schemaVersion = 2;
  if (change === "route-metadata") value.href = `/trips/${after.id}`;
  if (change === "embedded-body")
    value.itinerary.items.find(
      (item: Record<string, unknown>) => item.kind === "activity",
    ).data = {};
  if (change === "quoted-validator") value.etag = '"already-quoted"';
  if (change === "weak-validator")
    value.itinerary.items.find(
      (item: Record<string, unknown>) => item.kind === "visit",
    ).etag = 'W/"1"';
  if (change === "day-name-type")
    value.preferences.destinations[0].schedule.days[0].name = 123;
  if (change === "day-name-length")
    value.preferences.destinations[0].schedule.days[0].name = "a".repeat(201);
  expect(() => validateTripDocument(value, after.id)).toThrow();
});

test("one document hydrates offline screens and stores only domain data and validator metadata", async () => {
  const { vi } = await import("vitest");
  const {
    openTripDocument,
    clearTripDocumentCache,
    refreshTripDocument,
    tripFetch,
  } = await import("./tripDocumentStore");
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const network = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify(after), {
        headers: { ETag: '"document-1"' },
      }),
    )
    .mockRejectedValue(new TypeError("Offline"));
  vi.stubGlobal("fetch", network);
  try {
    await openTripDocument("owner", after.id, "");
    expect(network.mock.calls[0][0]).toBe(`/trips/${after.id}/document`);
    const saved = JSON.parse(
      storage.get(`tripplanner.document.v1:owner:${after.id}`)!,
    );
    expect(saved.document).toEqual(after);
    expect(saved.apiResults.resources).toEqual({});
    await refreshTripDocument();
    const path = `/trips/${after.id}/destinations`;
    expect(await (await tripFetch(path)).json()).toEqual(
      before.resources[path].data,
    );
    expect(network).toHaveBeenCalledTimes(2);
    await expect(
      tripFetch(`/trips/${after.id}`, { method: "PUT", body: "{}" }),
    ).rejects.toThrow("Connect to the internet");
  } finally {
    clearTripDocumentCache();
    vi.unstubAllGlobals();
  }
});

test("API results are cached outside the trip document, survive offline restart, and never cross accounts", async () => {
  const { vi } = await import("vitest");
  const {
    openTripDocument,
    clearTripDocumentCache,
    tripFetch,
    cachedTripResource,
    refreshTripDocument,
  } = await import("./tripDocumentStore");
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const path = Object.keys(before.resources).find((p) =>
    p.endsWith("/activity-plan"),
  )!;
  const expected = structuredClone(before.resources[path]);
  (expected.data as { plan: { days: { name?: string }[] } }).plan.days[0].name =
    "EPCOT Visit";
  const network = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(after)))
    .mockResolvedValueOnce(
      new Response(JSON.stringify(expected.data), {
        headers: {
          ETag: expected.etag,
          "Planning-Context": expected.contextVersion!,
        },
      }),
    )
    .mockRejectedValue(new TypeError("Offline"));
  vi.stubGlobal("fetch", network);
  try {
    await openTripDocument("owner", after.id, "");
    expect(await (await tripFetch(path)).json()).toEqual(expected.data);
    const saved = storage.get(`tripplanner.document.v1:owner:${after.id}`)!;
    expect(JSON.parse(saved).document.assessments).toBeUndefined();
    expect(JSON.parse(saved).apiResults.resources[path].data).toEqual(
      expected.data,
    );
    clearTripDocumentCache();
    storage.set(`tripplanner.document.v1:owner:${after.id}`, saved);
    await openTripDocument("owner", after.id, "");
    expect(await (await tripFetch(path)).json()).toEqual(expected.data);
    expect(network).toHaveBeenCalledTimes(3);
    await expect(
      openTripDocument("another-owner", after.id, ""),
    ).rejects.toThrow();
    expect(cachedTripResource(path)).toBeUndefined();
    // Reload the same account with a changed document: previous API results are invalidated.
    network.mockResolvedValueOnce(new Response(JSON.stringify(after)));
    await openTripDocument("owner", after.id, "");
    const next = structuredClone(after);
    next.revision += "-changed";
    network.mockResolvedValueOnce(new Response(JSON.stringify(next)));
    await refreshTripDocument();
    expect(cachedTripResource(path)).toBeUndefined();
  } finally {
    clearTripDocumentCache();
    vi.unstubAllGlobals();
  }
});

test.each([401, 403, 404])(
  "an API result denied with %s is removed from the offline cache",
  async (status) => {
    const { vi } = await import("vitest");
    const {
      openTripDocument,
      clearTripDocumentCache,
      tripFetch,
      cachedTripResource,
    } = await import("./tripDocumentStore");
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    const path = `/trips/${after.id}/flights/constraints`;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(after)))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(before.resources[path].data)),
        )
        .mockResolvedValueOnce(new Response("{}", { status })),
    );
    try {
      await openTripDocument("owner", after.id, "");
      await tripFetch(path);
      expect(cachedTripResource(path)).toBeDefined();
      expect((await tripFetch(path)).status).toBe(status);
      expect(cachedTripResource(path)).toBeUndefined();
      expect(storage.has(`tripplanner.document.v1:owner:${after.id}`)).toBe(
        status === 404,
      );
    } finally {
      clearTripDocumentCache();
      vi.unstubAllGlobals();
    }
  },
);

test("a cached trip can fetch uncached API results while its connection is being verified", async () => {
  const { vi } = await import("vitest");
  const { openTripDocument, clearTripDocumentCache, tripFetch } =
    await import("./tripDocumentStore");
  const storage = new Map<string, string>([
    [
      `tripplanner.document.v1:owner:${after.id}`,
      JSON.stringify({ document: after, etag: '"document-1"' }),
    ],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  let complete!: (response: Response) => void;
  const path = `/trips/${after.id}/flights/constraints`;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(before.resources[path].data)),
      ),
  );
  try {
    const opening = openTripDocument("owner", after.id, "");
    expect(await (await tripFetch(path)).json()).toEqual(
      before.resources[path].data,
    );
    complete(new Response(null, { status: 304 }));
    await opening;
  } finally {
    clearTripDocumentCache();
    vi.unstubAllGlobals();
  }
});

test("entity validators supply edit headers without storing API addresses", () => {
  const validators = tripDocumentValidators(
    validateTripDocument(after, after.id),
  );
  for (const [path, validator] of Object.entries(validators)) {
    expect(validator.etag, path).toBe(before.resources[path].etag);
    expect(validator.contextVersion ?? null, path).toBe(
      before.resources[path].contextVersion ?? null,
    );
  }
  const prefix = `/trips/${after.id}`;
  const lodging = after.itinerary.items.find(
    (item: Record<string, unknown>) => item.kind === "lodging",
  );
  const visit = after.itinerary.items.find(
    (item: Record<string, unknown>) => item.id === lodging.visitId,
  );
  const activity = after.itinerary.items.find(
    (item: Record<string, unknown>) => item.kind === "activity",
  );
  const city = after.places.find(
    (p: Record<string, unknown>) => p.destinationId === visit.destinationId,
  );
  expect(validators[prefix].etag).toBe(`"${after.etag}"`);
  expect(
    validators[
      `${prefix}/destinations/${visit.destinationId}/stays/${visit.id}`
    ],
  ).toEqual({ etag: `"${visit.etag}"` });
  expect(
    validators[
      `${prefix}/destinations/${visit.destinationId}/stays/${visit.id}/location`
    ],
  ).toEqual({ etag: `"${lodging.etag}"` });
  expect(
    validators[
      `${prefix}/destinations/${activity.destinationId}/activities/${activity.id}`
    ],
  ).toEqual({
    etag: `"${activity.etag}"`,
    contextVersion: activity.contextVersion,
  });
  expect(validators[`${prefix}/destinations/${visit.destinationId}`]).toEqual({
    etag: `"${city.etag}"`,
  });
  expect(validators[`${prefix}/travel`]).toEqual({
    etag: `"${after.itinerary.connectionsEtag}"`,
    version: after.itinerary.connectionsVersion,
  });
  expect(JSON.stringify(after)).not.toContain("/trips/");
  expect(after.sync).toBeUndefined();
});

test.each(["missing-start", "busy-task", "duplicate-id"])(
  "calendar invariant %s is enforced",
  (change) => {
    const value = structuredClone(after);
    const item = value.itinerary.items.find(
      (item: Record<string, unknown>) => item.kind === "activity",
    );
    if (change === "missing-start") {
      item.type = "event";
      delete item.start;
    }
    if (change === "busy-task") {
      item.type = "task";
      item.busy = true;
    }
    if (change === "duplicate-id")
      value.itinerary.items.push(structuredClone(item));
    expect(() => validateTripDocument(value, value.id)).toThrow();
  },
);

test("calendar items retain hotel stays and unscheduled activity details", () => {
  const value = validateTripDocument(after, after.id);
  expect(value).not.toHaveProperty("activities");
  expect(value).not.toHaveProperty("transportation");
  expect(Object.keys(value.itinerary).sort()).toEqual([
    "connectionsEtag",
    "connectionsVersion",
    "items",
  ]);
  const lodging = value.itinerary.items.filter(
    (item) => item.kind === "lodging",
  );
  expect(lodging).toHaveLength(4);
  expect(
    lodging.every((item) => !item.busy && item.visitId && item.placeId),
  ).toBe(true);
  const activities = value.itinerary.items.filter(
    (item) => item.kind === "activity",
  );
  expect(activities).toHaveLength(76);
  expect(
    activities
      .filter((item) => item.type === "task")
      .every(
        (item) =>
          Object.hasOwn(item, "estimatedDuration") && item.name && !item.start,
      ),
  ).toBe(true);
});

test.each(["missing", "empty", "unknown", "duplicate", "tickets", "address"])(
  "invalid activity metadata %s is rejected",
  (change) => {
    const value = structuredClone(after);
    const activity = value.itinerary.items.find(
      (item: Record<string, unknown>) => item.kind === "activity",
    );
    if (change === "missing") delete activity.kinds;
    if (change === "empty") activity.kinds = [];
    if (change === "unknown") activity.kinds = ["Other"];
    if (change === "duplicate") activity.kinds = ["Art", "Art"];
    if (change === "tickets") activity.ticketRequirement = "Maybe";
    if (change === "address") activity.address = 123;
    expect(() => validateTripDocument(value, value.id)).toThrow(
      "Invalid activity details",
    );
  },
);
