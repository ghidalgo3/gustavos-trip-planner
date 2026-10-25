import { TripsSkeleton } from "./TripSkeletons";
import TripMetadataEditor from "./TripMetadataEditor";
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
  Title1,
  Title3,
} from "@fluentui/react-components";
import {
  Add24Regular,
  Delete24Regular,
  Edit24Regular,
} from "@fluentui/react-icons";
import {
  createTrip,
  deleteTrip,
  listTrips,
  type CurrentUser,
  type Trip,
  type TripInput,
} from "../../api/api";
import { trackBehavior } from "../../telemetry/telemetry";

type Props = { user: CurrentUser & { id: string } };

const emptyInput: TripInput = { name: "", description: "" };

export default function TripsDashboard({ user }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [trips, setTrips] = useState<Trip[]>();
  const showCreate = searchParams.get("create") === "1";
  const editingId = searchParams.get("edit") ?? undefined;
  const [createInput, setCreateInput] = useState<TripInput>(emptyInput);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [tripToDelete, setTripToDelete] = useState<Trip>();

  useEffect(() => {
    const controller = new AbortController();
    listTrips(user.id, controller.signal)
      .then(setTrips)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(reason));
        }
      });
    return () => controller.abort();
  }, [user.id]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (!createInput.name.trim()) return;
    trackBehavior("trip_creation_submitted");
    setBusyId("new");
    setError(undefined);
    try {
      const created = await createTrip(user.id, createInput);
      trackBehavior("trip_created");
      setTrips((current) => [created, ...(current ?? [])]);
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
    setSearchParams({ edit: trip.id });
    setError(undefined);
  }

  async function removeTrip(trip: Trip) {
    setBusyId(trip.id);
    setError(undefined);
    try {
      await deleteTrip(user.id, trip.id);
      setTrips((current) => current?.filter((item) => item.id !== trip.id));
      setTripToDelete(undefined);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className="trips-dashboard" aria-labelledby="trips-heading">
      <div className="dashboard-heading">
        <div>
          <Text className="eyebrow" weight="semibold">
            YOUR TRIPS
          </Text>
          <Title1 as="h1" id="trips-heading">
            Welcome back, {user.name ?? user.email ?? "traveler"}.
          </Title1>
          <Text>Start with a name. We’ll shape the itinerary together.</Text>
        </div>
        <Button
          appearance="primary"
          size="large"
          icon={<Add24Regular />}
          onClick={() => {
            setSearchParams({ create: "1" });
          }}
        >
          New trip
        </Button>
      </div>

      {error && !tripToDelete && <Text role="alert">{error}</Text>}

      {showCreate && (
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
          <Title3 as="h2">No trips yet</Title3>
          <Text>Create one when you’re ready to start planning.</Text>
        </Card>
      ) : (
        <div className="trip-grid">
          {trips.map((trip) => (
            <Card key={trip.id} className="trip-card">
              {editingId === trip.id && trip.ownerUserId === user.id ? (
                <TripMetadataEditor
                  key={trip.id}
                  trip={trip}
                  userId={user.id}
                  onSaved={(updated) =>
                    setTrips((current) =>
                      current?.map((item) =>
                        item.id === updated.id ? updated : item,
                      ),
                    )
                  }
                  onClose={() => setSearchParams({}, { replace: true })}
                />
              ) : (
                <>
                  <Link
                    className="trip-card-link"
                    to={`/trips/${encodeURIComponent(trip.id)}`}
                    aria-label={`Open trip: ${trip.name}`}
                  />
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
                          aria-disabled={busyId === trip.id}
                          onClick={(event) => {
                            if (busyId === trip.id) event.preventDefault();
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
                            disabled={busyId === trip.id}
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
                            disabled={busyId === trip.id}
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
                </>
              )}
            </Card>
          ))}
        </div>
      )}
      {tripToDelete && (
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
