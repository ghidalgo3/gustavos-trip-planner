import { isValidElement, type ReactNode } from "react";
import {
  WeatherMoon20Regular,
  WeatherSunny20Regular,
} from "@fluentui/react-icons";
import { daylight, type SolarLocation } from "../../shared/time/daylight";

export function addDaylightDividers(
  items: ReactNode[],
  date: string,
  location?: SolarLocation,
) {
  if (!location) return items;
  const sun = daylight(date, location);
  if (!sun) return items;
  const result = [...items];
  // Insert by start time without reordering bookings or splitting activity cards.
  for (const event of sun.events) {
    const next = result.findIndex(
      (item) =>
        isValidElement<{ "data-agenda-time"?: string }>(item) &&
        item.props["data-agenda-time"] &&
        item.props["data-agenda-time"] > event.localTime,
    );
    result.splice(
      next < 0 ? result.length : next,
      0,
      <li
        className="agenda-item agenda-daylight"
        key={event.name}
        aria-label={event.name}
        data-agenda-time={event.localTime}
      >
        <time className="agenda-time" dateTime={event.instant}>
          {event.localTime.slice(11)}
        </time>
        <div
          className="agenda-daylight-divider"
          title="Calculated for the destination, in local time"
        >
          {event.name === "Sunrise" ? (
            <WeatherSunny20Regular aria-hidden="true" />
          ) : (
            <WeatherMoon20Regular aria-hidden="true" />
          )}
          <span>{event.name}</span>
        </div>
      </li>,
    );
  }
  if (sun.note)
    result.unshift(
      <li className="agenda-daylight-note" key="polar-daylight">
        {sun.note}
      </li>,
    );
  return result;
}
