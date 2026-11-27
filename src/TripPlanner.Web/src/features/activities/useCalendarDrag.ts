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
export type CalendarDragCard = {
  activityId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type Gesture = {
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  offset: number;
  timing: CalendarTiming;
  mode: CalendarGesture;
  source: "calendar" | "list" | "map";
  moved: boolean;
  listCard?: DOMRect;
  dayKey: string;
  hoveredDay?: string;
  hoverStarted?: number;
};

export default function useCalendarDrag({
  disabled,
  onTiming,
  onUnschedule,
  grid,
  scroll,
  activityList,
  mapPanel,
  mapTiming,
  dayKey,
  onNavigate,
}: {
  disabled: boolean;
  onTiming: (timing: CalendarTiming) => void;
  onUnschedule: (id: string) => void;
  grid: RefObject<HTMLDivElement | null>;
  scroll: RefObject<HTMLDivElement | null>;
  activityList: RefObject<HTMLElement | null>;
  mapPanel?: RefObject<HTMLDivElement | null>;
  mapTiming: (activityId: string) => CalendarTiming | undefined;
  dayKey: string;
  onNavigate: (key: string) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<CalendarTiming | null>(null);
  const [dragCard, setDragCard] = useState<CalendarDragCard | null>(null);
  const [overActivityList, setOverActivityList] = useState(false);
  const [wasDisabled, setWasDisabled] = useState(disabled);
  const navigate = useEffectEvent(onNavigate);
  const previewAtPointer = useEffectEvent((current: Gesture) =>
    atPointer(current),
  );
  if (wasDisabled !== disabled) {
    setWasDisabled(disabled);
    setDragging(false);
    setPreview(null);
    setDragCard(null);
    setOverActivityList(false);
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

  function overUnscheduleTarget(current: Gesture) {
    return (
      current.mode === "move" &&
      current.source === "calendar" &&
      Boolean(
        activityList.current?.contains(
          document.elementFromPoint(current.x, current.y),
        ),
      )
    );
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
    event: ReactPointerEvent<HTMLElement> | PointerEvent,
    target: HTMLElement,
    timing: CalendarTiming,
    mode: CalendarGesture = "move",
    source: Gesture["source"] = "calendar",
  ) {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    target.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    gesture.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      offset:
        source === "calendar" && grid.current
          ? (event.clientY - grid.current.getBoundingClientRect().top) /
              pixelsPerMinute -
            (mode === "end" ? timing.end : timing.start)
          : 0,
      timing,
      mode,
      source,
      moved: false,
      listCard: source === "list" ? target.getBoundingClientRect() : undefined,
      dayKey,
    };
    setDragging(true);
  }

  function move(event: ReactPointerEvent<HTMLElement> | PointerEvent) {
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
      setOverActivityList(overUnscheduleTarget(current));
      if (current.listCard) {
        setDragCard({
          activityId: current.timing.activityId,
          left: current.listCard.left + current.x - current.originX,
          top: current.listCard.top + current.y - current.originY,
          width: current.listCard.width,
          height: current.listCard.height,
        });
      }
    }
  }

  function cancel() {
    gesture.current = null;
    setDragging(false);
    setPreview(null);
    setDragCard(null);
    setOverActivityList(false);
  }

  function finish(event: ReactPointerEvent<HTMLElement> | PointerEvent) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const drop = { ...current, x: event.clientX, y: event.clientY };
    cancel();
    if (!current.moved || disabled) return;
    if (overUnscheduleTarget(drop)) {
      onUnschedule(current.timing.activityId);
      return;
    }
    const next = atPointer(drop);
    if (
      next &&
      (next.start !== current.timing.start ||
        next.end !== current.timing.end ||
        current.source !== "calendar" ||
        current.dayKey !== dayKey)
    )
      onTiming(next);
  }

  const beginMapDrag = useEffectEvent((event: PointerEvent) => {
    suppressClick.current = false;
    if (disabled || !(event.target instanceof Element)) return;
    const marker = event.target.closest<HTMLButtonElement>(
      "button[data-calendar-activity-id]:not(:disabled)",
    );
    const activityId = marker?.dataset.calendarActivityId;
    if (!marker || !activityId) return;
    const timing = mapTiming(activityId);
    if (timing) begin(event, marker, timing, "move", "map");
  });
  const moveMapDrag = useEffectEvent(move);
  const finishMapDrag = useEffectEvent(finish);
  const cancelMapDrag = useEffectEvent((event: PointerEvent) => {
    if (
      gesture.current?.source === "map" &&
      gesture.current.pointerId === event.pointerId
    )
      cancel();
  });
  const mapKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape" && gesture.current?.source === "map") cancel();
    else suppressClick.current = false;
  });
  function filterClick(event: React.MouseEvent<HTMLElement> | MouseEvent) {
    if (suppressClick.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
    }
  }

  useEffect(() => {
    const panel = mapPanel?.current;
    if (!panel) return;
    const listeners = new AbortController();
    const options = { capture: true, signal: listeners.signal };
    panel.addEventListener(
      "pointerdown",
      (event) => beginMapDrag(event),
      options,
    );
    panel.addEventListener(
      "pointermove",
      (event) => moveMapDrag(event),
      options,
    );
    panel.addEventListener(
      "pointerup",
      (event) => finishMapDrag(event),
      options,
    );
    panel.addEventListener(
      "pointercancel",
      (event) => cancelMapDrag(event),
      options,
    );
    panel.addEventListener(
      "lostpointercapture",
      (event) => cancelMapDrag(event),
      options,
    );
    panel.addEventListener("keydown", (event) => mapKeyDown(event), options);
    panel.addEventListener("click", filterClick, options);
    return () => listeners.abort();
  }, [mapPanel]);
  useEffect(() => {
    const panel = mapPanel?.current;
    if (!panel || disabled) return;
    panel.dataset.calendarMapDrag = "true";
    return () => {
      delete panel.dataset.calendarMapDrag;
    };
  }, [mapPanel, disabled]);

  return {
    preview,
    dragCard,
    overActivityList,
    begin: (
      event: ReactPointerEvent<HTMLElement>,
      timing: CalendarTiming,
      mode: CalendarGesture = "move",
      fromList = false,
    ) =>
      begin(
        event,
        event.currentTarget,
        timing,
        mode,
        fromList ? "list" : "calendar",
      ),
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
      onClickCapture: filterClick,
    },
  };
}
