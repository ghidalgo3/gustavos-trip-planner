import { useActionToast } from "./useActionToast";
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
  const [resource, setResource] = useState<Versioned<Preferences>>();
  const [text, setText] = useState("");
  const { notify, toaster } = useActionToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
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
    if (!resource) return;
    setBusy(true);
    try {
      const value = await planningRequest<Preferences>(path, {
        method: "PUT",
        etag: resource.etag,
        body: { ...resource.data, instructions: text },
      });
      setResource(value);
      if (onSaved) onSaved();
      else notify("Preferences saved.");
    } catch (e) {
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
        onClick={() => (open ? setOpen(false) : void load())}
      >
        {label}
      </button>
      {toaster}
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
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p>
            Describe interests and preferences. Destination instructions
            override trip instructions on the same topic. Timing interpreted
            from text needs your confirmation.
          </p>
          {!readOnly && (
            <button
              type="button"
              className={
                text !== resource.data.instructions ? "planning-primary" : ""
              }
              disabled={busy || text === resource.data.instructions}
              onClick={() => void save()}
            >
              Save preferences
            </button>
          )}
        </div>
      )}
    </section>
  );
}
