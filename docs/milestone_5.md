# Milestone 5: Complete trip snapshots

Status: Implemented. The executable wire contract is
[`schemas/trip-snapshot-v1.schema.json`](schemas/trip-snapshot-v1.schema.json).
This document records the design and behavioral contracts. Existing resources are
included in `resources` to let current views consume the snapshot without more GETs;
new clients can consume its canonical entities and calendar directly.

## Boundary and goals

PostgreSQL remains authoritative. A snapshot is a complete, authorized read model
delivered in one HTTP request as compressed JSON and cached locally for offline
reading. Clients continue editing complete REST resources with conditional writes.
The snapshot is not a replacement database, a whole-trip PUT contract, an event
log, or an offline write queue. CRDTs are outside this milestone.

The top-level object is Schema.org `Trip`. Its `itinerary` is an ordered `ItemList`
of destination visits. Each visit is a `ListItem` whose `item` references a `Place`.
`tripOrigin` references the home Place. One JSCalendar `Group` in `plan` contains
all activity and travel Tasks/Events. There is one party per trip, represented by
travellers with roles and a separate owner reference.

Each visit independently selects accommodation. Two visits may reference the same
hotel Place, but changing one visit's selection or booking does not change another.
Selected flights retain optional actual reservations; temporary offers and fare
search results are outside the snapshot.

The endpoint is `GET /trips/{tripId}/snapshot`. Existing GETs
remain for compatibility and focused refreshes. Snapshot availability does not
add new flight/rail/bus booking or routing integrations by itself.

## Identity, definitions, and references

Entity identity survives renaming, reordering, serialization, and refreshing the
snapshot. Persistent IDs are mapped deterministically to absolute IRIs; existing
UUIDs use `urn:uuid:<uuid>`. Existing non-UUID IDs need a documented stable mapping
scoped to their trip. IDs must not come from names, array positions, coordinates,
flight numbers alone, or expiring provider-cache keys.

| Entity | Canonical definition | References to it |
| --- | --- | --- |
| Trip | Root `Trip` with `@id` | Resource metadata and trip-scoped entities |
| Place | `places[]`: destinations, home, venues, accommodation, airports/stations | Visits, `tripOrigin`, activity locations, travel endpoints, services/reservations |
| Person | `people[]` | Owner, traveller memberships, reservation holders, calendar participants |
| Visit | `itinerary.itemListElement[]`, each with its own `@id` and `position` | Day assignments, accommodation/reservation associations, travel endpoints, flight selections |
| Activity | A Task or Event in `plan.entries[]`, identified by `uid` | Day ordering, predecessor rules, travel endpoints, assessment issues |
| Travel connection | A Task or Event in `plan.entries[]`, identified by `uid` | Day ordering, assessment issues, routing evidence |
| Transport service occurrence | `services[]`: `Flight`, `TrainTrip`, or `BusTrip` | Flight selections, travel entries, reservations |
| Flight selection | `flights[]`, with an application `@id` | Travel entries and selection status; owns the selected `flight` and optional `reservation` references |
| Reservation | `reservations[]`, with `@id` | Flight selections or visit accommodation bookings; `reservationFor` references the booked service/place |

Calendar UIDs use persistent UUIDs; their cross-document reference form is
`urn:uuid:<uid>`. A Task becoming an Event retains its UID, common content, and
application rules. It is replaced in place, never duplicated as a second activity.
Regenerating a calendar projection must not mint a new activity UID. Membership
identity is the pair of trip and person IDs. A planning day's identity is its visit
ID plus local date, rather than a second independently generated identifier.

Destinations without remaining visits can remain in `places` and destination
planning settings so their ideas remain recoverable. Identical-looking places
are not automatically merged. Explicitly choosing the same known place reuses its
ID. Flight identity includes the particular dated service occurrence; a recurring
flight number alone cannot identify it.

Schema.org references are objects of the form `{ "@id": "..." }`. Native
JSCalendar fields retain their prescribed shapes; application extensions contain
the equivalent reference strings. Each reference must resolve within the snapshot
unless explicitly designated an external link. JSON-LD `@id` values are identifiers,
not URLs that clients must fetch to render a trip.

Each shared entity has one canonical definition. Native calendar locations and
participants may carry generated copies of names/coordinates needed by independent
calendar readers. These are derived from the registries; edits target the canonical
resource. Transport service times are authoritative for a selected service;
calendar travel timing is its derived schedule placement. User buffers belong to
separate travel/waiting entries or explicit planning settings, not invented changes
to a flight's departure time.

## Placement, rules, and defaults

Calendar entries use application fields for `kind` (`activity` or `travel`),
destination association, planning state, rules, and travel metadata. An activity
without an exact resolved start remains a Task, including one already assigned to
a day. Never invent midnight or a zero duration to satisfy Event requirements.

`planning.days[]` contains the visit reference, local date, and ordered calendar
entry references. It owns assignment/order; do not store a second editable ordering
on the entries. It also owns day-specific availability, meal positions, settings
overrides, and accepted arrival/departure matches. A visit/date pair is unique and
an activity can occur at most once across all visits, matching current behavior.

| Data | Owner in the snapshot |
| --- | --- |
| Name, description, location reference, links, cost and cost basis | Activity Task/Event |
| Known expected duration, evidence, and explicit unknown/assumed status | Activity application metadata; projected to Task `estimatedDuration` when known, or Event `duration` for its scheduled allowance |
| `Proposed`, `Planned`, `Rejected` | Activity application planning state, independent of Task progress or Event status |
| Must-do, fixed date/start, predecessor, duration override, meal credit, opening windows/closures | Activity rules extension |
| Shared instructions, trip constraints, structured defaults, flight-search preferences/constraints | `planning.trip` |
| Destination instructions, constraints, defaults | `planning.destinations[]`, referencing the destination Place |
| Arrival/departure dates, flexibility, ordering constraints, accommodation selection | Visit |
| Sleep, meals, slack, availability, airport buffers and meal positions | Shared defaults plus `planning.days[]` overrides |
| Mode choice, duration override, route segments and evidence | Travel Task/Event extension |
| Assessed timings, breaks, assumptions, issues, fit and freshness | `assessment`, referencing canonical entries/visits |

An unassigned selected activity is a `Task` with `Planned` state. A day-assigned
activity without a resolved start is still a `Task`. A resolved activity becomes
an `Event` with `Planned` state. Rejected and Proposed activities are Tasks without
day assignments. Removing a placement preserves selection as an unscheduled Task;
returning to Ideas also changes state to Proposed. Rejected activities remain
available for recovery. Task progress describes completion of the activity, not
whether planning is finished.

Proposed precedence for structured settings is application defaults -> trip ->
destination -> day, with explicit activity/travel overrides taking final precedence
for their own subject. In a settings-override object, absent or null fields mean no
override and inherit from the broader scope; explicit zero remains zero where
allowed. Null on a source fact (such as unknown activity duration) means unknown,
not an instruction to inherit. Collections are replaced as
complete collections, never implicitly concatenated. The snapshot includes explicit
overrides and effective shared settings, including the defaults version, so an
offline reader need not obtain server configuration. Effective values are derived.

Trip and destination instruction text remain distinct. Structured rules take
precedence in evaluation; inferred rules require explicit acceptance before they
become structured constraints. Private profile instructions remain outside the
shared snapshot. Shared preference scoring can retain its authorized derived fit
and provenance without exporting those instructions.

## Travel and accommodation

A travel connection has explicit from/to Place references and optional activity,
visit, or accommodation-selection associations. Activity venue connections within
a visit and connections between visits use the same model. Home is an explicit
Place endpoint with no visit; it must be distinguishable from an unknown endpoint.

Modes are walk, bike, car, bus, train, transit, flight; preserve the current taxi
choice as taxi rather than losing that user intent. An unspecified mode is allowed
on an unresolved Task. The mode list is a snapshot capability, not a claim that the
current planner/provider already implements every mode. Store whether the user or server selected a mode; automatic
refresh cannot replace an explicit user choice. Provider-specific mode names are
mapped by adapters, not persisted as the public vocabulary.

Mixed journeys retain ordered segments, each with mode, endpoints and available
timing. Define the total as elapsed door-to-door time, including walking, transfers,
and waiting, counting each once. Distinguish a service's onboard duration from
the complete connection. Service details and actual reservations are referenced,
not copied into each segment. No purchase is inferred from a selection.

Routing evidence stores provider, retrieval time, estimate, source kind
(provider/manual/heuristic), and the endpoint/mode/departure inputs used. Changed
inputs invalidate its applicability. Time-based expiration marks it stale without
deleting the last known estimate. Assessment records its explicit evaluation time,
so freshness is reproducible. Unknown, estimated, stale, and confirmed facts remain
distinguishable. User overrides survive refresh. No provider I/O occurs while
reading or serializing a snapshot.

A visit's accommodation selection points to a Place (Hotel/LodgingBusiness when
known), with an optional actual LodgingReservation associated with that visit.
Reservation details must not be fabricated to express a user's Booked assertion;
confirmation numbers, seats and tickets remain optional. One booking record can
be referenced by several selected services when appropriate. Removing a selection
does not silently erase an actual booking; retain it with an explicit unassigned
association for review.

## Time and validity

UTC is used for recorded instants: creation/update/retrieval times and resolved
departure/arrival instants. These serialize with `Z` and remain DateTimeOffset in
C#. Local dates (`DateOnly`) and local clock intentions (`TimeOnly`) remain local;
durations remain TimeSpan and serialize as ISO 8601. A visit's June 10 is not an
instant at midnight UTC. Daily sleep 23:00 and a fixed museum start 09:00 refer to
the destination's IANA time zone.

Native JSCalendar `start` is a LocalDateTime with a separate `timeZone`; do not add
`Z` to a field whose standard type forbids an offset. Resolved UTC start/end can be
included in derived assessment metadata. Transport services retain endpoint IANA
zones alongside known instants for local display. Manual skipped/ambiguous DST
anchors are reported as unresolved; do not silently select an offset. Preserve
the existing distinction between the planning day and the actual local date of an
after-midnight activity/opening window. Time-zone-rule changes can invalidate
derived timing while preserving the local intention.

Structural errors (malformed values, wrong reference types, duplicate IDs,
references to nonexistent entities, inconsistent state/placement) are rejected.
Incomplete or infeasible planning data (missing estimates, undated visits,
out-of-visit placements, overfull days, contradictory scheduling intentions) remains
saveable and explainable by assessments. An unresolved scheduled item stays a Task;
stale previously resolved timing may remain as a labelled last-known projection.
Assessments identify their input context/version and evaluation time.

## Reads, updates, and concurrency

PostgreSQL enforces keys, referential integrity, and atomic writes through explicit
constraints/transactions. Domain evaluation handles planning feasibility. A client
ETag precondition must be checked inside the write transaction, using a conditional
update/lock; a successful earlier GET or a pre-transaction comparison is insufficient.

Build the snapshot from one database snapshot: a single suitable statement or a
read-only REPEATABLE READ transaction spanning all component queries. PostgreSQL's
default READ COMMITTED isolation can observe different commits between statements.
Do not hold this transaction open while calling providers. Authorization and the
included shared data must be evaluated consistently. Relevant membership writes
must participate in the same concurrency rules as other shared changes.

The snapshot carries `schemaVersion`, a durable shared-state revision, resource
metadata (the exact REST resource URL, strong ETag, and relevant context version),
and the last known assessment. Representation-specific HTTP ETags validate snapshot
GETs. Keep transient delivery times out of stable content; if representation
changes, its strong validator changes. Separate identity/gzip/br representations
need distinct strong validators and `Vary: Accept-Encoding`; resource edit validators
refer to the editable resource representation, not the compressed snapshot bytes.

Resource metadata must include an edit validator for every mutable resource exposed
to the client, including meaningful empty collections/absent optional values. A
JSON-LD entity ID is not necessarily a REST write boundary: an activity is edited
independently, while a destination plan may remain an aggregate spanning many days.

| Situation | Required behavior |
| --- | --- |
| Refresh unchanged snapshot | Conditional GET can return 304; cache stays intact |
| Replace/delete editable resource | Send its own quoted ETag in `If-Match` |
| Missing edit precondition | 428 |
| Resource changed | 412; no mutation |
| Referenced planning input context changed | 409 with current context information; no mutation |
| Unrelated resource changed | Do not reject solely because the trip snapshot revision changed |
| Action touches several rows | Verify its preconditions and commit all effects atomically |

The trip revision describes shared persisted content and supports refresh; it is
not a global write gate. A plan's context version covers dependencies such as
activities, visits, accommodation, shared settings, selected transport, and
membership. Dependency changes must participate in transaction locking/versioning
so they cannot race between validation and commit.

On 412/409, preserve the user's draft and notify them that the resource or its
planning inputs changed, with an explicit Refresh button. Refresh loads current
server state and its validators. The failed draft remains available for reference;
it is not automatically reapplied or resubmitted against the new ETag. A comparison
or merge UI is not required in this milestone. No automatic merging or CRDT is
part of the initial client contract. Successful transformations must expose any
fresh validators through HTTP-compliant response/GET behavior.

Deletion cleans up owned placements/rules/derived connections atomically. Deleting
a visit preserves its destination's activity ideas; deleting an activity removes
its assignments and referencing rules. Previously booked services and retained
reservations are marked unassigned rather than silently destroyed. A retained
record must not contain a dangling entity reference. Shared Place/Person definitions
are removed only when no retained entity needs them. Revoking membership updates
authorization and relevant contexts, not historical booking identity.

## Shared web and native client flow

Web and native clients use the same read/write protocol:

1. Load the authorized trip snapshot into the trip read model. When an existing
   local cache is available, display it as last known state while refreshing.
2. Edit in a separate resource draft and send a complete resource replacement or
   deletion with its resource ETag and any required planning context version.
   Serialize writes to the same resource and keep existing content visible.
3. On success, reconcile the server-confirmed resource and fresh validators into
   the read model when supplied. Do not treat the outgoing draft as the canonical
   server response. Refresh the snapshot when the response does not provide enough
   information about affected resources or derived state. A whole-snapshot refresh
   is the conservative fallback; targeted reconciliation is an optimization.
4. On 412/409, show the conflict notification and Refresh button described above.
   Initially Refresh can reload the whole snapshot in one request, which also
   refreshes dependencies. Retain unrelated drafts. A subsequent edit starts from
   refreshed server state and uses the new resource validator.
5. Persist confirmed cached state for offline reading. A locally reconciled read
   model does not invent a new snapshot ETag or claim to be a fresh server snapshot.
   An older in-flight GET must not overwrite a newer confirmed save or refresh;
   serialize refreshes with writes or reject obsolete response generations.

A save that committed successfully remains successful if the following refresh
fails. Show a saved-but-refresh-needed status with a retry for the read, never an
automatic replay of the mutation. Network errors and permission failures are
distinct from edit conflicts. A mutation whose outcome is unknown after connection
loss requires reconciliation or its operation's idempotency mechanism before retry.

Both clients can read their last cached trip without connectivity. Offline writes
and automatic reconciliation after disconnected edits remain outside this
milestone. Native-specific storage and platform UI do not change the protocol.

## Wire contract, caching, and implementation limits

Use a pinned JSON Schema for this application profile and a pinned, offline-usable
JSON-LD context. Standard Schema.org properties keep their meanings; application
properties are explicitly mapped. Embed native JSCalendar as an `@json` value so
its `@type` and fields are not reinterpreted as Schema.org terms. Use a controlled
domain prefix for JSCalendar extensions. Examples in discussion use `example.com`;
the permanent vocabulary URI/domain must be selected before the first wire schema
is released. That naming choice is not a reason to change the model's semantics.

Arrays have defined ordering only where semantic (visit order, day order, route
segments); registries are unordered sets identified by IDs. Snapshot serialization
should be deterministic for unchanged inputs. Missing optional information remains
explicitly optional; unknown durations/coordinates are never fabricated as zero.
Unknown namespaced extension data is retained by supported editors; an incompatible
schema version allows safe read-only fallback or an explicit unsupported response.

Serve negotiated gzip initially; additional encodings can be added after measuring
payloads. Cache as private authenticated data and replace the complete local cache
atomically after validation. Interrupted refresh retains the last complete snapshot.
Offline reading needs no remote context, provider cache, map token, or API call.
External websites, map tiles, and attachments linked by URL are not guaranteed
offline. Snapshot role descriptions never confer server permissions.

Keep private profiles, credentials, calendar subscription secrets, transient search
results, and provider job state outside the shared snapshot. Separately exposed
operations/history can continue using their current APIs; this milestone does not
promise to embed an unbounded Activity Log in each download.

Existing multiple-party data needs an explicit conversion/reset plan; never merge
parties or permissions silently. Current city-level accommodation can seed each
visit's independent selection. These changes may need database migrations; the
snapshot format itself does not require replacing relational persistence or making
future schema changes disappear.

## Verification before rollout

- Document the JSON Schema, context, stable legacy-ID mapping, and DTO contracts.
- Validate and round-trip fixtures for repeat visits, independent accommodation,
  Proposed/Rejected/selected/day-assigned Tasks, scheduled Events, booked/unbooked
  flights, home endpoints, mixed-mode inter-visit travel, DST, unknown data, and
  conflicting plans. Preserve supported extensions and semantic identities.
- Test pure state-1/action/state-2 transformations with explicit time, IDs and
  provider evidence. Keep persistence and provider work behind interfaces.
- Exercise concurrent independent edits, same-resource conflicts, dependency races,
  atomic cleanup, and a snapshot read concurrent with a multi-row mutation.
- Verify authorization, stale-assessment labels, interrupted refresh, and complete
  offline reading without issuing component GETs.
- Measure compressed bytes, server assembly time and client hydration on realistic
  fixtures before setting release performance thresholds.
- Evaluate the new read endpoint for MCP exposure; continue to omit credentials and
  map/provider proxy capabilities from MCP.

## Standards used

- [Schema.org Trip](https://schema.org/Trip), [Flight](https://schema.org/Flight),
  [FlightReservation](https://schema.org/FlightReservation),
  [LodgingReservation](https://schema.org/LodgingReservation).
- [JSCalendar](https://www.rfc-editor.org/rfc/rfc8984.html): native object shapes,
  local calendar times, and extension naming. Application lifecycle, overrides and
  identity mapping in this document are additional profile rules.
- [JSON-LD JSON literals](https://www.w3.org/TR/json-ld11/#json-literals).
- [HTTP If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1).
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).


## Native clients and implementation boundaries

REST authorization accepts an API-audience bearer token as well as the web
session cookie. Public native clients register exact callbacks in
`Mcp:NativeClients` and use authorization code + PKCE S256; see the README for
configuration and token flow. API tokens and MCP tokens have distinct audiences.
A missing session/token returns an HTTP authentication error, never an HTML login
redirect. Resource identity and optimistic concurrency do not depend on user IDs
in browser URLs, cookies, Origin headers or CORS. Existing `/user/...` routes remain
compatibility aliases; canonical traveller resources infer the acting user.

The version 1 snapshot assumes a single party. Existing flight/search REST
representations remain available in resource metadata. Travel editing supports
all transport modes as intent, including date-only/unscheduled journeys and manual
elapsed allowances. It does not add routing providers or integrate new connections
into the destination optimizer. Existing saved routing evidence is exported with
its provenance. Accommodation bookings and ticket numbers cannot be synthesized
from accommodation selection or a user-reported flight purchase flag; the latter
is marked explicitly in its projected reservation.

The web shell uses a production-only service worker, and trip snapshots use a
separate account-scoped local cache. Offline availability on a device requires a
previous successful online load. Offline edits and background synchronization are
outside this milestone. Refresh discards the conflicted editor's draft only when
the user requests it; metadata editing additionally retains the old text for
comparison. Unknown response fields are not a complete-resource PUT contract;
clients submit the documented writable DTOs with their resource ETag.

Travel REST endpoints use `activityId` for a venue and `visitId` for a destination
or its accommodation, preserving repeated visits and deletion behavior. `placeId`
addresses home or an airport. A connection referencing a selected service retains
its canonical service definition (without offers), so deselecting the flight does
not leave that journey with a dangling service or airport reference.
