# Transportation between visits

Trips support flight, train, car, and walking transportation between visits,
including the legs from and to home. Tap a transportation card on the web overview
to open a map drawer with Flight, Train, Car, and Walking choices. Flight embeds the
existing flight planner; hovering or focusing a flight previews great-circle arcs
through its layovers and marks the airports. Car and Walking draw and save Azure Maps routes and duration
estimates. Train searches filter Azure Maps to passenger-rail station categories,
including suburban and metro stations, near the destination. Results retain the
provider's names and relevance order. Matching numbered list results and map pins
share the same selection.
Select both stations and save departure and arrival times
together. Times use explicit time zones and are stored as offset timestamps.
Transportation retains optional GeoJSON route geometry, sequenced steps, and
instructions supplied by richer clients. Each transport connects visit IDs rather
than city names, so repeated visits remain independent. Saved transportation is
available in offline documents with editing disabled.

On iOS, MapKit searches stations and supplies public-transit ETA estimates.
MapKit does not expose full transit route geometry or train-only itineraries;
use **Train directions in Maps** for full directions, or enter train times manually.
Car and walking estimates use the authenticated trip-scoped
`POST /trips/{tripId}/transportation/estimate` endpoint, backed by Azure Maps.
The optional `includeGeometry` request flag returns road/walking route geometry
alongside the duration; iOS can continue requesting duration estimates alone.
The existing transportation MCP tools accept visit IDs and offset times; the
provider estimate endpoint is intentionally not exposed as an Azure Maps proxy tool.

## Transportation resources

**Transportation** records journeys as GeoJSON FeatureCollections. Each journey has
its own ID, ETag, notes, optional requested transport mode, local departure date,
clock time, time zone, and elapsed duration. Its features contain exactly one
`from` and one `to`, plus optional ordered route steps. An endpoint either
references an activity, airport, hotel, or user's home city by typed UUID, or owns
an inline Point with a name and nullable address. References resolve their current
location on reads; clients do not need to create a place first. Route steps have
unique sequence numbers, modes, optional line names, directions, instructions,
durations, and optional LineString/MultiLineString geometry. Notes and instructions
support journeys researched without precise route geometry. No new routing or
booking provider calls are made by these APIs.

`GET/POST /trips/{tripId}/transportation` lists or creates journeys;
`GET/PUT/DELETE /trips/{tripId}/transportation/{transportationId}` reads, replaces,
or removes one complete journey. Replacements/deletions require its current
`If-Match` (`428` when missing, `412` when stale). Creation returns `201`, Location,
and ETag. Linked location changes advance the journey's version; coordinate
changes mark existing routes stale. Submitting changed route steps or explicitly
setting `routeReviewed: true` acknowledges review. A resolved local departure
produces a calendar event; incomplete or ambiguous timing remains a task. The
trip document stores each FeatureCollection under its calendar item's
`transportation` property, preserving GeoJSON's `type` separately from event/task
semantics. Web and iOS adapters reconstruct individual resources and validators
for offline reads and later editing.

PostgreSQL stores one row per journey in `transportation`, with route steps and
metadata as JSONB. `transportation_endpoints` holds typed foreign keys and inline
features, with constraints enforcing one source per endpoint and exactly two
endpoints per journey. Activity and hotel references are constrained to the same
trip. Before deleting a referenced source, database triggers preserve its current
name/address/Point as an inline snapshot. Deletion is blocked if a referenced
source has no usable coordinates; replacing/removing that reference permits it.
Deleting an entire trip still cascades its owned resources.

## Hotel and airport references

Hotels have stable trip-scoped IDs in `hotels`, independent of visits/stays.
`GET/POST /trips/{tripId}/hotels` and `GET/PUT/DELETE .../hotels/{hotelId}` manage
complete hotel resources. Stay selection still uses the visit's `/location`
resource: supply `properties.hotelId` to select an existing hotel, or omit it to
create a hotel and select it atomically from the supplied name/address/Point.
Returned stay features contain `properties.hotelId`. Changing or removing a stay
selection does not delete the hotel or redirect transportation. Deleting a hotel
clears its stay selections and snapshots transportation references.

Airports are persisted in `airports`. Release preparation downloads the public
OurAirports and airportsdata catalogs, joins IATA codes to time zones, validates
the result, and embeds it in the image without modifying the checkout. Startup
upserts that catalog, preserving database IDs and retaining absent airports as
inactive. Retired airports remain readable for saved journeys. Local builds use
the checked-in catalog. The airport search API includes the stable `id` used by
transportation references. Migration `0021` separates hotels from stay selections
and converts existing travel connections to the new resources; obsolete visit
endpoints become hotel references or inline destination points. Existing durations
and segment modes/durations are preserved; old service snapshots are retired.

## Transportation in the daily plan

Travel blocks in the daily Plan open a transportation editor. **View route** opens the map, draws the previewed street route in the selected mode, and frames the path, including travel to and from the visit's stay. Changing the plan or destination clears the selection. Route previews are available to Travellers as well as Planners and do not save the draft. The API derives both locations and the departure from the authorized day's plan; it does not accept arbitrary routing coordinates. This map-only preview is deliberately excluded from MCP tools. Route responses whose start or end is over 500 metres from the requested location are rejected instead of drawn. Azure can return coarse paths on sparse road coverage in Japan; a successful HTTP response does not establish a usable street route there.
