import { cloneElement, isValidElement, type ReactNode } from "react";
import { Airplane20Regular } from "@fluentui/react-icons";
import type { Availability, PlanDay } from "./activityPlanApi";

export function flightWindowForDay(day: PlanDay, suggestions: Availability[]) {
  const visit = suggestions.filter((s) => s.stayId === day.stayId);
  if (!visit.length) return undefined;
  const from = visit
    .flatMap((s) => (s.availableFromInstant ? [s.availableFromInstant] : []))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const until = visit
    .flatMap((s) => (s.availableUntilInstant ? [s.availableUntilInstant] : []))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return {
    ...visit[0],
    date: day.date,
    availableFromInstant: from,
    availableUntilInstant: until,
    candidates: visit.flatMap((s) => s.candidates ?? []),
  };
}

export function addFlightItems(
  items: ReactNode[],
  date: string,
  availability?: Availability | null,
) {
  if (!availability) return items;
  const from = availability.availableFromInstant?.slice(0, 16);
  const until = availability.availableUntilInstant?.slice(0, 16);
  const result = items.map((item) => {
    if (
      !isValidElement<{
        "data-agenda-time"?: string;
        "data-order-unavailable"?: boolean;
        className?: string;
      }>(item)
    )
      return item;
    const time = item.props["data-agenda-time"];
    if (!time || !((from && time < from) || (until && time >= until)))
      return item;
    return cloneElement(item, {
      "data-order-unavailable": true,
      className: `${item.props.className ?? ""} agenda-unavailable`,
    });
  });
  const insert = (
    time: string,
    key: string,
    content: ReactNode,
    blocked = false,
  ) => {
    const index = result.findIndex(
      (item) =>
        isValidElement<{ "data-agenda-time"?: string }>(item) &&
        (item.props["data-agenda-time"] ?? "") >= time,
    );
    result.splice(
      index < 0 ? result.length : index,
      0,
      <li
        key={key}
        className={`agenda-item agenda-flight${blocked ? " agenda-flight-block" : ""}`}
        data-agenda-time={time}
        data-order-unavailable
      >
        <div className="agenda-time">{time.slice(11, 16)}</div>
        <div className="agenda-flight-card">
          <Airplane20Regular aria-hidden="true" />
          <div>{content}</div>
        </div>
      </li>,
    );
  };
  const seen = new Set<string>();
  for (const flight of availability.candidates ?? []) {
    if (!flight.selected) continue;
    const { departure, arrival, departureAirport, arrivalAirport } = flight;
    const key = `${flight.travellerId}:${departure}:${arrival}:${departureAirport}:${arrivalAirport}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const startsToday = departure?.slice(0, 10) === date;
    const endsToday = arrival?.slice(0, 10) === date;
    if (!startsToday && !endsToday) continue;
    const time = (startsToday ? departure : arrival)!.slice(0, 16);
    const label = (instant?: string | null) =>
      instant
        ? `${instant.slice(0, 10)} ${instant.slice(11, 16)}`
        : "Time unavailable";
    insert(
      time,
      key,
      <>
        <strong>
          Flight · {departureAirport} → {arrivalAirport}
        </strong>
        <p>
          {flight.travellerName} · Departs {label(departure)} · Arrives{" "}
          {label(arrival)}
        </p>
        <small>Destination local time</small>
      </>,
    );
  }
  if (from && from >= `${date}T00:00`) {
    const time = from.slice(0, 10) === date ? from : `${date}T23:59`;
    insert(
      time,
      "arrival-availability",
      <>
        <strong>
          {from.slice(0, 10) === date
            ? `Unavailable until ${from.slice(11)}`
            : "Unavailable all day"}
        </strong>
        <p>Arrival, airport and transfer time</p>
      </>,
      true,
    );
  }
  if (until && until < `${date}T23:59`) {
    const time = until.slice(0, 10) === date ? until : `${date}T00:00`;
    insert(
      time,
      "departure-availability",
      <>
        <strong>
          {until.slice(0, 10) === date
            ? `Unavailable from ${until.slice(11)}`
            : "Unavailable all day"}
        </strong>
        <p>Airport transfer, departure and flight time</p>
      </>,
      true,
    );
  }
  return result;
}
