import { SkeletonItem } from "@fluentui/react-components";
import type { ReactNode } from "react";
import ContentSkeleton from "../../shared/components/ContentSkeleton";

export function CalendarEventsSkeleton() {
  return (
    <ContentSkeleton
      label="Loading events"
      className="calendar-events-skeleton"
    >
      <div className="skeleton-stack">
        <SkeletonItem style={{ height: 52 }} />
        <SkeletonItem style={{ height: 52 }} />
      </div>
    </ContentSkeleton>
  );
}

export function CalendarActivityCardsSkeleton() {
  return (
    <ContentSkeleton label="Loading activities">
      <SkeletonItem style={{ height: 56 }} />
    </ContentSkeleton>
  );
}

export function ActivityWorkspaceSkeleton({
  tripHeader,
}: {
  tripHeader?: ReactNode;
}) {
  return (
    <ContentSkeleton label="Loading destinations">
      <div className="skeleton-stack">
        <div className="activity-planning-heading">
          {tripHeader}
          <div className="skeleton-row skeleton-destination-tabs">
            {[0, 1, 2].map((index) => (
              <div className="skeleton-stack" key={index}>
                <SkeletonItem size={32} style={{ width: 36 }} />
                <SkeletonItem size={20} style={{ width: "70%" }} />
                <SkeletonItem size={12} />
              </div>
            ))}
          </div>
        </div>
        <div className="skeleton-row skeleton-activity-tabs">
          <SkeletonItem shape="circle" size={32} style={{ width: 72 }} />
          <SkeletonItem shape="circle" size={32} style={{ width: 72 }} />
        </div>
        <div className="skeleton-activity-workspace">
          <div className="activity-map-shell skeleton-workspace-map">
            <SkeletonItem />
          </div>
          <div className="skeleton-stack skeleton-workspace-ideas">
            <div className="skeleton-row">
              <SkeletonItem size={24} style={{ width: "35%" }} />
              <SkeletonItem size={32} style={{ width: 128 }} />
              <SkeletonItem size={32} style={{ width: 32 }} />
            </div>
            <div className="activity-status-filters">
              {[160, 130, 180].map((width) => (
                <SkeletonItem
                  key={width}
                  shape="circle"
                  size={48}
                  style={{ width }}
                />
              ))}
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
