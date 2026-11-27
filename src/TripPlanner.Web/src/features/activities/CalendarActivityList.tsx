import { useState, type PointerEvent } from "react";
import { Button, Portal, SearchBox } from "@fluentui/react-components";
import {
  Dismiss24Regular,
  ReOrderDotsVertical24Regular,
} from "@fluentui/react-icons";
import type { Activity } from "./activitiesApi";
import type { ActivityPlan } from "./activityPlanApi";
import { activityRule } from "./activityPlanApi";
import { activityMatchesSearch } from "./activitySearch";
import {
  calendarDateLabel,
  type CalendarTiming,
} from "./activityCalendarModel";
import { durationMinutes } from "../../shared/time/durations";
import type { CalendarDragCard } from "./useCalendarDrag";

export default function CalendarActivityList({
  activities,
  plan,
  timedIds,
  disabled,
  readOnly,
  onEvent,
  dragCard,
  onDrag,
}: {
  activities: Activity[];
  plan: ActivityPlan;
  timedIds: Set<string>;
  disabled: boolean;
  readOnly: boolean;
  onEvent: (id: string) => void;
  dragCard: CalendarDragCard | null;
  onDrag?: (event: PointerEvent<HTMLElement>, timing: CalendarTiming) => void;
}) {
  const [query, setQuery] = useState("");
  const matching = activities.filter((item) =>
    activityMatchesSearch(item, query.trim().toLocaleLowerCase()),
  );
  return (
    <aside className="schedule-activities" aria-label="Schedule activities">
      <h2>
        Activities <span>{activities.length}</span>
      </h2>
      <div className="schedule-activity-search">
        <SearchBox
          aria-label="Search schedule activities"
          placeholder="Search activities"
          dismiss={null}
          value={query}
          onChange={(_, data) => setQuery(data.value)}
        />
        {query && (
          <Button
            icon={<Dismiss24Regular />}
            aria-label="Clear schedule activity search"
            onClick={() => setQuery("")}
          />
        )}
      </div>
      <div className="schedule-activity-groups">
        {[false, true].map((scheduled) => {
          const items = matching.filter(
            (item) => timedIds.has(item.id) === scheduled,
          );
          return (
            <section
              key={String(scheduled)}
              aria-label={
                scheduled ? "Scheduled activities" : "Unscheduled activities"
              }
            >
              <h3>
                {scheduled ? "Scheduled" : "Unscheduled"}{" "}
                <span>{items.length}</span>
              </h3>
              <ul>
                {items.map((activity) => {
                  const rule = activityRule(plan, activity.id);
                  const minutes =
                    durationMinutes(
                      rule.duration ?? activity.properties.duration,
                    ) ?? 60;
                  const day = plan.days.find((item) =>
                    item.activityIds.includes(activity.id),
                  );
                  const className = `schedule-activity${scheduled ? " is-scheduled" : ""}`;
                  const preview =
                    dragCard?.activityId === activity.id ? dragCard : null;
                  const content = (
                    <>
                      {onDrag && (
                        <span data-drag-handle="true" aria-hidden="true">
                          <ReOrderDotsVertical24Regular />
                        </span>
                      )}
                      <span>
                        <strong>{activity.properties.name}</strong>
                        <small>
                          {minutes} min
                          {scheduled && day
                            ? ` · ${calendarDateLabel(day.date)}${rule.fixedStart ? ` · ${rule.fixedStart.slice(0, 5)}` : ""}`
                            : ""}
                        </small>
                      </span>
                    </>
                  );
                  return (
                    <li key={activity.id}>
                      <button
                        type="button"
                        className={className}
                        data-draggable={!!onDrag && !readOnly}
                        data-dragging={!!preview}
                        aria-label={`Schedule ${activity.properties.name}`}
                        disabled={disabled}
                        onClick={() => onEvent(activity.id)}
                        onPointerDown={(event) => {
                          if (
                            event.pointerType === "touch" &&
                            !(event.target as Element).closest(
                              "[data-drag-handle]",
                            )
                          )
                            return;
                          onDrag?.(event, {
                            activityId: activity.id,
                            start: 0,
                            end: Math.min(1440, Math.max(15, minutes)),
                          });
                        }}
                      >
                        {content}
                      </button>
                      {preview && (
                        <Portal>
                          <div
                            className={`${className} schedule-activity-drag-card`}
                            aria-hidden="true"
                            style={{
                              left: preview.left,
                              top: preview.top,
                              width: preview.width,
                              height: preview.height,
                            }}
                          >
                            {content}
                          </div>
                        </Portal>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {!matching.length && (
          <p role="status">
            {activities.length
              ? "No activities match your search."
              : "No activities yet."}
          </p>
        )}
      </div>
    </aside>
  );
}
