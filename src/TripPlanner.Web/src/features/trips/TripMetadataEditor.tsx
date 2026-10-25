import { useRef, useState } from "react";
import {
  Button,
  Field,
  Input,
  Text,
  Textarea,
} from "@fluentui/react-components";
import { updateTrip, type Trip, type TripInput } from "../../api/api";

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
    if (writing.current || draft[field] === confirmed.current[field]) return;
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
  return (
    <div className="trip-form">
      <Field label="Trip name" required>
        <Input
          value={draft.name}
          maxLength={200}
          disabled={busy}
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
          resize="vertical"
          onChange={(_, data) => edit("description", data.value)}
          onBlur={() => void save("description")}
        />
      </Field>
      <Text role="status">{status}</Text>
      {error && <Text role="alert">{error}</Text>}
      <div className="trip-form-actions">
        {failedField && (
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
