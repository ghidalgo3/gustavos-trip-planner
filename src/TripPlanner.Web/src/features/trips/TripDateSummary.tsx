import type { Trip } from "../../api/api";
import {
  countryName,
  flagSymbol,
  tripCountries,
} from "../../shared/placeArtwork";
import type { Destination } from "../activities/activitiesApi";
import { formatStayDates } from "./tripDates";

export default function TripDateSummary({
  trip,
  destinations,
  dateText,
}: {
  trip: Trip;
  destinations?: Destination[];
  dateText?: string;
}) {
  const countries = tripCountries(
    destinations?.map((destination) => destination.properties.countryCode) ??
      trip.countryCodes ??
      [],
  );
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
              <svg
                key={code}
                className="country-flag"
                viewBox="0 0 16 12"
                role="img"
                aria-label={countryName(code)}
              >
                <title>{countryName(code)}</title>
                <use href={`/artwork/flags.svg#${flagSymbol(code)}`} />
              </svg>
            ))}
          </span>
        </>
      )}
    </div>
  );
}
