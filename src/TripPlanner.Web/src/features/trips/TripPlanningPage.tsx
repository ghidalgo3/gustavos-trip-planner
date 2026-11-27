import { Button, Text, Title1 } from "@fluentui/react-components";
import { Share24Regular } from "@fluentui/react-icons";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router";
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
import TripBreadcrumbs from "./TripBreadcrumbs";
import OfflineNotice from "../../shared/components/OfflineNotice";
import { useMediaQuery } from "../../shared/hooks/useMediaQuery";
import type { DestinationCollection } from "../activities/activitiesApi";
import { DestinationOverviewSkeleton, TripPageSkeleton } from "./TripSkeletons";

export default function TripPlanningPage({
  userId,
  homeCity,
  offline = false,
  breadcrumbHost,
}: {
  userId: string;
  homeCity?: string | null;
  offline?: boolean;
  breadcrumbHost?: HTMLElement | null;
}) {
  const { tripId, "*": section } = useParams();
  const navigate = useNavigate();
  const wide = useMediaQuery("(min-width: 1100px)");
  const activeSection =
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
      <TripPageSkeleton overview={activeSection === "overview"}>
        {activeSection === "activities" ? (
          <ActivityWorkspaceSkeleton />
        ) : activeSection === "flights" ? (
          <FlightPlanningSkeleton />
        ) : activeSection === "party" ? (
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
  const breadcrumbs = <TripBreadcrumbs trip={trip} section={activeSection} />;
  const topbarBreadcrumbs =
    activeSection === "activities" && wide ? breadcrumbHost : null;
  const tripHeader = (
    <header className="trip-page-header">
      <div className="trip-page-heading">
        <div className="trip-page-heading-main">
          <Title1 as="h1">{trip.name}</Title1>
        </div>
        {activeSection === "overview" && (
          <Button
            appearance="outline"
            icon={<Share24Regular />}
            onClick={() =>
              navigate(`/trips/${encodeURIComponent(trip.id)}/party`)
            }
          >
            Share
          </Button>
        )}
      </div>
      <div className="trip-page-title">
        <TripDateSummary
          trip={trip}
          destinations={destinations?.features ?? []}
          showFlags={activeSection !== "activities"}
        />
        {readOnly && !offline && !documentState.offline && (
          <Text size={200}>Shared with you · View only</Text>
        )}
      </div>
      {!topbarBreadcrumbs && breadcrumbs}
    </header>
  );

  return (
    <div
      className={`trip-workspace trip-workspace-overview${activeSection === "activities" ? " trip-workspace-activities" : ""}`}
    >
      {topbarBreadcrumbs && createPortal(breadcrumbs, topbarBreadcrumbs)}
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
      {activeSection !== "activities" && tripHeader}
      <div className="trip-page-body">
        <div className="planning-page trip-page-content">
          {activeSection === "flights" ? (
            <TripPlanning
              trip={trip}
              readOnly={readOnly}
              onBack={() => navigate(`/trips/${encodeURIComponent(trip.id)}`)}
            />
          ) : activeSection === "party" ? (
            <TripParties
              tripId={trip.id}
              userId={userId}
              readOnly={readOnly || trip.ownerUserId !== userId}
            />
          ) : activeSection === "overview" ? (
            <TripOverview
              key={`overview:${trip.id}`}
              trip={trip}
              readOnly={readOnly}
              homeCity={homeCity}
            />
          ) : null}
          <ActivityPlanningTab
            key={trip.id}
            active={activeSection === "activities"}
            trip={trip}
            readOnly={readOnly}
            tripHeader={activeSection === "activities" ? tripHeader : undefined}
          />
        </div>
      </div>
    </div>
  );
}
