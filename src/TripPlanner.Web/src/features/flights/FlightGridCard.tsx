import { memo, useCallback, useState } from "react";
import { Badge, Text } from "@fluentui/react-components";
import {
  airportLabel,
  flightNumbers,
  legKey,
  priceLabel,
  type AirportCities,
} from "./flightFormatting";
import type { FlightNode } from "./flightRouteGraph";
import type { FareItinerary } from "../../api/operationsApi";
import FlightInformation from "./FlightInformation";

type ContentProps = {
  node: FlightNode;
  selected: boolean;
  total?: FareItinerary["price"];
  farePrice?: FareItinerary["price"];
  fareLabel: string;
  restrict: boolean;
  searching: boolean;
  busy: boolean;
  cities: AirportCities;
  preferredAirlines: string[];
};
type Props = ContentProps & {
  active: boolean;
  connected: boolean;
  muted: boolean;
  register: (id: string, element: HTMLDivElement | null) => void;
  onChoose: (index: number, key: string) => void;
  onHover: (id: string | undefined) => void;
  onFocus: (id: string | undefined) => void;
};

// Hover changes the shell's classes, never the flight details or fare formatting.
const FlightGridCard = memo(function FlightGridCard({
  active,
  connected,
  muted,
  register,
  onChoose,
  onHover,
  onFocus,
  ...content
}: Props) {
  const { node, busy, selected } = content;
  const first = node.leg.segments[0];
  const last = node.leg.segments.at(-1)!;
  const ref = useCallback(
    (element: HTMLDivElement | null) => register(node.id, element),
    [register, node.id],
  );
  return (
    <div
      ref={ref}
      className={`flight-grid-card${active ? " is-active" : connected ? " is-connected" : ""}${muted ? " is-muted" : ""}${selected ? " is-chosen" : ""}`}
      role="group"
      onClick={(event) => {
        if (busy || (event.target as HTMLElement).closest("details")) return;
        onChoose(node.legIndex, legKey(node.leg));
      }}
      aria-label={`${first.departure_airport} to ${last.arrival_airport}, ${first.departure_time_local}, ${node.leg.carrier ?? first.marketing_carrier_code ?? "Flight"}`}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(undefined)}
      onFocus={() => {
        onHover(undefined);
        onFocus(node.id);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          onFocus(undefined);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onHover(undefined);
          onFocus(undefined);
        }
      }}
    >
      <FlightGridCardContent {...content} />
    </div>
  );
});
export default FlightGridCard;

const FlightGridCardContent = memo(function FlightGridCardContent({
  node,
  selected,
  total,
  farePrice,
  fareLabel,
  restrict,
  searching,
  busy,
  cities,
  preferredAirlines,
}: ContentProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const first = node.leg.segments[0];
  const last = node.leg.segments.at(-1)!;
  return (
    <>
      <button
        type="button"
        className="flight-grid-select"
        disabled={busy}
        aria-pressed={Boolean(selected)}
        aria-label={`Choose flight ${flightNumbers(node.leg)}, ${first.departure_airport} to ${last.arrival_airport}, ${first.departure_time_local}`}
      />
      <div className="flight-grid-card-top">
        <div className="flight-grid-airline">
          <Text size={200} weight="semibold">
            {node.leg.carrier ??
              first.operating_carrier_name ??
              first.marketing_carrier_code ??
              "Airline"}
          </Text>
          <Text size={200} className="flight-grid-flight-numbers">
            {flightNumbers(node.leg)}
          </Text>
          {selected && (
            <Badge appearance="outline" color="success">
              Chosen
            </Badge>
          )}
        </div>
        <div className="flight-grid-fare">
          {farePrice && (
            <Text size={200} weight="semibold">
              {priceLabel(farePrice)}
            </Text>
          )}
          <span className="flight-grid-price-context">{fareLabel}</span>
        </div>
      </div>
      <div
        className="flight-grid-times"
        title={`${airportLabel(first.departure_airport, cities)} → ${airportLabel(last.arrival_airport, cities)}`}
      >
        <div>
          <strong>
            {first.departure_time_local?.slice(11, 16) ?? "—"}{" "}
            <span>{first.departure_airport}</span>
          </strong>
          <span>{first.departure_time_local?.slice(0, 10)}</span>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <strong>
            {last.arrival_time_local?.slice(11, 16) ?? "—"}{" "}
            <span>{last.arrival_airport}</span>
          </strong>
          <span>{last.arrival_time_local?.slice(0, 10)}</span>
        </div>
      </div>
      <Text size={200}>
        {node.leg.segments.length === 1
          ? "Nonstop"
          : `${node.leg.segments.length - 1} stop(s)`}
        {node.leg.duration_minutes != null
          ? ` · ${Math.floor(node.leg.duration_minutes / 60)}h ${node.leg.duration_minutes % 60}m`
          : ""}{" "}
        · Local times
      </Text>
      <Text
        size={200}
        className={
          total ? "flight-grid-route-ready" : "flight-grid-route-pending"
        }
      >
        {total
          ? `Complete trip from ${priceLabel(total)}`
          : restrict
            ? "No matching complete trip"
            : searching
              ? "Waiting for a complete path"
              : "No complete path found"}
      </Text>
      <div className="flight-grid-card-actions">
        <details onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
          <summary>Flight details</summary>
          {detailsOpen && (
            <FlightInformation
              leg={node.leg}
              cities={cities}
              preferredAirlines={preferredAirlines}
            />
          )}
        </details>
      </div>
    </>
  );
});
