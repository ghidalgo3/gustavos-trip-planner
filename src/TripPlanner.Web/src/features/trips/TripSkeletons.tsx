import type { ReactNode } from "react";
import { SkeletonItem } from "@fluentui/react-components";
import ContentSkeleton from "../../shared/components/ContentSkeleton";

export function TripsSkeleton() {
  return (
    <ContentSkeleton label="Loading your trips">
      <div className="trip-grid">
        {[0, 1, 2].map((index) => (
          <div className="skeleton-panel skeleton-trip-card" key={index}>
            <div className="skeleton-row">
              <SkeletonItem size={24} style={{ width: "60%" }} />
              <SkeletonItem size={24} style={{ width: 28 }} />
            </div>
            <SkeletonItem size={16} style={{ width: "85%" }} />
          </div>
        ))}
      </div>
    </ContentSkeleton>
  );
}

export function DestinationOverviewSkeleton() {
  return (
    <ContentSkeleton label="Loading destinations">
      <div className="skeleton-stack">
        {[0, 1].map((index) => (
          <div className="skeleton-stack" key={index}>
            <div className="skeleton-row skeleton-flight-spacer">
              <SkeletonItem shape="circle" size={20} />
              <SkeletonItem size={12} style={{ width: "35%" }} />
              <SkeletonItem size={12} style={{ width: "25%" }} />
            </div>
            <div className="overview-destination">
              <div className="skeleton-row">
                <SkeletonItem size={32} style={{ width: "45%" }} />
                <SkeletonItem size={40} style={{ width: 44 }} />
              </div>
              <SkeletonItem size={40} style={{ width: "min(100%, 300px)" }} />
              <SkeletonItem size={40} style={{ width: "min(100%, 240px)" }} />
              <div className="skeleton-row skeleton-badges">
                <SkeletonItem
                  shape="rectangle"
                  size={24}
                  style={{ width: 96 }}
                />
                <SkeletonItem
                  shape="rectangle"
                  size={24}
                  style={{ width: 104 }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </ContentSkeleton>
  );
}

export function TripPageSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="trip-workspace trip-workspace-overview">
      <ContentSkeleton label="Loading trip">
        <div className="trip-page-header skeleton-stack">
          <SkeletonItem size={32} style={{ width: "min(75%, 360px)" }} />
          <div className="skeleton-row skeleton-trip-navigation">
            {[0, 1, 2, 3].map((index) => (
              <SkeletonItem key={index} size={32} />
            ))}
          </div>
        </div>
      </ContentSkeleton>
      <div className="trip-page-body">
        <div className="planning-page trip-page-content">{children}</div>
      </div>
    </div>
  );
}

export function ActivityLogSkeleton() {
  return (
    <ContentSkeleton label="Loading activity">
      <div className="activity-log-entries">
        {[0, 1, 2].map((index) => (
          <div className="skeleton-panel" key={index}>
            <div className="skeleton-row">
              <SkeletonItem size={16} style={{ width: "55%" }} />
              <SkeletonItem size={20} style={{ width: 72 }} />
            </div>
            <SkeletonItem size={16} style={{ width: "40%" }} />
            <SkeletonItem size={12} style={{ width: "85%" }} />
            <SkeletonItem size={12} style={{ width: "35%" }} />
            <SkeletonItem size={12} style={{ width: "45%" }} />
          </div>
        ))}
      </div>
    </ContentSkeleton>
  );
}
