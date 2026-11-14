# Trip Document

A trip document is a versioned, self-contained description of an entire trip.
Web and iOS clients download it in one authenticated request and retain it for read-only offline use.
PostgreSQL remains authoritative; edits use focused REST resources and their optimistic concurrency checks.

The document and REST contracts evolve independently.
A file format change does not require matching changes to every editing endpoint, and a REST representation change does not automatically require a new document version. Server and client adapters translate between the two contracts.

## Domain model

**The itinerary is the trip's calendar.** Its `items` collection contains every
activity, journey or transfer, city visit, and hotel stay. Each item owns its
identity, details, and timing. There is no separate activity definition collection
or timing schedule to join to it.

| Section | Meaning |
| --- | --- |
| `people` | Participants, roles, and ownership. |
| `places` | Reusable cities, airports, hotels, and venues with stable IDs and GeoJSON locations. |
| `itinerary.items` | The calendar's events and unscheduled tasks. |
| `preferences` | Editable constraints, day assignments, scheduling rules, participant groups, and saved flight-selection inputs. |

Each calendar item has `id`, `name`, `kind`, `type`, and `busy`:

| Kind | Details and behavior |
| --- | --- |
| `activity` | Complete idea, required nonempty `kinds` array of unique, nonblank free-form strings (up to 200 characters each), nullable `address`, explicit `ticketRequirement` (`Unknown`, `Required`, `NotRequired`), estimated duration, cost, research, links, selection state, and scheduling rule. An assigned visit is referenced by `visitId`. |
| `flight` | A selected flight segment, its airports, flight number, purchase state, and visit associations. |
| `transportation` | An explicit journey whose `transportation` property is a complete GeoJSON FeatureCollection: referenced/inline endpoints, notes, and optional ordered route steps. |
| `transfer` | A calculated local journey between activities. |
| `visit` | A city visit, including its route `order` and date range. Repeat visits have distinct IDs. |
| `lodging` | A hotel stay referencing its `placeId` and `visitId`. The hotel location is reusable; each stay is a separate calendar item. |

An item with a known start is an `event`; an unscheduled item is a `task`.
Scheduling an activity keeps its ID and details and changes its type to `event`.
An activity retains its Proposed/Planned/Rejected `state` and separate
Selected/Excluded/Unassigned `selection`. Unselected ideas remain available as
tasks rather than disappearing from the file.

Events use `start` with either an exclusive `end` or an elapsed `duration`.
City visits and lodging use date ranges. Timed activities and transportation use
offset timestamps with `timeZone` for local display; selected flights also
retain airport-local times for display. Dates, times, timestamps, and elapsed
durations use ISO 8601. An activity's `estimatedDuration` remains its research
estimate; a scheduled event's `duration` is the actual planned allocation.

Tasks have `busy: false`. City visits and lodging events also have `busy: false`,
so they provide context without blocking daytime activities. Timed activities and
transportation have `busy: true`.

Hotels have independent, trip-scoped identities. A visit selects a hotel, and transportation references that hotel rather than following the visit’s selection. Current lodging storage records that selection against a visit. Its calendar
range therefore comes from that visit and is marked `timingSource: "visit"`.
These are visit dates, not independently confirmed hotel check-in/out times.

Day assignments, availability, meal positions, and flight matches are editable
planning inputs under `preferences.destinations[].schedule.days`. Actual event
timings belong to the calendar items. Computed assessments remain API features.
Shared provider fare data lives in `preferences.flightChoices[].journeys`, and a
group's saved complete booking is in `preferences.groups[].booking`; a shared
booking is stored once rather than repeated on each flight event.

The format is ordinary JSON described by
[`trip-document-v1.schema.json`](schemas/trip-document-v1.schema.json), using
calendar event/task semantics. It does not require JSON-LD or literal jCal array
syntax. IDs are opaque, stable across exports, and should not be interpreted as
network addresses.

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
| Lodging `etag` | The chosen hotel for a visit |
| Visit `accommodationEtag` | An absent hotel, allowing its first save with a validator |
| Activity `etag` | Activity details and destination context |
| Activity preferences `etag` and `version` | The complete preference resource at that scope |
| Destination scheduling preferences `etag`, `version`, and `contextVersion` | Saved activity plan version and planning context |
| Group `memberEtags[personId]` | That person's membership in the group |
| Group `flightChoicesEtag` and `bookingEtag` | Selected journeys and saved provider booking for the group |
| Transportation item `transportation.etag` and `transportation.version` | The individual transportation resource |
| Hotel place `etag` and `version` | The independent hotel resource |
| Preferences `flightPlanningEtag` | Flight-planning inputs and their computed view |

For example, a hotel stay is a calendar event:

```json
{
  "id": "a75ac33b-9f4a-4e2c-9b78-1ac0205b24c9",
  "kind": "lodging",
  "type": "event",
  "name": "Mets Shibuya Hotel",
  "start": "2026-12-25",
  "end": "2026-12-30",
  "timeZone": "Asia/Tokyo",
  "busy": false,
  "placeId": "hotel-place-id",
  "visitId": "29638aaf-ee9a-4aa5-8f64-00639da26763",
  "timingSource": "visit",
  "etag": "hotel-7"
}
```

Transportation journeys have individual ETags on their nested FeatureCollections.
Hotel places carry the independent hotel's ETag and version; lodging items carry
the validator for that visit's hotel selection.
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
their synchronization metadata is historical. Activity kinds and explicit unknown ticket/address fields have been added to both comparison fixtures for the current contract; these annotations are not newly verified travel facts.
