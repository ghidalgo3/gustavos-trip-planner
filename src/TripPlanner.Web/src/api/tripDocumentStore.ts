import {
  hydrateTripDocument,
  tripDocumentValidators,
  validateTripDocument,
  type TripDocument,
} from "./tripDocument";
import {
  clearOfflineCache,
  forgetOfflineTrip,
  rememberTrip,
  documentKey,
  offlineStorageKeys,
} from "./offlineCache";
import type { Trip } from "./api";
import { useEffect, useEffectEvent, useSyncExternalStore } from "react";

export type ClientResource = {
  href: string;
  etag: string;
  data: unknown;
  status: number;
  contentType: string;
  contextVersion?: string | null;
};
export type TripView = {
  document: TripDocument;
  name: string;
  revision: string;
  places: {
    id: string;
    name: string;
    timeZone?: string;
    iataCode?: string;
    address?: { addressLocality?: string };
  }[];
  resources: Record<string, ClientResource>;
};
type DocumentState = {
  userId: string;
  tripId: string;
  document?: TripView;
  etag?: string;
  message?: string;
  conflict?: string;
  offline: boolean;
  loading: boolean;
};
const empty: DocumentState = {
  userId: "",
  tripId: "",
  offline: false,
  loading: false,
};
let state = empty;
let baseUrl = "";
let generation = 0;
let explicitRefresh = { path: "", sequence: 0 };
export class ResourceConflictError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
const listeners = new Set<() => void>();
const versions = new Map<string, number>();
const writes = new Map<string, Promise<unknown>>();
const validators = new Map<string, string>();
// API results are an account-scoped application cache, outside the portable file.
export const isTripApiResult = (path: string) =>
  /\/(?:activity-plan|flights\/constraints)$/.test(path);
type ApiResults = {
  revision?: string;
  resources: Record<string, ClientResource>;
};
let apiResults: ApiResults = { resources: {} };
function cacheEnvelope(view: TripView, etag?: string) {
  return { document: view.document, etag, apiResults };
}
function persistApiResults() {
  if (!state.document) return;
  try {
    localStorage.setItem(
      cacheKey(state.userId, state.tripId),
      JSON.stringify(cacheEnvelope(state.document, state.etag)),
    );
  } catch {
    /* API results remain available in memory if storage is unavailable. */
  }
}
function restoreApiResults(
  value: ApiResults | undefined,
  tripId: string,
  revision: string,
): ApiResults {
  if (value?.revision !== revision) return { revision, resources: {} };
  return {
    revision,
    resources: Object.fromEntries(
      Object.entries(value.resources ?? {}).filter(
        ([path, resource]) =>
          path.startsWith(`/trips/${tripId}/`) &&
          isTripApiResult(path) &&
          resource?.href === path &&
          resource.status === 200 &&
          typeof resource.contentType === "string" &&
          typeof resource.etag === "string",
      ),
    ),
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = (next: DocumentState) => {
  state = next;
  listeners.forEach((listener) => listener());
};
const cacheKey = documentKey;
export const canonicalPath = (path: string) =>
  path
    .replace(/^\/user\/[^/]+\/trips(?=\/|$)/, "/trips")
    .replace(/\/$/, "")
    .replace(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
      (id) => id.toLowerCase(),
    );

function validate(value: unknown, tripId: string): TripView {
  return hydrateTripDocument(validateTripDocument(value, tripId));
}

function changedResources(previous: TripView | undefined, next: TripView) {
  const oldResources: Record<string, Partial<ClientResource>> = {
    ...(previous?.document ? tripDocumentValidators(previous.document) : {}),
    ...previous?.resources,
  };
  const newResources: Record<string, Partial<ClientResource>> = {
    ...(next.document ? tripDocumentValidators(next.document) : {}),
    ...next.resources,
  };
  const paths = new Set([
    ...Object.keys(oldResources),
    ...Object.keys(newResources),
  ]);
  for (const path of paths) {
    const oldResource = oldResources[path];
    const newResource = newResources[path];
    if (
      oldResource?.etag !== newResource?.etag ||
      oldResource?.contextVersion !== newResource?.contextVersion ||
      JSON.stringify(oldResource?.data) !== JSON.stringify(newResource?.data)
    ) {
      versions.set(path, (versions.get(path) ?? 0) + 1);
      const segments = path.split("/");
      while (segments.length > 3) {
        segments.pop();
        const parent = segments.join("/");
        versions.set(parent, (versions.get(parent) ?? 0) + 1);
      }
    }
    if (newResource?.etag) validators.set(path, newResource.etag);
    else validators.delete(path);
  }
}

export async function openTripDocument(
  userId: string,
  tripId: string,
  apiBaseUrl: string,
  signal?: AbortSignal,
) {
  baseUrl = apiBaseUrl;
  if (state.userId !== userId || state.tripId !== tripId) {
    validators.clear();
    versions.clear();
    apiResults = { resources: {} };
  }
  ++generation;
  let cached: { document: TripView; etag?: string } | undefined =
    state.userId === userId && state.tripId === tripId && state.document
      ? { document: state.document, etag: state.etag }
      : undefined;
  try {
    const raw = localStorage.getItem(cacheKey(userId, tripId));
    if (raw) {
      const value = JSON.parse(raw) as {
        document?: unknown;
        etag?: string;
        apiResults?: ApiResults;
      };
      cached = {
        document: validate(value.document, tripId),
        etag: value.etag,
      };
      apiResults = restoreApiResults(
        value.apiResults,
        tripId,
        cached.document.revision,
      );
    }
  } catch {
    /* Unavailable/corrupt storage must not prevent an online load. */
  }
  changedResources(
    undefined,
    cached?.document ?? ({ resources: {} } as TripView),
  );
  publish({
    userId,
    tripId,
    document: cached?.document,
    etag: cached?.etag,
    offline: !!cached,
    loading: true,
  });
  return refreshTripDocument(signal);
}

export async function refreshTripDocument(
  signal?: AbortSignal,
): Promise<TripView | undefined> {
  if (!state.tripId) return undefined;
  const requestGeneration = ++generation;
  const previous = state;
  publish({ ...state, loading: true });
  try {
    if (navigator.onLine === false) throw new TypeError("Offline");
    const response = await fetch(
      `${baseUrl}/trips/${encodeURIComponent(previous.tripId)}/document`,
      {
        credentials: "include",
        signal,
        headers: {
          Accept: "application/json",
          ...(previous.etag ? { "If-None-Match": previous.etag } : {}),
        },
      },
    );
    if (requestGeneration !== generation || signal?.aborted)
      return state.document;
    if ([401, 403, 404].includes(response.status)) {
      try {
        forgetOfflineTrip(previous.userId, previous.tripId);
      } catch {
        /* Storage may be disabled. */
      }
      apiResults = { resources: {} };
      publish({
        ...previous,
        document: undefined,
        etag: undefined,
        loading: false,
        offline: false,
        message:
          "This trip is no longer available. Sign in or return to your trips.",
      });
      throw new Error("This trip is no longer available.");
    }
    if (response.status === 304 && previous.document) {
      publish({
        ...previous,
        loading: false,
        offline: false,
        conflict: previous.conflict,
        message: previous.conflict ? previous.message : undefined,
      });
      return previous.document;
    }
    if (!response.ok) throw new Error("Unable to refresh the trip.");
    const document = validate(await response.json(), previous.tripId);
    if (requestGeneration !== generation || signal?.aborted)
      return state.document;
    if (apiResults.revision !== document.revision)
      apiResults = { revision: document.revision, resources: {} };
    changedResources(state.document, document);
    rememberTrip(
      previous.userId,
      document.resources[`/trips/${previous.tripId}`].data as Trip,
    );
    const etag = response.headers.get("ETag") ?? undefined;
    let message: string | undefined;
    try {
      localStorage.setItem(
        cacheKey(previous.userId, previous.tripId),
        JSON.stringify(cacheEnvelope(document, etag)),
      );
    } catch {
      message = "Trip loaded. Offline storage is unavailable on this device.";
    }
    publish({
      ...previous,
      document,
      etag,
      loading: false,
      offline: false,
      conflict: previous.conflict,
      message: previous.conflict ? previous.message : message,
    });
    return document;
  } catch (error) {
    if (requestGeneration !== generation || signal?.aborted)
      return state.document;
    if (!state.document) {
      publish({
        ...state,
        loading: false,
        message:
          state.message ??
          (navigator.onLine === false || error instanceof TypeError
            ? "This trip has not been saved for offline use. Connect to the internet and open it once to download it."
            : error instanceof Error
              ? error.message
              : "Unable to load trip."),
      });
      throw error;
    }
    publish({
      ...state,
      loading: false,
      offline: true,
      message: "Showing the last saved trip. Refresh when connected.",
    });
    return state.document;
  }
}

export async function refreshConflictedResource() {
  const path = state.conflict;
  const result = await refreshTripDocument();
  if (result && !state.offline) {
    if (path)
      explicitRefresh = { path, sequence: explicitRefresh.sequence + 1 };
    publish({ ...state, conflict: undefined, message: undefined });
  }
  return result;
}
export function useExplicitResourceRefresh(
  path: string,
  refresh: () => void | Promise<void>,
) {
  const refreshEvent = useEffectEvent(refresh);
  useEffect(() => {
    let observed = explicitRefresh.sequence;
    return subscribe(() => {
      if (observed === explicitRefresh.sequence) return;
      observed = explicitRefresh.sequence;
      if (canonicalPath(explicitRefresh.path) === canonicalPath(path))
        void Promise.resolve(refreshEvent()).catch(() => undefined);
    });
  }, [path]);
}
export function useTripDocumentState() {
  return useSyncExternalStore(subscribe, () => state);
}
export function useTripResourceVersion(path: string) {
  return useSyncExternalStore(
    subscribe,
    () => versions.get(canonicalPath(path)) ?? 0,
  );
}
export function pruneTripDocumentCache(
  userId: string,
  tripIds: ReadonlySet<string>,
) {
  try {
    const prefix = `tripplanner.document.v1:${userId}:`;
    for (const key of offlineStorageKeys())
      if (key.startsWith(prefix) && !tripIds.has(key.slice(prefix.length)))
        localStorage.removeItem(key);
  } catch {
    /* Storage may be unavailable. */
  }
  if (state.userId === userId && state.tripId && !tripIds.has(state.tripId)) {
    ++generation;
    validators.clear();
    versions.clear();
    apiResults = { resources: {} };
    publish(empty);
  }
}

export function clearTripDocumentCache() {
  ++generation;
  clearOfflineCache();
  validators.clear();
  versions.clear();
  apiResults = { resources: {} };
  publish(empty);
}
export function rememberResourceEtag(path: string, etag: string) {
  validators.set(canonicalPath(path), etag);
}
export function cachedTripResource<T>(path: string): T | undefined {
  const key = canonicalPath(path);
  return (state.document?.resources[key] ?? apiResults.resources[key])?.data as
    T | undefined;
}

// A transport adapter, shared by existing resource APIs. It never changes global fetch.
export async function tripFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    "http://tripplanner.local",
  );
  const key = canonicalPath(url.pathname) + url.search;
  const method = (init.method ?? "GET").toUpperCase();
  const tripId = /^\/trips\/([^/]+)/.exec(key)?.[1];
  if (!tripId) return fetch(input, init);
  const account = state.userId;
  const active = tripId === state.tripId && !!state.document;
  const stillActive = () =>
    active && state.tripId === tripId && state.userId === account;
  const disconnected =
    navigator.onLine === false || (state.offline && !state.loading);
  const cached =
    state.document?.resources[key] ??
    (disconnected ? apiResults.resources[key] : undefined);
  if (method === "GET" && active && init.cache !== "reload" && cached) {
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const resource = cached;
    return new Response(
      resource.status === 204 ? null : JSON.stringify(resource.data),
      {
        status: resource.status,
        headers: {
          "Content-Type": resource.contentType,
          ...(resource.etag ? { ETag: resource.etag } : {}),
          ...(resource.contextVersion
            ? {
                "Planning-Context": resource.contextVersion,
                "Destination-Context": resource.contextVersion,
              }
            : {}),
        },
      },
    );
  }
  if (method === "GET" && active && disconnected && isTripApiResult(key))
    throw new Error(
      "This planning result has not been saved offline. Connect to load it.",
    );
  const headers = new Headers(init.headers);
  const resourceKey = key.endsWith("/purchases") ? key.slice(0, -10) : key;
  const mutation = !!tripId && ["PUT", "DELETE", "POST"].includes(method);
  let addedValidator = false;
  if (
    ["PUT", "DELETE"].includes(method) &&
    !headers.has("If-Match") &&
    validators.has(resourceKey)
  ) {
    headers.set("If-Match", validators.get(resourceKey)!);
    addedValidator = true;
  }
  if (
    method === "PUT" &&
    active &&
    key.includes("/members/") &&
    !validators.has(resourceKey) &&
    !headers.has("If-Match")
  ) {
    headers.set("If-None-Match", "*");
    addedValidator = true;
  }
  if (mutation && state.offline && active)
    throw new Error("Connect to the internet before saving changes.");
  if (
    mutation &&
    active &&
    state.document?.document &&
    !state.document.document.etag
  )
    throw new Error(
      "Refresh the trip to obtain editing versions before saving changes.",
    );
  const send = async () => {
    if (mutation && active && !stillActive())
      throw new Error(
        "The trip session changed. Reopen the trip before saving.",
      );
    if (mutation && stillActive()) ++generation; // Invalidate GETs issued before this save.
    const readGeneration = generation;
    let response: Response;
    try {
      response = await fetch(
        input,
        addedValidator ? { ...init, headers } : init,
      );
    } catch (reason) {
      if (mutation && stillActive())
        publish({
          ...state,
          offline: true,
          conflict: resourceKey,
          message:
            "Connection lost while saving. Refresh to check whether the change was saved before trying again.",
        });
      throw reason;
    }
    if (
      method === "GET" &&
      isTripApiResult(key) &&
      stillActive() &&
      readGeneration === generation
    ) {
      if ([401, 403].includes(response.status)) {
        ++generation;
        apiResults = { resources: {} };
        validators.clear();
        versions.clear();
        forgetOfflineTrip(account, tripId);
        publish({
          ...state,
          document: undefined,
          etag: undefined,
          loading: false,
          offline: false,
          message:
            "This trip is no longer available. Sign in or return to your trips.",
        });
      } else if (response.status === 404) {
        delete apiResults.resources[key];
        persistApiResults();
      }
    }
    const etag = response.headers?.get("ETag");
    if (mutation && response.ok) {
      if (etag) validators.set(resourceKey, etag);
      else if (!active && response.clone) {
        const saved = (await response
          .clone()
          .json()
          .catch(() => null)) as { etag?: string } | null;
        if (saved?.etag) validators.set(resourceKey, saved.etag);
      }
    }
    if (method === "GET" && response.ok && etag && (!active || stillActive()))
      validators.set(key, etag);
    if (
      method === "GET" &&
      response.ok &&
      isTripApiResult(key) &&
      stillActive() &&
      readGeneration === generation
    ) {
      const data: unknown = await response.clone().json();
      if (stillActive() && readGeneration === generation && state.document) {
        apiResults = {
          revision: state.document.revision,
          resources: {
            ...apiResults.resources,
            [key]: {
              href: key,
              etag: etag ?? "",
              status: response.status,
              contentType:
                response.headers.get("Content-Type") ?? "application/json",
              contextVersion:
                response.headers.get("Planning-Context") ?? undefined,
              data,
            },
          },
        };
        persistApiResults();
      }
    }
    if (
      mutation &&
      stillActive() &&
      [409, 412, 428].includes(response.status)
    ) {
      // Some 409s are domain validation, not concurrency conflicts.
      const problem = (await response
        .clone()
        .json()
        .catch(() => ({}))) as { code?: string };
      if (
        response.status !== 409 ||
        [
          "planning_context_changed",
          "destination_changed",
          "resource_changed",
        ].includes(problem.code ?? "")
      )
        publish({
          ...state,
          conflict: resourceKey,
          message:
            "This resource has changed. Refresh before editing it again.",
        });
    } else if (
      mutation &&
      stillActive() &&
      response.ok &&
      response.status !== 202 &&
      !key.includes("/previews") &&
      !key.includes("/bookingLinks") &&
      !key.includes("-proposals")
    ) {
      const updated = await refreshTripDocument().catch(() => undefined);
      if (!updated || state.offline)
        publish({
          ...state,
          message: "Saved. Refresh the trip to load the latest changes.",
        });
    }
    return response;
  };
  if (!mutation) return send();
  // Capture the caller's precondition before queueing; never silently rebase its body.
  const previous = writes.get(resourceKey) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(send);
  writes.set(resourceKey, pending);
  try {
    return await pending;
  } finally {
    if (writes.get(resourceKey) === pending) writes.delete(resourceKey);
  }
}
