# Trip Document

A trip document is a versioned, self-contained description of an entire trip.
Web and iOS clients download it in one authenticated request and retain it for
read-only offline use. PostgreSQL remains authoritative; edits use focused REST
resources and their optimistic concurrency checks.

The document and REST contracts evolve independently. A file format change does
not require matching changes to every editing endpoint, and a REST representation
change does not automatically require a new document version. Server and client
adapters translate between the two contracts.

## Domain model

| Section | Meaning |
| --- | --- |
| `people` | Participants, trip membership roles, and `isOwner`. Ownership implies planning permission, regardless of the stored membership role. Exactly one person owns the trip. |
| `places` | Shared city, airport, accommodation, and activity locations. Each has a stable ID and one GeoJSON `location`; other entities reference it. Cities include their opaque `destinationId`. |
| `activities` | Complete undated activity ideas: name, details, duration, cost, links, research evidence, and a place reference. `state` is the idea's Proposed/Planned/Rejected state; `selection` separately records its explicit Selected/Excluded/Unassigned status in the saved schedule. `rule` contains its scheduling restrictions. |
| `transportation.legs` | Selected flight segments, explicit connections, and calculated local transfers. Flights contain their details, visit associations, and a purchase flag directly. There are no separate services, flight-selection references, or generated reservation entities. |
| `transportation.journeys` | Selected provider itineraries, including fares and connection details needed to display and continue a saved flight selection. `groupId` associates them with participants; a null `legIndex` identifies a selection awaiting reassignment. |
| `transportation.bookings` | Saved provider bookings used by flight editing and display. These are actual saved provider data, rather than synthetic reservations generated from a purchase flag. |
| `itinerary.visits` | Visits in explicit route order, including repeat visits to one city. Dates and accommodation references belong to each visit. |
| `itinerary.days` | Editable day assignments and ordered activity references, including availability, meal placement, and flight matching choices. |
| `itinerary.schedule` | Calculated calendar timings referencing activity or transportation IDs. Definitions and titles remain in their domain collections. Unscheduled items have no schedule entry. |
| `preferences` | Editable trip constraints, activity preferences, destination scheduling settings, travel-group membership, and flight-selection progress. |
| `etag`, `contextVersion`, and version fields | Optional validators placed directly on the entities and editable sections they describe. Root `canPlan` records current planning permission. No API addresses, status codes, media types, or response bodies are stored. |

The format is ordinary JSON described by
[`trip-document-v1.schema.json`](schemas/trip-document-v1.schema.json).
It does not require JSON-LD processing. IDs remain stable across exports; place IDs
are opaque and should not be interpreted as network addresses. Dates, local clock
times, timestamps, and elapsed durations use ISO 8601. The itinerary is a domain
model with references and timings, rather than a jCal document.

## Entity validators

Each independently editable resource has its own validator, even when several
resources belong to the same entity. The document stores bare opaque ETag tokens. The client adds HTTP's required
double quotes when constructing an editing request's `If-Match` header.
For example, JSON `"etag": "visit-7"` becomes `If-Match: "visit-7"`.
The whole downloaded file has a separate HTTP ETag.

| Location | Resource validated |
| --- | --- |
| Root `etag` | Trip metadata and constraints |
| Person `etag` | Trip participation and role |
| Destination place `etag` | Destination details and constraints |
| Destination place `activitiesEtag` and `contextVersion` | Activity collection and destination context |
| Visit `etag` | Visit dates and ordering |
| Visit `accommodationEtag` | Accommodation, including an absent accommodation |
| Activity `etag` | Activity details and destination context |
| Activity preferences `etag` and `version` | The complete preference resource at that scope |
| Destination scheduling preferences `etag`, `version`, and `contextVersion` | Saved activity plan version and planning context |
| Group `memberEtags[personId]` | That person's membership in the group |
| Group `flightChoicesEtag` and `bookingEtag` | Selected journeys and saved provider booking for the group |
| Transportation `connectionsEtag` and `connectionsVersion` | The collection of explicit connections |
| Preferences `flightPlanningEtag` | Flight-planning inputs and their computed view |

For example, a visit can carry separate edit validators without API addresses:

```json
{
  "id": "ceaa5647-9604-46c6-b7bf-b8100ef9106b",
  "arrivalDate": "2026-12-10",
  "departureDate": "2026-12-14",
  "etag": "visit-7",
  "accommodationEtag": "accommodation-2"
}
```

Collection validators belong to the collection's owning section. A connection
has no individual ETag because the REST API replaces the connection collection.
Read-only collection views reconstructed by clients do not require edit ETags.
Removing the root `etag` makes clients treat the file as read-only even if some
entity metadata remains. Root `canPlan` is a direct, optional permission hint,
which never grants authorization. Import never treats supplied metadata as authority.

## Reading and editing

`GET /trips/{tripId}/document` returns the complete document. It requires the
signed-in user's access to the trip. Gzip negotiation and conditional GETs work as
before: the HTTP ETag validates the exact downloaded representation, while
entity-local validator fields supply separate validators for individual editing resources. API addresses belong to the web and iOS adapters, so changing a route does not change the file format.
The JSON Schema is public at `/schemas/trip-document-v1.json`.

Clients build their screen and REST models locally from the domain sections.
Activity-plan assessments and the computed flight-planning view are API features:
clients fetch them from the existing activity-plan and flight-constraints endpoints,
not from the trip document. The web stores viewed API results in an account-scoped
application cache outside the document, for read-only offline viewing. A changed
document invalidates these results, and online access denial or sign-out clears
them with the trip cache. A result that has never been loaded needs connectivity.
The web persists the domain document without its reconstructed domain response cache.
iOS builds destination and stay editing bodies only where needed. Only the current trip document format is supported.

Edits still submit complete REST resources with `If-Match`, and planning/activity
edits retain their existing context checks. A stale edit is rejected; clients do
not replay it automatically. Current clients refresh the document after successful
mutations. This redesign reduces document duplication; incremental refreshes and
narrower server-side ETag computation are separate work.

All validator fields can be omitted from a portable file. Without server validators the file can
supply read-only views; applications must obtain fresh editing metadata before
saving. Imported ownership, roles, revisions, and ETags never establish access.

`PUT /trips/{tripId}/document` preserves the existing metadata-only cloud-promotion
capability. It uses the authenticated owner and existing idempotent import store;
it never overwrites an existing trip. Richer imports fail explicitly rather than
discarding unsupported entities or settings. iOS promotion journals submit the current document to this endpoint.

MCP exposes the document as `get_trip_document`. Metadata-only creation is covered
by `create_trip`, so a separate file-import MCP tool is unnecessary.

## Examples

[`before.json`](before.json) is the complete Japan December 2026 response captured
from the running app on November 8, 2026. Its content was moved out of this document
without removing any data.

[`after.json`](after.json) is the same captured trip represented in the current document
format. It is a comparison fixture, not a fresh download from a deployed
server. The API and client tests check its domain content, reference relationships,
domain REST view reconstruction, API-only assessment loading, and edit validators. Both files contain real trip data;
their synchronization metadata is historical.
