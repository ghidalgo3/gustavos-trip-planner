import { Skeleton, SkeletonItem } from "@fluentui/react-components";

type Layout = "text" | "field" | "list" | "cards" | "map";

export default function ContentSkeleton({
  label,
  layout = "list",
  count = 3,
}: {
  label: string;
  layout?: Layout;
  count?: number;
}) {
  return (
    <Skeleton
      aria-label={label}
      aria-busy="true"
      role="status"
      animation="pulse"
      className={`content-skeleton content-skeleton--${layout}`}
    >
      <span className="visually-hidden">{label}</span>
      {layout === "map" ? (
        <SkeletonItem aria-hidden="true" className="content-skeleton-map" />
      ) : layout === "text" ? (
        <SkeletonItem aria-hidden="true" size={16} />
      ) : layout === "field" ? (
        <div className="content-skeleton-field" aria-hidden="true">
          <SkeletonItem size={12} style={{ width: "40%" }} />
          <SkeletonItem size={32} />
        </div>
      ) : (
        Array.from({ length: count }, (_, index) => (
          <div key={index} className="content-skeleton-item" aria-hidden="true">
            <SkeletonItem size={20} style={{ width: "55%" }} />
            <SkeletonItem size={12} />
            <SkeletonItem size={12} style={{ width: "75%" }} />
            {layout === "cards" && (
              <SkeletonItem size={32} style={{ width: "40%" }} />
            )}
          </div>
        ))
      )}
    </Skeleton>
  );
}
