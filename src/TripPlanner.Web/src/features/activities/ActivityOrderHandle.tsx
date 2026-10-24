import { ReOrderDotsVertical24Regular } from "@fluentui/react-icons";
import { useEffect, useId, useRef, useState } from "react";

type Drag = {
  pointerId: number;
  handle: HTMLButtonElement;
  card: HTMLElement;
  list: Element | null;
  target?: HTMLElement;
  index: number;
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
}: {
  name: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (index: number) => void;
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
    const target = document
      .elementFromPoint(current.x, current.y)
      ?.closest<HTMLElement>("[data-order-index]");
    current.target = undefined;
    current.index = index;
    if (
      !target ||
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
    if (!cancelled && !disabled && current.index !== index) {
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
        title="Drag to reorder, or use the up and down arrow keys"
        disabled={disabled || count < 2}
        onPointerDown={(event) => {
          if (disabled || count < 2 || event.button !== 0 || drag.current)
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
          };
          drag.current = current;
          card.dataset.reorderDragging = "true";
          setAnnouncement(
            `Moving ${name}. Release over another activity to reorder. Escape cancels.`,
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
        Drag within this day to reorder. Use Up or Down to move by keyboard.
        Escape cancels a drag.
      </span>
      <span className="visually-hidden" role="status">
        {announcement}
      </span>
    </>
  );
}
