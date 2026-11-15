import {
  Breadcrumb,
  BreadcrumbDivider,
  BreadcrumbItem,
} from "@fluentui/react-components";
import { Link } from "react-router";
import type { Trip } from "../../api/api";

export default function TripBreadcrumbs({
  trip,
  section,
}: {
  trip: Trip;
  section: "overview" | "activities" | "flights" | "party";
}) {
  const tripUrl = `/trips/${encodeURIComponent(trip.id)}`;
  return (
    <Breadcrumb aria-label="Breadcrumb" className="trip-breadcrumbs">
      <BreadcrumbItem>
        <Link to="/">Trips</Link>
      </BreadcrumbItem>
      <BreadcrumbDivider />
      <BreadcrumbItem>
        {section === "overview" ? (
          <span aria-current="page">Overview</span>
        ) : (
          <Link to={tripUrl}>Overview</Link>
        )}
      </BreadcrumbItem>
      {section !== "overview" && (
        <>
          <BreadcrumbDivider />
          <BreadcrumbItem>
            <span aria-current="page">
              {section === "activities"
                ? "Activities"
                : section === "flights"
                  ? "Flights"
                  : "Party"}
            </span>
          </BreadcrumbItem>
        </>
      )}
    </Breadcrumb>
  );
}
