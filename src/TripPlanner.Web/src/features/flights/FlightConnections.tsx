import { memo, useEffect, useMemo, useState, type RefObject } from "react";
import type { FlightEdge, FlightNode } from "./flightRouteGraph";

type Position = { left: number; right: number; y: number };

const FlightConnections = memo(function FlightConnections({
  canvas,
  cards,
  columns,
  edges,
}: {
  canvas: RefObject<HTMLDivElement | null>;
  cards: RefObject<Map<string, HTMLDivElement>>;
  columns: FlightNode[][];
  edges: FlightEdge[];
}) {
  const [positions, setPositions] = useState(new Map<string, Position>());

  // Read each card once when layout changes. Hovering only chooses edges from
  // these cached coordinates; it must not re-observe or remeasure the board.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame: number | undefined;
    const measure = () => {
      frame = undefined;
      const root = element.getBoundingClientRect();
      const next = new Map<string, Position>();
      cards.current.forEach((card, id) => {
        const rect = card.getBoundingClientRect();
        next.set(id, {
          left: rect.left - root.left,
          right: rect.right - root.left,
          y: rect.top + rect.height / 2 - root.top,
        });
      });
      setPositions((previous) =>
        previous.size === next.size &&
        [...next].every(([id, position]) => {
          const old = previous.get(id);
          return (
            old?.left === position.left &&
            old.right === position.right &&
            old.y === position.y
          );
        })
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (frame === undefined) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(schedule);
    observer?.observe(element);
    cards.current.forEach((card) => observer?.observe(card));
    window.addEventListener("resize", schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [canvas, cards, columns]);

  // Every connection is still drawn, as a separate subpath of one SVG element.
  // Avoid reconciling thousands of SVG elements whenever the pointer moves.
  const path = useMemo(
    () =>
      edges
        .map(({ from, to }) => {
          const start = positions.get(from);
          const end = positions.get(to);
          if (!start || !end) return "";
          const bend = (end.left - start.right) / 2;
          return `M ${start.right} ${start.y} C ${start.right + bend} ${start.y}, ${end.left - bend} ${end.y}, ${end.left} ${end.y}`;
        })
        .join(" "),
    [edges, positions],
  );

  return (
    <svg className="flight-grid-connections" aria-hidden="true">
      {path.trim() && <path d={path} />}
    </svg>
  );
});

export default FlightConnections;
