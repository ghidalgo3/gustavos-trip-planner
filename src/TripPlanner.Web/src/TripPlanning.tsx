import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Select,
  Spinner,
  Text,
  Title1,
  Title3,
} from "@fluentui/react-components";
import { ArrowLeft24Regular, Add24Regular } from "@fluentui/react-icons";
import type { Trip } from "./api";
import AirportPicker from "./AirportPicker";
import PlanningRun from "./PlanningRun";
import {
  getPlanning,
  saveConstraints,
  type ConstraintType,
  type DateWindow,
  type PartySettings,
  type PlanningConstraint,
  type PlanningDocument,
  type PlanningParty,
} from "./planningApi";

const constraintNames: Record<ConstraintType, string> = {
  departureWindow: "Leave home",
  returnHomeWindow: "Return flight",
  presence: "Required destination stay",
  travelTogether: "Travel together",
  nonstop: "Nonstop flights only",
  avoidLayover: "Avoid a layover",
};
const emptyWindow: DateWindow = {
  earliest: null,
  latest: null,
  preferred: null,
};
type Props = {
  userId: string;
  trip: Trip;
  onBack: () => void;
  onSaved: (trip: Trip) => void;
};

export default function TripPlanning({ userId, trip, onBack, onSaved }: Props) {
  const [document, setDocument] = useState<PlanningDocument>();
  const [parties, setParties] = useState<PlanningParty[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getPlanning(userId, trip.id, controller.signal)
      .then((editor) => {
        if (controller.signal.aborted) return;
        setParties(editor.parties);
        setDocument({
          ...editor.document,
          userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          travelDates: editor.document.travelDates ?? {
            startDate: initialDate(editor.document, "departureWindow"),
            endDate: initialDate(editor.document, "returnHomeWindow"),
          },
          parties: editor.parties.map((party) => {
            const saved = editor.document.parties.find(
              (p) => p.partyId === party.id,
            );
            return {
              partyId: party.id,
              cabin: "economy",
              market: "US",
              maxJourneyHours: 48,
              maxStops: null,
              preferredAirlines: [],
              ...saved,
              origin: saved?.origin ?? party.suggestedOrigin ?? null,
            };
          }),
        });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(message(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, trip.id]);

  function change(next: PlanningDocument) {
    setDocument(next);
    setDirty(true);
    setNotice(undefined);
    setError(undefined);
  }
  function changeConstraint(next: PlanningConstraint) {
    if (document)
      change({
        ...document,
        constraints: document.constraints.map((c) =>
          c.id === next.id ? next : c,
        ),
      });
  }
  function updatePartySettings(partyId: string, next: PartySettings) {
    if (!document) return;
    change({
      ...document,
      parties: document.parties.map((party) =>
        party.partyId === partyId ? next : party,
      ),
    });
  }
  async function persist(showNotice: boolean) {
    if (!document) return;
    onSaved(await saveConstraints(userId, trip.id, document));
    setDirty(false);
    if (showNotice) setNotice("Planning details saved.");
  }
  async function save() {
    if (!document) return;
    setBusy(true);
    setError(undefined);
    try {
      await persist(true);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="planning-page" aria-label="Trip planning">
      <Button
        appearance="subtle"
        icon={<ArrowLeft24Regular />}
        disabled={busy}
        onClick={() => {
          if (!dirty || window.confirm("Discard unsaved planning changes?"))
            onBack();
        }}
      >
        Back to trips
      </Button>
      <div className="planning-intro">
        <Text className="eyebrow" weight="semibold">
          DEFINE YOUR TRIP
        </Text>
        <Title1 as="h1">{trip.name}</Title1>
        <Text>Choose where and when to travel, then plan your trip.</Text>
      </div>
      {error && <Text role="alert">{error}</Text>}
      {notice && <Text role="status">{notice}</Text>}
      {loading && <Spinner label="Loading planning details" />}
      {document && (
        <>
          <fieldset className="planning-fields" disabled={busy}>
            <Card className="planning-card">
              <Title3 as="h2">Where and when?</Title3>
              <AirportPicker
                label="Destination"
                value={document.destination}
                onChange={(destination) => change({ ...document, destination })}
              />
              <div className="planning-row">
                <Field
                  label="Departure date"
                  hint="The day your outbound flight starts"
                >
                  <Input
                    type="date"
                    value={document.travelDates?.startDate ?? ""}
                    onChange={(_, data) =>
                      change({
                        ...document,
                        travelDates: {
                          startDate: data.value || null,
                          endDate: document.travelDates?.endDate ?? null,
                        },
                      })
                    }
                  />
                </Field>
                <Field
                  label="Return flight date"
                  hint="The day your flight home begins"
                >
                  <Input
                    type="date"
                    value={document.travelDates?.endDate ?? ""}
                    min={document.travelDates?.startDate ?? undefined}
                    onChange={(_, data) =>
                      change({
                        ...document,
                        travelDates: {
                          startDate: document.travelDates?.startDate ?? null,
                          endDate: data.value || null,
                        },
                      })
                    }
                  />
                </Field>
              </div>
              <Button
                appearance="subtle"
                aria-expanded={advanced}
                aria-controls="advanced-filters"
                onClick={() => setAdvanced(!advanced)}
              >
                Advanced filters
              </Button>
              {advanced && (
                <div id="advanced-filters" className="advanced-filters">
                  {parties.map((party, index) => {
                    const settings = document.parties.find(
                      (candidate) => candidate.partyId === party.id,
                    )!;
                    return (
                      <div className="party-search-settings" key={party.id}>
                        <Text weight="semibold">
                          Party {index + 1}
                          {parties.length > 1
                            ? ` · ${party.members.map((member) => member.name).join(", ")}`
                            : ""}
                        </Text>
                        <div className="planning-row">
                          <Field label="Cabin">
                            <Select
                              value={settings.cabin}
                              onChange={(_, data) =>
                                updatePartySettings(party.id, {
                                  ...settings,
                                  cabin: data.value,
                                })
                              }
                            >
                              <option value="economy">Economy</option>
                              <option value="premium_economy">
                                Premium economy
                              </option>
                              <option value="business">Business</option>
                              <option value="first">First</option>
                            </Select>
                          </Field>
                          <Field
                            label="Pricing market"
                            hint="Two-letter country code"
                          >
                            <Input
                              value={settings.market}
                              maxLength={2}
                              onChange={(_, data) =>
                                updatePartySettings(party.id, {
                                  ...settings,
                                  market: data.value.toUpperCase(),
                                })
                              }
                            />
                          </Field>
                          <Field
                            label="Maximum hours per direction"
                            hint="Includes all flights and layovers"
                          >
                            <Input
                              type="number"
                              min={1}
                              max={168}
                              value={String(settings.maxJourneyHours)}
                              onChange={(_, data) =>
                                updatePartySettings(party.id, {
                                  ...settings,
                                  maxJourneyHours: Number(data.value),
                                })
                              }
                            />
                          </Field>
                          <Field label="Stops allowed">
                            <Select
                              value={
                                settings.maxStops === null
                                  ? ""
                                  : String(settings.maxStops)
                              }
                              onChange={(_, data) =>
                                updatePartySettings(party.id, {
                                  ...settings,
                                  maxStops:
                                    data.value === ""
                                      ? null
                                      : Number(data.value),
                                })
                              }
                            >
                              <option value="">Any number</option>
                              <option value="0">Nonstop only</option>
                              <option value="1">Up to 1 stop</option>
                              <option value="2">Up to 2 stops</option>
                            </Select>
                          </Field>
                        </div>
                        <Field
                          label="Preferred airlines"
                          hint="Optional airline codes separated by commas, e.g. DL, AF. Preferences won't exclude other airlines."
                        >
                          <CodeList
                            value={settings.preferredAirlines}
                            onChange={(preferredAirlines) =>
                              updatePartySettings(party.id, {
                                ...settings,
                                preferredAirlines,
                              })
                            }
                          />
                        </Field>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {parties.map((party, index) => {
              const settings = document.parties.find(
                (p) => p.partyId === party.id,
              )!;
              return (
                <Card className="planning-card party-card" key={party.id}>
                  <div className="planning-section-heading">
                    <Title3 as="h2">
                      Party {index + 1} ·{" "}
                      {party.members.map((m) => m.name).join(", ")}
                    </Title3>
                    <Button
                      appearance="subtle"
                      className="coming-soon-button"
                      icon={<Add24Regular />}
                      aria-label={`Invite someone to Party ${index + 1}`}
                      title="Coming soon"
                      onClick={() =>
                        setNotice("Inviting travelers is coming soon.")
                      }
                    />
                  </div>
                  <Text size={200}>
                    {party.members
                      .map((m) => m.homeCity || "Home city not set")
                      .join(" · ")}
                  </Text>
                  <AirportPicker
                    label={"Party " + (index + 1) + " origin"}
                    value={settings.origin}
                    onChange={(origin) =>
                      updatePartySettings(party.id, { ...settings, origin })
                    }
                  />
                  {party.suggestedOrigin &&
                    settings.origin?.code === party.suggestedOrigin.code && (
                      <Text size={200}>
                        Suggested from your party's home city.
                      </Text>
                    )}
                  {!settings.origin && (
                    <Text size={200}>
                      Choose the airport your party will depart from.
                    </Text>
                  )}
                  <Text size={200}>
                    Passenger count: {party.members.length}. This prototype
                    treats each party member as an adult; guests and children
                    will follow.
                  </Text>
                </Card>
              );
            })}

            <Card className="planning-card">
              <div className="planning-section-heading">
                <Title3 as="h2">Optional constraints</Title3>
                <Button
                  icon={<Add24Regular />}
                  disabled={parties.length === 0}
                  onClick={() => {
                    const firstUser = parties[0]?.members[0]?.id;
                    if (firstUser)
                      change({
                        ...document,
                        constraints: [
                          ...document.constraints,
                          {
                            id: crypto.randomUUID(),
                            userId: firstUser,
                            type: "departureWindow",
                            window: {
                              earliest: document.travelDates?.startDate ?? null,
                              latest: document.travelDates?.startDate ?? null,
                              preferred:
                                document.travelDates?.startDate ?? null,
                            },
                            countryCodes: [],
                          },
                        ],
                      });
                  }}
                >
                  Add requirement
                </Button>
              </div>
              <Text>
                Your selected dates are enough to start. Add departure or
                return-flight windows to allow flexibility separately, or add
                requirements for destination stays, traveling together, and
                layovers.
              </Text>
              {document.constraints.length === 0 && (
                <Text>No requirements yet.</Text>
              )}
              {document.constraints.map((constraint, index) => (
                <ConstraintEditor
                  key={constraint.id}
                  index={index}
                  constraint={constraint}
                  parties={parties}
                  travelDates={document.travelDates}
                  onChange={changeConstraint}
                  onRemove={() =>
                    change({
                      ...document,
                      constraints: document.constraints.filter(
                        (c) => c.id !== constraint.id,
                      ),
                    })
                  }
                />
              ))}
            </Card>
          </fieldset>
          <div className="planning-toolbar">
            <Button onClick={save} disabled={busy}>
              Save planning details
            </Button>
            <Text size={200}>
              {dirty ? "Unsaved changes" : "Planning details saved"}
            </Text>
            {busy && <Spinner size="tiny" label="Working" />}
          </div>
          <PlanningRun
            tripId={trip.id}
            parties={parties}
            partySettings={document.parties}
            disabled={busy}
            onBeforeSearch={() => persist(false)}
          />
        </>
      )}
    </section>
  );
}

function initialDate(document: PlanningDocument, type: ConstraintType) {
  const window = document.constraints.find((c) => c.type === type)?.window;
  return window?.preferred ?? window?.earliest ?? null;
}

function ConstraintEditor({
  constraint: c,
  index,
  parties,
  travelDates,
  onChange,
  onRemove,
}: {
  constraint: PlanningConstraint;
  index: number;
  parties: PlanningParty[];
  travelDates: PlanningDocument["travelDates"];
  onChange: (constraint: PlanningConstraint) => void;
  onRemove: () => void;
}) {
  const members = parties.flatMap((p) => p.members);
  return (
    <div
      className="constraint-editor"
      role="group"
      aria-label={"Requirement " + (index + 1)}
    >
      <div className="planning-row">
        <Field label={"Requirement " + (index + 1)}>
          <Select
            value={c.type}
            onChange={(_, data) =>
              onChange({
                id: c.id,
                userId: c.userId,
                type: data.value as ConstraintType,
                window: (() => {
                  const date =
                    data.value === "returnHomeWindow"
                      ? travelDates?.endDate
                      : travelDates?.startDate;
                  return date
                    ? { earliest: date, latest: date, preferred: date }
                    : { ...emptyWindow };
                })(),
                countryCodes: [],
                locationType: "airport",
              })
            }
          >
            {Object.entries(constraintNames).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Traveler">
          <Select
            value={c.userId}
            onChange={(_, data) => onChange({ ...c, userId: data.value })}
          >
            {members.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          appearance="subtle"
          onClick={onRemove}
          aria-label={"Remove requirement " + (index + 1)}
        >
          Remove
        </Button>
      </div>
      {(c.type === "departureWindow" || c.type === "returnHomeWindow") && (
        <WindowEditor
          key={c.type}
          label={constraintNames[c.type]}
          window={c.window ?? emptyWindow}
          onChange={(window) => onChange({ ...c, window })}
        />
      )}
      {c.type === "presence" && (
        <>
          <div className="planning-row">
            <Field label="Be there on or before">
              <Input
                type="date"
                value={c.startDate ?? ""}
                onChange={(_, data) =>
                  onChange({ ...c, startDate: data.value || null })
                }
              />
            </Field>
            <Field label="Leave on or after">
              <Input
                type="date"
                value={c.endDate ?? ""}
                onChange={(_, data) =>
                  onChange({ ...c, endDate: data.value || null })
                }
              />
            </Field>
          </div>
          <Text size={200}>
            Dates use the destination's local calendar. Actual flight arrival
            times must be checked later.
          </Text>
        </>
      )}
      {c.type === "nonstop" && (
        <Text>
          Both outbound and return flights must have no connecting stops.
        </Text>
      )}
      {c.type === "travelTogether" && (
        <Field
          label="Travel with"
          hint="Same outbound, same return, and shared destination stay. Party membership must agree."
        >
          <Select
            value={c.otherUserId ?? ""}
            onChange={(_, data) =>
              onChange({ ...c, otherUserId: data.value || null })
            }
          >
            <option value="">Choose another traveler</option>
            {members
              .filter((m) => m.id !== c.userId)
              .map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
          </Select>
          {members.length < 2 && (
            <Text size={200}>
              There are no other travelers yet. Invitations and party management
              are a separate step.
            </Text>
          )}
        </Field>
      )}
      {c.type === "avoidLayover" && (
        <>
          <div className="planning-row">
            <Field label="Location type">
              <Select
                value={c.locationType ?? "airport"}
                onChange={(_, data) =>
                  onChange({
                    ...c,
                    locationType: data.value,
                    location: "",
                    countryCodes: [],
                  })
                }
              >
                <option value="airport">Airport</option>
                <option value="city">City</option>
                <option value="country">Country</option>
                <option value="region">Named region</option>
              </Select>
            </Field>
            {c.locationType === "airport" ? (
              <AirportPicker
                label="Airport to avoid"
                value={c.location ? { code: c.location, timeZone: "" } : null}
                onChange={(location) =>
                  onChange({ ...c, location: location?.code ?? "" })
                }
              />
            ) : (
              <Field
                label="Location to avoid"
                hint={
                  c.locationType === "country"
                    ? "Two-letter country code"
                    : "Include country for city names"
                }
              >
                <Input
                  value={c.location ?? ""}
                  onChange={(_, data) =>
                    onChange({
                      ...c,
                      location:
                        c.locationType === "country"
                          ? data.value.toUpperCase()
                          : data.value,
                    })
                  }
                />
              </Field>
            )}
          </div>
          {c.locationType === "region" && (
            <Field
              label="Countries in this region"
              hint="Define this region with comma-separated country codes, e.g. AE, QA."
            >
              <CodeList
                value={c.countryCodes}
                onChange={(countryCodes) => onChange({ ...c, countryCodes })}
              />
            </Field>
          )}
        </>
      )}
    </div>
  );
}

function WindowEditor({
  label,
  window: value,
  onChange,
}: {
  label: string;
  window: DateWindow;
  onChange: (window: DateWindow) => void;
}) {
  const [flexible, setFlexible] = useState(Boolean(value.preferred));
  const [days, setDays] = useState(
    value.preferred && value.earliest
      ? Math.round(
          (Date.parse(value.preferred) - Date.parse(value.earliest)) / 86400000,
        )
      : 0,
  );
  function setPreferred(date: string | null, flexibility: number) {
    onChange({
      preferred: date,
      earliest: shiftDate(date, -flexibility),
      latest: shiftDate(date, flexibility),
    });
  }
  return (
    <div className="window-editor">
      <Checkbox
        label={
          "Use a preferred date and flexibility for " + label.toLowerCase()
        }
        checked={flexible}
        onChange={(_, data) => {
          setFlexible(Boolean(data.checked));
          if (data.checked)
            setPreferred(value.preferred ?? value.earliest, days);
          else onChange({ ...value, preferred: null });
        }}
      />
      <div className="planning-row">
        {flexible ? (
          <>
            <Field label={label + " preferred date"}>
              <Input
                type="date"
                value={value.preferred ?? ""}
                onChange={(_, data) => setPreferred(data.value || null, days)}
              />
            </Field>
            <Field label={label + " flexibility (± days)"}>
              <Input
                type="number"
                min={0}
                max={182}
                value={String(days)}
                onChange={(_, data) => {
                  const count = Math.max(
                    0,
                    Math.min(182, Math.trunc(Number(data.value))),
                  );
                  setDays(count);
                  setPreferred(value.preferred, count);
                }}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={label + " earliest"}>
              <Input
                type="date"
                value={value.earliest ?? ""}
                onChange={(_, data) =>
                  onChange({ ...value, earliest: data.value || null })
                }
              />
            </Field>
            <Field label={label + " latest"}>
              <Input
                type="date"
                value={value.latest ?? ""}
                onChange={(_, data) =>
                  onChange({ ...value, latest: data.value || null })
                }
              />
            </Field>
          </>
        )}
      </div>
      {flexible && value.earliest && value.latest && (
        <Text size={200}>
          Allowed dates: {value.earliest} – {value.latest}
        </Text>
      )}
    </div>
  );
}

function CodeList({
  value,
  onChange,
}: {
  value: string[];
  onChange: (codes: string[]) => void;
}) {
  // Keep commas while typing; the document always contains normalized codes.
  const [text, setText] = useState(value.join(", "));
  return (
    <Input
      value={text}
      onChange={(_, data) => {
        setText(data.value);
        onChange([
          ...new Set(
            data.value
              .toUpperCase()
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ]);
      }}
    />
  );
}

function shiftDate(date: string | null, days: number): string | null {
  if (!date) return null;
  const parsed = new Date(date + "T12:00:00Z");
  if (!Number.isFinite(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
function message(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : "Unable to complete the planning request.";
}
