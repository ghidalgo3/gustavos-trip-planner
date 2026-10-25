import { ReOrderDotsVertical24Regular } from "@fluentui/react-icons";
import { useEffect, useId, useRef, useState } from "react";

type Drag = {
  pointerId: number;
  handle: HTMLButtonElement;
  card: HTMLElement;
  list: Element | null;
  target?: HTMLElement;
  index: number;
  destination?: HTMLElement;
  mealsBefore?: number;
  originalMealsBefore?: number;
  x: number;
  y: number;
  frame: number;
};

function clearDrag(drag: Drag) {
  cancelAnimationFrame(drag.frame);
  drag.card.removeAttribute("data-reorder-dragging");
  drag.target?.removeAttribute("data-reorder-target");
  if (drag.handle.hasPointerCapture?.(drag.pointerId))
    drag.handle.releasePointerCapture(drag.pointerId);
}

export default function ActivityOrderHandle({
  name,
  index,
  count,
  disabled,
  onMove,
  onMoveToDay,
}: {
  name: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (index: number) => void;
  onMoveToDay?: (
    date: string | null,
    index: number,
    mealsBefore?: number,
  ) => void;
}) {
  const helpId = useId();
  const drag = useRef<Drag | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  useEffect(
    () => () => {
      if (drag.current) clearDrag(drag.current);
      drag.current = undefined;
    },
    [disabled],
  );

  function locate(current: Drag) {
    current.target?.removeAttribute("data-reorder-target");
    const hit = document.elementFromPoint(current.x, current.y);
    let target = hit?.closest<HTMLElement>(
      "[data-order-index], [data-order-meal], [data-order-boundary]",
    );
    const destination = hit?.closest<HTMLElement>("[data-order-day]");
    const source = current.card.closest("[data-order-day]");
    const agenda = current.card.closest("[data-order-agenda]");
    const acrossDays =
      onMoveToDay &&
      agenda &&
      destination &&
      destination.closest("[data-order-agenda]") === agenda;
    current.target = undefined;
    current.destination = undefined;
    current.mealsBefore = undefined;
    current.index = index;
    if (acrossDays) {
      if (target === current.card) return;
      const sameDay = destination === source;
      const rows = [
        ...destination.querySelectorAll<HTMLElement>(
          "[data-order-index], [data-order-meal], [data-order-boundary]",
        ),
      ];
      // The space between rows belongs to the nearest timeline boundary.
      if (!target && hit?.closest("ol") && rows.length) {
        target = rows.reduce((nearest, row) => {
          const distance = (element: HTMLElement) => {
            const bounds = element.getBoundingClientRect();
            return Math.abs(current.y - (bounds.top + bounds.bottom) / 2);
          };
          return distance(row) < distance(nearest) ? row : nearest;
        });
      }
      if (target === current.card) return;
      const bounds = target?.getBoundingClientRect();
      const after =
        target?.dataset.orderBoundary === "Wake up"
          ? true
          : target?.dataset.orderBoundary === "Sleep"
            ? false
            : bounds
              ? current.y >= bounds.top + bounds.height / 2
              : true;
      const boundary = target
        ? rows.indexOf(target) + (after ? 1 : 0)
        : rows.length;
      const preceding = rows.slice(0, boundary);
      current.index = preceding.filter(
        (row) =>
          row.hasAttribute("data-order-index") &&
          (!sameDay || row !== current.card),
      ).length;
      if (destination.querySelector("[data-order-meal]")) {
        current.mealsBefore = preceding.filter((row) =>
          row.hasAttribute("data-order-meal"),
        ).length;
      }
      current.destination = destination;
      current.target = target ?? destination;
      current.target.dataset.reorderTarget = after ? "after" : "before";
      return;
    }
    if (
      !target ||
      !target.hasAttribute("data-order-index") ||
      target.closest("ol") !== current.list ||
      target === current.card
    )
      return;
    const bounds = target.getBoundingClientRect();
    const after = current.y >= bounds.top + bounds.height / 2;
    const insertion = Number(target.dataset.orderIndex) + (after ? 1 : 0);
    current.index = Math.max(
      0,
      Math.min(count - 1, insertion - (index < insertion ? 1 : 0)),
    );
    current.target = target;
    target.dataset.reorderTarget = after ? "after" : "before";
  }

  function scroll(current: Drag) {
    if (drag.current !== current) return;
    let container = current.card.parentElement;
    while (
      container &&
      !(
        container.scrollHeight > container.clientHeight &&
        /auto|scroll/.test(getComputedStyle(container).overflowY)
      )
    )
      container = container.parentElement;
    const bounds = container?.getBoundingClientRect();
    const top = bounds?.top ?? 0;
    const bottom = bounds?.bottom ?? window.innerHeight;
    const delta = current.y < top + 48 ? -10 : current.y > bottom - 48 ? 10 : 0;
    if (delta) {
      if (container) container.scrollTop += delta;
      else window.scrollBy(0, delta);
      locate(current);
    }
    current.frame = requestAnimationFrame(() => scroll(current));
  }

  function finish(cancelled: boolean) {
    const current = drag.current;
    if (!current) return;
    drag.current = undefined;
    clearDrag(current);
    const source = current.card.closest<HTMLElement>("[data-order-day]");
    if (
      !cancelled &&
      !disabled &&
      current.destination &&
      onMoveToDay &&
      (current.destination !== source ||
        current.index !== index ||
        current.mealsBefore !== current.originalMealsBefore)
    ) {
      const date = current.destination.dataset.orderDay || null;
      if (current.mealsBefore === undefined) onMoveToDay(date, current.index);
      else onMoveToDay(date, current.index, current.mealsBefore);
      setAnnouncement(
        `${name} moved to ${date ?? "To schedule"}, position ${current.index + 1}.`,
      );
    } else if (!cancelled && !disabled && current.index !== index) {
      onMove(current.index);
      setAnnouncement(
        `${name} moved to position ${current.index + 1} of ${count}.`,
      );
    } else setAnnouncement(`${name}: order unchanged.`);
  }

  return (
    <>
      <button
        type="button"
        className="activity-order-handle"
        aria-label={`Reorder ${name}`}
        aria-describedby={helpId}
        title={
          onMoveToDay
            ? "Drag between meals or activities, or to another day"
            : "Drag to reorder, or use the up and down arrow keys"
        }
        disabled={disabled || (!onMoveToDay && count < 2)}
        onPointerDown={(event) => {
          if (
            disabled ||
            (!onMoveToDay && count < 2) ||
            event.button !== 0 ||
            drag.current
          )
            return;
          const card =
            event.currentTarget.closest<HTMLElement>("[data-order-index]");
          if (!card) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          const current: Drag = {
            pointerId: event.pointerId,
            handle: event.currentTarget,
            card,
            list: card.closest("ol"),
            index,
            x: event.clientX,
            y: event.clientY,
            frame: 0,
            originalMealsBefore: (() => {
              const day = card.closest("[data-order-day]");
              if (!day?.querySelector("[data-order-meal]")) return undefined;
              const rows = [
                ...day.querySelectorAll(
                  "[data-order-index], [data-order-meal]",
                ),
              ];
              return rows
                .slice(0, rows.indexOf(card))
                .filter((row) => row.hasAttribute("data-order-meal")).length;
            })(),
          };
          drag.current = current;
          card.dataset.reorderDragging = "true";
          setAnnouncement(
            `Moving ${name}. ${onMoveToDay ? "Release between meals or activities, or over a day, to move." : "Release over another activity to reorder."} Escape cancels.`,
          );
          scroll(current);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          current.x = event.clientX;
          current.y = event.clientY;
          locate(current);
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId === event.pointerId) finish(false);
        }}
        onPointerCancel={() => finish(true)}
        onLostPointerCapture={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && drag.current) {
            event.preventDefault();
            finish(true);
            return;
          }
          if (
            disabled ||
            drag.current ||
            !["ArrowUp", "ArrowDown"].includes(event.key)
          )
            return;
          event.preventDefault();
          const card =
            event.currentTarget.closest<HTMLElement>("[data-order-index]");
          const day = card?.closest<HTMLElement>("[data-order-day]");
          if (onMoveToDay && day?.querySelector("[data-order-meal]")) {
            const rows = [
              ...day.querySelectorAll("[data-order-index], [data-order-meal]"),
            ];
            const at = rows.indexOf(card!);
            const up = event.key === "ArrowUp";
            if ((up && at > 0) || (!up && at < rows.length - 1)) {
              const preceding = rows.slice(0, at + (up ? -1 : 2));
              const position = preceding.filter(
                (row) => row.hasAttribute("data-order-index") && row !== card,
              ).length;
              const mealsBefore = preceding.filter((row) =>
                row.hasAttribute("data-order-meal"),
              ).length;
              onMoveToDay(day.dataset.orderDay || null, position, mealsBefore);
              setAnnouncement(
                `${name} moved ${up ? "earlier" : "later"} in the day's agenda.`,
              );
            }
            return;
          }
          const target = Math.max(
            0,
            Math.min(count - 1, index + (event.key === "ArrowUp" ? -1 : 1)),
          );
          if (target !== index) {
            onMove(target);
            setAnnouncement(
              `${name} moved to position ${target + 1} of ${count}.`,
            );
          }
        }}
      >
        <ReOrderDotsVertical24Regular aria-hidden="true" />
      </button>
      <span id={helpId} className="visually-hidden">
        {onMoveToDay
          ? "Drag between meals or activities, or move between days, including empty or collapsed days. Use the Day selector to change days by keyboard."
          : "Drag within this day to reorder."}{" "}
        Use Up or Down to move through the agenda by keyboard. Escape cancels a
        drag.
      </span>
      <span className="visually-hidden" role="status">
        {announcement}
      </span>
    </>
  );
}
