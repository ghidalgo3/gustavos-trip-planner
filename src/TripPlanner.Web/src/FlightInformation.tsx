import type { ReactNode } from "react";
import { Card, Switch, Text, Title3 } from "@fluentui/react-components";
import type { FareLeg } from "./operationsApi";
import { airportLabel, type AirportCities } from "./flightFormatting";

function displayTime(value?: string, timeOnly = false): string {
  if (!value) return "Time unavailable";
  if (!timeOnly) return value.replace("T", " ").slice(0, 16);
  const clock = /T(\d{2}):(\d{2})/.exec(value);
  if (!clock) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, Number(clock[1]), Number(clock[2])));
}

function duration(minutes?: number): string {
  if (minutes == null || !Number.isFinite(minutes))
    return "Duration unavailable";
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

function layoverMinutes(
  arrival?: string,
  departure?: string,
): number | undefined {
  if (!arrival || !departure) return undefined;
  const minutes = (Date.parse(departure) - Date.parse(arrival)) / 60_000;
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : undefined;
}

export default function FlightInformation({
  leg,
  cities = {},
  title,
  summary,
  actions,
  purchased,
  onPurchasedChange,
  purchaseBusy = false,
  timeOnly = false,
}: {
  leg: FareLeg;
  cities?: AirportCities;
  title?: string;
  summary?: string;
  actions?: ReactNode;
  purchased?: boolean;
  onPurchasedChange?: (value: boolean) => void;
  purchaseBusy?: boolean;
  timeOnly?: boolean;
}) {
  const first = leg.segments[0];
  const last = leg.segments.at(-1);
  if (!first || !last) return null;
  const carrier =
    leg.carrier ||
    first.operating_carrier_name ||
    first.marketing_carrier_code ||
    "Airline unavailable";
  return (
    <Card className="flight-information">
      {title && <Title3 as="h4">{title}</Title3>}
      <Text weight="semibold" size={400}>
        {airportLabel(first.departure_airport, cities)} →{" "}
        {airportLabel(last.arrival_airport, cities)}
      </Text>
      {summary && <Text>{summary}</Text>}
      <Text>
        {carrier} ·{" "}
        {leg.segments.length === 1
          ? "Nonstop"
          : `${leg.segments.length - 1} stop${leg.segments.length > 2 ? "s" : ""}`}{" "}
        · {duration(leg.duration_minutes)}
      </Text>
      {leg.segments.map((segment, index) => {
        const next = leg.segments[index + 1];
        const wait = next
          ? layoverMinutes(
              segment.arrival_time_utc ?? segment.arrival_time_local,
              next.departure_time_utc ?? next.departure_time_local,
            )
          : undefined;
        const flight = [segment.marketing_carrier_code, segment.flight_number]
          .filter(Boolean)
          .join(" ");
        return (
          <div className="flight-segment" key={index}>
            <Text size={200}>
              {segment.operating_carrier_name ||
                leg.carrier ||
                segment.marketing_carrier_code ||
                "Airline unavailable"}
              {flight && ` · ${flight}`}
              {" · "}
              {airportLabel(segment.departure_airport, cities)}{" "}
              {displayTime(segment.departure_time_local, timeOnly)} →{" "}
              {airportLabel(segment.arrival_airport, cities)}{" "}
              {displayTime(segment.arrival_time_local, timeOnly)}
            </Text>
            {next && (
              <Text size={200} weight="semibold">
                Layover in {airportLabel(segment.arrival_airport, cities)}
                {wait == null ? "" : ` · ${duration(wait)}`}
              </Text>
            )}
          </div>
        );
      })}
      <Text size={200}>Times are local to each airport.</Text>
      {purchased !== undefined &&
        (onPurchasedChange ? (
          <Switch
            label="Purchased"
            checked={purchased}
            disabled={purchaseBusy}
            onChange={(_, data) => onPurchasedChange(data.checked)}
          />
        ) : (
          <Text size={200}>{purchased ? "Purchased" : "Not purchased"}</Text>
        ))}
      {actions && <div className="flight-information-actions">{actions}</div>}
    </Card>
  );
}
