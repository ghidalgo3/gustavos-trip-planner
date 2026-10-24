import { SkeletonItem } from "@fluentui/react-components";
import ContentSkeleton from "../../shared/components/ContentSkeleton";

export function ConnectedAgentsSkeleton() {
  return (
    <ContentSkeleton label="Loading connected agents">
      <div className="skeleton-panel">
        <SkeletonItem size={24} style={{ width: "55%" }} />
        <SkeletonItem size={16} style={{ width: "90%" }} />
        <SkeletonItem size={32} style={{ width: 168 }} />
      </div>
    </ContentSkeleton>
  );
}

export function HomeAirportSkeleton() {
  return (
    <ContentSkeleton label="Finding home airports">
      <div className="skeleton-stack">
        <SkeletonItem size={12} style={{ width: 144 }} />
        <SkeletonItem size={32} />
        <SkeletonItem size={12} style={{ width: "90%" }} />
      </div>
    </ContentSkeleton>
  );
}
