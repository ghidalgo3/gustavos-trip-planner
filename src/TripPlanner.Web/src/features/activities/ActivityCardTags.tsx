import { Tag, TagGroup } from "@fluentui/react-components";
import { useLayoutEffect, useRef } from "react";

export default function ActivityCardTags({ kinds }: { kinds: string[] }) {
  const row = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;

    const tags = Array.from(element.children);
    const measure = () => {
      let remaining = element.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(element).columnGap) || 0;

      // Hidden tags keep their intrinsic width so they can reappear on resize.
      const widths = tags.map((tag) => tag.getBoundingClientRect().width);
      tags.forEach((tag, index) => {
        const fits = widths[index] <= remaining;
        tag.toggleAttribute("data-overflow", !fits);
        if (fits) remaining -= widths[index] + gap;
      });
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    tags.forEach((tag) => observer.observe(tag));
    return () => observer.disconnect();
  }, [kinds]);

  return (
    <TagGroup
      ref={row}
      className="activity-kinds activity-list-tags"
      aria-label="Activity kinds"
      size="small"
    >
      {kinds.map((kind) => (
        <Tag key={kind} value={kind} className="activity-kind-tag">
          {kind}
        </Tag>
      ))}
    </TagGroup>
  );
}
