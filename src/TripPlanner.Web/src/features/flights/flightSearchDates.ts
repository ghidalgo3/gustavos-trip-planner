import type { FlightSearchIssue } from "../../api/operationsApi";
import type { Destination } from "../activities/activitiesApi";
import type { PlannedVisit } from "./planningApi";

export function pastDestinationDateIssues(
  destinations: Destination[],
  visits: PlannedVisit[],
  now: Date,
): FlightSearchIssue[] {
  return destinations.flatMap((destination) => {
    const expired = destination.properties.stays.filter((stay) => {
      const timeZone =
        destination.properties.timeZone ??
        visits.find((visit) => visit.id === stay.id)?.location?.timeZone;
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      return [stay.arrivalDate, stay.departureDate].some(
        (date) => date && date < today,
      );
    });
    return expired.length
      ? [
          {
            code: "pastDestinationDates",
            message: `Destination ${destination.properties.name}'s dates are in the past, you must plan a future trip`,
            partyId: null,
            constraintIds: expired.map((stay) => stay.id),
          },
        ]
      : [];
  });
}
