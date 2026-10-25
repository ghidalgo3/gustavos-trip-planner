import { useId, useState } from "react";
import { Button, SkeletonItem } from "@fluentui/react-components";
import {
  ChevronDown20Regular,
  ChevronRight20Regular,
} from "@fluentui/react-icons";
import ContentSkeleton from "../../shared/components/ContentSkeleton";
import type { Activity, Stay } from "../activities/activitiesApi";
import type { PlanResponse } from "../activities/activityPlanApi";

export default function VisitPlans({
  stay,
  name,
  response,
  activities,
  activityError,
  onRetry,
}: {
  stay: Stay;
  name: string;
  response?: PlanResponse | null;
  activities?: Activity[];
  activityError?: boolean;
  onRetry: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const days = response?.version
    ? response.plan.days.filter((day) => day.stayId === stay.id)
    : [];
  const dates = new Set(days.map((day) => day.date));
  if (stay.arrivalDate) dates.add(stay.arrivalDate);
  if (stay.departureDate) dates.add(stay.departureDate);
  if (stay.arrivalDate && stay.departureDate) {
    for (let date = stay.arrivalDate; date <= stay.departureDate;) {
      dates.add(date);
      date = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
  }
  const orderedDates = [...dates].sort();
  const arrival = stay.arrivalDate ?? orderedDates[0];
  const departure = stay.departureDate ?? orderedDates.at(-1);

  return (
    <div className="overview-plans">
      <Button
        appearance="outline"
        icon={expanded ? <ChevronDown20Regular /> : <ChevronRight20Regular />}
        aria-label={`Plans for ${name}, visit ${stay.order + 1}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((value) => !value)}
      >
        Plans
      </Button>
      <div id={contentId} hidden={!expanded}>
        {expanded &&
          (response === null || activityError ? (
            <div className="overview-load-error">
              <p role="alert">Could not load plans.</p>
              <Button onClick={onRetry}>Retry plans</Button>
            </div>
          ) : !response || !activities ? (
            <ContentSkeleton label="Loading plans">
              <div className="overview-plan-days">
                {[0, 1].map((day) => (
                  <div className="overview-plan-day" key={day}>
                    <SkeletonItem size={20} style={{ width: "60%" }} />
                    <SkeletonItem size={16} style={{ width: "80%" }} />
                    <SkeletonItem size={16} style={{ width: "70%" }} />
                  </div>
                ))}
              </div>
            </ContentSkeleton>
          ) : orderedDates.length === 0 ? (
            <p>Add visit dates to see plans by day.</p>
          ) : (
            <div className="overview-plan-days">
              {orderedDates.map((date) => {
                const ids =
                  days.find((day) => day.date === date)?.activityIds ?? [];
                return (
                  <section
                    className="overview-plan-day"
                    key={date}
                    aria-label={date}
                  >
                    <h4>
                      <time dateTime={date}>
                        {new Intl.DateTimeFormat(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(`${date}T00:00:00Z`))}
                      </time>
                    </h4>
                    <ol aria-label={`Activities on ${date}`}>
                      {date === arrival && (
                        <li className="overview-plan-boundary">Arrive</li>
                      )}
                      {ids.map((id) => (
                        <li key={id}>
                          {activities.find((activity) => activity.id === id)
                            ?.properties.name ??
                            response.assessment?.days
                              .find(
                                (day) =>
                                  day.stayId === stay.id && day.date === date,
                              )
                              ?.entries.find((entry) => entry.activityId === id)
                              ?.name ??
                            "Activity unavailable"}
                        </li>
                      ))}
                      {date === departure && (
                        <li className="overview-plan-boundary">Leave</li>
                      )}
                    </ol>
                    {ids.length === 0 && (
                      <p className="overview-plan-empty">
                        No activities scheduled.
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
}
