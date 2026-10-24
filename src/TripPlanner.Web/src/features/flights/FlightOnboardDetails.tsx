import type { FareLeg } from "../../api/operationsApi";

export default function FlightOnboardDetails({ leg }: { leg: FareLeg }) {
  return (
    <div className="flight-onboard-details">
      {leg.segments.map((segment, index) => (
        <div key={index}>
          {leg.segments.length > 1 && (
            <strong>
              {segment.departure_airport} → {segment.arrival_airport}
            </strong>
          )}
          <div>Aircraft: {segment.aircraft?.trim() || "Not provided"}</div>
          {segment.operating_carrier_name && (
            <div>Operated by {segment.operating_carrier_name}</div>
          )}
        </div>
      ))}
    </div>
  );
}
