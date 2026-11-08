import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { listTrips, type Trip } from "../../api/api";
import { readTripCatalog } from "../../api/offlineCache";
import { isAccessDenied } from "../../api/httpErrors";
import { clearTripDocumentCache } from "../../api/tripDocumentStore";
import { selectTrips, tripPageSize } from "./tripList";

type State = {
  key: string;
  trips?: Trip[];
  hasMore: boolean;
  loadingMore: boolean;
  readOnly: boolean;
  error?: string;
};

export function useTripList({
  userId,
  search,
  past,
  today,
  offline,
  enabled = true,
  onSessionExpired,
}: {
  userId: string;
  search: string;
  past: boolean;
  today: string;
  offline: boolean;
  enabled?: boolean;
  onSessionExpired?: () => void;
}) {
  const key = JSON.stringify([userId, search, past, today, offline]);
  const [state, setState] = useState<State>({
    key,
    hasMore: false,
    loadingMore: false,
    readOnly: offline,
  });
  const [revision, setRevision] = useState(0);
  const active = useRef<AbortController | undefined>(undefined);
  const morePending = useRef(false);
  const firstPending = useRef(false);
  const sessionExpired = useEffectEvent(() => onSessionExpired?.());
  const view: State =
    state.key === key
      ? state
      : {
          key,
          hasMore: false,
          loadingMore: false,
          readOnly: offline || state.readOnly,
        };

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    active.current = controller;
    morePending.current = false;
    firstPending.current = true;
    async function load() {
      try {
        if (offline || navigator.onLine === false)
          throw new TypeError("Offline");
        const page = await listTrips(
          userId,
          { skip: 0, search, past, today },
          controller.signal,
        );
        if (!controller.signal.aborted)
          setState({
            key,
            trips: page.trips,
            hasMore: page.hasMore,
            loadingMore: false,
            readOnly: false,
          });
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (isAccessDenied(reason)) {
          clearTripDocumentCache();
          setState({
            key,
            trips: [],
            hasMore: false,
            loadingMore: false,
            readOnly: true,
            error: "Sign in again to load your trips.",
          });
          sessionExpired();
        } else {
          const catalog = readTripCatalog(userId);
          const saved = selectTrips(catalog ?? [], search, past, today);
          setState({
            key,
            trips: saved.slice(0, tripPageSize),
            hasMore: saved.length > tripPageSize,
            loadingMore: false,
            readOnly: true,
            error: catalog
              ? undefined
              : "No trip list is saved on this device. Connect to the internet to load your trips.",
          });
        }
      } finally {
        if (!controller.signal.aborted) firstPending.current = false;
      }
    }
    void load();
    return () => controller.abort();
  }, [userId, search, past, today, offline, enabled, key, revision]);

  async function loadMore() {
    const controller = active.current;
    if (
      !view.trips ||
      !view.hasMore ||
      morePending.current ||
      firstPending.current ||
      !controller ||
      controller.signal.aborted
    )
      return;
    morePending.current = true;
    setState((current) => ({
      ...current,
      loadingMore: true,
      error: undefined,
    }));
    try {
      const skip = view.trips.length;
      const page = view.readOnly
        ? (() => {
            const saved = selectTrips(
              readTripCatalog(userId) ?? [],
              search,
              past,
              today,
            );
            return {
              trips: saved.slice(skip, skip + tripPageSize),
              hasMore: saved.length > skip + tripPageSize,
            };
          })()
        : await listTrips(
            userId,
            { skip, search, past, today },
            controller.signal,
          );
      if (controller.signal.aborted) return;
      setState((current) => ({
        ...current,
        trips: [
          ...new Map(
            [...(current.trips ?? []), ...page.trips].map((trip) => [
              trip.id,
              trip,
            ]),
          ).values(),
        ],
        hasMore: page.hasMore,
        loadingMore: false,
      }));
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (isAccessDenied(reason)) {
        clearTripDocumentCache();
        setState({
          key,
          trips: [],
          hasMore: false,
          loadingMore: false,
          readOnly: true,
          error: "Sign in again to load your trips.",
        });
        onSessionExpired?.();
      } else {
        setState((current) => ({
          ...current,
          loadingMore: false,
          error:
            reason instanceof Error
              ? reason.message
              : "Unable to load more trips. Try again.",
        }));
      }
    } finally {
      if (!controller.signal.aborted) morePending.current = false;
    }
  }

  function setTrips(update: SetStateAction<Trip[] | undefined>) {
    setState((current) => ({
      ...current,
      trips: typeof update === "function" ? update(current.trips) : update,
    }));
  }

  return {
    ...view,
    setTrips,
    loadMore,
    refresh: () => setRevision((value) => value + 1),
  };
}
