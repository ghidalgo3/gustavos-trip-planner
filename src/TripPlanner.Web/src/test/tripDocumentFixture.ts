import type { Trip } from "../api/api";
import type { TripDocument } from "../api/tripDocument";

export function tripDocumentFixture(
  trip: Partial<Trip> & { id: string },
  patch: Partial<TripDocument> = {},
): TripDocument {
  return {
    schemaVersion: 1,
    id: trip.id,
    name: trip.name ?? "Trip",
    description: trip.description ?? "",
    revision: "1",
    createdAt: trip.createdAt ?? "2030-01-01T00:00:00Z",
    updatedAt: trip.updatedAt ?? "2030-01-01T00:00:00Z",
    originPlaceId: "home",
    people: [
      {
        id: trip.ownerUserId ?? "owner",
        name: "Owner",
        role: "Planner",
        isOwner: true,
        homeCityName: null,
      },
    ],
    places: [{ id: "home", name: "Home", type: "Place", location: null }],
    itinerary: { items: [] },
    preferences: {
      constraints: trip.constraints ?? {},
      activities: { instructions: "", defaults: null },
      destinations: [],
      groups: [],
      flightChoices: [],
    },
    canPlan: trip.canPlan ?? true,
    etag: "1",
    ...patch,
  };
}
