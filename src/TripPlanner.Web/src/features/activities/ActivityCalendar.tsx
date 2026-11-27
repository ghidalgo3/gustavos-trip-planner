import { Button } from "@fluentui/react-components";
import {
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import { Link } from "react-router";
import {
  Add20Regular,
  VehicleCar20Regular,
  PersonWalking20Regular,
  Airplane20Regular,
  Bed20Regular,
} from "@fluentui/react-icons";
import type { Activity, Destination } from "./activitiesApi";
import type {
  ActivityPlan,
  PlanAssessment,
  PlanDay,
  PlanIssue,
} from "./activityPlanApi";
import {
  calendarActivityDragTiming,
  calendarActivityMinutes,
  calendarClock,
  calendarDateLabel,
  calendarDayKey,
  calendarEntries,
  calendarLayout,
  type CalendarDayOption,
  type CalendarEntry,
  type CalendarTiming,
} from "./activityCalendarModel";
import CalendarActivityList from "./CalendarActivityList";
import CalendarDayNavigation from "./CalendarDayNavigation";
import { CalendarEventsSkeleton } from "./ActivityPlanningSkeletons";
import ResizableActivityWorkspace from "./ResizableActivityWorkspace";
import useCalendarDrag from "./useCalendarDrag";
import type { TripDocument } from "../../api/tripDocument";
import { scheduledTravelEntries } from "./scheduledTravel";

export default function ActivityCalendar({
  tripId,
  itinerary,
  plan,
  day,
  dayOptions,
  activities,
  activitiesLoading = false,
  planLoading = false,
  assessment,
  destination,
  readOnly,
  busy,
  pendingTiming,
  mapPanel,
  scheduleNotices,
  moreNoticeCount,
  onMoreNotices,
  notice,
  onDay,
  onEvent,
  onEntry,
  onDayDetails,
  onTiming,
  onUnschedule,
}: {
  tripId: string;
  itinerary?: TripDocument["itinerary"];
  plan?: ActivityPlan;
  day?: PlanDay;
  dayOptions: CalendarDayOption[];
  activities: Activity[];
  activitiesLoading?: boolean;
  planLoading?: boolean;
  assessment?: PlanAssessment;
  destination?: Destination;
  readOnly: boolean;
  busy: boolean;
  pendingTiming?: CalendarTiming;
  mapPanel?: RefObject<HTMLDivElement | null>;
  scheduleNotices: PlanIssue[];
  moreNoticeCount: number;
  onMoreNotices: () => void;
  notice?: ReactNode;
  onDay: (key: string) => void;
  onEvent: (id?: string) => void;
  onEntry: (entry: CalendarEntry) => void;
  onDayDetails: () => void;
  onTiming: (timing: CalendarTiming) => void;
  onUnschedule: (id: string) => void;
}) {
  const agenda = useSyncExternalStore(subscribeToWideCalendar, showAgenda);
  const dayKey = day ? calendarDayKey(day) : "";
  const timeZone = plan?.timeZone ?? destination?.properties.timeZone ?? null;
  const loading = planLoading || activitiesLoading;
  const tripTravel = day
    ? scheduledTravelEntries(itinerary?.items ?? [], day, timeZone)
    : [];
  const planEntries =
    plan && day && !activitiesLoading
      ? calendarEntries(
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
        )
      : [];
  const entries = [...planEntries, ...tripTravel].sort(
    (a, b) => a.start - b.start || a.id.localeCompare(b.id),
  );
  const timed = new Set(
    plan && !activitiesLoading
      ? plan.days
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
          .flatMap((item) => (item.activityId ? [item.activityId] : []))
      : [],
  );
  const startHour = 0;
  const endHour = 24;
  const startMinute = startHour * 60;
  const endMinute = endHour * 60;
  const height = (endHour - startHour) * 90;
  const calendarId = useId();
  const overlapDescriptionId = `${calendarId}-overlap`;
  const layout = calendarLayout(
    entries.filter(
      (entry) =>
        entry.start < endMinute &&
        (entry.end > startMinute || entry.start >= startMinute),
    ),
  );
  const scroll = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const activityList = useRef<HTMLElement>(null);
  const drag = useCalendarDrag({
    disabled: agenda || readOnly || busy || loading || !plan || !day,
    onTiming,
    onUnschedule,
    grid,
    scroll,
    activityList,
    mapPanel,
    mapTiming: (id) => {
      const activity = activities.find((item) => item.id === id);
      if (activity && plan)
        return calendarActivityDragTiming(
          id,
          calendarActivityMinutes(plan, activity),
        );
    },
    dayKey,
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
  useLayoutEffect(() => {
    if (!loading) scrollToEvents();
  }, [agenda, day?.stayId, day?.date, loading]);
  return (
    <div className="calendar-interaction-workspace" {...drag.handlers}>
      <ResizableActivityWorkspace mapPanelId={calendarId} layout="calendar">
        <CalendarActivityList
          listRef={activityList}
          dropToUnschedule={drag.overActivityList}
          activities={activities}
          plan={plan}
          loading={loading}
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
            <CalendarDayNavigation
              options={dayOptions}
              selectedKey={dayKey}
              dragDestinationId={plan && !loading ? destination?.id : undefined}
              onDay={onDay}
            />
            <div className="calendar-toolbar-actions">
              <span className="calendar-zone">{timeZone}</span>
              {day && (
                <Button disabled={!plan} onClick={onDayDetails}>
                  Day details
                </Button>
              )}
              {!readOnly && (
                <Button
                  appearance="primary"
                  icon={<Add20Regular />}
                  disabled={loading || !plan || !day || !activities.length}
                  onClick={() => onEvent()}
                >
                  Add event
                </Button>
              )}
            </div>
          </header>
          {day && (
            <h3 className="calendar-day-heading">
              {day.name && <strong>{day.name}</strong>}
              <time dateTime={day.date}>{calendarDateLabel(day.date)}</time>
            </h3>
          )}
          {notice}
          {scheduleNotices.length > 0 && (
            <section aria-label="Schedule notices" className="calendar-notices">
              <ul className="calendar-notice-list">
                {scheduleNotices.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
              {moreNoticeCount > 0 && (
                <Button appearance="outline" onClick={onMoreNotices}>
                  View {moreNoticeCount} more{" "}
                  {moreNoticeCount === 1 ? "notice" : "notices"}
                </Button>
              )}
            </section>
          )}
          {plan && !day && (
            <div className="calendar-empty">
              <h3>No visit dates</h3>
              <p>Add dates on Overview.</p>
            </div>
          )}
          {(day || planLoading) && (
            <div
              ref={agenda ? undefined : scroll}
              className={agenda ? "calendar-agenda" : "calendar-scroll"}
              tabIndex={agenda ? undefined : 0}
              role="region"
              aria-label="Day calendar"
              aria-busy={loading}
            >
              {layout.some((entry) => entry.overlaps.length > 0) && (
                <span id={overlapDescriptionId} className="visually-hidden">
                  Overlaps another calendar event.
                </span>
              )}
              <div
                className="calendar-grid"
                style={agenda ? undefined : { height }}
              >
                {!agenda && loading && !entries.length && (
                  <CalendarEventsSkeleton />
                )}
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
                  {layout.map((entry) => {
                    const visibleStart = Math.max(startMinute, entry.start);
                    const top = (visibleStart - startMinute) * 1.5;
                    const durationHeight =
                      (Math.min(endMinute, entry.end) - visibleStart) * 1.5;
                    const hasOverlap = entry.overlaps.length > 0;
                    const size = entry.isTravelExtension
                      ? durationHeight
                      : Math.max(
                          entry.kind === "travel" ? 44 : 46,
                          hasOverlap ? durationHeight : durationHeight - 3,
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
                        className={`calendar-event calendar-event-${entry.kind}${entry.estimated ? " calendar-event-estimated" : ""}${entry.isTravelExtension ? " calendar-event-travel-extension" : ""}${entry.hasTravelExtension ? " calendar-event-with-travel" : ""}`}
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
                          if (!busy && event.target === event.currentTarget)
                            onEntry(entry);
                        }}
                      >
                        {entry.kind === "flight" ? (
                          <Link
                            className="calendar-event-content calendar-travel-link"
                            aria-label={label}
                            aria-describedby={
                              hasOverlap ? overlapDescriptionId : undefined
                            }
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
                            aria-describedby={
                              hasOverlap ? overlapDescriptionId : undefined
                            }
                            title={
                              entry.travel
                                ? `${label} · ${entry.detail}`
                                : undefined
                            }
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
                        {agenda
                          ? hasOverlap && (
                              <span
                                className="calendar-event-overlap"
                                aria-hidden="true"
                              />
                            )
                          : entry.overlaps.map(({ start, end }) => {
                              const overlapStart = Math.max(
                                visibleStart,
                                start,
                              );
                              return (
                                <span
                                  key={start}
                                  className="calendar-event-overlap"
                                  aria-hidden="true"
                                  style={{
                                    top: (overlapStart - visibleStart) * 1.5,
                                    height:
                                      (Math.min(endMinute, end) -
                                        overlapStart) *
                                      1.5,
                                  }}
                                />
                              );
                            })}
                      </div>
                    );
                  })}
                  {agenda && loading && <CalendarEventsSkeleton />}
                  {plan && !loading && entries.length === 0 && (
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
