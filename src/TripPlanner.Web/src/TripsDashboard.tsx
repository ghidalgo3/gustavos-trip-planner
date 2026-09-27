import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
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
  updateTrip,
  type CurrentUser,
  type Trip,
  type TripInput,
} from "./api";

type Props = { user: CurrentUser & { id: string } };

const emptyInput: TripInput = { name: "", description: "" };

export default function TripsDashboard({ user }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [trips, setTrips] = useState<Trip[]>();
  const showCreate = searchParams.get("create") === "1";
  const editingId = searchParams.get("edit") ?? undefined;
  const [createInput, setCreateInput] = useState<TripInput>(emptyInput);
  const [editDraft, setEditDraft] = useState<{
    tripId: string;
    input: TripInput;
  }>();
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
    setBusyId("new");
    setError(undefined);
    try {
      const created = await createTrip(user.id, createInput);
      setTrips((current) => [created, ...(current ?? [])]);
      setCreateInput(emptyInput);
      setSearchParams({}, { replace: true });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyId(undefined);
    }
  }

  function startEditing(trip: Trip) {
    setSearchParams({ edit: trip.id });
    setEditDraft(undefined);
    setError(undefined);
  }

  async function submitEdit(event: FormEvent, tripId: string) {
    event.preventDefault();
    const original = trips?.find((trip) => trip.id === tripId);
    const editInput =
      editDraft?.tripId === tripId
        ? editDraft.input
        : {
            name: original?.name ?? "",
            description: original?.description ?? "",
          };
    if (!editInput.name.trim()) return;
    setBusyId(tripId);
    setError(undefined);
    try {
      const updated = await updateTrip(user.id, tripId, editInput);
      setTrips((current) =>
        current?.map((trip) => (trip.id === tripId ? updated : trip)),
      );
      setSearchParams({}, { replace: true });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyId(undefined);
    }
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
              setSearchParams({}, { replace: true });
              setCreateInput(emptyInput);
            }}
            submitLabel="Create trip"
            busy={busyId === "new"}
          />
        </Card>
      )}

      {!trips ? (
        <Spinner label="Loading your trips" />
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
                <TripForm
                  input={
                    editDraft?.tripId === trip.id
                      ? editDraft.input
                      : { name: trip.name, description: trip.description }
                  }
                  onChange={(input) => setEditDraft({ tripId: trip.id, input })}
                  onSubmit={(event) => submitEdit(event, trip.id)}
                  onCancel={() => setSearchParams({}, { replace: true })}
                  submitLabel="Save changes"
                  busy={busyId === trip.id}
                />
              ) : (
                <>
                  <CardHeader
                    header={<Title3 as="h2">{trip.name}</Title3>}
                    description={
                      <Text>
                        {trip.description || "No description yet."}
                        {trip.ownerUserId !== user.id && " · Shared with you"}
                      </Text>
                    }
                  />
                  <div className="trip-actions">
                    <Button
                      appearance="primary"
                      onClick={() =>
                        navigate(`/trips/${encodeURIComponent(trip.id)}`)
                      }
                      disabled={busyId !== undefined}
                    >
                      {trip.ownerUserId === user.id
                        ? "Find flights"
                        : "View trip"}
                    </Button>
                    {trip.ownerUserId === user.id && (
                      <Button
                        appearance="subtle"
                        icon={<Edit24Regular />}
                        onClick={() => startEditing(trip)}
                        disabled={busyId === trip.id}
                      >
                        Edit
                      </Button>
                    )}
                    {trip.ownerUserId === user.id && (
                      <Button
                        appearance="subtle"
                        icon={<Delete24Regular />}
                        onClick={() => {
                          setError(undefined);
                          setTripToDelete(trip);
                        }}
                        disabled={busyId === trip.id}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={Boolean(tripToDelete)}
        onOpenChange={(_, data) => {
          if (!data.open && busyId !== tripToDelete?.id) {
            setTripToDelete(undefined);
            setError(undefined);
          }
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Delete trip?</DialogTitle>
            <DialogContent>
              Delete <strong>{tripToDelete?.name}</strong> and its planning
              details? This cannot be undone.
              {error && <Text role="alert">{error}</Text>}
            </DialogContent>
            <DialogActions>
              <Button
                disabled={busyId === tripToDelete?.id}
                onClick={() => {
                  setTripToDelete(undefined);
                  setError(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                disabled={busyId === tripToDelete?.id}
                onClick={() => tripToDelete && void removeTrip(tripToDelete)}
              >
                {busyId === tripToDelete?.id ? "Deleting…" : "Delete trip"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
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
