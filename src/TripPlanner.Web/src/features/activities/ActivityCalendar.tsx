import { Button } from "@fluentui/react-components";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useSyncExternalStore,
} from "react";
import { Link } from "react-router";
import {
  Add20Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
  VehicleCar20Regular,
  PersonWalking20Regular,
  Airplane20Regular,
  Bed20Regular,
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
  type CalendarTiming,
} from "./activityCalendarModel";
import CalendarActivityList from "./CalendarActivityList";
import ResizableActivityWorkspace from "./ResizableActivityWorkspace";
import useCalendarDrag from "./useCalendarDrag";
import type { TripDocument } from "../../api/tripDocument";
import { scheduledTravelEntries } from "./scheduledTravel";

export default function ActivityCalendar({
  tripId,
  itinerary,
  plan,
  day,
  activities,
  assessment,
  destination,
  readOnly,
  busy,
  pendingTiming,
  onDay,
  onEvent,
  onEntry,
  onDayDetails,
  onTiming,
}: {
  tripId: string;
  itinerary?: TripDocument["itinerary"];
  plan: ActivityPlan;
  day?: PlanDay;
  activities: Activity[];
  assessment?: PlanAssessment;
  destination?: Destination;
  readOnly: boolean;
  busy: boolean;
  pendingTiming?: CalendarTiming;
  onDay: (key: string) => void;
  onEvent: (id?: string) => void;
  onEntry: (entry: CalendarEntry) => void;
  onDayDetails: () => void;
  onTiming: (timing: CalendarTiming) => void;
}) {
  const agenda = useSyncExternalStore(subscribeToWideCalendar, showAgenda);
  const days = [...plan.days].sort((a, b) => a.date.localeCompare(b.date));
  const index = days.findIndex(
    (item) => day && calendarDayKey(item) === calendarDayKey(day),
  );
  const tripTravel = day
    ? scheduledTravelEntries(itinerary?.items ?? [], day, plan.timeZone)
    : [];
  const entries = day
    ? [
        ...calendarEntries(
          plan,
          day,
          activities,
          assessment,
          destination,
          pendingTiming,
        ).filter(
          (entry) =>
            entry.kind !== "flight" ||
            !tripTravel.some((item) => item.kind === "flight"),
        ),
        ...tripTravel,
      ].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    : [];
  const timed = new Set(
    plan.days
      .flatMap((item) =>
        calendarEntries(
          plan,
          item,
          activities,
          assessment,
          destination,
          pendingTiming,
        ),
      )
      .filter((item) => item.kind === "activity")
      .flatMap((item) => (item.activityId ? [item.activityId] : [])),
  );
  const startHour = 0;
  const endHour = 24;
  const startMinute = startHour * 60;
  const height = (endHour - startHour) * 90;
  const calendarId = useId();
  const scroll = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useCalendarDrag({
    disabled: agenda || readOnly || busy || !day,
    onTiming,
    grid,
    scroll,
    dayKey: day ? calendarDayKey(day) : "",
    onNavigate: onDay,
  });
  const scrollToEvents = useEffectEvent(() => {
    const first = entries.find((entry) => entry.kind !== "break");
    if (scroll.current) {
      scroll.current.scrollTop = Math.max(
        0,
        ((first?.start ?? 480) - startMinute - 60) * 1.5,
      );
    }
  });
  useEffect(() => {
    scrollToEvents();
  }, [agenda, day?.stayId, day?.date]);
  const issues =
    assessment?.issues.filter(
      (item) => !item.date || item.date === day?.date,
    ) ?? [];
  return (
    <div className="calendar-interaction-workspace" {...drag.handlers}>
      <ResizableActivityWorkspace mapPanelId={calendarId} layout="calendar">
        <CalendarActivityList
          activities={activities}
          plan={plan}
          timedIds={timed}
          disabled={busy}
          readOnly={readOnly}
          onEvent={onEvent}
          dragCard={drag.dragCard}
          onDrag={
            agenda
              ? undefined
              : (event, timing) => drag.begin(event, timing, "move", true)
          }
        />
        <div className="activity-calendar" id={calendarId}>
          <header className="calendar-toolbar">
            <div className="calendar-navigation">
              <Button
                icon={<ChevronLeft20Regular />}
                aria-label="Previous day"
                data-calendar-day={
                  index > 0 ? calendarDayKey(days[index - 1]) : undefined
                }
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
                    <option
                      key={calendarDayKey(item)}
                      value={calendarDayKey(item)}
                    >
                      {item.name ? `${item.name} · ` : ""}
                      {calendarDateLabel(item.date)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                icon={<ChevronRight20Regular />}
                aria-label="Next day"
                data-calendar-day={
                  index >= 0 && index < days.length - 1
                    ? calendarDayKey(days[index + 1])
                    : undefined
                }
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
                  disabled={!days.length || !activities.length}
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
                ref={agenda ? undefined : scroll}
                className={agenda ? "calendar-agenda" : "calendar-scroll"}
                tabIndex={agenda ? undefined : 0}
                role="region"
                aria-label="Day calendar"
              >
                <div
                  className="calendar-grid"
                  style={agenda ? undefined : { height }}
                >
                  {!agenda &&
                    Array.from({ length: endHour - startHour + 1 }, (_, i) => (
                      <div
                        key={i}
                        className="calendar-hour"
                        style={{ top: i * 90 }}
                      >
                        <time>{calendarClock((startHour + i) * 60)}</time>
                        <span />
                      </div>
                    ))}
                  <div
                    className="calendar-events"
                    ref={agenda ? undefined : grid}
                  >
                    {calendarLayout(entries)
                      .filter(
                        (entry) =>
                          (entry.end > startMinute &&
                            entry.start < endHour * 60) ||
                          (entry.start >= startMinute &&
                            entry.start < endHour * 60),
                      )
                      .map((entry) => {
                        const top =
                          Math.max(0, entry.start - startMinute) * 1.5;
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
                        const content = (
                          <>
                            <strong>
                              {entry.kind === "lodging" && <Bed20Regular />}
                              {entry.kind === "flight" && <Airplane20Regular />}
                              {entry.kind === "transportation" && (
                                <VehicleCar20Regular />
                              )}
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
                                : entry.start === entry.end
                                  ? calendarClock(entry.start)
                                  : `${calendarClock(Math.max(0, entry.start))}–${entry.end === 1440 ? "24:00" : calendarClock(entry.end)}${entry.end > 1440 ? " (+1 day)" : ""}`}
                            </span>
                            {entry.kind !== "travel" && entry.detail && (
                              <small>{entry.detail}</small>
                            )}
                          </>
                        );
                        return (
                          <div
                            key={entry.id}
                            className={`calendar-event calendar-event-${entry.kind}${entry.estimated ? " calendar-event-estimated" : ""}`}
                            style={
                              agenda
                                ? undefined
                                : {
                                    top,
                                    height: size,
                                    left: `calc(${(entry.lane / entry.lanes) * 100}% + 2px)`,
                                    width: `calc(${100 / entry.lanes}% - 4px)`,
                                  }
                            }
                            onPointerDown={(event) => {
                              if (
                                event.target === event.currentTarget &&
                                entry.activityId
                              )
                                drag.begin(event, {
                                  activityId: entry.activityId,
                                  start: entry.start,
                                  end: entry.end,
                                });
                            }}
                            onClick={(event) => {
                              if (event.target === event.currentTarget)
                                onEntry(entry);
                            }}
                          >
                            {entry.kind === "flight" ? (
                              <Link
                                className="calendar-event-content calendar-travel-link"
                                aria-label={label}
                                to={`/trips/${encodeURIComponent(tripId)}/flights`}
                              >
                                {content}
                              </Link>
                            ) : (
                              <button
                                type="button"
                                className={`calendar-event-content${entry.kind === "transportation" ? " calendar-transportation-link" : ""}`}
                                data-draggable={
                                  !!entry.activityId && !readOnly && !agenda
                                }
                                aria-label={label}
                                disabled={busy}
                                onClick={() => onEntry(entry)}
                                onPointerDown={(event) =>
                                  entry.activityId &&
                                  drag.begin(event, {
                                    activityId: entry.activityId,
                                    start: entry.start,
                                    end: entry.end,
                                  })
                                }
                              >
                                {content}
                              </button>
                            )}
                            {entry.activityId && !readOnly && !agenda && (
                              <>
                                {(["start", "end"] as const).map((edge) => (
                                  <button
                                    key={edge}
                                    type="button"
                                    className={`calendar-resize calendar-resize-${edge}`}
                                    aria-label={`Resize ${entry.title} ${edge}`}
                                    title={`Resize ${edge} time`}
                                    disabled={busy}
                                    onClick={() => onEntry(entry)}
                                    onPointerDown={(event) =>
                                      drag.begin(
                                        event,
                                        {
                                          activityId: entry.activityId!,
                                          start: entry.start,
                                          end: entry.end,
                                        },
                                        edge,
                                      )
                                    }
                                  >
                                    <span />
                                  </button>
                                ))}
                              </>
                            )}
                          </div>
                        );
                      })}
                    {entries.length === 0 && (
                      <div className="calendar-empty-day">
                        No events scheduled
                      </div>
                    )}
                    {drag.preview && (
                      <div
                        className="calendar-drag-preview"
                        style={{
                          top: drag.preview.start * 1.5,
                          height: Math.max(
                            44,
                            (drag.preview.end - drag.preview.start) * 1.5,
                          ),
                        }}
                      >
                        <strong>
                          {
                            activities.find(
                              (item) => item.id === drag.preview!.activityId,
                            )?.properties.name
                          }
                        </strong>
                        <span>
                          {calendarClock(drag.preview.start)}–
                          {calendarClock(drag.preview.end)}
                          {drag.preview.end >= 1440 ? " (+1 day)" : ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </ResizableActivityWorkspace>
    </div>
  );
}

// Match the breakpoint where the schedule workspace stacks its panels.
const wideCalendar = "(min-width: 1100px)";

function showAgenda() {
  return !(window.matchMedia?.(wideCalendar).matches ?? true);
}

function subscribeToWideCalendar(onChange: () => void) {
  const media = window.matchMedia?.(wideCalendar);
  media?.addEventListener?.("change", onChange);
  return () => media?.removeEventListener?.("change", onChange);
}
