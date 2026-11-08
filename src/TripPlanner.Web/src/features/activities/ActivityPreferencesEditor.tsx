import { useExplicitResourceRefresh } from "../../api/tripDocumentStore";
import { PreferencesSkeleton } from "./ActivityPlanningSkeletons";
import { useActionToast } from "../../shared/hooks/useActionToast";
import { useState } from "react";
import {
  planningRequest,
  type Preferences,
  type Versioned,
} from "./activityPlanApi";

export default function ActivityPreferencesEditor({
  path,
  label,
  readOnly = false,
  onSaved,
}: {
  path: string;
  label: string;
  readOnly?: boolean;
  onSaved?: () => void;
}) {
  useExplicitResourceRefresh(path, () => load());
  const [resource, setResource] = useState<Versioned<Preferences>>();
  const [text, setText] = useState("");
  const { notify, toaster } = useActionToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  async function load() {
    setBusy(true);
    try {
      const value = await planningRequest<Preferences>(path);
      setResource(value);
      setText(value.data.instructions);
      setOpen(true);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!resource || readOnly || busy || text === resource.data.instructions)
      return;
    setBusy(true);
    setSaveError(undefined);
    try {
      const value = await planningRequest<Preferences>(path, {
        method: "PUT",
        etag: resource.etag,
        body: { ...resource.data, instructions: text },
      });
      setResource(value);
      if (onSaved) onSaved();
    } catch (e) {
      setSaveError((e as Error).message);
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="planning-preferences">
      <button
        type="button"
        disabled={busy}
        aria-expanded={open}
        onClick={() => (resource ? setOpen(!open) : void load())}
      >
        {label}
      </button>
      {toaster}
      {busy && !open && <PreferencesSkeleton label={label} />}
      {open && resource && (
        <div>
          <label>
            {label}
            <textarea
              value={text}
              readOnly={readOnly}
              disabled={busy}
              maxLength={10000}
              rows={4}
              onChange={(e) => {
                setText(e.target.value);
                setSaveError(undefined);
              }}
              onBlur={() => void save()}
            />
          </label>
          <p>
            Describe interests and preferences. Destination instructions
            override trip instructions on the same topic. Timing interpreted
            from text needs your confirmation.
          </p>
          {!readOnly && (
            <p role="status">
              {busy
                ? "Saving preferences…"
                : saveError
                  ? "Changes have not been saved."
                  : text === resource.data.instructions
                    ? "Preferences saved."
                    : "Changes save when you leave this field."}
            </p>
          )}
          {saveError && (
            <div>
              <p role="alert">{saveError}</p>
              <button type="button" disabled={busy} onClick={() => void save()}>
                Retry preferences
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
