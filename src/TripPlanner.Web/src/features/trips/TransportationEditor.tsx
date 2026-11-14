import { useState } from "react";
import { Button } from "@fluentui/react-components";
import {
  cachedTripResource,
  refreshConflictedResource,
  useTripDocumentState,
} from "../../api/tripDocumentStore";
import { planningRequest } from "../activities/activityPlanApi";
import {
  durationFromMinutes,
  durationMinutes,
} from "../../shared/time/durations";
import {
  saveTransportation,
  type Transportation,
  type TransportationFeature,
  type TransportationReference,
} from "./transportationApi";

const modes = [
  "walk",
  "bike",
  "car",
  "taxi",
  "bus",
  "train",
  "transit",
  "flight",
];
const endpoint = (id: string): TransportationFeature => ({
  type: "Feature",
  id,
  geometry: null,
  properties: { name: "", address: "", reference: null },
});

export default function TransportationEditor({
  tripId,
  readOnly,
}: {
  tripId: string;
  readOnly: boolean;
}) {
  const document = useTripDocumentState().document?.document;
  const values =
    cachedTripResource<Transportation[]>(`/trips/${tripId}/transportation`) ??
    [];
  const [draft, setDraft] = useState<Transportation>();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choices: {
    key: string;
    label: string;
    reference: TransportationReference;
    zone?: string;
  }[] = [
    ...(document?.people ?? []).map((p) => ({
      key: `home:${p.id}`,
      label: `${p.name} · Home`,
      reference: { kind: "home" as const, id: String(p.id) },
    })),
    ...(document?.places ?? [])
      .filter((p) => p.hotelId || p.airportId)
      .map((p) => ({
        key: `${p.hotelId ? "hotel" : "airport"}:${p.hotelId ?? p.airportId}`,
        label: String(p.name),
        reference: {
          kind: p.hotelId ? ("hotel" as const) : ("airport" as const),
          id: String(p.hotelId ?? p.airportId),
        },
        zone: typeof p.timeZone === "string" ? p.timeZone : undefined,
      })),
    ...(document?.itinerary.items ?? [])
      .filter((i) => i.kind === "activity")
      .map((i) => ({
        key: `activity:${i.id}`,
        label: String(i.name),
        reference: { kind: "activity" as const, id: String(i.id) },
      })),
  ];
  function update(change: Partial<Transportation>) {
    setDraft((current) => current && { ...current, ...change });
  }
  function updateEndpoint(id: string, change: Partial<TransportationFeature>) {
    setDraft(
      (current) =>
        current && {
          ...current,
          features: current.features.map((f) =>
            f.id === id ? { ...f, ...change } : f,
          ),
        },
    );
  }
  async function save() {
    if (!draft) return;
    if (
      !draft.name.trim() ||
      draft.features
        .filter((f) => f.id === "from" || f.id === "to")
        .some(
          (f) =>
            !f.properties.reference &&
            (!f.properties.name?.trim() ||
              f.geometry?.type !== "Point" ||
              !f.geometry.coordinates.every(Number.isFinite)),
        )
    ) {
      setError("Give the journey a name and select or locate both endpoints.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveTransportation(tripId, draft, creating);
      setDraft(undefined);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(value: Transportation) {
    setBusy(true);
    setError("");
    try {
      await planningRequest(`/trips/${tripId}/transportation/${value.id}`, {
        method: "DELETE",
        etag: `"${value.etag}"`,
      });
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="trip-travel" aria-label="Transportation">
      <details>
        <summary>
          Transportation{values.length ? ` (${values.length})` : ""}
        </summary>
        {values.map((value) => (
          <article key={value.id}>
            <strong>{value.name}</strong>
            <p>
              {value.mode ?? "Choose transport"}
              {value.duration
                ? ` · ${durationMinutes(value.duration)} minutes`
                : ""}
            </p>
            {value.notes && (
              <p style={{ whiteSpace: "pre-wrap" }}>{value.notes}</p>
            )}
            {value.routeStale && <p role="status">Route needs review</p>}
            {value.features
              .filter((f) => f.id !== "from" && f.id !== "to")
              .sort(
                (a, b) =>
                  (a.properties.sequence ?? 0) - (b.properties.sequence ?? 0),
              )
              .map((f) => (
                <p key={f.id}>
                  {[
                    f.properties.line,
                    f.properties.direction,
                    f.properties.instructions,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ))}
            {!readOnly && (
              <>
                <Button
                  disabled={busy || !!draft}
                  onClick={() => {
                    setDraft(structuredClone(value));
                    setCreating(false);
                    setError("");
                  }}
                >
                  Edit journey
                </Button>
                <Button
                  disabled={busy || !!draft}
                  onClick={() => void remove(value)}
                >
                  Remove journey
                </Button>
              </>
            )}
          </article>
        ))}
        {!readOnly && !draft && (
          <Button
            appearance="primary"
            disabled={busy}
            onClick={() => {
              setCreating(true);
              setError("");
              setDraft({
                type: "FeatureCollection",
                id: "",
                name: "Travel",
                notes: "",
                features: [endpoint("from"), endpoint("to")],
                mode: null,
                departureDate: null,
                departureTime: null,
                timeZone: null,
                duration: null,
                version: 0,
                etag: "",
                routeStale: false,
              });
            }}
          >
            Add journey
          </Button>
        )}
        {draft && (
          <fieldset
            disabled={busy || readOnly}
            className="travel-editor-fields"
          >
            <legend>{creating ? "New journey" : draft.name}</legend>
            <label>
              Name
              <input
                aria-label="Journey name"
                maxLength={200}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              Notes
              <textarea
                aria-label="Journey notes"
                maxLength={10000}
                value={draft.notes}
                onChange={(e) => update({ notes: e.target.value })}
              />
            </label>
            {(["from", "to"] as const).map((id) => {
              const f = draft.features.find((f) => f.id === id)!;
              const r = f.properties.reference;
              return (
                <fieldset key={id}>
                  <legend>{id === "from" ? "From" : "To"}</legend>
                  <label>
                    Location
                    <select
                      aria-label={`Journey ${id}`}
                      value={r ? `${r.kind}:${r.id}` : "point"}
                      onChange={(e) => {
                        const choice = choices.find(
                          (c) => c.key === e.target.value,
                        );
                        updateEndpoint(
                          id,
                          choice
                            ? {
                                geometry: null,
                                properties: { reference: choice.reference },
                              }
                            : {
                                geometry: null,
                                properties: {
                                  name: "",
                                  address: "",
                                  reference: null,
                                },
                              },
                        );
                        if (id === "from" && choice?.zone)
                          update({ timeZone: choice.zone });
                      }}
                    >
                      <option value="point">Enter location</option>
                      {choices.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!r && (
                    <>
                      <label>
                        Name
                        <input
                          aria-label={`${id} name`}
                          maxLength={200}
                          value={f.properties.name ?? ""}
                          onChange={(e) =>
                            updateEndpoint(id, {
                              properties: {
                                ...f.properties,
                                name: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Address
                        <input
                          aria-label={`${id} address`}
                          maxLength={2000}
                          value={f.properties.address ?? ""}
                          onChange={(e) =>
                            updateEndpoint(id, {
                              properties: {
                                ...f.properties,
                                address: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      {(["Longitude", "Latitude"] as const).map(
                        (label, index) => (
                          <label key={label}>
                            {label}
                            <input
                              aria-label={`${id} ${label.toLowerCase()}`}
                              type="number"
                              min={index ? -90 : -180}
                              max={index ? 90 : 180}
                              step="any"
                              value={
                                f.geometry?.type === "Point"
                                  ? Number.isFinite(
                                      f.geometry.coordinates[index],
                                    )
                                    ? f.geometry.coordinates[index]
                                    : ""
                                  : ""
                              }
                              onChange={(e) => {
                                const coordinates: [number, number] =
                                  f.geometry?.type === "Point"
                                    ? [...f.geometry.coordinates]
                                    : [Number.NaN, Number.NaN];
                                coordinates[index] = Number(e.target.value);
                                updateEndpoint(id, {
                                  geometry:
                                    e.target.value === ""
                                      ? null
                                      : { type: "Point", coordinates },
                                });
                              }}
                            />
                          </label>
                        ),
                      )}
                    </>
                  )}
                </fieldset>
              );
            })}
            <label>
              Transport
              <select
                aria-label="Journey transport"
                value={draft.mode ?? ""}
                onChange={(e) => update({ mode: e.target.value || null })}
              >
                <option value="">Decide later</option>
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Travel allowance (minutes)
              <input
                aria-label="Journey minutes"
                type="number"
                min={0}
                max={525600}
                value={draft.duration ? durationMinutes(draft.duration) : ""}
                onChange={(e) =>
                  update({
                    duration:
                      e.target.value === ""
                        ? null
                        : durationFromMinutes(Number(e.target.value)),
                  })
                }
              />
            </label>
            <label>
              Departure date
              <input
                aria-label="Journey date"
                type="date"
                value={draft.departureDate ?? ""}
                onChange={(e) =>
                  update({ departureDate: e.target.value || null })
                }
              />
            </label>
            <label>
              Departure time
              <input
                aria-label="Journey time"
                type="time"
                value={draft.departureTime?.slice(0, 5) ?? ""}
                onChange={(e) =>
                  update({
                    departureTime: e.target.value
                      ? `${e.target.value}:00`
                      : null,
                  })
                }
              />
            </label>
            <label>
              Time zone
              <input
                aria-label="Journey time zone"
                value={draft.timeZone ?? ""}
                onChange={(e) => update({ timeZone: e.target.value || null })}
              />
            </label>
            <div>
              <Button appearance="primary" onClick={() => void save()}>
                {busy ? "Saving…" : "Save journey"}
              </Button>
              <Button
                onClick={() => {
                  setDraft(undefined);
                  setError("");
                }}
              >
                Cancel
              </Button>
            </div>
          </fieldset>
        )}
        {error && (
          <p role="alert">
            {error}{" "}
            <Button
              disabled={busy}
              onClick={() =>
                void refreshConflictedResource().then(() => {
                  if (draft && !creating) {
                    const refreshed = cachedTripResource<Transportation>(
                      `/trips/${tripId}/transportation/${draft.id}`,
                    );
                    if (refreshed) setDraft(structuredClone(refreshed));
                  }
                  setError("");
                })
              }
            >
              Refresh transportation
            </Button>
          </p>
        )}
      </details>
    </section>
  );
}
