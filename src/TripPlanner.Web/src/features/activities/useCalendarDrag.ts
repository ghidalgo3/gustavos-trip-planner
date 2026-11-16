import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  calendarGestureTiming,
  type CalendarGesture,
  type CalendarTiming,
} from "./activityCalendarModel";

const pixelsPerMinute = 1.5;
type Gesture = {
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  offset: number;
  timing: CalendarTiming;
  mode: CalendarGesture;
  moved: boolean;
  fromList: boolean;
  dayKey: string;
  hoveredDay?: string;
  hoverStarted?: number;
};

export default function useCalendarDrag({
  disabled,
  onTiming,
  grid,
  scroll,
  dayKey,
  onNavigate,
}: {
  disabled: boolean;
  onTiming: (timing: CalendarTiming) => void;
  grid: RefObject<HTMLDivElement | null>;
  scroll: RefObject<HTMLDivElement | null>;
  dayKey: string;
  onNavigate: (key: string) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<CalendarTiming | null>(null);
  const [wasDisabled, setWasDisabled] = useState(disabled);
  const navigate = useEffectEvent(onNavigate);
  const previewAtPointer = useEffectEvent((current: Gesture) =>
    atPointer(current),
  );
  if (wasDisabled !== disabled) {
    setWasDisabled(disabled);
    setDragging(false);
    setPreview(null);
  }

  function atPointer(current: Gesture) {
    const bounds = grid.current?.getBoundingClientRect();
    if (
      !bounds ||
      current.x < bounds.left ||
      current.x > bounds.right ||
      current.y < bounds.top ||
      current.y > bounds.bottom
    )
      return null;
    const viewport = scroll.current?.getBoundingClientRect();
    if (viewport && (current.y < viewport.top || current.y > viewport.bottom))
      return null;
    const minute = (current.y - bounds.top) / pixelsPerMinute - current.offset;
    return calendarGestureTiming(current.timing, current.mode, minute);
  }

  useEffect(() => {
    if (disabled) {
      gesture.current = null;
    }
  }, [disabled]);

  useEffect(() => {
    if (!dragging || disabled) return;
    const timer = window.setInterval(() => {
      const current = gesture.current;
      const element = scroll.current;
      if (!current?.moved || !element) return;
      const navigation = document
        .elementFromPoint(current.x, current.y)
        ?.closest<HTMLElement>("[data-calendar-day]:not(:disabled)");
      const hoveredDay =
        current.mode === "move" ? navigation?.dataset.calendarDay : undefined;
      if (current.hoveredDay !== hoveredDay) {
        current.hoveredDay = hoveredDay;
        current.hoverStarted = Date.now();
      }
      if (
        hoveredDay &&
        current.hoverStarted &&
        Date.now() - current.hoverStarted > 750
      ) {
        navigate(hoveredDay);
        current.hoverStarted = Date.now();
        setPreview(null);
      }
      const bounds = element.getBoundingClientRect();
      if (
        current.x < bounds.left ||
        current.x > bounds.right ||
        current.y < bounds.top ||
        current.y > bounds.bottom
      )
        return;
      const delta =
        current.y < bounds.top + 48
          ? -18
          : current.y > bounds.bottom - 48
            ? 18
            : 0;
      if (delta) {
        element.scrollTop += delta;
        setPreview(previewAtPointer(current));
      }
    }, 40);
    return () => window.clearInterval(timer);
  }, [dragging, disabled, scroll]);

  function begin(
    event: ReactPointerEvent<HTMLElement>,
    timing: CalendarTiming,
    mode: CalendarGesture = "move",
    fromList = false,
  ) {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    gesture.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      offset:
        !fromList && grid.current
          ? (event.clientY - grid.current.getBoundingClientRect().top) /
              pixelsPerMinute -
            (mode === "end" ? timing.end : timing.start)
          : 0,
      timing,
      mode,
      moved: false,
      fromList,
      dayKey,
    };
    setDragging(true);
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || disabled) return;
    current.x = event.clientX;
    current.y = event.clientY;
    current.moved ||=
      Math.hypot(current.x - current.originX, current.y - current.originY) >= 6;
    if (current.moved) {
      event.preventDefault();
      suppressClick.current = true;
      setPreview(atPointer(current));
    }
  }

  function cancel() {
    gesture.current = null;
    setDragging(false);
    setPreview(null);
  }

  function finish(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next =
      current.moved && !disabled
        ? atPointer({ ...current, x: event.clientX, y: event.clientY })
        : null;
    cancel();
    if (
      next &&
      (next.start !== current.timing.start ||
        next.end !== current.timing.end ||
        current.fromList ||
        current.dayKey !== dayKey)
    )
      onTiming(next);
  }

  return {
    preview,
    begin,
    handlers: {
      onPointerDownCapture: () => {
        suppressClick.current = false;
      },
      onPointerMove: move,
      onPointerUp: finish,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape") cancel();
        else suppressClick.current = false;
      },
      onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      },
    },
  };
}
