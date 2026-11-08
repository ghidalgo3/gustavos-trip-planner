import {
  refreshConflictedResource,
  useExplicitResourceRefresh,
  useTripDocumentState,
} from "../../api/tripDocumentStore";
import { useState } from "react";
import { Button, Text } from "@fluentui/react-components";
import { planningRequest, type Versioned } from "../activities/activityPlanApi";
import type {
  Activity,
  DestinationCollection,
} from "../activities/activitiesApi";
import {
  durationFromMinutes,
  durationMinutes,
} from "../../shared/time/durations";

type Endpoint = {
  placeId?: string | null;
  activityId?: string | null;
  visitId?: string | null;
};
export type TravelConnection = {
  id: string;
  name: string;
  from: Endpoint;
  to: Endpoint;
  mode: string | null;
  modeSelectedBy?: string;
  departureDate?: string | null;
  departureTime?: string | null;
  timeZone?: string | null;
  durationOverride?: string | null;
  serviceId?: string | null;
  segments?: {
    mode: string;
    from: Endpoint;
    to: Endpoint;
    duration: string | null;
  }[];
};
export type TravelPlan = { connections: TravelConnection[]; version: number };
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

export default function TripTravelEditor({
  tripId,
  destinations,
  activities,
  readOnly,
  value,
}: {
  tripId: string;
  destinations: DestinationCollection;
  activities: (Activity & { destinationId?: string })[];
  readOnly: boolean;
  value: TravelPlan;
}) {
  const [resource, setResource] = useState<Versioned<TravelPlan>>();
  const [draft, setDraft] = useState<TravelConnection[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `/trips/${tripId}/travel`;
  const document = useTripDocumentState();
  const homeZone =
    document.document?.places?.find((p) => p.id.endsWith(":place:home"))
      ?.timeZone ?? null;
  const endpoints = [
    {
      key: "home",
      label: "Home",
      endpoint: { placeId: `urn:tripplanner:${tripId}:place:home` } as Endpoint,
      zone: homeZone as string | null,
    },
    ...(document.document?.places ?? [])
      .filter(
        (p) => !p.id.endsWith(":place:home") && /:place:airport%3A/i.test(p.id),
      )
      .map((p) => ({
        key: `place:${p.id}`,
        label: p.name,
        endpoint: { placeId: p.id } as Endpoint,
        zone: p.timeZone ?? null,
      })),
    ...destinations.features.flatMap((d) =>
      d.properties.stays.map((v) => ({
        key: `visit:${v.id}`,
        label: `${d.properties.name} · ${v.arrivalDate ?? "Undated visit"} · visit ${v.order + 1}`,
        endpoint: { visitId: v.id } as Endpoint,
        zone: d.properties.timeZone ?? null,
      })),
    ),
    ...activities.map((a) => ({
      key: `activity:${a.id}`,
      label: a.properties.name,
      endpoint: { activityId: a.id } as Endpoint,
      zone:
        destinations.features.find((d) => d.id === a.destinationId)?.properties
          .timeZone ?? null,
    })),
  ];
  const keyOf = (endpoint: Endpoint) =>
    endpoint.activityId
      ? `activity:${endpoint.activityId}`
      : endpoint.visitId
        ? `visit:${endpoint.visitId}`
        : endpoint.placeId?.endsWith(":home")
          ? "home"
          : endpoint.placeId
            ? `place:${endpoint.placeId}`
            : "";
  function update(id: string, change: Partial<TravelConnection>) {
    setDraft((current) =>
      current?.map((c) => (c.id === id ? { ...c, ...change } : c)),
    );
  }
  async function edit() {
    setBusy(true);
    setError("");
    try {
      const loaded = await planningRequest<TravelPlan>(path);
      setResource(loaded);
      setDraft(structuredClone(loaded.data.connections));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useExplicitResourceRefresh(path, edit);
  async function save() {
    if (!draft || !resource) return;
    if (
      draft.some(
        (c) =>
          !c.name.trim() ||
          !keyOf(c.from) ||
          !keyOf(c.to) ||
          keyOf(c.from) === keyOf(c.to),
      )
    ) {
      setError(
        "Give each journey a name and different departure and arrival places.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await planningRequest<TravelPlan>(path, {
        method: "PUT",
        etag: resource.etag,
        body: {
          connections: draft.map(
            ({
              id,
              name,
              from,
              to,
              mode,
              departureDate,
              departureTime,
              timeZone,
              durationOverride,
              serviceId,
              segments,
            }) => ({
              id,
              name,
              from,
              to,
              mode,
              departureDate,
              departureTime,
              timeZone,
              durationOverride,
              serviceId,
              segments,
            }),
          ),
        },
      });
      setDraft(undefined);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="trip-travel" aria-label="Travel connections">
      <details>
        <summary>
          Travel connections
          {value.connections.length > 0 ? ` (${value.connections.length})` : ""}
        </summary>
        <p>
          Plan journeys between activities or visits by foot, bike, road, public
          transport, or flight.
        </p>
        {!draft &&
          value.connections.map((c) => (
            <p key={c.id}>
              <strong>{c.name}</strong> · {c.mode ?? "Choose transport"}
              {c.durationOverride
                ? ` · ${durationMinutes(c.durationOverride)} minutes`
                : " · Duration unknown"}
            </p>
          ))}
        {!draft && !readOnly && (
          <Button
            appearance="primary"
            disabled={busy}
            onClick={() => void edit()}
          >
            Edit travel
          </Button>
        )}
        {draft && (
          <div>
            {draft.map((connection, index) => (
              <fieldset
                key={connection.id}
                disabled={busy || readOnly}
                className="travel-editor-fields"
              >
                <legend>Journey {index + 1}</legend>
                <label>
                  Name
                  <input
                    aria-label={`Journey ${index + 1} name`}
                    value={connection.name}
                    maxLength={200}
                    onChange={(e) =>
                      update(connection.id, { name: e.target.value })
                    }
                  />
                </label>
                {(["from", "to"] as const).map((direction) => (
                  <label key={direction}>
                    {direction === "from" ? "From" : "To"}
                    <select
                      aria-label={`Journey ${index + 1} ${direction}`}
                      value={keyOf(connection[direction])}
                      onChange={(e) => {
                        const selected = endpoints.find(
                          (x) => x.key === e.target.value,
                        );
                        if (selected)
                          update(connection.id, {
                            [direction]: selected.endpoint,
                            ...(direction === "from"
                              ? { timeZone: selected.zone }
                              : {}),
                          });
                      }}
                    >
                      <option value="">Choose a place</option>
                      {endpoints.map((e) => (
                        <option key={e.key} value={e.key}>
                          {e.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  Transport
                  <select
                    aria-label={`Journey ${index + 1} transport`}
                    value={connection.mode ?? ""}
                    onChange={(e) =>
                      update(connection.id, { mode: e.target.value || null })
                    }
                  >
                    <option value="">Decide later</option>
                    {modes.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Travel allowance (minutes)
                  <input
                    aria-label={`Journey ${index + 1} minutes`}
                    type="number"
                    min={0}
                    max={525600}
                    value={
                      connection.durationOverride
                        ? durationMinutes(connection.durationOverride)
                        : ""
                    }
                    onChange={(e) =>
                      update(connection.id, {
                        durationOverride:
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
                    aria-label={`Journey ${index + 1} date`}
                    type="date"
                    value={connection.departureDate ?? ""}
                    onChange={(e) =>
                      update(connection.id, {
                        departureDate: e.target.value || null,
                      })
                    }
                  />
                </label>
                <label>
                  Departure time
                  <input
                    aria-label={`Journey ${index + 1} time`}
                    type="time"
                    value={connection.departureTime?.slice(0, 5) ?? ""}
                    onChange={(e) =>
                      update(connection.id, {
                        departureTime: e.target.value
                          ? `${e.target.value}:00`
                          : null,
                      })
                    }
                  />
                </label>
                {connection.timeZone && (
                  <Text size={200}>
                    Departure time in {connection.timeZone}
                  </Text>
                )}
                <Button
                  onClick={() =>
                    setDraft(draft.filter((c) => c.id !== connection.id))
                  }
                >
                  Remove journey
                </Button>
              </fieldset>
            ))}
            <div className="travel-editor-actions">
              <Button
                disabled={busy || readOnly}
                onClick={() =>
                  setDraft([
                    ...draft,
                    {
                      id: crypto.randomUUID(),
                      name: "Travel",
                      from: {},
                      to: {},
                      mode: null,
                    },
                  ])
                }
              >
                Add journey
              </Button>
              <Button
                appearance="primary"
                disabled={busy || readOnly}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save travel"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setDraft(undefined);
                  setError("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert">
            {error}{" "}
            <Button
              disabled={busy}
              onClick={() => void refreshConflictedResource().then(edit)}
            >
              Refresh travel
            </Button>
          </p>
        )}
      </details>
    </section>
  );
}
