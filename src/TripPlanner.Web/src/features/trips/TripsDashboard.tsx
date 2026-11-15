import { hasOfflineTrip } from "../../api/offlineCache";
import { TripsSkeleton } from "./TripSkeletons";
import TripMetadataEditor from "./TripMetadataEditor";
import TripDateSummary from "./TripDateSummary";
import OfflineNotice from "../../shared/components/OfflineNotice";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Text,
  Textarea,
  Title3,
} from "@fluentui/react-components";
import {
  Add24Regular,
  Delete24Regular,
  Edit24Regular,
  Search24Regular,
  ChevronDown24Regular,
  ChevronRight24Regular,
} from "@fluentui/react-icons";
import {
  createTrip,
  deleteTrip,
  type CurrentUser,
  type Trip,
  type TripInput,
} from "../../api/api";
import { formatTripDates, localToday } from "./tripList";
import { useTripList } from "./useTripList";
import { trackBehavior } from "../../telemetry/telemetry";

type Props = {
  user: CurrentUser & { id: string };
  offline?: boolean;
  onSessionExpired?: () => void;
};

const emptyInput: TripInput = { name: "", description: "" };

export default function TripsDashboard({
  user,
  offline = false,
  onSessionExpired,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [today, setToday] = useState(localToday);
  const [pastOpen, setPastOpen] = useState(false);
  const current = useTripList({
    userId: user.id,
    search: query,
    past: false,
    today,
    offline,
    onSessionExpired,
  });
  const past = useTripList({
    userId: user.id,
    search: query,
    past: true,
    today,
    offline: offline || current.readOnly,
    enabled: pastOpen,
    onSessionExpired,
  });
  const { trips, setTrips } = current;
  const showCreate = searchParams.get("create") === "1";
  const editingId = searchParams.get("edit") ?? undefined;
  const [createInput, setCreateInput] = useState<TripInput>(emptyInput);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [tripToDelete, setTripToDelete] = useState<Trip>();
  const readOnly = offline || current.readOnly;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      if (search.trim()) setPastOpen(true);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(localToday()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (readOnly || !createInput.name.trim()) return;
    trackBehavior("trip_creation_submitted");
    setBusyId("new");
    setError(undefined);
    try {
      const created = await createTrip(user.id, createInput);
      trackBehavior("trip_created");
      setTrips((current) => [created, ...(current ?? [])]);
      setSearch("");
      setQuery("");
      current.refresh();
      setCreateInput(emptyInput);
      setSearchParams({}, { replace: true });
    } catch (reason) {
      trackBehavior("trip_creation_failed");
      setError(errorMessage(reason));
    } finally {
      setBusyId(undefined);
    }
  }

  function startEditing(trip: Trip) {
    if (readOnly) return;
    setSearchParams({ edit: trip.id });
    setError(undefined);
  }

  async function removeTrip(trip: Trip) {
    if (readOnly) return;
    setBusyId(trip.id);
    setError(undefined);
    try {
      await deleteTrip(user.id, trip.id);
      setTrips((current) => current?.filter((item) => item.id !== trip.id));
      past.setTrips((items) => items?.filter((item) => item.id !== trip.id));
      current.refresh();
      past.refresh();
      setTripToDelete(undefined);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyId(undefined);
    }
  }

  const renderTrips = (items: Trip[]) => (
    <div className="trip-grid">
      {items.map((trip) => (
        <Card key={trip.id} className="trip-card interactive-card">
          {!readOnly &&
          editingId === trip.id &&
          trip.ownerUserId === user.id ? (
            <TripMetadataEditor
              key={trip.id}
              trip={trip}
              userId={user.id}
              onSaved={(updated) => {
                const replace = (items: Trip[] | undefined) =>
                  items?.map((item) =>
                    item.id === updated.id ? updated : item,
                  );
                setTrips(replace);
                past.setTrips(replace);
              }}
              onClose={() => {
                setSearchParams({}, { replace: true });
                current.refresh();
                past.refresh();
              }}
            />
          ) : (
            <>
              {(!readOnly || hasOfflineTrip(user.id, trip.id)) && (
                <Link
                  className="trip-card-link card-action"
                  to={`/trips/${encodeURIComponent(trip.id)}`}
                  aria-label={`Open trip: ${trip.name}`}
                />
              )}
              {readOnly && !hasOfflineTrip(user.id, trip.id) && (
                <Text size={200}>Connect to open this trip.</Text>
              )}
              <div className="trip-card-heading">
                <CardHeader
                  header={<Title3 as="h2">{trip.name}</Title3>}
                  description={
                    trip.description || trip.ownerUserId !== user.id ? (
                      <Text>
                        {trip.description}
                        {trip.ownerUserId !== user.id &&
                          trip.description &&
                          " · "}
                        {trip.ownerUserId !== user.id && "Shared with you"}
                      </Text>
                    ) : undefined
                  }
                />
                {trip.ownerUserId === user.id && (
                  <details className="trip-card-menu">
                    <summary
                      role="button"
                      aria-label={`Options for ${trip.name}`}
                      aria-disabled={readOnly || busyId === trip.id}
                      onClick={(event) => {
                        if (readOnly || busyId === trip.id)
                          event.preventDefault();
                      }}
                    >
                      ...
                    </summary>
                    <div
                      className="trip-card-menu-panel"
                      role="group"
                      aria-label={`${trip.name} actions`}
                    >
                      <button
                        type="button"
                        disabled={readOnly || busyId === trip.id}
                        onClick={(event) => {
                          event.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                          startEditing(trip);
                        }}
                      >
                        <Edit24Regular aria-hidden="true" />
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={readOnly || busyId === trip.id}
                        onClick={(event) => {
                          event.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                          setError(undefined);
                          setTripToDelete(trip);
                        }}
                      >
                        <Delete24Regular aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </details>
                )}
              </div>
              <TripDateSummary
                trip={trip}
                dateText={formatTripDates(trip) ?? ""}
              />
            </>
          )}
        </Card>
      ))}
    </div>
  );

  return (
    <section className="trips-dashboard" aria-label="Your trips">
      <div className="dashboard-heading">
        <Button
          appearance="primary"
          disabled={readOnly}
          size="large"
          icon={<Add24Regular />}
          onClick={() => {
            setSearchParams({ create: "1" });
          }}
        >
          New trip
        </Button>
        <Input
          type="search"
          aria-label="Search trips"
          placeholder="Search trips"
          contentBefore={<Search24Regular />}
          value={search}
          maxLength={200}
          onChange={(_, data) => setSearch(data.value)}
        />
      </div>

      <OfflineNotice
        offline={!offline && current.readOnly}
        onRetry={() => {
          current.refresh();
          past.refresh();
        }}
      />
      {(error || current.error) && !tripToDelete && (
        <Text role="alert">{error ?? current.error}</Text>
      )}
      {current.error && !readOnly && (
        <Button onClick={current.refresh}>Retry loading trips</Button>
      )}

      {showCreate && !readOnly && (
        <Card className="trip-editor">
          <Title3 as="h2">Create a trip</Title3>
          <TripForm
            input={createInput}
            onChange={setCreateInput}
            onSubmit={submitCreate}
            onCancel={() => {
              trackBehavior("trip_creation_cancelled");
              setSearchParams({}, { replace: true });
              setCreateInput(emptyInput);
            }}
            submitLabel="Create trip"
            busy={busyId === "new"}
          />
        </Card>
      )}

      {!trips ? (
        <TripsSkeleton />
      ) : trips.length === 0 && !showCreate ? (
        <Card className="empty-trips" appearance="filled-alternative">
          <Title3 as="h2">
            {query ? "No matching upcoming trips" : "No upcoming trips"}
          </Title3>
        </Card>
      ) : (
        renderTrips(trips)
      )}
      {current.hasMore && (
        <Button
          className="trip-load-more"
          disabled={current.loadingMore}
          onClick={() => void current.loadMore()}
        >
          {current.loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
      {current.loadingMore && <TripsSkeleton />}

      <section className="past-trips" aria-label="Past trips">
        <Button
          appearance="secondary"
          aria-expanded={pastOpen}
          aria-controls="past-trips-list"
          icon={pastOpen ? <ChevronDown24Regular /> : <ChevronRight24Regular />}
          onClick={() => setPastOpen((value) => !value)}
        >
          Past trips
        </Button>
        {pastOpen && (
          <div id="past-trips-list" className="past-trips-content">
            {!past.trips ? (
              <TripsSkeleton />
            ) : past.trips.length ? (
              renderTrips(past.trips)
            ) : (
              <Text>{query ? "No matching past trips" : "No past trips"}</Text>
            )}
            {past.error && <Text role="alert">{past.error}</Text>}
            {past.error && !past.readOnly && (
              <Button onClick={past.refresh}>Retry loading past trips</Button>
            )}
            {past.hasMore && (
              <Button
                className="trip-load-more"
                disabled={past.loadingMore}
                onClick={() => void past.loadMore()}
              >
                {past.loadingMore ? "Loading…" : "Load more past trips"}
              </Button>
            )}
            {past.loadingMore && <TripsSkeleton />}
          </div>
        )}
      </section>
      {tripToDelete && !readOnly && (
        <DeleteTripDialog
          trip={tripToDelete}
          busy={busyId === tripToDelete.id}
          error={error}
          onCancel={() => {
            setTripToDelete(undefined);
            setError(undefined);
          }}
          onDelete={() => void removeTrip(tripToDelete)}
        />
      )}
    </section>
  );
}

function DeleteTripDialog({
  trip,
  busy,
  error,
  onCancel,
  onDelete,
}: {
  trip: Trip;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="trip-delete-dialog"
      aria-labelledby="trip-delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <Title3 as="h2" id="trip-delete-title">
        Delete trip?
      </Title3>
      <p>
        Delete <strong>{trip.name}</strong> and its planning details? This
        cannot be undone.
      </p>
      {error && <Text role="alert">{error}</Text>}
      <div className="trip-delete-actions">
        <Button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          appearance="primary"
          disabled={busy}
          onClick={onDelete}
        >
          {busy ? "Deleting…" : "Delete trip"}
        </Button>
      </div>
    </dialog>
  );
}

type TripFormProps = {
  input: TripInput;
  onChange: (input: TripInput) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  submitLabel: string;
  busy: boolean;
};

function TripForm({
  input,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
}: TripFormProps) {
  return (
    <form className="trip-form" onSubmit={onSubmit}>
      <Field label="Trip name" required>
        <Input
          value={input.name}
          maxLength={200}
          onChange={(_, data) => onChange({ ...input, name: data.value })}
          autoFocus
        />
      </Field>
      <Field label="Description">
        <Textarea
          value={input.description}
          maxLength={4000}
          resize="vertical"
          onChange={(_, data) =>
            onChange({ ...input, description: data.value })
          }
        />
      </Field>
      <div className="trip-form-actions">
        <Button type="submit" appearance="primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" appearance="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Something went wrong.";
}
