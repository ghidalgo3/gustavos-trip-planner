import { SkeletonItem } from "@fluentui/react-components";
import ContentSkeleton from "./ContentSkeleton";

export default function SearchResultsSkeleton({
  label,
  appearance = "options",
}: {
  label: string;
  appearance?: "options" | "places" | "stays";
}) {
  return (
    <ContentSkeleton label={label}>
      <div
        className={`search-results-skeleton search-results-skeleton--${appearance}`}
      >
        {[0, 1].map((index) => (
          <div className="search-result-skeleton" key={index}>
            {appearance !== "options" && (
              <SkeletonItem shape="circle" size={24} />
            )}
            <div className="skeleton-stack">
              <SkeletonItem
                size={16}
                style={{ width: index ? "60%" : "80%" }}
              />
              {appearance !== "options" && (
                <SkeletonItem size={12} style={{ width: "95%" }} />
              )}
              {appearance === "stays" && (
                <SkeletonItem size={12} style={{ width: "35%" }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </ContentSkeleton>
  );
}
