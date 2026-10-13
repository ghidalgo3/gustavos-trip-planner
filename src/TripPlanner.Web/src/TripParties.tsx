import { useEffect, useState } from "react";
import { Button, Spinner, Text, Title2 } from "@fluentui/react-components";
import PartySelector from "./PartySelector";
import { getTripParties, type PlanningParty } from "./planningApi";

export default function TripParties({
  tripId,
  userId,
  readOnly,
}: {
  tripId: string;
  userId: string;
  readOnly: boolean;
}) {
  const [parties, setParties] = useState<PlanningParty[]>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getTripParties(tripId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setParties(value);
          setError(undefined);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load travelers.",
          );
      });
    return () => controller.abort();
  }, [tripId, retry]);
  async function refresh() {
    setParties(await getTripParties(tripId));
  }
  return (
    <section className="trip-parties" aria-label="Trip travelers">
      <Title2 as="h2">Travelers</Title2>
      {error ? (
        <>
          <Text role="alert">{error}</Text>
          <Button onClick={() => setRetry((value) => value + 1)}>
            Retry travelers
          </Button>
        </>
      ) : !parties ? (
        <Spinner label="Loading travelers" />
      ) : (
        parties.map((party, index) =>
          readOnly ? (
            <div key={party.id}>
              <strong>Party {index + 1}</strong>
              <p>{party.members.map((member) => member.name).join(", ")}</p>
            </div>
          ) : (
            <PartySelector
              key={party.id}
              tripId={tripId}
              userId={userId}
              party={party}
              index={index}
              onChanged={refresh}
            />
          ),
        )
      )}
    </section>
  );
}
