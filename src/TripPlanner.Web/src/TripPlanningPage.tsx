import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Spinner,
  Tab,
  TabList,
  Text,
  Title1,
  Title3,
} from "@fluentui/react-components";
import { useLocation, useNavigate, useParams } from "react-router";
import { getTrip, type Trip } from "./api";
import TripPlanning from "./TripPlanning";
import PlansOverview from "./PlansOverview";

export default function TripPlanningPage({
  userId,
  preferredAirlines,
  featureFlags,
}: {
  userId: string;
  preferredAirlines: string[];
  featureFlags: string[];
}) {
  const { tripId, "*": section } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [flightDirty, setFlightDirty] = useState(false);
  const activeTab =
    section === "plans" || section === "stays" ? section : "flights";
  const [loaded, setLoaded] = useState<{
    tripId: string;
    trip?: Trip;
    error?: string;
  }>();

  useEffect(() => {
    if (!tripId) return;
    const controller = new AbortController();
    getTrip(userId, tripId, controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) setLoaded({ tripId, trip: loaded });
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
  const readOnly = current.trip.ownerUserId !== userId;
  function openTab(tab: string) {
    if (tab === activeTab) return;
    if (flightDirty && !window.confirm("Discard unsaved planning changes?"))
      return;
    navigate(`/trips/${tripId}/${tab}${location.search}`);
  }
  return (
    <div className="trip-workspace">
      <TabList
        className="trip-tab-list"
        aria-label="Trip sections"
        selectedValue={activeTab}
        onTabSelect={(_, data) => openTab(String(data.value))}
      >
        <Tab value="flights">Flights</Tab>
        <Tab value="stays">Stays</Tab>
        <Tab value="plans">Plans</Tab>
      </TabList>
      {activeTab === "flights" && !readOnly ? (
        <TripPlanning
          userId={userId}
          preferredAirlines={preferredAirlines}
          featureFlags={featureFlags}
          key={tripId}
          trip={current.trip}
          onBack={() => navigate("/")}
          onSaved={(trip) => setLoaded({ tripId: trip.id, trip })}
          onDirtyChange={setFlightDirty}
        />
      ) : (
        <section className="planning-page">
          <Button appearance="subtle" onClick={() => navigate("/")}>
            Back to trips
          </Button>
          <div className="planning-intro">
            <Title1 as="h1">{current.trip.name}</Title1>
          </div>
          {activeTab === "plans" || (activeTab === "flights" && readOnly) ? (
            <PlansOverview
              trip={current.trip}
              userId={userId}
              onFindFlights={() => openTab("flights")}
              readOnly={readOnly}
            />
          ) : (
            <Card className="planning-card">
              <Title3 as="h2">Stays</Title3>
              <Text>
                Stay planning is coming next. Your selected flight is saved in
                Plans.
              </Text>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
