import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const handleWidth = 24;
const minimumPanelWidth = 260;

export default function ResizableActivityWorkspace({
  children,
  mapPanelId,
}: {
  children: ReactNode;
  mapPanelId: string;
}) {
  const workspace = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startPercent: number;
  } | null>(null);
  const [width, setWidth] = useState(0);
  const [planPercent, setPlanPercent] = useState(40);
  const [dragging, setDragging] = useState(false);
  const availableWidth = Math.max(1, width - handleWidth);
  const minimumPercent = width
    ? Math.min(50, (minimumPanelWidth / availableWidth) * 100)
    : 20;
  const maximumPercent = 100 - minimumPercent;
  const clamp = (value: number) =>
    Math.max(minimumPercent, Math.min(maximumPercent, value));
  const displayedPercent = clamp(planPercent);

  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
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
      className={`activity-workspace${dragging ? " is-resizing" : ""}`}
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
        aria-label="Resize plan and map"
        aria-orientation="vertical"
        aria-controls={mapPanelId}
        aria-valuemin={Math.ceil(minimumPercent)}
        aria-valuemax={Math.floor(maximumPercent)}
        aria-valuenow={Math.round(displayedPercent)}
        aria-valuetext={`Plan ${Math.round(displayedPercent)}%, map ${Math.round(100 - displayedPercent)}%`}
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
