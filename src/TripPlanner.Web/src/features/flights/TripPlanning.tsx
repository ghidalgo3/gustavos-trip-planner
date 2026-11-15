import { useTripResourceVersion } from "../../api/tripDocumentStore";
import { FlightPlanningSkeleton } from "./FlightSkeletons";
import { useEffect, useState } from "react";
import { Button, Text } from "@fluentui/react-components";
import type { Trip } from "../../api/api";
import { getDestinations, type Destination } from "../activities/activitiesApi";
import { pastDestinationDateIssues } from "./flightSearchDates";
import {
  getTripFlightPlanningData,
  type TripFlightPlanningData,
} from "./planningApi";
import PlanningRun from "./PlanningRun";

export default function TripPlanning({
  trip,
  onBack,
  readOnly = false,
}: {
  trip: Trip;
  onBack: () => void;
  readOnly?: boolean;
}) {
  const documentVersion = useTripResourceVersion(`/trips/${trip.id}/flights`);
  const [data, setData] = useState<TripFlightPlanningData>();
  const [destinations, setDestinations] = useState<Destination[]>([]);
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
          setDestinations(destinations?.features ?? []);
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
  }, [trip.id, retry, documentVersion]);
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
        <FlightPlanningSkeleton />
      ) : !destinations.some((item) => item.properties.stays.length) ? (
        <Text>Add destinations on Overview before finding flights.</Text>
      ) : (
        <PlanningRun
          tripId={trip.id}
          parties={data.parties}
          partySettings={data.document.parties}
          constraints={data.document.constraints}
          validationIssues={pastDestinationDateIssues(
            destinations,
            data.document.visits ?? [],
            new Date(),
          )}
          multiCity={true}
          visitCount={data.document.visits?.length ?? 0}
          visits={data.document.visits ?? []}
          returnDate={data.document.travelDates?.endDate}
          readOnly={readOnly}
          disabled={readOnly}
          hasUnsavedChanges={false}
          savedVersion={0}
          onBeforeSearch={async () => {}}
          onReviewRequirements={onBack}
        />
      )}
    </section>
  );
}
