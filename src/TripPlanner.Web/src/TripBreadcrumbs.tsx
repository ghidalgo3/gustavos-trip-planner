import {
  Breadcrumb,
  BreadcrumbDivider,
  BreadcrumbItem,
} from "@fluentui/react-components";
import { Link } from "react-router";
import type { Trip } from "./api";

export default function TripBreadcrumbs({
  trip,
  section,
  destinationName,
}: {
  trip: Trip;
  section: "overview" | "activities" | "flights";
  destinationName?: string;
}) {
  const tripUrl = `/trips/${encodeURIComponent(trip.id)}`;
  return (
    <Breadcrumb aria-label="Breadcrumb" className="trip-breadcrumbs">
      <BreadcrumbItem>
        <Link to="/">Trips</Link>
      </BreadcrumbItem>
      <BreadcrumbDivider />
      <BreadcrumbItem>
        <Link to={tripUrl}>{trip.name}</Link>
      </BreadcrumbItem>
      <BreadcrumbDivider />
      <BreadcrumbItem>
        {section === "activities" && destinationName ? (
          <Link to={`${tripUrl}/activities`}>Activities</Link>
        ) : (
          <span aria-current="page">
            {section === "overview"
              ? "Overview"
              : section === "flights"
                ? "Flights"
                : "Activities"}
          </span>
        )}
      </BreadcrumbItem>
      {section === "activities" && destinationName && (
        <>
          <BreadcrumbDivider />
          <BreadcrumbItem>
            <span aria-current="page">{destinationName}</span>
          </BreadcrumbItem>
        </>
      )}
    </Breadcrumb>
  );
}
