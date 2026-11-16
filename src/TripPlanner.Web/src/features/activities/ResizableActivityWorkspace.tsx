import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const handleWidth = 24;
export default function ResizableActivityWorkspace({
  children,
  mapPanelId,
  layout = "ideas",
}: {
  children: ReactNode;
  mapPanelId: string;
  layout?: "ideas" | "plan" | "calendar";
}) {
  const workspace = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startPercent: number;
  } | null>(null);
  const [width, setWidth] = useState(0);
  const [wide, setWide] = useState(false);
  const [percentages, setPercentages] = useState({
    ideas: 40,
    plan: 75,
    calendar: 28,
  });
  const planPercent = percentages[layout];
  const setPlanPercent = (value: number) =>
    setPercentages((current) => ({ ...current, [layout]: value }));
  const [dragging, setDragging] = useState(false);
  const availableWidth = Math.max(1, width - handleWidth);
  const minimumLeft =
    layout === "calendar" ? 180 : layout === "plan" && wide ? 550 : 260;
  const minimumRight = layout === "calendar" ? 300 : 260;
  const minimumPercent = width
    ? Math.min(100, (minimumLeft / availableWidth) * 100)
    : 20;
  const maximumPercent = width
    ? Math.max(minimumPercent, 100 - (minimumRight / availableWidth) * 100)
    : 80;
  const label =
    layout === "calendar"
      ? "Resize activities and calendar"
      : "Resize plan and map";
  const clamp = (value: number) =>
    Math.max(minimumPercent, Math.min(maximumPercent, value));
  const displayedPercent = clamp(planPercent);

  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const measure = () => {
      setWidth(element.getBoundingClientRect().width);
      setWide(window.matchMedia?.("(min-width: 1100px)").matches ?? false);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function finishDrag() {
    drag.current = null;
    setDragging(false);
  }

  return (
    <div
      ref={workspace}
      className={`${layout === "calendar" ? "schedule-workspace" : "activity-workspace"}${layout === "plan" ? " activity-plan-workspace" : ""}${dragging ? " is-resizing" : ""}`}
      style={
        {
          "--activity-plan-track": `${displayedPercent}fr`,
          "--activity-map-track": `${100 - displayedPercent}fr`,
        } as CSSProperties
      }
    >
      {children}
      <div
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-controls={mapPanelId}
        aria-valuemin={Math.round(minimumPercent)}
        aria-valuemax={Math.round(maximumPercent)}
        aria-valuenow={Math.round(displayedPercent)}
        aria-valuetext={
          layout === "calendar"
            ? `Activities ${Math.round(displayedPercent)}%, calendar ${Math.round(100 - displayedPercent)}%`
            : `Plan ${Math.round(displayedPercent)}%, map ${Math.round(100 - displayedPercent)}%`
        }
        tabIndex={0}
        className="activity-resize-handle"
        title="Drag to resize. Use the left and right arrow keys when focused."
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startPercent: displayedPercent,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          setPlanPercent(
            clamp(
              current.startPercent +
                ((event.clientX - current.startX) / availableWidth) * 100,
            ),
          );
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          finishDrag();
        }}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowLeft"
              ? displayedPercent - 5
              : event.key === "ArrowRight"
                ? displayedPercent + 5
                : event.key === "Home"
                  ? minimumPercent
                  : event.key === "End"
                    ? maximumPercent
                    : null;
          if (next === null) return;
          event.preventDefault();
          setPlanPercent(clamp(next));
        }}
      >
        <span aria-hidden="true" />
      </div>
    </div>
  );
}
