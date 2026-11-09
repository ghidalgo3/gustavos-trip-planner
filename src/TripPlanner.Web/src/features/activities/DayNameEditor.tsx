import { useId, useState } from "react";
import type { PlanDay } from "./activityPlanApi";

export default function DayNameEditor({
  day,
  disabled,
  draftDay,
  onCommit,
}: {
  day: PlanDay;
  disabled: boolean;
  draftDay: boolean;
  onCommit: (day: PlanDay, name: string | null) => Promise<void>;
}) {
  const id = useId();
  const confirmed = day.name ?? "";
  const [draft, setDraft] = useState({ baseline: confirmed, value: confirmed });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  if (draft.baseline !== confirmed) {
    setDraft({
      baseline: confirmed,
      value: error ? draft.value : confirmed,
    });
  }

  async function commit() {
    if (disabled || saving) return;
    const name = draft.value.trim() || null;
    if ((name?.length ?? 0) > 200) {
      setError("Use 200 characters or fewer.");
      return;
    }
    if (name === (day.name ?? null)) {
      setDraft({ baseline: confirmed, value: confirmed });
      setError("");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onCommit(day, name);
      setSaved(true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save the day name.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agenda-day-name-editor">
      <label htmlFor={id}>Day name (optional)</label>
      <input
        id={id}
        type="text"
        maxLength={200}
        value={draft.value}
        disabled={disabled || saving}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setDraft({ baseline: confirmed, value: event.target.value });
          setError("");
          setSaved(false);
        }}
        onBlur={() => void commit()}
      />
      {saving && <p role="status">Saving…</p>}
      {!saving && saved && (
        <p role="status">{draftDay ? "Unsaved day" : "Saved"}</p>
      )}
      {error && (
        <div className="agenda-day-name-error">
          <p role="alert" id={`${id}-error`}>
            {error}
          </p>
          <button
            type="button"
            disabled={disabled || saving}
            onClick={() => void commit()}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
