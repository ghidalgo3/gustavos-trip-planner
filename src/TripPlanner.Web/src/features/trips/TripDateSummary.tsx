import type { Trip } from "../../api/api";
import CountryFlag from "../../shared/components/CountryFlag";
import { tripCountries } from "../../shared/placeArtwork";
import type { Destination } from "../activities/activitiesApi";
import { formatStayDates } from "./tripDates";

export default function TripDateSummary({
  trip,
  destinations,
  dateText,
  showFlags = true,
}: {
  trip: Trip;
  destinations?: Destination[];
  dateText?: string;
  showFlags?: boolean;
}) {
  const countries = showFlags
    ? tripCountries(
        destinations?.map(
          (destination) => destination.properties.countryCode,
        ) ??
          trip.countryCodes ??
          [],
      )
    : [];
  const dates =
    dateText ?? formatStayDates(trip.startDate ?? null, trip.endDate ?? null);
  if (!dates && countries.length === 0) return null;
  return (
    <div className="trip-date-summary">
      {dates && <span>{dates}</span>}
      {countries.length > 0 && (
        <>
          {dates && <span aria-hidden="true">·</span>}
          <span className="trip-country-flags" aria-label="Trip countries">
            {countries.map((code) => (
              <CountryFlag key={code} code={code} />
            ))}
          </span>
        </>
      )}
    </div>
  );
}
