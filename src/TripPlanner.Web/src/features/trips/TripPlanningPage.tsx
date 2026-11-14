import { Button, Text, Title1 } from "@fluentui/react-components";
import {
  Airplane24Regular,
  Home24Regular,
  Map24Regular,
  People24Regular,
} from "@fluentui/react-icons";
import { useEffect } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { apiBaseUrl, type Trip } from "../../api/api";
import {
  openTripDocument,
  refreshConflictedResource,
  useTripDocumentState,
} from "../../api/tripDocumentStore";
import { ActivityWorkspaceSkeleton } from "../activities/ActivityPlanningSkeletons";
import ActivityPlanningTab from "../activities/ActivityPlanningTab";
import { FlightPlanningSkeleton } from "../flights/FlightSkeletons";
import TripPlanning from "../flights/TripPlanning";
import PartySkeleton from "../party/PartySkeleton";
import TripParties from "../party/TripParties";
import TripOverview from "./TripOverview";
import TripDateSummary from "./TripDateSummary";
import OfflineNotice from "../../shared/components/OfflineNotice";
import type { DestinationCollection } from "../activities/activitiesApi";
import { DestinationOverviewSkeleton, TripPageSkeleton } from "./TripSkeletons";

export default function TripPlanningPage({
  userId,
  homeCity,
  offline = false,
}: {
  userId: string;
  homeCity?: string | null;
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
  const documentState = useTripDocumentState();
  useEffect(() => {
    if (!tripId) return;
    const controller = new AbortController();
    void openTripDocument(userId, tripId, apiBaseUrl, controller.signal).catch(
      () => undefined,
    );
    return () => controller.abort();
  }, [userId, tripId, offline]);
  const current =
    documentState.tripId === tripId && documentState.userId === userId
      ? {
          trip: documentState.document?.resources[`/trips/${tripId}`]?.data as
            Trip | undefined,
          error:
            !documentState.document && !documentState.loading
              ? documentState.message
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
  const destinations = documentState.document?.resources[
    `/trips/${trip.id}/destinations`
  ]?.data as DestinationCollection | undefined;
  const readOnly =
    offline ||
    documentState.offline ||
    (trip.ownerUserId !== userId && !trip.canPlan);

  return (
    <div
      className={`trip-workspace trip-workspace-overview${activeTab === "activities" ? " trip-workspace-activities" : ""}`}
    >
      {(documentState.conflict ||
        (documentState.message && !documentState.offline)) && (
        <div
          className="document-status"
          role={documentState.conflict ? "alert" : "status"}
        >
          <Text>{documentState.message}</Text>
          <Button
            appearance="primary"
            disabled={documentState.loading}
            onClick={() =>
              void refreshConflictedResource().catch(() => undefined)
            }
          >
            {documentState.loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      )}
      <OfflineNotice
        offline={
          !offline &&
          documentState.offline &&
          !documentState.loading &&
          !documentState.conflict
        }
        onRetry={() => void refreshConflictedResource().catch(() => undefined)}
      />
      <header className="trip-page-header">
        <div className="trip-page-title">
          <Title1 as="h1">{trip.name}</Title1>
          <TripDateSummary
            trip={trip}
            destinations={destinations?.features ?? []}
          />
          {readOnly && !offline && !documentState.offline && (
            <Text size={200}>Shared with you · View only</Text>
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
          />
        </div>
      </div>
    </div>
  );
}
