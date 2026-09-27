import { useEffect, useState } from "react";
import { Button, Spinner, Text } from "@fluentui/react-components";
import { useNavigate, useParams } from "react-router";
import { getTrip, type Trip } from "./api";
import TripPlanning from "./TripPlanning";

export default function TripPlanningPage({
  userId,
  preferredAirlines,
  featureFlags,
}: {
  userId: string;
  preferredAirlines: string[];
  featureFlags: string[];
}) {
  const { tripId } = useParams();
  const navigate = useNavigate();
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
  return (
    <TripPlanning
      userId={userId}
      preferredAirlines={preferredAirlines}
      featureFlags={featureFlags}
      key={tripId}
      trip={current.trip}
      onBack={() => navigate("/")}
      onSaved={(trip) => setLoaded({ tripId: trip.id, trip })}
    />
  );
}
