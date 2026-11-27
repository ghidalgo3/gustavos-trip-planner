import { Button } from "@fluentui/react-components";
import {
  ChevronLeft20Regular,
  ChevronRight20Regular,
} from "@fluentui/react-icons";
import type { CalendarDayOption } from "./activityCalendarModel";

export default function CalendarDayNavigation({
  options,
  selectedKey,
  dragDestinationId,
  onDay,
}: {
  options: CalendarDayOption[];
  selectedKey: string;
  dragDestinationId?: string;
  onDay: (key: string) => void;
}) {
  const index = options.findIndex((option) => option.key === selectedKey);
  const previous = index > 0 ? options[index - 1] : undefined;
  const next = options[index + 1];

  return (
    <div className="calendar-navigation">
      <Button
        icon={<ChevronLeft20Regular />}
        aria-label="Previous day"
        data-calendar-day={
          previous?.destinationId === dragDestinationId
            ? previous?.key
            : undefined
        }
        disabled={!previous}
        onClick={() => {
          if (previous) onDay(previous.key);
        }}
      />
      <label className="calendar-date-picker">
        <span className="visually-hidden">Calendar day</span>
        <select
          aria-label="Calendar day"
          value={index >= 0 ? selectedKey : ""}
          onChange={(event) => onDay(event.target.value)}
          disabled={!options.length}
        >
          {index < 0 && (
            <option value="" disabled>
              {options.length ? "Select a day" : "No visit dates"}
            </option>
          )}
          {options.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Button
        icon={<ChevronRight20Regular />}
        aria-label="Next day"
        data-calendar-day={
          next?.destinationId === dragDestinationId ? next?.key : undefined
        }
        disabled={!next}
        onClick={() => {
          if (next) onDay(next.key);
        }}
      />
    </div>
  );
}
