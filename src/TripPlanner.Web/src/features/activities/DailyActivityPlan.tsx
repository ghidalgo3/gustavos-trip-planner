import { DailyPlanSkeleton } from "./ActivityPlanningSkeletons";
import ActivityOrderHandle from "./ActivityOrderHandle";
import ActivityAgenda from "./ActivityAgenda";
import { useActivityPlanPreview } from "./useActivityPlanPreview";
import { isTimeZoneId } from "../../shared/time/timeZones";
import { useActionToast } from "../../shared/hooks/useActionToast";
import {
  durationFromMinutes,
  durationMinutes,
} from "../../shared/time/durations";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Activity, Destination } from "./activitiesApi";
import {
  activityPlanPath,
  activityRule,
  chooseActivity,
  moveActivity,
  planningRequest,
  previewActivityPlan,
  type ActivityPlan,
  type DailySettings,
  type DayAssessment,
  type PlanAssessment,
  type PlanChoice,
  type PlanDay,
  type PlanJob,
  type PlanResponse,
  type PlanResult,
  type PlanRule,
  type Versioned,
} from "./activityPlanApi";
import ActivityPreferencesEditor from "./ActivityPreferencesEditor";
import ActivityCalendarSubscriptions from "./ActivityCalendarSubscriptions";
import "./activityPlan.css";

// HTML time inputs emit HH:mm; resources use ISO 8601 with seconds.
const isoClockTime = (value: string) =>
  value.length === 5 ? `${value}:00` : value;

const modes = ["walking", "taxi", "driving"];
const modeName = (mode: string) =>
  mode === "taxi"
    ? "Taxi / rideshare"
    : mode === "driving"
      ? "Self-driving (whole day)"
      : mode === "walking"
        ? "Walking"
        : "Unsupported transport";
const dateName = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const time = (value: string | null) =>
  value ? value.slice(11, 16) : "Time unknown";
const statusName: Record<string, string> = {
  fits: "Fits known constraints",
  provisional: "Provisional estimates",
  incomplete: "More information needed",
  conflicting: "Conflicting plan",
};

export function PlanningSettings({
  settings,
  onChange,
  prefix,
}: {
  settings: DailySettings;
  onChange: (value: DailySettings) => void;
  prefix: string;
}) {
  return (
    <div className="planning-fields">
      {(["sleepStart", "sleepEnd"] as const).map((key) => (
        <label key={key}>
          {key === "sleepStart" ? "Sleep starts" : "Wake up"}
          <input
            aria-label={`${prefix} ${key === "sleepStart" ? "sleep starts" : "wake up"}`}
            type="time"
            value={settings[key].slice(0, 5)}
            onChange={(e) =>
              onChange({ ...settings, [key]: isoClockTime(e.target.value) })
            }
          />
        </label>
      ))}
      {(
        [
          ["breakfastDuration", "Breakfast"],
          ["lunchDuration", "Lunch"],
          ["dinnerDuration", "Dinner"],
          ["slackDuration", "Slack"],
          ["airportArrivalBufferDuration", "Airport arrival buffer"],
          ["airportDepartureBufferDuration", "Airport departure buffer"],
          ["airportTransferDuration", "Airport transfer"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label} (minutes)
          <input
            aria-label={`${prefix} ${label.toLowerCase()} minutes`}
            type="number"
            min={0}
            max={1440}
            value={durationMinutes(settings[key])}
            onChange={(e) =>
              onChange({
                ...settings,
                [key]: durationFromMinutes(Number(e.target.value)),
              })
            }
          />
        </label>
      ))}
      <label>
        Transport
        <select
          aria-label={`${prefix} transport`}
          value={settings.transportMode}
          onChange={(e) =>
            onChange({ ...settings, transportMode: e.target.value })
          }
        >
          {modes.map((mode) => (
            <option key={mode} value={mode}>
              {modeName(mode)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function AssessmentSummary({
  assessment,
}: {
  assessment: PlanAssessment;
}) {
  return (
    <section
      aria-label="Plan assessment"
      className={`planning-assessment planning-${assessment.status}`}
    >
      <strong>{statusName[assessment.status] ?? assessment.status}</strong>
      <p>
        {assessment.conflictCount} conflicts ·{" "}
        {durationMinutes(assessment.travelDuration)} min travel ·{" "}
        {durationMinutes(assessment.overrunDuration)} min over capacity
      </p>
      {assessment.issues.length > 0 && (
        <details>
          <summary>Why this assessment?</summary>
          <ul>
            {assessment.issues.map((issue, i) => (
              <li key={i} className={`planning-issue-${issue.severity}`}>
                {issue.date && `${dateName(issue.date)}: `}
                {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Traveller preference fit</summary>
        <p>
          Each traveller has equal weight. Estimates are neutral until
          preference scoring is available.
        </p>
        <ul>
          {assessment.travellerFit.map((f) => (
            <li key={f.userId}>
              {f.name}: {f.points.toFixed(1)} of {f.availablePoints.toFixed(1)}{" "}
              available points {f.estimated && "(estimated)"}
            </li>
          ))}
        </ul>
      </details>
      {assessment.evidence?.length > 0 && (
        <details>
          <summary>Sources and applicable dates</summary>
          <ul>
            {assessment.evidence.map((source, i) => (
              <li key={i}>
                <a href={source.source} target="_blank" rel="noreferrer">
                  Opening-hours source
                </a>{" "}
                · {source.applicableDates.join(", ")}{" "}
                {source.provisional && "· provisional"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DayTotals({ assessment }: { assessment?: DayAssessment }) {
  if (!assessment) return null;
  return (
    <p className="planning-day-totals">
      {durationMinutes(assessment.availableDuration)} min available ·{" "}
      {durationMinutes(assessment.activityDuration)} activities ·{" "}
      {durationMinutes(assessment.travelDuration)} travel ·{" "}
      {durationMinutes(assessment.mealDuration)} meals ·{" "}
      {durationMinutes(assessment.waitingDuration)} min in gaps (included in
      free time) · {durationMinutes(assessment.slackDuration)} slack (
      {durationMinutes(assessment.requiredSlackDuration)} reserved) ·{" "}
      {durationMinutes(assessment.restDuration)} rest
      {durationMinutes(assessment.overrunDuration) > 0 && (
        <strong>
          {" "}
          · {durationMinutes(assessment.overrunDuration)} min over capacity
        </strong>
      )}
    </p>
  );
}

export default function DailyActivityPlan({
  tripId,
  destinationId,
  destination,
  activities,
  readOnly,
  useAiAllowed,
  onSelect,
  onSaved,
  onChooseActivities,
}: {
  tripId: string;
  destinationId: string;
  destination?: Destination;
  activities: Activity[];
  readOnly: boolean;
  useAiAllowed: boolean;
  onSelect: (id: string) => void;
  onSaved: () => Promise<void>;
  onChooseActivities?: () => void;
}) {
  const path = activityPlanPath(tripId, destinationId);
  const [resource, setResource] = useState<Versioned<PlanResponse>>();
  const [plan, setPlan] = useState<ActivityPlan>();
  const [assessment, setAssessment] = useState<PlanAssessment>();
  const [error, setError] = useState("");
  const { notify, toaster } = useActionToast();
  const [busy, setBusy] = useState(false);
  const [checkingMove, setCheckingMove] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [job, setJob] = useState<Versioned<PlanJob>>();
  const [pending, setPending] = useState<{
    id: string;
    kind: string;
    schedule: boolean;
  }>();
  const [preview, setPreview] = useState<PlanChoice>();
  const [availabilityCurrent, setAvailabilityCurrent] = useState(true);
  const active = useRef(true);
  const invalidTimeZone = !isTimeZoneId(plan?.timeZone);
  const dirty = Boolean(
    plan &&
    resource &&
    JSON.stringify(plan) !== JSON.stringify(resource.data.plan),
  );
  const needsPreview = dirty || Boolean(resource?.data.timingStale);
  const livePreview = useActivityPlanPreview(
    path,
    plan,
    resource?.data.contextVersion,
    needsPreview,
  );
  useEffect(() => {
    active.current = true;
    const abort = new AbortController();
    void planningRequest<PlanResponse>(path, { signal: abort.signal })
      .then((value) => {
        setResource(value);
        setPlan(value.data.plan);
        setAssessment(value.data.assessment);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError((e as Error).message);
      });
    return () => {
      active.current = false;
      abort.abort();
    };
  }, [path]);
  const reportPollingError = useEffectEvent((message: string) => {
    notify(message, "error");
    setShowTools(true);
  });
  const finishJob = useEffectEvent(
    async (
      value: Versioned<PlanJob>,
      signal: AbortSignal,
      schedule: boolean,
    ) => {
      if (value.data.error || value.data.status === "Failed") {
        reportPollingError(
          value.data.error ?? "Scheduling failed. Your plan has not changed.",
        );
        return;
      }
      const result = value.data.result;
      if (
        schedule &&
        (!result ||
          result.kind !== "schedule" ||
          result.alternatives.length === 0)
      ) {
        reportPollingError(
          result?.warnings.join(" ") ||
            "No schedule could satisfy the constraints. Your plan has not changed.",
        );
        return;
      }
      const refreshed = await planningRequest<PlanResponse>(path, { signal });
      if (signal.aborted) return;
      const current =
        result &&
        refreshed.data.version === result.basePlanVersion &&
        refreshed.data.contextVersion === result.contextVersion;
      if (current) setResource(refreshed);
      if (schedule && result) {
        if (readOnly)
          throw new Error(
            "You no longer have permission to schedule these activities.",
          );
        if (!current)
          throw new Error(
            "The plan changed while scheduling. Refresh the plan and try again; your saved plan has not been overwritten.",
          );
        const choice = result.alternatives.find(
          (candidate) =>
            candidate.assessment.conflictCount === 0 &&
            candidate.assessment.status !== "incomplete",
        );
        if (!choice)
          throw new Error(
            "No complete schedule could satisfy the constraints. Your plan has not changed.",
          );
        const saved = await planningRequest<PlanResponse>(path, {
          method: "PUT",
          signal,
          etag: refreshed.etag,
          body: {
            plan: choice.plan,
            contextVersion: result.contextVersion,
            proposalId: result.id,
            choiceId: choice.id,
          },
        });
        if (signal.aborted) return;
        setResource(saved);
        setPlan(saved.data.plan);
        setAssessment(saved.data.assessment);
        setAvailabilityCurrent(true);
        setPreview(undefined);
        setJob(undefined);
        notify("Activities scheduled. Your agenda and calendar are updated.");
        await onSaved();
      } else {
        notify(
          "Review the results below. Your saved schedule has not changed.",
        );
        if (result?.kind === "assessment") setAvailabilityCurrent(true);
      }
    },
  );
  useEffect(() => {
    if (!pending) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const value = await planningRequest<PlanJob>(
          `${path}/${pending!.kind}/${pending!.id}`,
          { signal: abort.signal },
        );
        if (abort.signal.aborted) return;
        setJob(value);
        if (value.data.result) setAssessment(value.data.result.assessment);
        if (
          value.data.status === "Completed" ||
          value.data.status === "Failed"
        ) {
          await finishJob(value, abort.signal, pending!.schedule);
          if (abort.signal.aborted) return;
          setPending(undefined);
        } else timer = setTimeout(() => void poll(), 2000);
      } catch (e) {
        if (!abort.signal.aborted) {
          reportPollingError((e as Error).message);
          setPending(undefined);
        }
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [pending, path]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (active.current) notify((e as Error).message, "error");
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function reload() {
    const value = await planningRequest<PlanResponse>(path);
    setResource(value);
    setAvailabilityCurrent(true);
    setPlan(value.data.plan);
    setAssessment(value.data.assessment);
    setJob(undefined);
    setPreview(undefined);
  }
  async function save(choice?: PlanChoice) {
    if (!plan || !resource) return;
    if (!isTimeZoneId((choice?.plan ?? plan).timeZone)) {
      throw new Error(
        "The city time zone could not be resolved. Reload the plan to retry.",
      );
    }
    const result = job?.data.result;
    const body = {
      plan: choice?.plan ?? plan,
      contextVersion: choice
        ? result?.contextVersion
        : resource.data.contextVersion,
      proposalId: choice ? result?.id : undefined,
      choiceId: choice?.id,
    };
    const value = await planningRequest<PlanResponse>(path, {
      method: "PUT",
      body,
      etag: resource.etag,
    });
    setResource(value);
    setAvailabilityCurrent(true);
    setPlan(value.data.plan);
    setAssessment(value.data.assessment);
    setPreview(undefined);
    setJob(undefined);
    notify("Plan saved. Your calendar now uses this schedule.");
    await onSaved();
  }
  async function request(
    kind: "assessments" | "draft" | "improvements" | "schedule",
  ) {
    if (!resource || !plan) return;
    if (invalidTimeZone) {
      throw new Error(
        "The city time zone could not be resolved. Reload the plan to retry.",
      );
    }
    setJob(undefined);
    setPreview(undefined);
    const collection = kind === "assessments" ? kind : "proposals";
    const value = await planningRequest<{
      operationId: string;
      result: PlanResult | null;
    }>(`${path}/${collection}`, {
      method: "POST",
      body: {
        requestId: crypto.randomUUID(),
        contextVersion: resource.data.contextVersion,
        plan,
        refreshEvidence: kind === "schedule" || refresh,
        useAi: kind === "schedule" ? false : useAi,
        ...(kind !== "assessments" ? { kind } : {}),
      },
    });
    setPending({
      id: value.data.operationId,
      kind: collection,
      schedule: kind === "schedule",
    });
  }
  function updateDay(day: PlanDay, changes: Partial<PlanDay>) {
    if (changes.flightMatches || "settings" in changes)
      setAvailabilityCurrent(false);
    if (plan)
      setPlan({
        ...plan,
        days: plan.days.map((d) =>
          d.date === day.date && d.stayId === day.stayId
            ? { ...d, ...changes }
            : d,
        ),
      });
  }
  function updateRule(id: string, changes: Partial<PlanRule>) {
    if (plan)
      setPlan({
        ...plan,
        rules: [
          ...plan.rules.filter((r) => r.activityId !== id),
          { ...activityRule(plan, id), ...changes },
        ],
      });
  }
  function move(
    id: string,
    date: string | null,
    index?: number,
    mealsBefore?: number,
  ) {
    if (!plan || !resource || busy) return;
    const next = moveActivity(
      plan,
      id,
      date,
      index,
      mealsBefore,
      needsPreview ? livePreview?.assessment : assessment,
    );
    const hasFlights = resource.data.context.suggestedAvailability.some(
      (a) =>
        a.availableFromInstant ||
        a.availableUntilInstant ||
        a.candidates?.length,
    );
    if (!hasFlights || date === null) {
      setPlan(next);
      return;
    }
    setCheckingMove(true);
    void run(async () => {
      try {
        const checked = await previewActivityPlan(
          path,
          next,
          resource.data.contextVersion,
          new AbortController().signal,
        );
        if (!active.current) return;
        const conflict = checked.issues.find(
          (issue) => issue.code === "flight_unavailable",
        );
        if (conflict)
          throw new Error(`Cannot move this activity. ${conflict.message}`);
        setPlan(next);
        setAssessment(checked);
      } finally {
        if (active.current) setCheckingMove(false);
      }
    });
  }
  function state(id: string, next: "selected" | "idea" | "excluded") {
    if (plan) setPlan(chooseActivity(plan, id, next));
  }
  const result = job?.data.result;
  const staleDraft = Boolean(
    result &&
    resource &&
    result.contextVersion !== resource.data.contextVersion,
  );
  if (!plan || !resource)
    return (
      <section className="daily-plan">
        {error ? <p role="alert">{error}</p> : <DailyPlanSkeleton />}
      </section>
    );
  const disabled = readOnly || busy || Boolean(pending);
  const name = (id: string | null) =>
    id
      ? (activities.find((a) => a.id === id)?.properties.name ?? "Activity")
      : "Accommodation";
  const scheduled = new Set(plan.days.flatMap((d) => d.activityIds));
  const ruleEditor = (id: string) => {
    const rule = activityRule(plan, id);
    return (
      <details className="planning-restrictions">
        <summary>Preferences and restrictions for {name(id)}</summary>
        <fieldset disabled={disabled}>
          <div className="planning-fields">
            <label>
              <input
                type="checkbox"
                checked={rule.mustDo}
                onChange={(e) => updateRule(id, { mustDo: e.target.checked })}
              />{" "}
              Must do
            </label>
            <label>
              Fixed day
              <input
                aria-label={`Fixed day for ${name(id)}`}
                type="date"
                value={rule.fixedDate ?? ""}
                onChange={(e) =>
                  updateRule(id, { fixedDate: e.target.value || null })
                }
              />
            </label>
            <label>
              Fixed start
              <input
                aria-label={`Fixed start for ${name(id)}`}
                type="time"
                value={rule.fixedStart?.slice(0, 5) ?? ""}
                onChange={(e) =>
                  updateRule(id, {
                    fixedStart: isoClockTime(e.target.value) || null,
                  })
                }
              />
            </label>
            <label>
              Must follow
              <select
                aria-label={`Must precede ${name(id)}`}
                value={rule.afterActivityId ?? ""}
                onChange={(e) =>
                  updateRule(id, { afterActivityId: e.target.value || null })
                }
              >
                <option value="">No restriction</option>
                {activities
                  .filter((a) => a.id !== id)
                  .map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.properties.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Duration override (minutes)
              <input
                type="number"
                min={1}
                max={10080}
                value={durationMinutes(rule.duration) ?? ""}
                onChange={(e) =>
                  updateRule(id, {
                    duration: e.target.value
                      ? durationFromMinutes(Number(e.target.value))
                      : null,
                  })
                }
              />
            </label>
            <label>
              Satisfies a meal
              <select
                value={rule.coversMeal ?? ""}
                onChange={(e) =>
                  updateRule(id, { coversMeal: e.target.value || null })
                }
              >
                <option value="">No meal</option>
                {["breakfast", "lunch", "dinner"].map((meal) => (
                  <option key={meal}>{meal}</option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={rule.alwaysAvailable}
                onChange={(e) =>
                  updateRule(id, { alwaysAvailable: e.target.checked })
                }
              />{" "}
              No opening-hours restriction
            </label>
          </div>
          <p>Dining duration counts toward its meal allowance once.</p>
          {rule.openingWindows.map((window, i) => (
            <div className="planning-fields" key={i}>
              <label>
                Opening date
                <input
                  type="date"
                  value={window.date}
                  onChange={(e) =>
                    updateRule(id, {
                      openingWindows: rule.openingWindows.map((w, n) =>
                        n === i ? { ...w, date: e.target.value } : w,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Opens
                <input
                  type="time"
                  value={window.start.slice(0, 5)}
                  onChange={(e) =>
                    updateRule(id, {
                      openingWindows: rule.openingWindows.map((w, n) =>
                        n === i
                          ? { ...w, start: isoClockTime(e.target.value) }
                          : w,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Closes
                <input
                  type="time"
                  value={window.end.slice(0, 5)}
                  onChange={(e) =>
                    updateRule(id, {
                      openingWindows: rule.openingWindows.map((w, n) =>
                        n === i
                          ? { ...w, end: isoClockTime(e.target.value) }
                          : w,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  updateRule(id, {
                    openingWindows: rule.openingWindows.filter(
                      (_, n) => n !== i,
                    ),
                  })
                }
              >
                Remove opening window
              </button>
            </div>
          ))}
          {!readOnly && plan.days[0] && (
            <button
              type="button"
              onClick={() =>
                updateRule(id, {
                  openingWindows: [
                    ...rule.openingWindows,
                    {
                      date: plan.days[0].date,
                      start: "09:00:00",
                      end: "17:00:00",
                    },
                  ],
                })
              }
            >
              Add known opening window
            </button>
          )}
          <label>
            Closed dates (comma separated)
            <input
              placeholder="2027-06-10, 2027-06-11"
              value={rule.closedDates.join(", ")}
              onChange={(e) =>
                updateRule(id, {
                  closedDates: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </fieldset>
      </details>
    );
  };
  const travelEditor = (
    day: PlanDay,
    from: string | null,
    to: string | null,
  ) => {
    const override = plan.transportOverrides.find(
      (t) =>
        t.date === day.date &&
        t.fromActivityId === from &&
        t.toActivityId === to,
    );
    const settings = day.settings ?? plan.settings;
    const replace = (mode: string, duration: string | null) =>
      setPlan({
        ...plan,
        transportOverrides: [
          ...plan.transportOverrides.filter((t) => t !== override),
          {
            date: day.date,
            fromActivityId: from,
            toActivityId: to,
            mode,
            duration,
          },
        ],
      });
    return (
      <details>
        <summary>
          {to ? `Travel to ${name(to)}` : "Travel back to accommodation"}
        </summary>
        <fieldset disabled={disabled}>
          <div className="planning-fields">
            <label>
              Travel mode
              <select
                disabled={settings.transportMode === "driving"}
                value={
                  settings.transportMode === "driving"
                    ? "driving"
                    : (override?.mode ?? settings.transportMode)
                }
                onChange={(e) =>
                  replace(e.target.value, override?.duration ?? null)
                }
              >
                {modes
                  .filter(
                    (m) =>
                      m !== "driving" || settings.transportMode === "driving",
                  )
                  .map((m) => (
                    <option key={m} value={m}>
                      {modeName(m)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Your travel estimate (minutes)
              <input
                type="number"
                min={0}
                max={1440}
                value={durationMinutes(override?.duration) ?? ""}
                onChange={(e) =>
                  replace(
                    override?.mode ?? settings.transportMode,
                    e.target.value
                      ? durationFromMinutes(Number(e.target.value))
                      : null,
                  )
                }
              />
            </label>
          </div>
          {override && (
            <button
              type="button"
              onClick={() =>
                setPlan({
                  ...plan,
                  transportOverrides: plan.transportOverrides.filter(
                    (t) => t !== override,
                  ),
                })
              }
            >
              Use default travel
            </button>
          )}
        </fieldset>
      </details>
    );
  };
  const assignment = (id: string, date: string | null) => (
    <label>
      Day
      <select
        aria-label={`Day for ${name(id)}`}
        disabled={disabled}
        value={date ?? ""}
        onChange={(e) => move(id, e.target.value || null)}
      >
        <option value="">Selected, unscheduled</option>
        {plan.days.map((d) => (
          <option key={`${d.stayId}-${d.date}`} value={d.date}>
            {dateName(d.date)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="daily-plan" aria-label="Daily activity plan">
      {error && (
        <p role="alert" className="planning-error">
          {error}
        </p>
      )}
      {toaster}
      {(dirty || resource.data.timingStale) && (
        <div className="planning-actions">
          {!readOnly && (
            <button
              type="button"
              className={
                dirty || resource.data.timingStale ? "planning-primary" : ""
              }
              disabled={
                disabled ||
                invalidTimeZone ||
                (!dirty && !resource.data.timingStale) ||
                staleDraft
              }
              onClick={() => void run(() => save())}
            >
              Save changes
            </button>
          )}
          <button
            type="button"
            disabled={busy || Boolean(pending)}
            onClick={() => void run(reload)}
          >
            {dirty ? "Discard changes" : "Refresh plan"}
          </button>
        </div>
      )}
      {checkingMove && <p role="status">Checking flight availability…</p>}
      {dirty && (
        <p className="agenda-draft">
          Unsaved changes · Save changes to keep your manual edits.
        </p>
      )}
      {pending?.schedule && (
        <p role="status">
          Planning is running. Finding days and times for your activities; the
          schedule will be saved when ready.
        </p>
      )}
      <ActivityAgenda
        plan={plan}
        activities={activities}
        location={
          destination
            ? {
                longitude: destination.geometry.coordinates[0],
                latitude: destination.geometry.coordinates[1],
                timeZone: destination.properties.timeZone ?? plan.timeZone,
              }
            : undefined
        }
        assessment={needsPreview ? livePreview?.assessment : assessment}
        assessmentError={livePreview?.error}
        flightAvailability={resource.data.context.suggestedAvailability}
        disabled={disabled}
        readOnly={readOnly}
        onChooseActivities={onChooseActivities}
        onSchedule={() => void run(() => request("schedule"))}
        onSelect={onSelect}
        onMove={move}
        onRemove={(id) => state(id, "idea")}
      />
      <button
        type="button"
        className="agenda-tools-toggle"
        aria-expanded={showTools}
        aria-controls="daily-planning-tools"
        onClick={() => setShowTools(!showTools)}
      >
        {showTools ? "Hide planning tools" : "Planning tools"}
      </button>
      {showTools && (
        <section
          id="daily-planning-tools"
          className="planning-tools"
          aria-label="Planning tools"
        >
          {resource.data.timingStale && (
            <p className="planning-attention">
              Inputs changed since the last save. Calendar events still use
              saved timing. Review this assessment and save to accept revised
              timing.
            </p>
          )}
          {staleDraft && (
            <p className="planning-attention">
              Research refreshed the planning inputs. Proposal choices carry the
              refreshed versions. Reload before saving other manual changes.
            </p>
          )}
          {assessment && (
            <>
              <p>
                {dirty
                  ? "Assessment of the last evaluated draft. Assess again after editing."
                  : "Current assessment"}
              </p>
              <AssessmentSummary assessment={assessment} />
            </>
          )}
          {!readOnly && (
            <fieldset
              disabled={disabled || invalidTimeZone}
              className="planning-assistant"
            >
              <legend>Assess or improve this draft</legend>
              <label>
                <input
                  type="checkbox"
                  checked={refresh}
                  onChange={(e) => setRefresh(e.target.checked)}
                />{" "}
                Refresh routing evidence
              </label>
              {useAiAllowed && (
                <label>
                  <input
                    type="checkbox"
                    checked={useAi}
                    onChange={(e) => setUseAi(e.target.checked)}
                  />{" "}
                  Research opening hours and score preferences with AI
                </label>
              )}
              <div className="planning-actions">
                <button
                  type="button"
                  onClick={() => void run(() => request("assessments"))}
                >
                  Assess draft
                </button>
                <button
                  type="button"
                  onClick={() => void run(() => request("draft"))}
                >
                  Propose a draft
                </button>
                <button
                  type="button"
                  onClick={() => void run(() => request("improvements"))}
                >
                  Suggest improvements
                </button>
              </div>
            </fieldset>
          )}
          {pending && !pending.schedule && (
            <p role="status">
              Planning is running. Available results appear below; your saved
              plan stays unchanged.
            </p>
          )}
          {result && (
            <section aria-label="Planning results">
              <h3>
                {result.kind === "assessment"
                  ? "Assessment result"
                  : result.kind === "schedule"
                    ? "Review schedule"
                    : "Review suggestions"}
              </h3>
              <p>Result: {result.status.replaceAll("_", " ")}</p>
              {result.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              {[
                ...result.alternatives,
                ...result.suggestions.filter(
                  (s) =>
                    !job?.data.review.dismissedSuggestionIds.includes(s.id),
                ),
              ].map((choice) => (
                <article className="planning-choice" key={choice.id}>
                  <h4>{choice.title}</h4>
                  <p>
                    {choice.explanation ??
                      `Group fit ${result.assessment.groupUtility.toFixed(1)} → ${choice.assessment.groupUtility.toFixed(1)}; travel ${durationMinutes(result.assessment.travelDuration)} → ${durationMinutes(choice.assessment.travelDuration)} min; conflicts ${result.assessment.conflictCount} → ${choice.assessment.conflictCount}.`}
                  </p>
                  <button type="button" onClick={() => setPreview(choice)}>
                    Review {choice.title}
                  </button>
                  {!readOnly && choice.fingerprint && (
                    <button
                      type="button"
                      disabled={busy || Boolean(pending)}
                      onClick={() =>
                        void run(async () => {
                          if (!job) return;
                          setJob(
                            await planningRequest<PlanJob>(
                              `${path}/proposals/${result.id}/review`,
                              {
                                method: "PUT",
                                etag: job.etag,
                                contextVersion: result.contextVersion,
                                body: {
                                  dismissedSuggestionIds: [
                                    ...job.data.review.dismissedSuggestionIds,
                                    choice.id,
                                  ],
                                },
                              },
                            ),
                          );
                        })
                      }
                    >
                      Dismiss suggestion
                    </button>
                  )}
                </article>
              ))}
              {result.ruleChanges?.length > 0 && (
                <section aria-label="Optional restriction changes">
                  <h4>Restriction changes to review separately</h4>
                  {result.ruleChanges.map((change) => (
                    <article
                      className="planning-choice"
                      key={change.activityId}
                    >
                      <p>
                        {name(change.activityId)}: {change.description}
                      </p>
                      {!readOnly && (
                        <button
                          type="button"
                          disabled={disabled || staleDraft}
                          onClick={() =>
                            updateRule(change.activityId, change.replacement)
                          }
                        >
                          Accept restriction change into draft
                        </button>
                      )}
                    </article>
                  ))}
                </section>
              )}
              {result.suggestedRules.map((rule, i) => (
                <article className="planning-choice" key={i}>
                  <p>
                    {rule.description} Sleep {rule.settings.sleepStart}–
                    {rule.settings.sleepEnd}; slack{" "}
                    {durationMinutes(rule.settings.slackDuration)} min.
                  </p>
                  {!readOnly && (
                    <button
                      type="button"
                      disabled={disabled || staleDraft}
                      onClick={() => {
                        setPlan({ ...plan, settings: rule.settings });
                        setAvailabilityCurrent(false);
                      }}
                    >
                      Accept settings into draft
                    </button>
                  )}
                </article>
              ))}
            </section>
          )}
          {preview && (
            <section className="planning-preview" aria-label="Proposal preview">
              <h3>{preview.title}</h3>
              <AssessmentSummary assessment={preview.assessment} />
              {preview.assessment.days.map((day) => (
                <div key={`${day.stayId}-${day.date}`}>
                  <h4>{dateName(day.date)}</h4>
                  <DayTotals assessment={day} />
                  <ol>
                    {day.entries.map((entry) => (
                      <li key={entry.activityId}>
                        {time(entry.start)}–{time(entry.end)} · {entry.name}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
              <div className="planning-actions">
                {!readOnly && (
                  <button
                    type="button"
                    className="planning-primary"
                    disabled={disabled}
                    onClick={() => void run(() => save(preview))}
                  >
                    {result?.kind === "schedule"
                      ? "Apply schedule"
                      : "Apply this proposal"}
                  </button>
                )}
                <button type="button" onClick={() => setPreview(undefined)}>
                  Close preview
                </button>
              </div>
            </section>
          )}
          <details>
            <summary>Default timing and transport</summary>
            <fieldset disabled={disabled}>
              <PlanningSettings
                settings={plan.settings}
                prefix="Default"
                onChange={(settings) => {
                  setPlan({ ...plan, settings });
                  setAvailabilityCurrent(false);
                }}
              />
              <p>
                City time zone:{" "}
                {plan.timeZone || "Unavailable — reload to retry"}
              </p>
            </fieldset>
          </details>
          <ActivityPreferencesEditor
            path={`/trips/${encodeURIComponent(tripId)}/activity-preferences`}
            label="Shared trip interests"
            readOnly={readOnly}
            onSaved={() =>
              notify(
                "Preferences saved. Reload the plan to use their new context version.",
              )
            }
          />
          <ActivityPreferencesEditor
            path={`${path.replace(/\/activity-plan$/, "")}/activity-preferences`}
            label="Destination interests"
            readOnly={readOnly}
            onSaved={() =>
              notify(
                "Preferences saved. Reload the plan to use their new context version.",
              )
            }
          />
          <section>
            <h3>Selected, unscheduled</h3>
            {plan.selectedActivityIds.filter((id) => !scheduled.has(id))
              .length === 0 && <p>No unscheduled selections.</p>}
            {plan.selectedActivityIds
              .filter((id) => !scheduled.has(id))
              .map((id) => (
                <article className="planning-stop" key={id}>
                  <button type="button" onClick={() => onSelect(id)}>
                    {name(id)}
                  </button>
                  {assignment(id, null)}
                  {!readOnly && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => state(id, "idea")}
                    >
                      Return to Ideas
                    </button>
                  )}
                  {ruleEditor(id)}
                </article>
              ))}
          </section>
          {plan.days.length === 0 && (
            <p className="planning-attention">
              Set destination visit dates to start a daily schedule.
            </p>
          )}
          {!readOnly && resource.data.context.visits && (
            <details>
              <summary>Add a day from a destination visit</summary>
              {resource.data.context.visits
                .filter((v) => v.arrivalDate && v.departureDate)
                .map((visit) => (
                  <label key={visit.stayId}>
                    Visit {dateName(visit.arrivalDate!)}–
                    {dateName(visit.departureDate!)}
                    <input
                      aria-label={`Add a day for visit ${visit.stayId}`}
                      type="date"
                      min={visit.arrivalDate!}
                      max={visit.departureDate!}
                      disabled={disabled}
                      onChange={(e) => {
                        const date = e.target.value;
                        if (date && !plan.days.some((d) => d.date === date))
                          setPlan({
                            ...plan,
                            days: [
                              ...plan.days,
                              {
                                stayId: visit.stayId,
                                date,
                                activityIds: [],
                                settings: null,
                                availableFrom: null,
                                availableUntil: null,
                                availabilityConfirmed: false,
                                flightMatches: [],
                              },
                            ].sort((a, b) => a.date.localeCompare(b.date)),
                          });
                      }}
                    />
                  </label>
                ))}
            </details>
          )}
          {plan.days.map((day) => {
            const assessed = assessment?.days.find(
              (d) => d.stayId === day.stayId && d.date === day.date,
            );
            const availability = (
              result?.suggestedAvailability?.length
                ? result.suggestedAvailability
                : resource.data.context.suggestedAvailability
            ).find((a) => a.stayId === day.stayId && a.date === day.date);
            return (
              <section
                className="planning-day"
                key={`${day.stayId}-${day.date}`}
                aria-label={dateName(day.date)}
              >
                <h3>{dateName(day.date)}</h3>
                <DayTotals assessment={assessed} />
                <details>
                  <summary>Day availability and overrides</summary>
                  <fieldset disabled={disabled}>
                    <div className="planning-fields">
                      <label>
                        Available from
                        <input
                          type="time"
                          value={day.availableFrom?.slice(0, 5) ?? ""}
                          onChange={(e) =>
                            updateDay(day, {
                              availableFrom:
                                isoClockTime(e.target.value) || null,
                            })
                          }
                        />
                      </label>
                      <label>
                        Available until
                        <input
                          type="time"
                          value={day.availableUntil?.slice(0, 5) ?? ""}
                          onChange={(e) =>
                            updateDay(day, {
                              availableUntil:
                                isoClockTime(e.target.value) || null,
                            })
                          }
                        />
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={day.availabilityConfirmed}
                          onChange={(e) =>
                            updateDay(day, {
                              availabilityConfirmed: e.target.checked,
                            })
                          }
                        />{" "}
                        I confirm this day's availability
                      </label>
                    </div>
                    {availability && (
                      <div>
                        <p>{availability.explanation}</p>
                        <ul>
                          {availability.flightChoices.map((choice) => (
                            <li key={choice}>{choice}</li>
                          ))}
                        </ul>
                        {availability.candidates &&
                          [
                            ...new Set(
                              availability.candidates.map(
                                (c) => `${c.travellerId}:${c.direction}`,
                              ),
                            ),
                          ].map((group) => {
                            const candidates = availability.candidates!.filter(
                              (c) =>
                                `${c.travellerId}:${c.direction}` === group,
                            );
                            const first = candidates[0];
                            return (
                              <label key={group}>
                                {first.travellerName} {first.direction}
                                <select
                                  aria-label={`${first.travellerName} ${first.direction} flight`}
                                  value={
                                    day.flightMatches?.find(
                                      (m) =>
                                        m.travellerId === first.travellerId &&
                                        m.direction === first.direction,
                                    )?.candidateId ?? ""
                                  }
                                  onChange={(e) =>
                                    updateDay(day, {
                                      flightMatches: [
                                        ...(day.flightMatches ?? []).filter(
                                          (m) =>
                                            m.travellerId !==
                                              first.travellerId ||
                                            m.direction !== first.direction,
                                        ),
                                        ...(e.target.value
                                          ? [
                                              {
                                                travellerId: first.travellerId,
                                                direction: first.direction,
                                                candidateId: e.target.value,
                                              },
                                            ]
                                          : []),
                                      ],
                                      availabilityConfirmed: false,
                                    })
                                  }
                                >
                                  <option value="">
                                    {candidates.length === 1
                                      ? "Use the only matching flight"
                                      : "Choose the matching flight"}
                                  </option>
                                  {candidates.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.time.slice(0, 16).replace("T", " ")}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            );
                          })}
                        {(availability.ambiguous || !availabilityCurrent) &&
                          !readOnly && (
                            <button
                              type="button"
                              onClick={() =>
                                void run(() => request("assessments"))
                              }
                            >
                              Assess selected flight matches
                            </button>
                          )}
                        {!availability.ambiguous && !readOnly && (
                          <button
                            type="button"
                            disabled={!availabilityCurrent}
                            onClick={() =>
                              updateDay(day, {
                                availableFrom: availability.availableFrom,
                                availableUntil: availability.availableUntil,
                                availabilityConfirmed: true,
                              })
                            }
                          >
                            Accept flight availability:{" "}
                            {availability.availableFrom ?? "usual start"}–
                            {availability.availableUntil ?? "usual end"}
                          </button>
                        )}
                      </div>
                    )}
                    <label>
                      <input
                        type="checkbox"
                        checked={day.settings !== null}
                        onChange={(e) =>
                          updateDay(day, {
                            settings: e.target.checked
                              ? { ...plan.settings }
                              : null,
                          })
                        }
                      />{" "}
                      Override this day's rest, meals, slack or transport
                    </label>
                    {day.settings && (
                      <PlanningSettings
                        settings={day.settings}
                        prefix={dateName(day.date)}
                        onChange={(settings) => updateDay(day, { settings })}
                      />
                    )}
                  </fieldset>
                </details>
                <ol className="planning-timeline">
                  {day.activityIds.flatMap((id, index) => {
                    const entry = assessed?.entries.find(
                      (e) => e.activityId === id,
                    );
                    const leg = assessed?.travel.find(
                      (t) => t.toActivityId === id,
                    );
                    const assessedIndex =
                      assessed?.entries.findIndex((e) => e.activityId === id) ??
                      -1;
                    const precedingEnd =
                      assessedIndex > 0
                        ? assessed?.entries[assessedIndex - 1].end
                        : null;
                    const meals =
                      assessed?.breaks.filter(
                        (meal) =>
                          meal.start &&
                          entry?.start &&
                          meal.start < entry.start &&
                          (!precedingEnd || meal.start >= precedingEnd),
                      ) ?? [];
                    return [
                      ...meals.map((meal) => (
                        <li
                          key={`${id}-${meal.name}`}
                          className="planning-breaks"
                        >
                          {time(meal.start)}–{time(meal.end)} · {meal.name} ·{" "}
                          {durationMinutes(meal.duration)} min
                        </li>
                      )),
                      <li
                        key={id}
                        className="planning-stop"
                        data-order-index={index}
                      >
                        {leg && (
                          <p className="planning-travel">
                            {durationMinutes(leg.duration)} min{" "}
                            {modeName(leg.mode)} from {name(leg.fromActivityId)}
                            {leg.provisional && " · estimated"}
                            {durationMinutes(leg.waitingDuration) > 0 &&
                              ` · ${durationMinutes(leg.waitingDuration)} min waiting`}{" "}
                            · {leg.source}
                          </p>
                        )}
                        {entry && (
                          <span>
                            {time(entry.start)}–{time(entry.end)}{" "}
                            {entry.provisional && "(provisional)"}
                          </span>
                        )}
                        <button
                          type="button"
                          className="planning-activity-name"
                          onClick={() => onSelect(id)}
                        >
                          {name(id)}
                        </button>
                        {assignment(id, day.date)}
                        {!readOnly && (
                          <div className="planning-actions">
                            <ActivityOrderHandle
                              name={name(id)}
                              index={index}
                              count={day.activityIds.length}
                              disabled={disabled}
                              onMove={(position) =>
                                move(id, day.date, position)
                              }
                            />
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => state(id, "idea")}
                            >
                              Return to Ideas
                            </button>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                updateRule(id, {
                                  mustDo: true,
                                  fixedDate: day.date,
                                  afterActivityId:
                                    index > 0
                                      ? day.activityIds[index - 1]
                                      : null,
                                });
                                notify(
                                  "This activity is now required on this day, after its current predecessor. Save to keep the restriction.",
                                );
                              }}
                            >
                              Keep this choice
                            </button>
                          </div>
                        )}
                        {ruleEditor(id)}
                        {travelEditor(
                          day,
                          index > 0 ? day.activityIds[index - 1] : null,
                          id,
                        )}
                      </li>,
                    ];
                  })}
                </ol>
                {assessed && (
                  <div className="planning-breaks">
                    {assessed.breaks
                      .filter(
                        (meal) =>
                          !assessed.entries.length ||
                          !meal.start ||
                          !assessed.entries.at(-1)?.end ||
                          meal.start >= assessed.entries.at(-1)!.end!,
                      )
                      .map((meal, i) => (
                        <p key={i}>
                          {time(meal.start)} · {meal.name} ·{" "}
                          {durationMinutes(meal.duration)} min
                        </p>
                      ))}
                    {assessed.travel.find((t) => t.toActivityId === null) && (
                      <p>
                        Return to accommodation:{" "}
                        {durationMinutes(
                          assessed.travel.find((t) => t.toActivityId === null)!
                            .duration,
                        )}{" "}
                        min
                      </p>
                    )}
                    <p>
                      Flexible slack: {durationMinutes(assessed.slackDuration)}{" "}
                      min
                    </p>
                  </div>
                )}
                {day.activityIds.length > 0 &&
                  travelEditor(day, day.activityIds.at(-1)!, null)}
                {day.activityIds.length === 0 && (
                  <p>Choose a day for one of your selected activities.</p>
                )}
              </section>
            );
          })}
          <section>
            <h3>Available ideas and excluded activities</h3>
            {activities
              .filter((a) => !plan.selectedActivityIds.includes(a.id))
              .map((activity) => (
                <article className="planning-idea" key={activity.id}>
                  <button type="button" onClick={() => onSelect(activity.id)}>
                    {activity.properties.name}
                  </button>
                  <span>
                    {activity.properties.duration === null
                      ? "Duration unknown"
                      : `${durationMinutes(activity.properties.duration)} min`}{" "}
                    ·{" "}
                    {plan.excludedActivityIds.includes(activity.id)
                      ? "Excluded"
                      : "Idea"}
                  </span>
                  {!readOnly && (
                    <div className="planning-actions">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => state(activity.id, "selected")}
                      >
                        Select activity
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          state(
                            activity.id,
                            plan.excludedActivityIds.includes(activity.id)
                              ? "idea"
                              : "excluded",
                          )
                        }
                      >
                        {plan.excludedActivityIds.includes(activity.id)
                          ? "Return to Ideas"
                          : "Exclude activity"}
                      </button>
                    </div>
                  )}
                  {ruleEditor(activity.id)}
                </article>
              ))}
          </section>
          <ActivityCalendarSubscriptions tripId={tripId} />
        </section>
      )}
    </section>
  );
}
