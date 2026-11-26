# REST API reference

## Input contracts

REST endpoints validate request bodies recursively before running handlers. MCP
tools use the same rules at invocation time, and publish them in `inputSchema`
(including nested properties). The development OpenAPI document also derives
string enums and custom formats from these validation attributes. Invalid inputs return HTTP `400` or an MCP error
with `structuredContent.status: 400` and field-specific errors, without saving a
mutation or queuing provider work. Scope, membership, concurrency, and
cross-field/domain checks still run in the existing handlers.

| Input | Contract |
| --- | --- |
| Activity state | Exactly `Yes`, `No`, or `Maybe` (case-sensitive) |
| Activity duration / cost | Duration is null or 1–10080 minutes; cost is nonnegative, with a three-letter currency and `perPerson` or `total` basis |
| Activity text / links | Name 1–200, description 0–10000, place name up to 200 characters; up to 20 absolute HTTP(S) links, URL up to 2048 and label up to 200 characters; URL credentials are forbidden |
| GeoJSON | `Feature` and `Point` literals; exactly `[longitude, latitude]`, finite and within ±180/±90 |
| Destinations / dates | City name 1–150 characters, two-letter country code, recognized optional time zone, ISO `YYYY-MM-DD` dates within 2000–2100; departure cannot precede arrival |
| Destination constraints | Object; arrival/departure flexibility 0–5 and `keepAfterPrevious` boolean when present |
| Trips / profile | Trip name 1–200, description up to 4000; home-city name up to 200; bounded airline/airport codes and valid home coordinates |
| Party role | Exactly `Traveller` or `Planner` |
| Flight planning | Cabin `economy`, `premium_economy`, `business`, or `first`; stops 0–2, journey hours 1–168, flexibility 0–5, trip length 1–36890 days; no destination-count cap; supported constraint/location types |
| Flight selection | Nonnegative itinerary indexes and prices, three-letter currencies, leg identifiers of at most 4096 characters each (null slots allowed for unselected legs in partial choices); choices must match server-owned current or retained fares |
| Activity planning | Proposal kind `draft` or `improvements`; day transport `fastest` (or legacy `walking`), `taxi`, or `driving`; leg overrides `walking`, `taxi`, or `driving`; meals `breakfast`, `lunch`, or `dinner`; clocks ISO 8601 `HH:mm:ss` with zero seconds, allowances 0–1440 minutes, bounded plan arrays |
| IDs / pagination | Nonempty UUIDs; reuse returned opaque destination/context IDs and quoted ETags; operation page size 1–100 and offsets 0–100000; operation filters accept known operation types |
| Authentication / uploads | OAuth parameters remain validated by OpenIddict; login/logout redirects must target local paths or configured origins and cannot contain backslashes/control characters; image uploads retain count, byte-size, MIME-signature, and pixel limits |

Activity states remain strings in storage. Existing custom states are not silently
rewritten; select a supported state before saving an old activity. The website's
state menus offer only supported values. After deployment, refresh the ChatGPT
plugin's tool definitions so it receives the updated schemas.

## Routes

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/health` | App Service liveness probe |
| GET | `/service` | Service metadata |
| GET | `/user` | Current authenticated profile, feature flags, or anonymous state |
| GET | `/user/avatar` | Proxy the current user's Google or Microsoft profile image without storing it |
| PUT | `/user/profile` | Save the authenticated user's complete profile: home city and preferred airlines |
| GET | `/airports/home?city={name}&longitude={longitude}&latitude={latitude}` | Resolve home-city passenger airports for profile selection |
| GET | `/airports?q={query}` | Airport suggestions by city, name, or IATA code (2–100 characters) |
| GET | `/users?query={name}` | Search other users by display name for party selection |
| GET | `/mapToken` | Issue an authenticated two-hour Azure Maps SAS limited to 50 requests per second |
| GET, POST | `/trips` | List visible trips or create a trip with name, description, and optional constraints |
| GET, PUT, DELETE | `/trips/{tripId}` | Read, replace, or delete a trip |
| GET, PUT | `/trips/{tripId}/document` | Portable trip document and metadata-only import; optional validator metadata, gzip, conditional reads; MCP: `get_trip_document` |
| GET | `/schemas/trip-document-v1.json` | Published JSON Schema for the trip document |
| GET, POST | `/trips/{tripId}/transportation` | List or create individual transportation FeatureCollections; MCP: `list_transportation`, `create_transportation` |
| GET, PUT, DELETE | `/trips/{tripId}/transportation/{transportationId}` | Read, conditionally replace, or delete a journey; MCP: `get_transportation`, `replace_transportation`, `delete_transportation` |
| GET, POST | `/trips/{tripId}/hotels` | List or create trip-scoped hotels; MCP: `list_hotels`, `create_hotel` |
| GET, PUT, DELETE | `/trips/{tripId}/hotels/{hotelId}` | Read, conditionally replace, or delete a hotel; MCP: `get_hotel`, `replace_hotel`, `delete_hotel` |
| GET | `/trips/{tripId}/travellers` | Read travellers and roles for the single-party trip |
| GET, PUT, DELETE | `/trips/{tripId}/travellers/{memberId}` | Read membership or conditionally replace/remove it as the owner; actor inferred from authentication |
| GET, POST | `/trips/{tripId}/destinations` | Read destination FeatureCollection or add a destination Feature and initial stay |
| GET, PUT, DELETE | `/trips/{tripId}/destinations/{destinationCity}` | Read or replace the place Feature; delete the destination and its stays, activities, and jobs |
| GET, PUT, DELETE | `/trips/{tripId}/destinations/{destinationCity}/stays/{stayId}` | Replace stay dates or remove one visit |
| GET, PUT, DELETE | `/trips/{tripId}/destinations/{destinationCity}/stays/{stayId}/location` | Read, replace or remove one visit's accommodation |
| GET, POST | `/trips/{tripId}/destinations/{destinationCity}/activities` | Read activity FeatureCollection or create an activity Feature |
| GET, PUT, DELETE | `/trips/{tripId}/destinations/{destinationCity}/activities/{activityId}` | Read, replace, or delete an activity Feature |
| PUT | `/user/{userId}/trips/{tripId}/parties/{partyId}/members/{memberId}` | Idempotently add a traveler to an owned party |
| DELETE | `/user/{userId}/trips/{tripId}/parties/{partyId}/members/{memberId}` | Idempotently remove a traveler from an owned party |
| GET | `/trips/{tripId}/parties` | Read the trip's parties and members |
| GET | `/trips/{tripId}/flights/constraints` | Read the trip's saved flight constraints |
| PUT | `/trips/{tripId}/flights/constraints` | Replace the trip's complete flight constraints |
| POST | `/trips/{tripId}/flights:prompt` | Translate a free-form prompt into proposed constraints asynchronously |
| GET | `/trips/{tripId}/flights/prompts/{operationId}` | Read the completed prompt result for review |
| POST | `/trips/{tripId}/flights:search` | Queue missing or expired Ignav fare searches; 202 with operation polling URL |
| GET | `/trips/{tripId}/flights/search` | Read fresh cached fare results, each identified by cache key; 404 when incomplete |
| POST | `/trips/{tripId}/flights/search/{cacheKey}/bookingLinks` | Read airline booking options for one cached fare |
| POST | `/trips/{tripId}/flights/choices/{partyId}/bookingLinks` | Request airline links for a whole retained booking among the selected flights |
| GET | `/trips/{tripId}/flights` | Read selected trip flights; 204 until a flight has been selected |
| GET, PUT | `/trips/{tripId}/flights/{partyId}` | Select or replace a fare by cache key and itinerary index |
| DELETE | `/trips/{tripId}/flights/{partyId}` | Deselect a party's flight |
| PUT | `/trips/{tripId}/flights/{partyId}/purchases` | Save purchase status for the selected flight's legs |
| GET | `/trips/{tripId}/flights/choices` | Read in-progress route choices |
| GET, PUT | `/trips/{tripId}/flights/choices/{partyId}` | Save in-progress route choices by cache key |
| GET, PUT | `/user/activity-preferences` | Private interests and optional defaults; replacement requires If-Match |
| GET, PUT | `/trips/{tripId}/activity-preferences` | Shared trip preferences |
| GET, PUT | `/trips/{tripId}/destinations/{destinationCity}/activity-preferences` | Shared destination preferences |
| GET, PUT | `/trips/{tripId}/destinations/{destinationCity}/activity-plan` | Complete plan, assessment and input context; conditional replacement |
| POST | `/trips/{tripId}/destinations/{destinationCity}/activity-plan/assessments` | Idempotent persisted assessment, optionally of an unsaved draft |
| POST | `/trips/{tripId}/destinations/{destinationCity}/activity-plan/previews` | Read-only draft evaluation from cached inputs; requires a complete plan and current contextVersion; MCP: `preview_activity_plan` with read scope |
| POST | `/trips/{tripId}/destinations/{destinationCity}/activity-plan/route-previews` | Read-only street path for a travel step in the current draft; requires plan, contextVersion, visit, date and endpoint activity IDs |
| GET | `/trips/{tripId}/destinations/{destinationCity}/activity-plan/assessments/{id}` | Assessment result and status |
| POST | `/trips/{tripId}/destinations/{destinationCity}/activity-plan/proposals` | Idempotent draft or improvement job; never applies a plan |
| GET | `/trips/{tripId}/destinations/{destinationCity}/activity-plan/proposals/{id}` | Progressive alternatives, suggestions and review |
| PUT | `/trips/{tripId}/destinations/{destinationCity}/activity-plan/proposals/{id}/review` | Replace dismissed suggestions using review ETag and Planning-Context |
| GET, POST | `/trips/{tripId}/calendar-subscriptions` | List or create the current member's subscription |
| DELETE | `/trips/{tripId}/calendar-subscriptions/{id}` | Revoke the current member's subscription |
| GET | `/calendars/{token}.ics` | Bearer-authorized saved schedule; no cookie required |
| GET | `/operations?top={top}&skip={skip}&type={type}` | List the authenticated user's operations with paging and optional type filtering |
| GET | `/operations/{operationId}` | Read one authorized operation's status and progress |

In Development, review the interactive API reference at
`http://localhost:5173/scalar` through Vite's API proxy, or directly at
`http://localhost:8080/scalar`. The underlying OpenAPI document remains at
`/openapi/v1.json`.
