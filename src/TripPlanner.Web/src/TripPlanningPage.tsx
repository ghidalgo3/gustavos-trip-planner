import { useEffect, useState } from "react";
import { Button, Spinner, Text, Title1 } from "@fluentui/react-components";
import { NavLink, useNavigate, useParams } from "react-router";
import {
  Airplane24Regular,
  Home24Regular,
  Map24Regular,
  People24Regular,
} from "@fluentui/react-icons";
import { getTrip, type Trip } from "./api";
import ActivityPlanning from "./ActivityPlanning";
import TripPlanning from "./TripPlanning";
import PlansOverview from "./PlansOverview";
import TripOverview from "./TripOverview";
import TripParties from "./TripParties";

export default function TripPlanningPage({
  userId,
  homeCity,
  featureFlags,
}: {
  userId: string;
  homeCity?: string | null;
  featureFlags: string[];
}) {
  const { tripId, "*": section } = useParams();
  const navigate = useNavigate();
  const activeTab =
    section === "activities"
      ? "activities"
      : section === "party"
        ? "party"
        : section === "flights"
          ? "flights"
          : "overview";
  const [loaded, setLoaded] = useState<{
    tripId: string;
    trip?: Trip;
    error?: string;
  }>();

  useEffect(() => {
    if (!tripId) return;
    const controller = new AbortController();
    getTrip(userId, tripId, controller.signal)
      .then((trip) => {
        if (!controller.signal.aborted) setLoaded({ tripId, trip });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            tripId,
            error:
              reason instanceof Error ? reason.message : "Unable to load trip.",
          });
      });
    return () => controller.abort();
  }, [userId, tripId]);

  const current = loaded?.tripId === tripId ? loaded : undefined;
  if (current?.error)
    return (
      <section className="planning-page">
        <Text role="alert">{current.error}</Text>
        <Button onClick={() => navigate("/")}>Back to trips</Button>
      </section>
    );
  if (!current?.trip) return <Spinner label="Loading trip" />;
  const trip = current.trip;
  const readOnly = trip.ownerUserId !== userId && !trip.canPlan;

  return (
    <div
      className={`trip-workspace trip-workspace-overview${activeTab === "activities" ? " trip-workspace-activities" : ""}`}
    >
      <header className="trip-page-header">
        <div className="trip-page-title">
          <Title1 as="h1">{trip.name}</Title1>
          {readOnly && <Text size={200}>Shared with you · View only</Text>}
        </div>
        <nav className="trip-navigation" aria-label="Trip sections">
          <NavLink
            to={`/trips/${encodeURIComponent(trip.id)}`}
            end
            aria-label="Overview"
            title="Overview"
          >
            <Home24Regular aria-hidden="true" />
            <span>Overview</span>
          </NavLink>
          <NavLink
            to={`/trips/${encodeURIComponent(trip.id)}/activities`}
            aria-label="Activities"
            title="Activities"
          >
            <Map24Regular aria-hidden="true" />
            <span>Activities</span>
          </NavLink>
          <NavLink
            to={`/trips/${encodeURIComponent(trip.id)}/flights`}
            aria-label="Flights"
            title="Flights"
          >
            <Airplane24Regular aria-hidden="true" />
            <span>Flights</span>
          </NavLink>
          <NavLink
            to={`/trips/${encodeURIComponent(trip.id)}/party`}
            aria-label="Party"
            title="Party"
          >
            <People24Regular aria-hidden="true" />
            <span>Party</span>
          </NavLink>
        </nav>
      </header>
      <div className="trip-page-body">
        <div className="planning-page trip-page-content">
          {activeTab === "flights" ? (
            readOnly ? (
              <PlansOverview
                trip={trip}
                userId={userId}
                readOnly
                onFindFlights={() => {}}
              />
            ) : (
              <TripPlanning
                backLabel="Back to Overview"
                trip={trip}
                onBack={() => navigate(`/trips/${encodeURIComponent(trip.id)}`)}
              />
            )
          ) : activeTab === "party" ? (
            <TripParties
              tripId={trip.id}
              userId={userId}
              readOnly={trip.ownerUserId !== userId}
            />
          ) : activeTab === "overview" ? (
            <TripOverview
              key={trip.id}
              trip={trip}
              readOnly={readOnly}
              homeCity={homeCity}
            />
          ) : (
            <ActivityPlanning
              key={trip.id}
              trip={trip}
              readOnly={readOnly}
              featureFlags={featureFlags}
            />
          )}
        </div>
      </div>
    </div>
  );
}
