import { useEffect, useState } from "react";
import {
  Button,
  Spinner,
  Text,
  Title2,
  Title3,
} from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowRight20Regular,
  Location24Regular,
  Delete20Regular,
} from "@fluentui/react-icons";
import { Link } from "react-router";
import type { Trip } from "./api";
import {
  getDestinations,
  deleteDestination,
  type Destination,
  type DestinationCollection,
  type Stay,
} from "./activitiesApi";
import AddDestinationDrawer from "./AddDestinationDrawer";
import DeleteDestinationDialog from "./DeleteDestinationDialog";

const emptyDestinations: DestinationCollection = {
  type: "FeatureCollection",
  features: [],
  route: [],
};

export default function TripOverview({
  trip,
  readOnly,
}: {
  trip: Trip;
  readOnly: boolean;
}) {
  const [destinations, setDestinations] = useState<DestinationCollection>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [editingVisit, setEditingVisit] = useState<{
    destination: Destination;
    stay: Stay;
  }>();
  const [showDateDrawer, setShowDateDrawer] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [message, setMessage] = useState<string>();
  const [destinationToDelete, setDestinationToDelete] = useState<Destination>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    getDestinations(trip.id, controller.signal)
      .then((collection) => {
        if (!controller.signal.aborted)
          setDestinations(collection ?? emptyDestinations);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load destinations.",
          );
      });
    return () => controller.abort();
  }, [trip.id, retry]);

  function destinationAdded(destination: Destination) {
    setDestinations((current) => {
      const collection = current ?? emptyDestinations;
      const exists = collection.features.some(
        (item) => item.id === destination.id,
      );
      const stay = destination.properties.stays.at(-1);
      return {
        ...collection,
        features: exists
          ? collection.features.map((item) =>
              item.id === destination.id ? destination : item,
            )
          : [...collection.features, destination],
        route: stay
          ? [
              ...collection.route,
              { destinationId: destination.id, stayId: stay.id },
            ]
          : collection.route,
      };
    });
    setShowDrawer(false);
    setMessage(`${destination.properties.name} added to your trip.`);
  }

  async function removeDestination() {
    if (!destinationToDelete || deleting || readOnly) return;
    const destination = destinationToDelete;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await deleteDestination(trip.id, destination.id);
      setDestinations((current) =>
        current
          ? {
              ...current,
              features: current.features.filter(
                (item) => item.id !== destination.id,
              ),
              route: current.route.filter(
                (item) => item.destinationId !== destination.id,
              ),
            }
          : current,
      );
      setDestinationToDelete(undefined);
      setMessage(`${destination.properties.name} deleted from your trip.`);
    } catch (reason) {
      setDeleteError(
        reason instanceof Error
          ? reason.message
          : "Could not delete the destination. Try again.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const visits = destinations?.route.length
    ? destinations.route.flatMap((visit) => {
        const destination = destinations.features.find(
          (item) => item.id === visit.destinationId,
        );
        const stay = destination?.properties.stays.find(
          (item) => item.id === visit.stayId,
        );
        return destination && stay ? [{ destination, stay }] : [];
      })
    : (destinations?.features.flatMap((destination) =>
        destination.properties.stays.map((stay) => ({ destination, stay })),
      ) ?? []);

  return (
    <section className="trip-overview" aria-labelledby="trip-overview-heading">
      <div className="trip-overview-heading">
        <Title2 as="h2" id="trip-overview-heading">
          Overview
        </Title2>
        {!readOnly && destinations && destinations.features.length > 0 && (
          <Button
            appearance="primary"
            icon={<Add24Regular />}
            onClick={() => setShowDrawer(true)}
          >
            Add destination
          </Button>
        )}
      </div>
      {message && <Text role="status">{message}</Text>}
      {error ? (
        <div className="overview-load-error">
          <Text role="alert">{error}</Text>
          <Button
            onClick={() => {
              setError(undefined);
              setRetry((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : !destinations ? (
        <Spinner label="Loading destinations" />
      ) : destinations.features.length === 0 ? (
        <div className="overview-empty">
          <div className="overview-empty-icon" aria-hidden="true">
            <Location24Regular />
          </div>
          <Title3 as="h3">Your trip starts here</Title3>
          <Text>
            {readOnly
              ? "No destinations have been added yet."
              : "Choose your first destination. The rest can take shape along the way."}
          </Text>
          {!readOnly && (
            <Button
              appearance="primary"
              size="large"
              icon={<Add24Regular />}
              onClick={() => setShowDrawer(true)}
            >
              Add destination
            </Button>
          )}
        </div>
      ) : (
        <ol className="overview-destinations" aria-label="Trip destinations">
          {visits.map(({ destination, stay }, index) => (
            <li key={stay.id} className="overview-destination">
              <span className="overview-destination-number" aria-hidden="true">
                {index + 1}
              </span>
              <div className="overview-destination-details">
                <Title3 as="h3">{destination.properties.name}</Title3>
                <Text>
                  {stay.arrivalDate || stay.departureDate
                    ? `${formatDate(stay.arrivalDate)} – ${formatDate(stay.departureDate)}`
                    : "Dates to decide"}
                </Text>
              </div>
              {!readOnly && (
                <Button
                  appearance="subtle"
                  aria-label={`Edit dates: ${destination.properties.name}, visit ${index + 1}`}
                  onClick={() => {
                    setEditingVisit({ destination, stay });
                    setShowDateDrawer(true);
                  }}
                >
                  Edit dates
                </Button>
              )}
              {!readOnly && (
                <Button
                  appearance="subtle"
                  icon={<Delete20Regular />}
                  aria-label={`Delete destination: ${destination.properties.name}`}
                  disabled={deleting}
                  onClick={() => {
                    setDeleteError(undefined);
                    setDestinationToDelete(destination);
                  }}
                />
              )}
              <Link
                className="overview-activities-link"
                aria-label={`${readOnly ? "View activities" : "Plan activities"} in ${destination.properties.name}`}
                to={`/trips/${encodeURIComponent(trip.id)}/activities?destination=${encodeURIComponent(destination.id)}`}
              >
                <span>{readOnly ? "View activities" : "Plan activities"}</span>
                <ArrowRight20Regular aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      )}
      {!readOnly && (
        <DeleteDestinationDialog
          destination={destinationToDelete}
          busy={deleting}
          error={deleteError}
          onCancel={() => {
            if (!deleting) {
              setDestinationToDelete(undefined);
              setDeleteError(undefined);
            }
          }}
          onDelete={() => void removeDestination()}
        />
      )}
      {!readOnly && (
        <AddDestinationDrawer
          key={
            editingVisit
              ? `${editingVisit.stay.id}:${editingVisit.stay.arrivalDate}:${editingVisit.stay.departureDate}`
              : "dates"
          }
          tripId={trip.id}
          editing={editingVisit}
          destinations={destinations?.features}
          open={showDateDrawer}
          onClose={() => setShowDateDrawer(false)}
          onAdded={(updated) => {
            setDestinations((current) =>
              current
                ? {
                    ...current,
                    features: current.features.map((item) =>
                      item.id === updated.id ? updated : item,
                    ),
                  }
                : current,
            );
            setShowDateDrawer(false);
            setMessage("Visit dates saved.");
          }}
        />
      )}
      {!readOnly && (
        <AddDestinationDrawer
          tripId={trip.id}
          destinations={destinations?.features}
          open={showDrawer}
          onClose={() => setShowDrawer(false)}
          onAdded={destinationAdded}
        />
      )}
    </section>
  );
}

function formatDate(date: string | null) {
  if (!date) return "To decide";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
