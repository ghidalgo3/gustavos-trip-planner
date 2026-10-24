import ActivityOrderHandle from "./ActivityOrderHandle";
import {
  CalendarLtr24Regular,
  ArrowRight20Regular,
  ChevronDown20Regular,
  ChevronRight20Regular,
} from "@fluentui/react-icons";
import { useId, useState, type ReactNode } from "react";
import type { Activity } from "./activitiesApi";
import type { ActivityPlan, PlanAssessment, PlanDay } from "./activityPlanApi";
import { durationMinutes } from "../../shared/time/durations";

const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

export default function ActivityAgenda({
  plan,
  activities,
  assessment,
  assessmentError,
  disabled,
  readOnly,
  onChooseActivities,
  onSchedule,
  onSelect,
  onMove,
  onRemove,
}: {
  plan: ActivityPlan;
  activities: Activity[];
  assessment?: PlanAssessment;
  assessmentError?: string;
  disabled: boolean;
  readOnly: boolean;
  onChooseActivities?: () => void;
  onSchedule?: () => void;
  onSelect: (id: string) => void;
  onMove: (id: string, date: string | null, index?: number) => void;
  onRemove: (id: string) => void;
}) {
  const agendaId = useId();
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const scheduled = new Set(plan.days.flatMap((day) => day.activityIds));
  const unscheduled = plan.selectedActivityIds.filter(
    (id) => !scheduled.has(id),
  );
  const chooseButton = onChooseActivities && !readOnly && (
    <button
      type="button"
      className="planning-primary"
      disabled={disabled}
      onClick={onChooseActivities}
    >
      Choose activities
    </button>
  );

  function activityItem(id: string, day?: PlanDay, index = 0) {
    const activity = activities.find((item) => item.id === id);
    const name = activity?.properties.name ?? "Activity";
    const duration = durationMinutes(
      plan.rules.find((rule) => rule.activityId === id)?.duration ??
        activity?.properties.duration,
    );
    const entry =
      day &&
      assessment?.days
        .find((item) => item.stayId === day.stayId && item.date === day.date)
        ?.entries.find((item) => item.activityId === id);
    return (
      <li
        className="agenda-item"
        key={id}
        data-order-index={day ? index : undefined}
      >
        <div className="agenda-time">
          {day ? (
            <>
              <span>{entry?.start ? entry.start.slice(11, 16) : "—"}</span>
              <small>{entry?.start ? "Estimated" : "Time to decide"}</small>
            </>
          ) : (
            <CalendarLtr24Regular aria-hidden="true" />
          )}
        </div>
        <div className="agenda-card">
          <div className="agenda-card-heading">
            {day && !readOnly && (
              <ActivityOrderHandle
                name={name}
                index={index}
                count={day.activityIds.length}
                disabled={disabled}
                onMove={(position) => onMove(id, day.date, position)}
              />
            )}
            <button
              type="button"
              className="agenda-name"
              onClick={() => onSelect(id)}
            >
              {name}
            </button>
          </div>
          <p className="agenda-meta">
            {duration === null ? "Duration to decide" : `${duration} min`}
            {activity?.properties.placeName &&
              ` · ${activity.properties.placeName}`}
          </p>
          <label>
            Day
            <select
              aria-label={`Day for ${name}`}
              disabled={disabled || plan.days.length === 0}
              value={day?.date ?? ""}
              onChange={(event) => onMove(id, event.target.value || null)}
            >
              <option value="">Choose a day later</option>
              {plan.days.map((option) => (
                <option
                  key={`${option.stayId}-${option.date}`}
                  value={option.date}
                >
                  {dateLabel(option.date)}
                </option>
              ))}
            </select>
          </label>
          {!readOnly && (
            <div className="agenda-item-actions">
              <button
                type="button"
                aria-label={`Return ${name} to Ideas`}
                disabled={disabled}
                onClick={() => onRemove(id)}
              >
                Return to Ideas
              </button>
            </div>
          )}
        </div>
      </li>
    );
  }

  function dayItems(day: PlanDay) {
    const settings = day.settings ?? plan.settings;
    const evaluatedDay = assessment?.days.find(
      (item) => item.stayId === day.stayId && item.date === day.date,
    );
    const meals: ReactNode[][] = Array.from(
      { length: day.activityIds.length + 1 },
      () => [],
    );
    const routine = (name: string, time: string | null, detail: string) => (
      <li className="agenda-item agenda-routine" key={name} aria-label={name}>
        <div className="agenda-time">
          <span>{time ?? "—"}</span>
        </div>
        <div className="agenda-routine-card">
          <strong>{name}</strong>
          <span>{detail}</span>
        </div>
      </li>
    );

    function travelCard(from: string | null, to: string | null) {
      const leg = evaluatedDay?.travel.find(
        (item) => item.fromActivityId === from && item.toActivityId === to,
      );
      // Always expose a missing connection between activities; stay legs appear when assessed.
      if (!leg && (from === null || to === null)) return null;
      const override = [...plan.transportOverrides]
        .reverse()
        .find(
          (item) =>
            item.date === day.date &&
            item.fromActivityId === from &&
            item.toActivityId === to,
        );
      const mode =
        leg?.mode ??
        (settings.transportMode === "driving"
          ? "driving"
          : (override?.mode ?? settings.transportMode));
      const modeLabel =
        (
          {
            walking: "Walking",
            taxi: "Taxi / rideshare",
            driving: "Driving",
          } as Record<string, string>
        )[mode] ?? mode;
      const name = (id: string | null) =>
        id === null
          ? "stay"
          : (activities.find((item) => item.id === id)?.properties.name ??
            "activity");
      const label = `Travel from ${name(from)} to ${name(to)}`;
      const duration = leg
        ? `${Math.ceil(durationMinutes(leg.duration))} min`
        : assessmentError
          ? "Travel time unavailable"
          : !assessment
            ? "Calculating travel…"
            : "Travel time unknown";
      return (
        <li
          className="agenda-item agenda-travel"
          key={`travel-${from}-${to}`}
          aria-label={label}
        >
          <div className="agenda-time">
            <ArrowRight20Regular aria-hidden="true" />
          </div>
          <div className="agenda-travel-card" title={leg?.source}>
            <strong>
              {modeLabel} · {duration}
            </strong>
            {from === null && <span>From stay</span>}
            {to === null && <span>Back to stay</span>}
            {leg?.provisional && <span>Estimated</span>}
          </div>
        </li>
      );
    }

    for (const [meal, label, allowance] of [
      ["breakfast", "Breakfast", settings.breakfastDuration],
      ["lunch", "Lunch", settings.lunchDuration],
      ["dinner", "Dinner", settings.dinnerDuration],
    ]) {
      const mealBreak = evaluatedDay?.breaks.find((item) => item.name === meal);
      const coveringActivities = day.activityIds.filter((id) =>
        plan.rules.some(
          (rule) => rule.activityId === id && rule.coversMeal === meal,
        ),
      );
      const coveredMinutes = coveringActivities.reduce(
        (total, id) =>
          total +
          (durationMinutes(
            plan.rules.find((rule) => rule.activityId === id)?.duration ??
              activities.find((activity) => activity.id === id)?.properties
                .duration,
          ) ?? 60),
        0,
      );
      const remaining = mealBreak
        ? durationMinutes(mealBreak.duration)
        : Math.max(0, durationMinutes(allowance) - coveredMinutes);
      const included =
        coveringActivities.length > 0
          ? `Included in ${coveringActivities.map((id) => activities.find((activity) => activity.id === id)?.properties.name ?? "activity").join(", ")}`
          : "";
      const detail =
        remaining > 0
          ? `${remaining} min${included ? " additional" : ""} · ${mealBreak?.start ? "Estimated" : "Time not set"}${included ? ` · ${included}` : ""}`
          : included || "No time reserved";
      let slot = meal === "breakfast" ? 0 : day.activityIds.length;
      if (mealBreak?.start) {
        const nextActivity = day.activityIds.findIndex((id) => {
          const start = evaluatedDay?.entries.find(
            (entry) => entry.activityId === id,
          )?.start;
          return start && Date.parse(start) >= Date.parse(mealBreak.start!);
        });
        slot = nextActivity < 0 ? day.activityIds.length : nextActivity;
      } else if (coveringActivities.length > 0) {
        slot = day.activityIds.indexOf(coveringActivities[0]) + 1;
      }
      meals[slot].push(
        routine(label, mealBreak?.start?.slice(11, 16) ?? null, detail),
      );
    }

    return [
      routine("Wake up", settings.sleepEnd.slice(0, 5), "Start of day"),
      ...day.activityIds.flatMap((id, index) => [
        ...meals[index],
        travelCard(index === 0 ? null : day.activityIds[index - 1], id),
        activityItem(id, day, index),
      ]),
      ...(day.activityIds.length > 0
        ? [travelCard(day.activityIds.at(-1)!, null)]
        : []),
      ...meals[day.activityIds.length],
      routine(
        "Sleep",
        settings.sleepStart.slice(0, 5),
        settings.sleepStart <= settings.sleepEnd
          ? "Bedtime · Next day"
          : "Bedtime",
      ),
    ];
  }

  function freeTime(day: PlanDay) {
    const evaluated = assessment?.days.find(
      (item) => item.stayId === day.stayId && item.date === day.date,
    );
    if (!evaluated)
      return (
        <span title={assessmentError}>
          {assessmentError ? "Free time unavailable" : "Calculating free time…"}
        </span>
      );
    const overrun = durationMinutes(evaluated.overrunDuration);
    const minutes = Math.max(
      0,
      durationMinutes(evaluated.slackDuration) -
        durationMinutes(evaluated.requiredSlackDuration),
    );
    // Round down to avoid offering more free time than the assessment allows.
    const hours = (Math.floor(minutes / 6) / 10).toLocaleString(undefined, {
      maximumFractionDigits: 1,
    });
    const estimated = assessment?.status !== "fits";
    return (
      <span
        className={overrun > 0 ? "agenda-overrun" : undefined}
        title="After activities, travel, meals, waiting, and reserved slack. Updates as you edit."
      >
        {overrun > 0 ? "0" : hours} h free{estimated ? " (estimated)" : ""}
        {overrun > 0 && ` · ${Math.ceil(overrun)} min over capacity`}
      </span>
    );
  }

  return (
    <div className="activity-agenda">
      {plan.selectedActivityIds.length === 0 && (
        <section className="agenda-empty" aria-label="Empty agenda">
          <CalendarLtr24Regular aria-hidden="true" />
          <h3>Your agenda is empty</h3>
          <p>
            {readOnly
              ? "No activities have been planned yet."
              : "Start in Ideas. Mark an activity Planned to add it here, then choose a day when you’re ready."}
          </p>
        </section>
      )}
      {unscheduled.length > 0 && (
        <section aria-label="To schedule" className="agenda-group">
          <header className="agenda-day-heading">
            <h3>To schedule</h3>
            <span>
              {unscheduled.length}{" "}
              {unscheduled.length === 1 ? "activity" : "activities"}
            </span>
          </header>
          <p>
            Ask the planner to pick days and times, or choose days manually.
          </p>
          {!readOnly && onSchedule && (
            <>
              <button
                type="button"
                className="planning-primary"
                disabled={disabled || plan.days.length === 0}
                onClick={onSchedule}
              >
                Schedule activities
              </button>
              <p>
                Pick and save days, times, and an order for your planned
                activities based on your constraints. With a stay, each day's
                route starts and ends there. Without one, travel is counted only
                between activities, breakfast comes before the first activity,
                and the last activity starts after dinner.
              </p>
            </>
          )}
          {plan.days.length === 0 && (
            <p className="planning-attention">
              Add visit dates on Overview to choose days for these activities.
            </p>
          )}
          <ol className="agenda-list">
            {unscheduled.map((id) => activityItem(id))}
          </ol>
        </section>
      )}
      {[...plan.days]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((day) => {
          const key = `${day.stayId}-${day.date}`;
          const expanded = !collapsedDays.has(key);
          const contentId = `${agendaId}-${key}`;
          return (
            <section
              className="agenda-group"
              aria-label={dateLabel(day.date)}
              key={`${day.stayId}-${day.date}`}
            >
              <h3 className="agenda-day-title">
                <button
                  type="button"
                  className="agenda-day-toggle"
                  aria-label={dateLabel(day.date)}
                  aria-describedby={`${contentId}-summary`}
                  aria-expanded={expanded}
                  aria-controls={contentId}
                  onClick={() =>
                    setCollapsedDays((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                >
                  {expanded ? (
                    <ChevronDown20Regular aria-hidden="true" />
                  ) : (
                    <ChevronRight20Regular aria-hidden="true" />
                  )}
                  <time dateTime={day.date}>{dateLabel(day.date)}</time>
                  <span
                    className="agenda-day-summary"
                    id={`${contentId}-summary`}
                  >
                    {freeTime(day)}
                    <span>
                      {day.activityIds.length}{" "}
                      {day.activityIds.length === 1 ? "activity" : "activities"}
                    </span>
                  </span>
                </button>
              </h3>
              <div id={contentId} hidden={!expanded}>
                {day.activityIds.length === 0 && (
                  <p>No activities scheduled for this day.</p>
                )}
                <ol className="agenda-list">{dayItems(day)}</ol>
              </div>
            </section>
          );
        })}
      {chooseButton}
    </div>
  );
}
