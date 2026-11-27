import DestinationTransport from "./DestinationTransport";
import type { TransportStop } from "./destinationTransportModel";
import {
  useExplicitResourceRefresh,
  useTripResourceVersion,
  useTripDocumentState,
} from "../../api/tripDocumentStore";
import ContentSkeleton from "../../shared/components/ContentSkeleton";
import CityIcon from "../../shared/components/CityIcon";
import { activityStatuses } from "../activities/activityStatus";
import { DestinationOverviewSkeleton } from "./TripSkeletons";
import { useActionToast } from "../../shared/hooks/useActionToast";
import { Fragment, useEffect, useState } from "react";
import { Badge, Button, Text, Title3 } from "@fluentui/react-components";
import {
  Add24Regular,
  Checkmark16Regular,
  ArrowRight20Regular,
  Location24Regular,
  Delete20Regular,
  BuildingPeople24Regular,
  Calendar24Regular,
  ChevronRight20Regular,
} from "@fluentui/react-icons";
import { Link } from "react-router";
import type { Trip } from "../../api/api";
import {
  getDestinations,
  getActivities,
  deleteDestination,
  type Activity,
  type Destination,
  type DestinationCollection,
  type Stay,
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
import { listTransportation, type Transportation } from "./transportationApi";
import { tripPlanningProgress } from "./tripPlanningProgress";
import { calendarDayKey } from "../activities/activityCalendarModel";
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
  const documentVersion = useTripResourceVersion(`/trips/${trip.id}`);
  const document = useTripDocumentState();
  const itinerary =
    document.tripId === trip.id
      ? document.document?.document.itinerary
      : undefined;
  const [transportation, setTransportation] = useState<Transportation[]>();
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
        items?: Activity[];
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
  }, [trip.id, retry, documentVersion]);

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
        return { counts, items: activities.features };
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
  }, [trip.id, destinations?.features, summaryRetry, documentVersion]);

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
  }, [trip.id, destinations?.features, summaryRetry, documentVersion]);

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
  }, [trip.id, destinations?.features, documentVersion]);

  useEffect(() => {
    if (!destinations?.features.length) return;
    let active = true;
    void listTransportation(trip.id)
      .then(({ data }) => {
        if (active && Array.isArray(data)) setTransportation(data);
      })
      .catch(() => {
        if (active) setTransportation(undefined);
      });
    return () => {
      active = false;
    };
  }, [trip.id, destinations?.features, documentVersion, summaryRetry]);

  function destinationAdded(destination: Destination) {
    setDestinations((current) => {
      const collection = current ?? emptyDestinations;
      const exists = collection.features.some(
        (item) => item.id === destination.id,
      );
      const stay = destination.properties.stays.at(-1);
      // The save refreshes the document before the drawer reports success.
      const newVisit =
        stay &&
        !collection.route.some(
          (visit) =>
            visit.destinationId === destination.id && visit.stayId === stay.id,
        );
      return {
        ...collection,
        features: exists
          ? collection.features.map((item) =>
              item.id === destination.id ? destination : item,
            )
          : [...collection.features, destination],
        route: newVisit
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

  const stops = visits.map(visitStop);
  const planningStops = homeCity
    ? [{ city: homeCity }, ...stops, { city: homeCity }]
    : stops;
  const planningLegs = planningStops
    .slice(1)
    .map((to: FlightStop & TransportStop, index) => {
      const from: FlightStop & TransportStop = planningStops[index];
      return {
        from: from.stayId,
        to: to.stayId,
        fromCity: from.city ?? "Home",
        toCity: to.city ?? "Home",
        hasFlight: matchingFlightLegs(from, to, legs, airportCities).length > 0,
      };
    });
  const progress = tripPlanningProgress(
    visits,
    planningSummaries,
    activitySummaries,
    planningLegs,
    transportation,
    itinerary,
  );
  const next = progress.next;

  function editDates(visit: (typeof visits)[number]) {
    setEditingVisit(visit);
    setShowDateDrawer(true);
  }

  function activityLink(
    visit: (typeof visits)[number],
    params: Record<string, string> = {},
  ) {
    const query = new URLSearchParams({
      destination: visit.destination.id,
      ...params,
    });
    return `/trips/${encodeURIComponent(trip.id)}/activities?${query}`;
  }

  function activityAction(visit: (typeof visits)[number]) {
    if (
      (next?.kind !== "choose" && next?.kind !== "schedule") ||
      next.visit.stay.id !== visit.stay.id
    )
      return null;
    const city = visit.destination.properties.name;
    const label =
      next.kind === "schedule"
        ? `Schedule ${next.count} ${next.count === 1 ? "activity" : "activities"} in ${city}`
        : `Choose activities in ${city}`;
    return (
      <Link
        className="navigation-button"
        data-next-action
        to={activityLink(
          visit,
          next.kind === "choose"
            ? { view: "ideas" }
            : { view: "schedule", unscheduled: "1" },
        )}
      >
        {label}
        <ArrowRight20Regular aria-hidden="true" />
      </Link>
    );
  }

  function transportSpacer(
    from: TransportStop & FlightStop,
    to: TransportStop & FlightStop,
  ) {
    const matches = matchingFlightLegs(from, to, legs, airportCities);
    return (
      <DestinationTransport
        key={`${from.stayId ?? "home"}:${to.stayId ?? "home"}`}
        tripId={trip.id}
        from={{
          ...from,
          date: from.departureDate ?? from.arrivalDate ?? to.arrivalDate,
        }}
        to={{
          ...to,
          date: to.arrivalDate ?? to.departureDate ?? from.departureDate,
        }}
        readOnly={readOnly}
        homeUserId={trip.ownerUserId}
        nextAction={
          next?.kind === "transport" &&
          next.leg.from === from.stayId &&
          next.leg.to === to.stayId
        }
        flights={matches.map(flightNumbers).join(" · ")}
      />
    );
  }

  return (
    <section className="trip-overview" aria-label="Overview">
      {toaster}
      {visits.length > 0 && (!readOnly || progress.planned) && (
        <div className="overview-planning-header">
          {progress.planned && (
            <Badge
              appearance="outline"
              color="subtle"
              size="large"
              icon={<Checkmark16Regular />}
              role="status"
            >
              Trip planned
            </Badge>
          )}
          {!readOnly && (
            <Button
              appearance="secondary"
              icon={<Add24Regular />}
              className="overview-add-destination"
              onClick={() => setShowDrawer(true)}
            >
              Add destination
            </Button>
          )}
        </div>
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
              {transportSpacer(
                index === 0
                  ? { city: homeCity ?? null }
                  : visitStop(visits[index - 1]),
                visitStop({ destination, stay }),
              )}
              <li className="overview-destination interactive-card">
                <Link
                  className="overview-destination-link card-action card-overlay"
                  aria-label={destination.properties.name}
                  to={`/trips/${encodeURIComponent(trip.id)}/activities?destination=${encodeURIComponent(destination.id)}`}
                />
                <div className="overview-destination-details">
                  <Title3 as="h3" className="overview-destination-heading">
                    <CityIcon
                      name={destination.properties.name}
                      countryCode={destination.properties.countryCode}
                    />
                    {destination.properties.name}
                  </Title3>
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
                </div>
                {readOnly ? (
                  <Text>{visitDates(stay)}</Text>
                ) : (
                  <Button
                    className="overview-destination-dates"
                    appearance={
                      next?.kind === "dates" && next.visit.stay.id === stay.id
                        ? "primary"
                        : "outline"
                    }
                    icon={<Calendar24Regular />}
                    aria-label={`Edit dates: ${destination.properties.name}, visit ${index + 1}`}
                    onClick={() => editDates({ destination, stay })}
                  >
                    <span className="overview-visit-button-label">
                      {visitDates(stay)}
                    </span>
                    <ChevronRight20Regular aria-hidden="true" />
                  </Button>
                )}
                {readOnly && stay.stayLocation && (
                  <Text className="overview-stay-name">
                    {stay.stayLocation.properties.name}
                  </Text>
                )}
                {!readOnly && (
                  <Button
                    className="overview-destination-stay"
                    appearance="outline"
                    icon={<BuildingPeople24Regular />}
                    aria-label={`${stay.stayLocation?.properties.name ?? "Choose stay"} in ${destination.properties.name}`}
                    onClick={() => setStayVisit({ destination, stay })}
                  >
                    <span className="overview-visit-button-label">
                      {stay.stayLocation?.properties.name ?? "Choose stay"}
                    </span>
                    <ChevronRight20Regular aria-hidden="true" />
                  </Button>
                )}
                {next?.kind === "conflict" &&
                  next.visit.stay.id === stay.id && (
                    <Link
                      className="navigation-button overview-conflict-link"
                      data-next-action
                      to={activityLink(
                        { destination, stay },
                        {
                          view: "schedule",
                          day: calendarDayKey({
                            stayId: stay.id,
                            date: next.date,
                          }),
                          details: "1",
                        },
                      )}
                    >
                      Review timing conflict
                    </Link>
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
                  {activityAction({ destination, stay })}
                  {activitySummaries[destination.id]?.counts ? (
                    Object.keys(activitySummaries[destination.id].counts!)
                      .length ? (
                      <div
                        className="overview-activity-tags"
                        aria-label={`${destination.properties.name} activities by state`}
                      >
                        {activityStatuses
                          .filter(
                            (status) =>
                              activitySummaries[destination.id].counts![
                                status.value
                              ] > 0,
                          )
                          .map((status) => {
                            const count =
                              activitySummaries[destination.id].counts![
                                status.value
                              ];
                            return (
                              <Link
                                key={status.value}
                                className="activity-state-pill"
                                data-activity-state={status.value}
                                to={`/trips/${encodeURIComponent(trip.id)}/activities?destination=${encodeURIComponent(destination.id)}`}
                                aria-label={`${count} ${status.label} activities in ${destination.properties.name}`}
                              >
                                <status.Icon aria-hidden="true" />
                                {status.label} {count}
                              </Link>
                            );
                          })}
                      </div>
                    ) : (
                      <Link
                        className="navigation-button overview-activities-link"
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
              </li>
              {index === visits.length - 1 &&
                transportSpacer(visitStop({ destination, stay }), {
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
}): FlightStop & TransportStop {
  return {
    city: destination.properties.name,
    stayId: stay.id,
    destination,
    date: stay.departureDate ?? stay.arrivalDate,
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
