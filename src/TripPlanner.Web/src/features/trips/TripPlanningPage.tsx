import { DestinationOverviewSkeleton, TripPageSkeleton } from "./TripSkeletons";
import { ActivityWorkspaceSkeleton } from "../activities/ActivityPlanningSkeletons";
import { FlightPlanningSkeleton } from "../flights/FlightSkeletons";
import PartySkeleton from "../party/PartySkeleton";
import { useEffect } from "react";
import { Button, Text, Title1 } from "@fluentui/react-components";
import { NavLink, useNavigate, useParams } from "react-router";
import {
  Airplane24Regular,
  Home24Regular,
  Map24Regular,
  People24Regular,
} from "@fluentui/react-icons";
import { apiBaseUrl, type Trip } from "../../api/api";
import {
  openTripSnapshot,
  refreshConflictedResource,
  useTripSnapshotState,
} from "../../api/tripSnapshot";
import ActivityPlanningTab from "../activities/ActivityPlanningTab";
import TripPlanning from "../flights/TripPlanning";
import TripOverview from "./TripOverview";
import TripParties from "../party/TripParties";

export default function TripPlanningPage({
  userId,
  homeCity,
  featureFlags,
  offline = false,
}: {
  userId: string;
  homeCity?: string | null;
  featureFlags: string[];
  offline?: boolean;
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
  const snapshotState = useTripSnapshotState();
  useEffect(() => {
    if (!tripId) return;
    const controller = new AbortController();
    void openTripSnapshot(userId, tripId, apiBaseUrl, controller.signal).catch(
      () => undefined,
    );
    return () => controller.abort();
  }, [userId, tripId, offline]);
  const current =
    snapshotState.tripId === tripId && snapshotState.userId === userId
      ? {
          trip: snapshotState.snapshot?.resources[`/trips/${tripId}`]?.data as
            Trip | undefined,
          error:
            !snapshotState.snapshot && !snapshotState.loading
              ? snapshotState.message
              : undefined,
        }
      : undefined;
  if (current?.error)
    return (
      <section className="planning-page">
        <Text role="alert">{current.error}</Text>
        <Button onClick={() => navigate("/")}>Back to trips</Button>
      </section>
    );
  if (!current?.trip)
    return (
      <TripPageSkeleton>
        {activeTab === "activities" ? (
          <ActivityWorkspaceSkeleton />
        ) : activeTab === "flights" ? (
          <FlightPlanningSkeleton />
        ) : activeTab === "party" ? (
          <PartySkeleton />
        ) : (
          <DestinationOverviewSkeleton />
        )}
      </TripPageSkeleton>
    );
  const trip = current.trip;
  const readOnly =
    offline ||
    snapshotState.offline ||
    (trip.ownerUserId !== userId && !trip.canPlan);

  return (
    <div
      className={`trip-workspace trip-workspace-overview${activeTab === "activities" ? " trip-workspace-activities" : ""}`}
    >
      {(snapshotState.message || snapshotState.conflict) && (
        <div
          className="snapshot-status"
          role={snapshotState.conflict ? "alert" : "status"}
        >
          <Text>{snapshotState.message}</Text>
          <Button
            appearance="primary"
            disabled={snapshotState.loading}
            onClick={() =>
              void refreshConflictedResource().catch(() => undefined)
            }
          >
            {snapshotState.loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      )}
      <header className="trip-page-header">
        <div className="trip-page-title">
          <Title1 as="h1">{trip.name}</Title1>
          {readOnly && (
            <Text size={200}>
              {offline || snapshotState.offline
                ? "Offline · View only"
                : "Shared with you · View only"}
            </Text>
          )}
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
            <TripPlanning
              trip={trip}
              readOnly={readOnly}
              onBack={() => navigate(`/trips/${encodeURIComponent(trip.id)}`)}
            />
          ) : activeTab === "party" ? (
            <TripParties
              tripId={trip.id}
              userId={userId}
              readOnly={readOnly || trip.ownerUserId !== userId}
            />
          ) : activeTab === "overview" ? (
            <TripOverview
              key={`overview:${trip.id}`}
              trip={trip}
              readOnly={readOnly}
              homeCity={homeCity}
            />
          ) : null}
          <ActivityPlanningTab
            key={trip.id}
            active={activeTab === "activities"}
            trip={trip}
            readOnly={readOnly}
            featureFlags={featureFlags}
          />
        </div>
      </div>
    </div>
  );
}
