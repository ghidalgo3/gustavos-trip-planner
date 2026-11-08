import { ResourceConflictError } from "../../api/tripDocumentStore";
import { useRef, useState } from "react";
import {
  Button,
  Field,
  Input,
  Text,
  Textarea,
} from "@fluentui/react-components";
import { getTrip, updateTrip, type Trip, type TripInput } from "../../api/api";

export default function TripMetadataEditor({
  trip,
  userId,
  onSaved,
  onClose,
}: {
  trip: Trip;
  userId: string;
  onSaved: (trip: Trip) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TripInput>({
    name: trip.name,
    description: trip.description,
  });
  const confirmed = useRef<TripInput>({
    name: trip.name,
    description: trip.description,
  });
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [previousDraft, setPreviousDraft] = useState<TripInput>();
  const [error, setError] = useState<string>();
  const [failedField, setFailedField] = useState<keyof TripInput>();
  const [status, setStatus] = useState(
    "Changes save when you leave each field.",
  );

  function edit(field: keyof TripInput, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(undefined);
    setFailedField(undefined);
    setStatus("Changes save when you leave each field.");
  }

  async function save(field: keyof TripInput) {
    if (
      conflict ||
      writing.current ||
      draft[field] === confirmed.current[field]
    )
      return;
    if (field === "name" && (!draft.name.trim() || draft.name.length > 200)) {
      setError("Enter a trip name of up to 200 characters.");
      return;
    }
    if (field === "description" && draft.description.length > 4000) {
      setError("Enter a description of up to 4,000 characters.");
      return;
    }
    writing.current = true;
    setBusy(true);
    setError(undefined);
    setFailedField(undefined);
    setStatus("Saving trip…");
    try {
      const saved = await updateTrip(userId, trip.id, {
        ...confirmed.current,
        [field]: draft[field],
      });
      confirmed.current = { name: saved.name, description: saved.description };
      setDraft((current) => ({ ...current, [field]: saved[field] }));
      onSaved(saved);
      const other = field === "name" ? "description" : "name";
      setStatus(
        draft[other] === confirmed.current[other]
          ? "Trip changes saved."
          : "Other edits have not been saved yet.",
      );
    } catch (reason) {
      if (reason instanceof ResourceConflictError) setConflict(true);
      setError(
        reason instanceof Error ? reason.message : "Could not update the trip.",
      );
      setFailedField(field);
      setStatus("Changes have not been saved.");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    try {
      const latest = await getTrip(userId, trip.id, undefined, true);
      setPreviousDraft(draft);
      confirmed.current = {
        name: latest.name,
        description: latest.description,
      };
      setDraft(confirmed.current);
      setConflict(false);
      setFailedField(undefined);
      setError(undefined);
      setStatus("Latest trip loaded. Previous edits have not been reapplied.");
      onSaved(latest);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="trip-form">
      <Field label="Trip name" required>
        <Input
          value={draft.name}
          maxLength={200}
          disabled={busy}
          readOnly={conflict}
          autoFocus
          onChange={(_, data) => edit("name", data.value)}
          onBlur={() => void save("name")}
        />
      </Field>
      <Field label="Description">
        <Textarea
          value={draft.description}
          maxLength={4000}
          disabled={busy}
          readOnly={conflict}
          resize="vertical"
          onChange={(_, data) => edit("description", data.value)}
          onBlur={() => void save("description")}
        />
      </Field>
      <Text role="status">{status}</Text>
      {error && <Text role="alert">{error}</Text>}
      {previousDraft && (
        <details>
          <summary>Previous unsaved edits</summary>
          <p>{previousDraft.name}</p>
          <p>{previousDraft.description}</p>
        </details>
      )}
      <div className="trip-form-actions">
        {conflict && (
          <Button
            appearance="primary"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh trip
          </Button>
        )}
        {failedField && !conflict && (
          <Button disabled={busy} onClick={() => void save(failedField)}>
            Retry trip changes
          </Button>
        )}
        <Button
          disabled={busy}
          onClick={() => {
            if (
              draft.name !== confirmed.current.name ||
              draft.description !== confirmed.current.description
            ) {
              setError(
                "Finish editing or retry the unsaved changes before closing.",
              );
              return;
            }
            onClose();
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
