import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@fluentui/react-components";
import {
  ChevronLeft20Regular,
  ChevronRight20Regular,
} from "@fluentui/react-icons";
import type { Destination } from "../activities/activitiesApi";
import {
  conflictingVisit,
  dateKey,
  formatStayDates,
  parseTripDate,
} from "./tripDates";

const colors = [
  "#0078d4",
  "#a35b00",
  "#8764b8",
  "#008272",
  "#c23965",
  "#677600",
];

export default function TripCalendar({
  arrivalDate,
  departureDate,
  onChange,
  destinations,
  excludeStayId,
  disabled,
}: {
  arrivalDate: string;
  departureDate: string;
  onChange: (arrivalDate: string, departureDate: string) => void;
  destinations: Destination[];
  excludeStayId?: string;
  disabled?: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const today = dateKey(new Date());
  const [month, setMonth] = useState(() => {
    const initial =
      parseTripDate(arrivalDate) ??
      parseTripDate(departureDate) ??
      destinations
        .flatMap((item) => item.properties.stays)
        .map((stay) =>
          parseTripDate(stay.arrivalDate ?? stay.departureDate ?? ""),
        )
        .find(Boolean) ??
      new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  function selection(key: string): [string, string] {
    return !arrivalDate || departureDate || key < arrivalDate
      ? [key, ""]
      : [arrivalDate, key];
  }
  const ranges = destinations.flatMap((destination, index) =>
    destination.properties.stays.flatMap((stay) => {
      if (stay.id === excludeStayId) return [];
      const start = stay.arrivalDate ?? stay.departureDate;
      const end = stay.departureDate ?? stay.arrivalDate;
      return start && end && parseTripDate(start) && parseTripDate(end)
        ? [
            {
              id: `${destination.id}-${stay.id}`,
              name: destination.properties.name,
              label: formatStayDates(stay.arrivalDate, stay.departureDate),
              start,
              end,
              color: colors[index % colors.length],
            },
          ]
        : [];
    }),
  );
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -date.getDay(),
      End: 6 - date.getDay(),
    };
    let next: Date;
    if (event.key in offsets)
      next = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + offsets[event.key],
      );
    else if (event.key === "PageUp" || event.key === "PageDown") {
      const targetMonth = date.getMonth() + (event.key === "PageUp" ? -1 : 1);
      next = new Date(
        date.getFullYear(),
        targetMonth,
        Math.min(
          date.getDate(),
          new Date(date.getFullYear(), targetMonth + 1, 0).getDate(),
        ),
      );
    } else return;
    event.preventDefault();
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    window.requestAnimationFrame(() =>
      surface.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${dateKey(next)}"]`)
        ?.focus(),
    );
  }
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lastDay = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(first);
  return (
    <div
      ref={surface}
      className="trip-calendar"
      role="group"
      aria-label="Destination dates"
    >
      <p className="visually-hidden" aria-live="polite">
        {formatStayDates(arrivalDate || null, departureDate || null)}
      </p>
      <div className="trip-calendar-heading">
        <Button
          appearance="subtle"
          icon={<ChevronLeft20Regular />}
          aria-label="Previous month"
          disabled={disabled}
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        />
        <strong aria-live="polite">{monthLabel}</strong>
        <Button
          appearance="subtle"
          icon={<ChevronRight20Regular />}
          aria-label="Next month"
          disabled={disabled}
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        />
      </div>
      <div className="trip-calendar-days" role="group" aria-label={monthLabel}>
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
          <span key={day} className="trip-calendar-weekday" aria-hidden="true">
            {day}
          </span>
        ))}
        {Array.from({ length: first.getDay() }, (_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {Array.from({ length: lastDay }, (_, index) => {
          const date = new Date(
            month.getFullYear(),
            month.getMonth(),
            index + 1,
          );
          const key = dateKey(date);
          const [nextArrival, nextDeparture] = selection(key);
          const conflict = conflictingVisit(
            destinations,
            nextArrival,
            nextDeparture,
            excludeStayId,
          );
          const matching = ranges.filter(
            (range) => key >= range.start && key <= range.end,
          );
          const inSelectedRange = Boolean(
            arrivalDate &&
            key >= arrivalDate &&
            key <= (departureDate || arrivalDate),
          );
          return (
            <button
              key={key}
              type="button"
              className="trip-calendar-day"
              data-date={key}
              aria-current={key === today ? "date" : undefined}
              onKeyDown={(event) => moveFocus(event, date)}
              style={
                matching.length && !inSelectedRange
                  ? {
                      background: `color-mix(in srgb, ${matching[0].color} 18%, var(--colorNeutralBackground1))`,
                    }
                  : undefined
              }
              disabled={disabled}
              aria-disabled={conflict ? true : undefined}
              title={
                conflict
                  ? `Conflicts with ${conflict.destination.properties.name}: ${formatStayDates(conflict.stay.arrivalDate, conflict.stay.departureDate)}`
                  : undefined
              }
              aria-label={`${formatStayDates(key, key)}${matching.length ? ` · ${matching.map((range) => range.name).join(", ")}` : ""}`}
              aria-pressed={inSelectedRange}
              data-range-edge={
                key === arrivalDate || key === departureDate || undefined
              }
              onClick={() => {
                if (!conflict) onChange(nextArrival, nextDeparture);
              }}
            >
              <span>{index + 1}</span>
              <span className="trip-calendar-range-marks" aria-hidden="true">
                {matching.map((range) => (
                  <i key={range.id} style={{ backgroundColor: range.color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <ul className="trip-calendar-legend" aria-label="Other destination dates">
        {ranges.map((range) => (
          <li key={range.id}>
            <i style={{ backgroundColor: range.color }} aria-hidden="true" />
            <span>
              <strong>{range.name}</strong>
              <small>{range.label}</small>
            </span>
          </li>
        ))}
      </ul>
      {ranges.length === 0 && (
        <p className="trip-calendar-empty">
          No dates set for other cities yet.
        </p>
      )}

      <Button
        appearance="subtle"
        disabled={disabled || (!arrivalDate && !departureDate)}
        onClick={() => onChange("", "")}
      >
        Clear dates
      </Button>
    </div>
  );
}
