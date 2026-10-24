import { useEffect, useState } from "react";
import { Button, Spinner, Text } from "@fluentui/react-components";
import type { Trip } from "./api";
import { getDestinations } from "./activitiesApi";
import {
  getTripFlightPlanningData,
  type TripFlightPlanningData,
} from "./planningApi";
import PlanningRun from "./PlanningRun";

export default function TripPlanning({
  trip,
  onBack,
}: {
  trip: Trip;
  onBack: () => void;
}) {
  const [data, setData] = useState<TripFlightPlanningData>();
  const [hasDestinations, setHasDestinations] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getTripFlightPlanningData(trip.id, controller.signal),
      getDestinations(trip.id, controller.signal),
    ])
      .then(([planning, destinations]) => {
        if (!controller.signal.aborted) {
          setData(planning);
          setHasDestinations(
            Boolean(
              destinations?.features.some(
                (item) => item.properties.stays.length,
              ),
            ),
          );
          setError(undefined);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load flight planning.",
          );
      });
    return () => controller.abort();
  }, [trip.id, retry]);
  return (
    <section className="flight-planning" aria-label="Flight planning">
      {error ? (
        <>
          <Text role="alert">{error}</Text>
          <Button onClick={() => setRetry((value) => value + 1)}>
            Retry flights
          </Button>
        </>
      ) : !data ? (
        <Spinner label="Loading flight planning" />
      ) : !hasDestinations ? (
        <Text>Add destinations on Overview before finding flights.</Text>
      ) : (
        <PlanningRun
          tripId={trip.id}
          parties={data.parties}
          partySettings={data.document.parties}
          constraints={data.document.constraints}
          multiCity={true}
          visitCount={data.document.visits?.length ?? 0}
          visits={data.document.visits ?? []}
          disabled={false}
          hasUnsavedChanges={false}
          savedVersion={0}
          onBeforeSearch={async () => {}}
          onReviewRequirements={onBack}
        />
      )}
    </section>
  );
}
