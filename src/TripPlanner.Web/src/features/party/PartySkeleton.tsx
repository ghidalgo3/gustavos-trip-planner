import { SkeletonItem } from "@fluentui/react-components";
import ContentSkeleton from "../../shared/components/ContentSkeleton";

export default function PartySkeleton({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  return (
    <ContentSkeleton label="Loading travelers">
      <div
        className={readOnly ? "skeleton-stack" : "skeleton-panel party-compact"}
      >
        <div className="skeleton-row">
          <SkeletonItem size={20} style={{ width: "40%" }} />
          <SkeletonItem size={12} style={{ width: "20%" }} />
        </div>
        {[0, 1].map((index) => (
          <div className="skeleton-row skeleton-party-member" key={index}>
            <SkeletonItem size={16} style={{ width: "40%" }} />
            <SkeletonItem size={readOnly ? 12 : 32} style={{ width: "30%" }} />
          </div>
        ))}
        {!readOnly && (
          <>
            <SkeletonItem size={12} style={{ width: "70%" }} />
            <SkeletonItem size={12} style={{ width: 96 }} />
            <div className="skeleton-row">
              <SkeletonItem size={32} />
              <SkeletonItem size={32} style={{ width: 72 }} />
            </div>
          </>
        )}
      </div>
    </ContentSkeleton>
  );
}
