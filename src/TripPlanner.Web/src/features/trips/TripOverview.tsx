import TripTravelEditor, { type TravelPlan } from "./TripTravelEditor";
import {
  cachedTripResource,
  useExplicitResourceRefresh,
  useTripResourceVersion,
} from "../../api/tripSnapshot";
import ContentSkeleton from "../../shared/components/ContentSkeleton";
import { DestinationOverviewSkeleton } from "./TripSkeletons";
import { useActionToast } from "../../shared/hooks/useActionToast";
import { Fragment, useEffect, useState } from "react";
import { Button, Badge, Text, Title3 } from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowRight20Regular,
  Location24Regular,
  Delete20Regular,
  Airplane20Regular,
  BuildingPeople24Regular,
} from "@fluentui/react-icons";
import { Link } from "react-router";
import type { Trip } from "../../api/api";
import {
  getDestinations,
  getActivities,
  deleteDestination,
  type Destination,
  type DestinationCollection,
  type Stay,
  type Activity,
} from "../activities/activitiesApi";
import {
  getSelectedFlights,
  getFlightChoices,
  type SelectedFlight,
  type FlightChoiceProgress,
} from "../flights/selectedFlightsApi";
import {
  selectedLegs,
  matchingFlightLegs,
  type FlightStop,
} from "./overviewFlights";
import { useAirportCities, flightAirportCodes } from "../flights/airportCities";
import { flightNumbers } from "../flights/flightFormatting";
import AddDestinationDrawer from "./AddDestinationDrawer";
import StayLocationDrawer from "./StayLocationDrawer";
import DeleteDestinationDialog from "./DeleteDestinationDialog";
import DestinationPlanningProgress from "./DestinationPlanningProgress";
import VisitPlans from "./VisitPlans";
import {
  activityPlanPath,
  planningRequest,
  type PlanResponse,
} from "../activities/activityPlanApi";

const emptyDestinations: DestinationCollection = {
  type: "FeatureCollection",
  features: [],
  route: [],
};

export default function TripOverview({
  trip,
  readOnly,
  homeCity,
}: {
  trip: Trip;
  readOnly: boolean;
  homeCity?: string | null;
}) {
  const snapshotVersion = useTripResourceVersion(`/trips/${trip.id}`);
  const [flightRetry, setFlightRetry] = useState(0);
  const [flightData, setFlightData] = useState<{
    flights?: SelectedFlight[];
    choices?: FlightChoiceProgress[];
    error?: boolean;
  }>();
  const legs = selectedLegs(
    flightData?.flights ?? [],
    flightData?.choices ?? [],
  );
  const airportCities = useAirportCities(flightAirportCodes(legs));
  const [summaryRetry, setSummaryRetry] = useState(0);
  const [activitySummaries, setActivitySummaries] = useState<
    Record<
      string,
      {
        counts?: Record<string, number>;
        activities?: Activity[];
        error?: boolean;
      }
    >
  >({});
  const [planningSummaries, setPlanningSummaries] = useState<
    Record<string, PlanResponse | null>
  >({});
  const [destinations, setDestinations] = useState<DestinationCollection>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [editingVisit, setEditingVisit] = useState<{
    destination: Destination;
    stay: Stay;
  }>();
  const [stayVisit, setStayVisit] = useState<{
    destination: Destination;
    stay: Stay;
  }>();
  const [showDateDrawer, setShowDateDrawer] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const { notify, toaster } = useActionToast();
  const [destinationToDelete, setDestinationToDelete] = useState<Destination>();
  const [deleting, setDeleting] = useState(false);

  const [visitRefresh, setVisitRefresh] = useState(0);
  async function reloadVisitEditors() {
    const collection = await getDestinations(trip.id);
    if (!collection) return;
    setDestinations(collection);
    const replace = (current: typeof editingVisit) => {
      if (!current) return current;
      const destination = collection.features.find(
        (d) => d.id === current.destination.id,
      );
      const stay = destination?.properties.stays.find(
        (v) => v.id === current.stay.id,
      );
      return destination && stay ? { destination, stay } : undefined;
    };
    setEditingVisit(replace);
    setStayVisit(replace);
    setVisitRefresh((value) => value + 1);
  }
  useExplicitResourceRefresh(
    `/trips/${trip.id}/destinations/${encodeURIComponent(editingVisit?.destination.id ?? "")}/stays/${editingVisit?.stay.id ?? ""}`,
    reloadVisitEditors,
  );
  useExplicitResourceRefresh(
    `/trips/${trip.id}/destinations/${encodeURIComponent(stayVisit?.destination.id ?? "")}/stays/${stayVisit?.stay.id ?? ""}/location`,
    reloadVisitEditors,
  );

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
  }, [trip.id, retry, snapshotVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const features = destinations?.features ?? [];
    void Promise.allSettled(
      features.map(async (destination) => {
        const activities = await getActivities(
          trip.id,
          destination.id,
          controller.signal,
        );
        const counts: Record<string, number> = Object.create(null);
        for (const activity of activities.features)
          counts[activity.properties.state] =
            (counts[activity.properties.state] ?? 0) + 1;
        return { counts, activities: activities.features };
      }),
    ).then((results) => {
      if (!controller.signal.aborted)
        setActivitySummaries(
          Object.fromEntries(
            results.map((result, index) => [
              features[index].id,
              result.status === "fulfilled" ? result.value : { error: true },
            ]),
          ),
        );
    });
    return () => controller.abort();
  }, [trip.id, destinations?.features, summaryRetry, snapshotVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const features = destinations?.features ?? [];
    void Promise.allSettled(
      features.map(async (destination) => {
        const result = await planningRequest<PlanResponse>(
          activityPlanPath(trip.id, destination.id),
          { signal: controller.signal },
        );
        return result.data;
      }),
    ).then((results) => {
      if (!controller.signal.aborted) {
        setPlanningSummaries(
          Object.fromEntries(
            results.map((result, index) => [
              features[index].id,
              result.status === "fulfilled" ? result.value : null,
            ]),
          ),
        );
      }
    });
    return () => controller.abort();
  }, [trip.id, destinations?.features, summaryRetry, snapshotVersion]);

  useEffect(() => {
    if (
      (destinations?.features.reduce(
        (count, item) => count + item.properties.stays.length,
        0,
      ) ?? 0) < 1
    )
      return;
    const controller = new AbortController();
    Promise.all([
      getSelectedFlights(trip.id, controller.signal),
      getFlightChoices(trip.id, controller.signal),
    ])
      .then(([flights, choices]) => {
        if (!controller.signal.aborted) setFlightData({ flights, choices });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFlightData({ error: true });
      });
    return () => controller.abort();
  }, [trip.id, destinations?.features, flightRetry, snapshotVersion]);

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
    notify(`${destination.properties.name} added to your trip.`);
  }

  async function removeDestination() {
    if (!destinationToDelete || deleting || readOnly) return;
    const destination = destinationToDelete;
    setDeleting(true);
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
      notify(`${destination.properties.name} deleted from your trip.`);
    } catch (reason) {
      notify(
        reason instanceof Error
          ? reason.message
          : "Could not delete the destination. Try again.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  const unsortedVisits = destinations?.route.length
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

  const visits = [...unsortedVisits].sort((a, b) => {
    const aDate = a.stay.arrivalDate ?? a.stay.departureDate;
    const bDate = b.stay.arrivalDate ?? b.stay.departureDate;
    return aDate && bDate
      ? aDate.localeCompare(bDate) || a.stay.order - b.stay.order
      : aDate
        ? -1
        : bDate
          ? 1
          : a.stay.order - b.stay.order;
  });

  function flightSpacer(from: FlightStop, to: FlightStop) {
    const matches = matchingFlightLegs(from, to, legs, airportCities);
    return (
      <li
        className="overview-flight-spacer"
        aria-label={`Flights from ${from.city ?? "Home"} to ${to.city ?? "Home"}`}
      >
        <Airplane20Regular aria-hidden="true" />
        <span className="overview-flight-route">
          {from.city ?? "Home"} → {to.city ?? "Home"}
        </span>
        {flightData?.error ? (
          <Button
            appearance="subtle"
            onClick={() => setFlightRetry((value) => value + 1)}
          >
            Retry flights
          </Button>
        ) : !flightData?.flights ? (
          <ContentSkeleton label="Loading flights" layout="text" />
        ) : (
          <Link to={`/trips/${encodeURIComponent(trip.id)}/flights`}>
            {matches.length
              ? matches.map(flightNumbers).join(" · ")
              : readOnly
                ? "View Flights"
                : "Plan Flights"}
          </Link>
        )}
      </li>
    );
  }

  return (
    <section className="trip-overview" aria-label="Overview">
      {!readOnly && destinations && destinations.features.length > 0 && (
        <div className="trip-overview-heading">
          <Button
            appearance="primary"
            icon={<Add24Regular />}
            onClick={() => setShowDrawer(true)}
          >
            Add destination
          </Button>
        </div>
      )}
      {toaster}
      {destinations &&
        cachedTripResource<TravelPlan>(`/trips/${trip.id}/travel`) && (
          <TripTravelEditor
            tripId={trip.id}
            destinations={destinations}
            readOnly={readOnly}
            activities={Object.entries(activitySummaries).flatMap(
              ([destinationId, summary]) =>
                (summary.activities ?? []).map((a) => ({
                  ...a,
                  destinationId,
                })),
            )}
            value={cachedTripResource<TravelPlan>(`/trips/${trip.id}/travel`)!}
          />
        )}
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
        <DestinationOverviewSkeleton />
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
            <Fragment key={stay.id}>
              {flightSpacer(
                index === 0
                  ? { city: homeCity ?? null }
                  : visitStop(visits[index - 1]),
                visitStop({ destination, stay }),
              )}
              <li className="overview-destination">
                <div className="overview-destination-details">
                  <Title3 as="h3">{destination.properties.name}</Title3>
                  {!readOnly && (
                    <Button
                      appearance="subtle"
                      className="overview-destination-delete"
                      icon={<Delete20Regular />}
                      aria-label={`Delete destination: ${destination.properties.name}`}
                      disabled={deleting}
                      onClick={() => {
                        setDestinationToDelete(destination);
                      }}
                    />
                  )}
                  {readOnly ? (
                    <Text>{visitDates(stay)}</Text>
                  ) : (
                    <Button
                      className="overview-destination-dates"
                      appearance="outline"
                      aria-label={`Edit dates: ${destination.properties.name}, visit ${index + 1}`}
                      onClick={() => {
                        setEditingVisit({ destination, stay });
                        setShowDateDrawer(true);
                      }}
                    >
                      {visitDates(stay)}
                    </Button>
                  )}
                </div>
                {readOnly && stay.stayLocation && (
                  <Text className="overview-stay-name">
                    {stay.stayLocation.properties.name}
                  </Text>
                )}
                {!readOnly && (
                  <Button
                    appearance="subtle"
                    icon={<BuildingPeople24Regular />}
                    aria-label={`${stay.stayLocation?.properties.name ?? "Choose stay"} in ${destination.properties.name}`}
                    onClick={() => setStayVisit({ destination, stay })}
                  >
                    {stay.stayLocation?.properties.name ?? "Choose stay"}
                  </Button>
                )}
                {planningSummaries[destination.id] && (
                  <DestinationPlanningProgress
                    response={planningSummaries[destination.id]!}
                    stayId={stay.id}
                    name={destination.properties.name}
                  />
                )}
                {planningSummaries[destination.id] === null && (
                  <Button
                    appearance="outline"
                    onClick={() => setSummaryRetry((value) => value + 1)}
                  >
                    Retry planning summary
                  </Button>
                )}
                <div className="overview-activity-summary">
                  {activitySummaries[destination.id]?.counts ? (
                    Object.keys(activitySummaries[destination.id].counts!)
                      .length ? (
                      <div
                        className="overview-activity-tags"
                        aria-label={`${destination.properties.name} activities by state`}
                      >
                        {Object.entries(
                          activitySummaries[destination.id].counts!,
                        )
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([state, count]) => (
                            <Link
                              key={state}
                              to={`/trips/${encodeURIComponent(trip.id)}/activities?destination=${encodeURIComponent(destination.id)}`}
                              aria-label={`${count} ${state} activities in ${destination.properties.name}`}
                            >
                              <Badge
                                appearance="tint"
                                color={
                                  state === "Planned"
                                    ? "success"
                                    : state === "Rejected"
                                      ? "danger"
                                      : "informative"
                                }
                              >
                                {state} · {count}
                              </Badge>
                            </Link>
                          ))}
                      </div>
                    ) : (
                      <Link
                        className="overview-activities-link"
                        aria-label={`${readOnly ? "View activities" : "Plan activities"} in ${destination.properties.name}`}
                        to={`/trips/${encodeURIComponent(trip.id)}/activities?destination=${encodeURIComponent(destination.id)}`}
                      >
                        <span>
                          {readOnly ? "View Activities" : "Plan Activities"}
                        </span>
                        <ArrowRight20Regular aria-hidden="true" />
                      </Link>
                    )
                  ) : activitySummaries[destination.id]?.error ? (
                    <Button
                      appearance="subtle"
                      onClick={() => setSummaryRetry((value) => value + 1)}
                    >
                      Retry activity summary
                    </Button>
                  ) : (
                    <ContentSkeleton
                      label="Loading activity summary"
                      layout="text"
                    />
                  )}
                </div>
                <VisitPlans
                  stay={stay}
                  name={destination.properties.name}
                  response={planningSummaries[destination.id]}
                  activities={activitySummaries[destination.id]?.activities}
                  activityError={activitySummaries[destination.id]?.error}
                  onRetry={() => setSummaryRetry((value) => value + 1)}
                />
              </li>
              {index === visits.length - 1 &&
                flightSpacer(visitStop({ destination, stay }), {
                  city: homeCity ?? null,
                })}
            </Fragment>
          ))}
        </ol>
      )}
      {!readOnly && (
        <DeleteDestinationDialog
          destination={destinationToDelete}
          busy={deleting}
          onCancel={() => {
            if (!deleting) {
              setDestinationToDelete(undefined);
            }
          }}
          onDelete={() => void removeDestination()}
        />
      )}
      {!readOnly && stayVisit && (
        <StayLocationDrawer
          tripId={trip.id}
          key={`${stayVisit.stay.id}:${visitRefresh}`}
          destination={stayVisit.destination}
          visit={stayVisit.stay}
          onClose={() => setStayVisit(undefined)}
          onSaved={async () => {
            setDestinations(
              (await getDestinations(trip.id)) ?? emptyDestinations,
            );
            notify("Stay location saved.");
          }}
        />
      )}
      {!readOnly && (
        <AddDestinationDrawer
          key={
            editingVisit
              ? `${editingVisit.stay.id}:${editingVisit.stay.arrivalDate}:${editingVisit.stay.departureDate}:${visitRefresh}`
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
            notify("Visit dates saved.");
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

function visitStop({
  destination,
  stay,
}: {
  destination: Destination;
  stay: Stay;
}): FlightStop {
  return {
    city: destination.properties.name,
    arrivalDate: stay.arrivalDate,
    departureDate: stay.departureDate,
    arrivalFlexibilityDays: Number(
      destination.properties.constraints?.arrivalFlexibilityDays ?? 0,
    ),
    departureFlexibilityDays: Number(
      destination.properties.constraints?.departureFlexibilityDays ?? 0,
    ),
  };
}

function visitDates(stay: Stay): string {
  return stay.arrivalDate || stay.departureDate
    ? `${formatDate(stay.arrivalDate)} – ${formatDate(stay.departureDate)}`
    : "Dates to decide";
}
