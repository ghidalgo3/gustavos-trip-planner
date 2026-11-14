import { Button } from "@fluentui/react-components";
import { useEffect, useEffectEvent, useRef } from "react";
import {
  Add20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  VehicleCar20Regular,
  PersonWalking20Regular,
} from "@fluentui/react-icons";
import type { Activity, Destination } from "./activitiesApi";
import type { ActivityPlan, PlanAssessment, PlanDay } from "./activityPlanApi";
import {
  calendarClock,
  calendarDateLabel,
  calendarDayKey,
  calendarEntries,
  calendarLayout,
  type CalendarEntry,
} from "./activityCalendarModel";

export default function ActivityCalendar({
  plan,
  day,
  activities,
  assessment,
  destination,
  readOnly,
  busy,
  onDay,
  onEvent,
  onEntry,
  onDayDetails,
}: {
  plan: ActivityPlan;
  day?: PlanDay;
  activities: Activity[];
  assessment?: PlanAssessment;
  destination?: Destination;
  readOnly: boolean;
  busy: boolean;
  onDay: (key: string) => void;
  onEvent: (id?: string) => void;
  onEntry: (entry: CalendarEntry) => void;
  onDayDetails: () => void;
}) {
  const days = [...plan.days].sort((a, b) => a.date.localeCompare(b.date));
  const index = days.findIndex(
    (item) => day && calendarDayKey(item) === calendarDayKey(day),
  );
  const entries = day
    ? calendarEntries(plan, day, activities, assessment, destination)
    : [];
  const timed = new Set(
    entries
      .filter((item) => item.kind === "activity")
      .map((item) => item.activityId),
  );
  const unscheduled = plan.selectedActivityIds.filter(
    (id) =>
      !plan.days.some((item) => item.activityIds.includes(id)) ||
      (!!day?.activityIds.includes(id) && !timed.has(id)),
  );
  const startHour = Math.min(
    7,
    ...entries.map((item) => Math.max(0, Math.floor(item.start / 60))),
  );
  const endHour = Math.max(
    22,
    ...entries.map((item) => Math.min(24, Math.ceil(item.end / 60))),
  );
  const startMinute = startHour * 60;
  const height = (endHour - startHour) * 90;
  const scroll = useRef<HTMLDivElement>(null);
  const scrollToEvents = useEffectEvent(() => {
    const first = entries.find((entry) => entry.kind === "activity");
    if (scroll.current) {
      scroll.current.scrollTop = Math.max(
        0,
        ((first?.start ?? 480) - startMinute - 60) * 1.5,
      );
    }
  });
  useEffect(() => {
    scrollToEvents();
  }, [day?.stayId, day?.date]);
  const issues =
    assessment?.issues.filter(
      (item) => !item.date || item.date === day?.date,
    ) ?? [];
  return (
    <div className="activity-calendar">
      <header className="calendar-toolbar">
        <div className="calendar-navigation">
          <Button
            icon={<ChevronLeft20Regular />}
            aria-label="Previous day"
            disabled={index <= 0}
            onClick={() => onDay(calendarDayKey(days[index - 1]))}
          />
          <label className="calendar-date-picker">
            <span className="visually-hidden">Calendar day</span>
            <select
              aria-label="Calendar day"
              value={day ? calendarDayKey(day) : ""}
              onChange={(event) => onDay(event.target.value)}
              disabled={!days.length}
            >
              {!days.length && <option value="">No visit dates</option>}
              {days.map((item) => (
                <option key={calendarDayKey(item)} value={calendarDayKey(item)}>
                  {item.name ? `${item.name} · ` : ""}
                  {calendarDateLabel(item.date)}
                </option>
              ))}
            </select>
          </label>
          <Button
            icon={<ChevronRight20Regular />}
            aria-label="Next day"
            disabled={index < 0 || index >= days.length - 1}
            onClick={() => onDay(calendarDayKey(days[index + 1]))}
          />
        </div>
        <div className="calendar-toolbar-actions">
          <span className="calendar-zone">
            {plan.timeZone ?? destination?.properties.timeZone}
          </span>
          {day && <Button onClick={onDayDetails}>Day details</Button>}
          {!readOnly && (
            <Button
              appearance="primary"
              icon={<Add20Regular />}
              disabled={
                busy || !days.length || !plan.selectedActivityIds.length
              }
              onClick={() => onEvent()}
            >
              Add event
            </Button>
          )}
        </div>
      </header>
      {issues.length > 0 && (
        <details className="calendar-conflicts">
          <summary>
            {issues.length}{" "}
            {issues.length === 1 ? "schedule notice" : "schedule notices"}
          </summary>
          <ul>
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </details>
      )}
      {unscheduled.length > 0 && (
        <section
          className="calendar-unscheduled"
          aria-label="Unscheduled activities"
        >
          <strong>Unscheduled</strong>
          <div>
            {unscheduled.map((id) => (
              <Button key={id} onClick={() => onEvent(id)}>
                {activities.find((item) => item.id === id)?.properties.name ??
                  "Activity"}
              </Button>
            ))}
          </div>
        </section>
      )}
      {!days.length ? (
        <div className="calendar-empty">
          <h3>No visit dates</h3>
          <p>Add dates on Overview.</p>
        </div>
      ) : (
        <>
          <h3 className="calendar-day-heading">
            {day?.name && <strong>{day.name}</strong>}
            <time dateTime={day?.date}>
              {day && calendarDateLabel(day.date)}
            </time>
          </h3>
          <div
            ref={scroll}
            className="calendar-scroll"
            tabIndex={0}
            role="region"
            aria-label="Day calendar"
          >
            <div className="calendar-grid" style={{ height }}>
              {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
                <div key={i} className="calendar-hour" style={{ top: i * 90 }}>
                  <time>{calendarClock((startHour + i) * 60)}</time>
                  <span />
                </div>
              ))}
              <div className="calendar-events">
                {calendarLayout(entries)
                  .filter(
                    (entry) =>
                      (entry.end > startMinute && entry.start < endHour * 60) ||
                      (entry.start >= startMinute &&
                        entry.start < endHour * 60),
                  )
                  .map((entry) => {
                    const top = Math.max(0, entry.start - startMinute) * 1.5;
                    const size = Math.max(
                      entry.kind === "travel" ? 44 : 46,
                      (Math.min(endHour * 60, entry.end) -
                        Math.max(startMinute, entry.start)) *
                        1.5 -
                        3,
                    );
                    const label = entry.travel
                      ? `${entry.title} from ${entry.travel.label.replace(" → ", " to ")}`
                      : entry.title;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={`calendar-event calendar-event-${entry.kind}${entry.estimated ? " calendar-event-estimated" : ""}`}
                        aria-label={label}
                        style={{
                          top,
                          height: size,
                          left: `calc(${(entry.lane / entry.lanes) * 100}% + 2px)`,
                          width: `calc(${100 / entry.lanes}% - 4px)`,
                        }}
                        onClick={() => onEntry(entry)}
                      >
                        <strong>
                          {entry.kind === "travel" &&
                            (entry.travel?.mode === "walking" ? (
                              <PersonWalking20Regular />
                            ) : (
                              <VehicleCar20Regular />
                            ))}
                          {entry.title}
                        </strong>
                        <span>
                          {entry.kind === "travel"
                            ? entry.detail
                            : `${calendarClock(Math.max(0, entry.start))}–${calendarClock(entry.end)}${entry.end >= 1440 ? " (+1 day)" : ""}`}
                        </span>
                        {entry.kind !== "travel" && entry.detail && (
                          <small>{entry.detail}</small>
                        )}
                      </button>
                    );
                  })}
                {!entries.some((item) => item.kind === "activity") && (
                  <div className="calendar-empty-day">No events scheduled</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
