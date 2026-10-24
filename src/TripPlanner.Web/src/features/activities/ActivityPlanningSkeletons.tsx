import { SkeletonItem } from "@fluentui/react-components";
import ContentSkeleton from "../../shared/components/ContentSkeleton";

export function DailyPlanSkeleton() {
  return (
    <ContentSkeleton label="Loading daily plan">
      <div className="skeleton-stack skeleton-agenda">
        {[0, 1, 2].map((day) => (
          <div className="skeleton-agenda-day skeleton-stack" key={day}>
            <div className="skeleton-row skeleton-agenda-heading">
              <SkeletonItem size={16} style={{ width: 16 }} />
              <SkeletonItem size={24} style={{ width: "50%" }} />
              <div className="skeleton-stack" style={{ width: "25%" }}>
                <SkeletonItem size={12} />
                <SkeletonItem size={12} style={{ width: "75%" }} />
              </div>
            </div>
            {[0, 1, 2, 3].map((entry) => (
              <div className="skeleton-agenda-entry" key={entry}>
                <SkeletonItem size={16} style={{ width: "80%" }} />
                <div
                  className={`skeleton-panel ${entry === 2 ? "skeleton-agenda-activity" : "skeleton-agenda-routine"}`}
                >
                  <SkeletonItem
                    size={entry === 2 ? 20 : 16}
                    style={{ width: "60%" }}
                  />
                  {entry === 2 && (
                    <SkeletonItem size={12} style={{ width: "35%" }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </ContentSkeleton>
  );
}

export function ActivityWorkspaceSkeleton() {
  return (
    <ContentSkeleton label="Loading destinations">
      <div className="skeleton-stack">
        <div className="skeleton-row skeleton-destination-tabs">
          {[0, 1, 2].map((index) => (
            <div className="skeleton-stack" key={index}>
              <SkeletonItem size={20} style={{ width: "70%" }} />
              <SkeletonItem size={12} />
            </div>
          ))}
        </div>
        <div className="skeleton-row skeleton-activity-tabs">
          <SkeletonItem size={32} style={{ width: 72 }} />
          <SkeletonItem size={32} style={{ width: 72 }} />
        </div>
        <div className="skeleton-activity-workspace">
          <div className="activity-map-shell skeleton-workspace-map">
            <SkeletonItem />
          </div>
          <div className="skeleton-stack skeleton-workspace-ideas">
            <div className="skeleton-row">
              <SkeletonItem size={24} style={{ width: "35%" }} />
              <SkeletonItem size={32} style={{ width: 128 }} />
            </div>
            {[0, 1, 2].map((index) => (
              <div className="skeleton-panel skeleton-idea" key={index}>
                <SkeletonItem shape="circle" size={32} />
                <SkeletonItem size={20} style={{ width: "100%" }} />
                <SkeletonItem size={32} style={{ width: 88 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </ContentSkeleton>
  );
}

export function PreferencesSkeleton({ label }: { label: string }) {
  return (
    <ContentSkeleton label={`Loading ${label}`}>
      <div className="skeleton-stack skeleton-preferences">
        <SkeletonItem size={16} style={{ width: "40%" }} />
        <SkeletonItem style={{ height: 100 }} />
        <SkeletonItem size={12} />
        <SkeletonItem size={12} style={{ width: "75%" }} />
        <SkeletonItem size={32} style={{ width: 144 }} />
      </div>
    </ContentSkeleton>
  );
}

export function CalendarSubscriptionsSkeleton() {
  return (
    <ContentSkeleton label="Loading calendar subscriptions">
      <div className="skeleton-stack skeleton-subscriptions">
        <SkeletonItem size={12} />
        <SkeletonItem size={12} style={{ width: "80%" }} />
        <SkeletonItem size={32} style={{ width: 180 }} />
        <div className="skeleton-row">
          <SkeletonItem size={16} style={{ width: "45%" }} />
          <SkeletonItem size={32} style={{ width: 140 }} />
        </div>
      </div>
    </ContentSkeleton>
  );
}
