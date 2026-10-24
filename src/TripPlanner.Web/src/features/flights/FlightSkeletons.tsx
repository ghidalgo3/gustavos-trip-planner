import { SkeletonItem } from "@fluentui/react-components";
import ContentSkeleton from "../../shared/components/ContentSkeleton";

export function FlightPlanningSkeleton() {
  return (
    <ContentSkeleton label="Loading flight planning">
      <div className="skeleton-panel">
        <div className="skeleton-row">
          <SkeletonItem size={24} style={{ width: "40%" }} />
          <SkeletonItem size={32} style={{ width: 120 }} />
        </div>
        <SkeletonItem size={16} style={{ width: "90%" }} />
        <SkeletonItem size={16} style={{ width: "65%" }} />
      </div>
    </ContentSkeleton>
  );
}

export function SelectedFlightsSkeleton() {
  return (
    <ContentSkeleton label="Loading trip overview">
      <div className="skeleton-stack">
        {[0, 1].map((index) => (
          <div className="skeleton-panel" key={index}>
            <SkeletonItem size={24} style={{ width: "45%" }} />
            {[0, 1].map((leg) => (
              <div className="skeleton-journey-leg" key={leg}>
                <SkeletonItem shape="circle" size={24} />
                <div className="skeleton-stack">
                  <div className="skeleton-row">
                    <SkeletonItem size={20} style={{ width: "45%" }} />
                    <SkeletonItem size={20} style={{ width: "30%" }} />
                  </div>
                  <SkeletonItem size={12} style={{ width: "70%" }} />
                  <SkeletonItem size={12} style={{ width: "55%" }} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </ContentSkeleton>
  );
}

export function BookingOptionsSkeleton() {
  return (
    <ContentSkeleton label="Loading booking options">
      <div className="skeleton-stack">
        {[0, 1].map((index) => (
          <div className="skeleton-row skeleton-booking-option" key={index}>
            <SkeletonItem size={16} style={{ width: "45%" }} />
            <SkeletonItem size={16} style={{ width: "30%" }} />
          </div>
        ))}
      </div>
    </ContentSkeleton>
  );
}
