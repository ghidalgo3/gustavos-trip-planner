import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  Button,
  Field,
  Input,
  Popover,
  PopoverSurface,
  PopoverTrigger,
} from "@fluentui/react-components";
import {
  Calendar24Regular,
  ChevronLeft20Regular,
  ChevronRight20Regular,
} from "@fluentui/react-icons";
import type { Destination } from "./activitiesApi";
import { dateKey, formatStayDates, parseTripDate } from "./tripDates";

const colors = [
  "#0078d4",
  "#a35b00",
  "#8764b8",
  "#008272",
  "#c23965",
  "#677600",
];
export default function TripDatePicker({
  label,
  value,
  onChange,
  destinations,
  excludeCityId,
  min,
  invalid,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  destinations: Destination[];
  excludeCityId?: string;
  min?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const surface = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(new Date());
  const ranges = destinations.flatMap((destination, index) =>
    destination.id === excludeCityId
      ? []
      : destination.properties.stays.flatMap((stay) => {
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
  function showCalendar(nextOpen: boolean) {
    if (nextOpen) {
      const initial =
        parseTripDate(value) ??
        (min ? parseTripDate(min) : undefined) ??
        (ranges[0] && parseTripDate(ranges[0].start)) ??
        new Date();
      setMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
    }
    setOpen(nextOpen);
  }
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
    if (min && dateKey(next) < min) return;
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
    <Field
      label={{ children: label, htmlFor: id }}
      hint="Optional · YYYY-MM-DD"
      validationState={invalid ? "error" : "none"}
      validationMessage={
        invalid
          ? "Enter a valid date; departure must be on or after arrival."
          : undefined
      }
    >
      <div className="trip-date-input">
        <Input
          id={id}
          value={value}
          placeholder="YYYY-MM-DD"
          disabled={disabled}
          onChange={(_, data) => onChange(data.value)}
        />
        <Popover
          open={open}
          onOpenChange={(_, data) => showCalendar(data.open)}
          positioning="below-end"
          trapFocus
        >
          <PopoverTrigger disableButtonEnhancement>
            <Button
              icon={<Calendar24Regular />}
              aria-label={`Choose ${label.toLowerCase()}`}
              disabled={disabled}
            />
          </PopoverTrigger>
          <PopoverSurface
            ref={surface}
            className="trip-calendar"
            aria-label={`${label} calendar`}
          >
            <div className="trip-calendar-heading">
              <Button
                appearance="subtle"
                icon={<ChevronLeft20Regular />}
                aria-label="Previous month"
                onClick={() =>
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() - 1, 1),
                  )
                }
              />
              <strong aria-live="polite">{monthLabel}</strong>
              <Button
                appearance="subtle"
                icon={<ChevronRight20Regular />}
                aria-label="Next month"
                onClick={() =>
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() + 1, 1),
                  )
                }
              />
            </div>
            <div
              className="trip-calendar-days"
              role="group"
              aria-label={monthLabel}
            >
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                <span
                  key={day}
                  className="trip-calendar-weekday"
                  aria-hidden="true"
                >
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
                const matching = ranges.filter(
                  (range) => key >= range.start && key <= range.end,
                );
                return (
                  <button
                    key={key}
                    type="button"
                    className="trip-calendar-day"
                    data-date={key}
                    onKeyDown={(event) => moveFocus(event, date)}
                    style={
                      matching.length
                        ? {
                            background: `color-mix(in srgb, ${matching[0].color} 18%, var(--colorNeutralBackground1))`,
                          }
                        : undefined
                    }
                    disabled={Boolean(min && key < min)}
                    aria-label={`${formatStayDates(key, key)}${matching.length ? ` · ${matching.map((range) => range.name).join(", ")}` : ""}`}
                    aria-pressed={key === value}
                    onClick={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                  >
                    <span>{index + 1}</span>
                    <span
                      className="trip-calendar-range-marks"
                      aria-hidden="true"
                    >
                      {matching.map((range) => (
                        <i
                          key={range.id}
                          style={{ backgroundColor: range.color }}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
            <ul
              className="trip-calendar-legend"
              aria-label="Other destination dates"
            >
              {ranges.map((range) => (
                <li key={range.id}>
                  <i
                    style={{ backgroundColor: range.color }}
                    aria-hidden="true"
                  />
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
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear date
            </Button>
          </PopoverSurface>
        </Popover>
      </div>
    </Field>
  );
}
