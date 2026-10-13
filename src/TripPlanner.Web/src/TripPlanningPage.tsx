import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Spinner,
  Tab,
  TabList,
  Text,
  Title1,
} from "@fluentui/react-components";
import { useNavigate, useParams } from "react-router";
import { getTrip, type Trip } from "./api";
import ActivityPlanning from "./ActivityPlanning";
import TripPlanning from "./TripPlanning";
import PlansOverview from "./PlansOverview";
import TripOverview from "./TripOverview";
import TripParties from "./TripParties";
import TripBreadcrumbs from "./TripBreadcrumbs";
import type { Destination } from "./activitiesApi";

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
      : section === "flights"
        ? "flights"
        : "overview";
  const [activeDestination, setActiveDestination] = useState<{
    tripId: string;
    name: string;
  }>();
  const onDestinationChange = useCallback(
    (destination: Destination | undefined) => {
      setActiveDestination(
        destination && tripId
          ? { tripId, name: destination.properties.name }
          : undefined,
      );
    },
    [tripId],
  );
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
  const readOnly = trip.ownerUserId !== userId;

  return (
    <div className="trip-workspace trip-workspace-overview">
      <header className="trip-page-header">
        <TripBreadcrumbs
          trip={trip}
          section={activeTab}
          destinationName={
            activeTab === "activities" && activeDestination?.tripId === trip.id
              ? activeDestination.name
              : undefined
          }
        />
        <div className="trip-page-title">
          <Title1 as="h1">{trip.name}</Title1>
          {trip.description && <Text>{trip.description}</Text>}
          {readOnly && <Text size={200}>Shared with you · View only</Text>}
        </div>
      </header>
      <TabList
        className="trip-tab-list"
        aria-label="Trip sections"
        selectedValue={activeTab}
        onTabSelect={(_, data) => {
          if (data.value !== activeTab)
            navigate(
              `/trips/${encodeURIComponent(trip.id)}${data.value === "activities" ? "/activities" : ""}`,
            );
        }}
      >
        <Tab value="overview">Overview</Tab>
        <Tab value="activities">Activities</Tab>
      </TabList>
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
        ) : activeTab === "overview" ? (
          <>
            <TripOverview
              key={trip.id}
              trip={trip}
              readOnly={readOnly}
              homeCity={homeCity}
            />
            <TripParties tripId={trip.id} userId={userId} readOnly={readOnly} />
          </>
        ) : (
          <ActivityPlanning
            key={trip.id}
            trip={trip}
            readOnly={readOnly}
            featureFlags={featureFlags}
            onDestinationChange={onDestinationChange}
          />
        )}
      </div>
    </div>
  );
}
