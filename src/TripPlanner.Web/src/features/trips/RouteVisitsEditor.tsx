import { Button, Card, Field, Input, Text } from "@fluentui/react-components";
import { Add20Regular } from "@fluentui/react-icons";
import FlightAirportPicker from "../flights/FlightAirportPicker";
import type { PlannedVisit, PlanningDocument } from "../flights/planningApi";

export default function RouteVisitsEditor({
  document,
  onChange,
}: {
  document: PlanningDocument;
  onChange: (document: PlanningDocument) => void;
}) {
  const visits = document.visits ?? [];
  const limits = document.searchLimits ?? {
    flexibilityDays: 5,
    maxTripDays: 21,
  };
  function update(id: string, patch: Partial<PlannedVisit>) {
    onChange({
      ...document,
      visits: visits.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    });
  }
  if (!visits.length)
    return (
      <Button
        onClick={() => {
          const stays = document.constraints.filter(
            (c) => c.type === "presence",
          );
          const starts = stays
            .flatMap((c) => (c.startDate ? [c.startDate] : []))
            .sort();
          const ends = stays
            .flatMap((c) => (c.endDate ? [c.endDate] : []))
            .sort();
          onChange({
            ...document,
            destination: null,
            searchLimits: limits,
            constraints: document.constraints.filter(
              (c) => c.type !== "presence",
            ),
            visits: [
              {
                id: crypto.randomUUID(),
                location: document.destination,
                nights: stays.length ? null : 4,
                presentFrom: starts[0] ?? null,
                presentThrough: ends.at(-1) ?? null,
                afterVisitIds: [],
              },
            ],
          });
        }}
      >
        Plan destinations
      </Button>
    );
  return (
    <div className="route-visits">
      <Text>
        Destinations stay in the order shown. Stays are measured in nights;
        required dates use the destination's local calendar. Flight dates can be
        chosen for you.
      </Text>
      {visits.map((visit, index) => (
        <Card key={visit.id} className="route-visit">
          <FlightAirportPicker
            label={`Destination ${index + 1}`}
            value={visit.location}
            onChange={(location) => update(visit.id, { location })}
          />
          <div className="planning-row">
            <Field
              label={`Destination ${index + 1} nights`}
              hint="Leave blank if the required stay determines the duration"
            >
              <Input
                type="number"
                min={1}
                max={60}
                value={visit.nights == null ? "" : String(visit.nights)}
                onChange={(_, data) =>
                  update(visit.id, {
                    nights: data.value ? Number(data.value) : null,
                  })
                }
              />
            </Field>
            <Field
              label={`Destination ${index + 1} required from`}
              hint="Arrive on or before this date"
            >
              <Input
                type="date"
                value={visit.presentFrom ?? ""}
                onChange={(_, data) =>
                  update(visit.id, { presentFrom: data.value || null })
                }
              />
            </Field>
            <Field
              label={`Destination ${index + 1} required through`}
              hint="Leave on or after this date"
            >
              <Input
                type="date"
                value={visit.presentThrough ?? ""}
                onChange={(_, data) =>
                  update(visit.id, { presentThrough: data.value || null })
                }
              />
            </Field>
          </div>
          {visit.originalInput && (
            <Text size={200}>
              From your description: “{visit.originalInput}”
            </Text>
          )}
          <Button
            appearance="subtle"
            onClick={() =>
              onChange({
                ...document,
                visits: visits
                  .filter((v) => v.id !== visit.id)
                  .map((v) => ({
                    ...v,
                    afterVisitIds: v.afterVisitIds.filter(
                      (id) => id !== visit.id,
                    ),
                  })),
              })
            }
          >
            Remove destination {index + 1}
          </Button>
        </Card>
      ))}
      <Button
        icon={<Add20Regular />}
        onClick={() =>
          onChange({
            ...document,
            visits: [
              ...visits,
              {
                id: crypto.randomUUID(),
                location: null,
                nights: 4,
                presentFrom: null,
                presentThrough: null,
                afterVisitIds: [visits[visits.length - 1].id],
              },
            ],
          })
        }
      >
        Add destination
      </Button>
      <div className="planning-row">
        <Field
          label="Flexibility around required stays"
          hint="Explore up to this many days earlier and later; these are search limits"
        >
          <Input
            type="number"
            min={0}
            max={5}
            value={String(limits.flexibilityDays)}
            onChange={(_, data) =>
              onChange({
                ...document,
                searchLimits: {
                  ...limits,
                  flexibilityDays: Number(data.value),
                },
              })
            }
          />
        </Field>
        <Field
          label="Maximum trip days"
          hint="Includes flight time; limits the date search"
        >
          <Input
            type="number"
            min={1}
            max={36890}
            value={String(limits.maxTripDays)}
            onChange={(_, data) =>
              onChange({
                ...document,
                searchLimits: { ...limits, maxTripDays: Number(data.value) },
              })
            }
          />
        </Field>
      </div>
      <Text size={200}>
        Searches are sampled across every flight in your route. Cached searches
        are reused. Separate tickets between stays are allowed; self-transfer
        connections are excluded.
      </Text>
    </div>
  );
}
