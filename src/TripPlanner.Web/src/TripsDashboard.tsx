import { FormEvent, useEffect, useState } from "react";
import {
  Button,
  Card,
  CardHeader,
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
import TripPlanning from "./TripPlanning";

type Props = { user: CurrentUser & { id: string } };

const emptyInput: TripInput = { name: "", description: "" };

export default function TripsDashboard({ user }: Props) {
  const [trips, setTrips] = useState<Trip[]>();
  const [showCreate, setShowCreate] = useState(false);
  const [createInput, setCreateInput] = useState<TripInput>(emptyInput);
  const [editingId, setEditingId] = useState<string>();
  const [editInput, setEditInput] = useState<TripInput>(emptyInput);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [planningTrip, setPlanningTrip] = useState<Trip>();

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
      setShowCreate(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyId(undefined);
    }
  }

  function startEditing(trip: Trip) {
    setEditingId(trip.id);
    setEditInput({ name: trip.name, description: trip.description });
    setError(undefined);
  }

  async function submitEdit(event: FormEvent, tripId: string) {
    event.preventDefault();
    if (!editInput.name.trim()) return;
    setBusyId(tripId);
    setError(undefined);
    try {
      const updated = await updateTrip(user.id, tripId, editInput);
      setTrips((current) =>
        current?.map((trip) => (trip.id === tripId ? updated : trip)),
      );
      setEditingId(undefined);
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
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyId(undefined);
    }
  }

  if (planningTrip) {
    return (
      <TripPlanning
        key={planningTrip.id}
        userId={user.id}
        trip={planningTrip}
        onBack={() => setPlanningTrip(undefined)}
        onSaved={(saved) => {
          setTrips((current) =>
            current?.map((trip) => (trip.id === saved.id ? saved : trip)),
          );
          setPlanningTrip(saved);
        }}
      />
    );
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
            setShowCreate(true);
            setEditingId(undefined);
          }}
        >
          New trip
        </Button>
      </div>

      {error && <Text role="alert">{error}</Text>}

      {showCreate && (
        <Card className="trip-editor">
          <Title3 as="h2">Create a trip</Title3>
          <TripForm
            input={createInput}
            onChange={setCreateInput}
            onSubmit={submitCreate}
            onCancel={() => {
              setShowCreate(false);
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
              {editingId === trip.id ? (
                <TripForm
                  input={editInput}
                  onChange={setEditInput}
                  onSubmit={(event) => submitEdit(event, trip.id)}
                  onCancel={() => setEditingId(undefined)}
                  submitLabel="Save changes"
                  busy={busyId === trip.id}
                />
              ) : (
                <>
                  <CardHeader
                    header={<Title3 as="h2">{trip.name}</Title3>}
                    description={
                      <Text>{trip.description || "No description yet."}</Text>
                    }
                  />
                  <div className="trip-actions">
                    <Button
                      appearance="primary"
                      onClick={() => setPlanningTrip(trip)}
                      disabled={busyId !== undefined}
                    >
                      Plan trip
                    </Button>
                    <Button
                      appearance="subtle"
                      icon={<Edit24Regular />}
                      onClick={() => startEditing(trip)}
                      disabled={busyId === trip.id}
                    >
                      Edit
                    </Button>
                    <Button
                      appearance="subtle"
                      icon={<Delete24Regular />}
                      onClick={() => removeTrip(trip)}
                      disabled={busyId === trip.id}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
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
