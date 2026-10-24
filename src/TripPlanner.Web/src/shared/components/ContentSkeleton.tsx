import { Skeleton, SkeletonItem } from "@fluentui/react-components";
import type { ReactNode } from "react";

type Props = { label: string; className?: string } & (
  | { layout: "text" | "map"; children?: never }
  | { layout?: never; children: ReactNode }
);

export default function ContentSkeleton({
  label,
  layout,
  children,
  className = "",
}: Props) {
  return (
    <Skeleton
      aria-label={label}
      aria-busy="true"
      role="status"
      animation="pulse"
      className={`content-skeleton${layout ? ` content-skeleton--${layout}` : ""} ${className}`}
    >
      <span className="visually-hidden">{label}</span>
      {children ? (
        <div aria-hidden="true">{children}</div>
      ) : layout === "map" ? (
        <SkeletonItem aria-hidden="true" className="content-skeleton-map" />
      ) : layout === "text" ? (
        <SkeletonItem aria-hidden="true" size={16} />
      ) : null}
    </Skeleton>
  );
}
