# Flight planning

Define destinations and visit dates on **Overview**, and manage party members through **Share** at the top right of Overview. New members default to **Traveller**; the owner can choose **Planner** when adding a member or change an existing member’s role. The member `PUT` accepts `{ "role": "Traveller" }` or `{ "role": "Planner" }`; a legacy empty request defaults to Traveller. Roles persist per party member, and demotion removes planning access. The destination drawer owns `properties.constraints.arrivalFlexibilityDays` and `departureFlexibilityDays` (independent ±0–5 day windows) with a fixed destination order. Legacy `keepAfterPrevious` values are accepted but no longer allow reordering. These city constraints apply to every visit, including repeat visits. Existing unrelated destination constraints are preserved when editing these controls.

**Plan Flights** opens `/trips/{tripId}/flights`, which contains the flight search and selection card. It has no separate party, destination, date, advanced-constraint, or AI trip-description form. Search validation issues offer a return to Overview. Home airports come from the trip owner's profile; airline preferences initialize the search settings. Preferred airlines affect ranking rather than excluding other carriers.

The API derives the effective flight document from the current destination resources on every constraints read, search, result read, booking lookup, and selection. Stable stay IDs identify planned visits. Dates determine the same chronological order shown on Overview, with stored visit order breaking ties. Flight searches always preserve that sequence, including repeat visits. Destination coordinates and country select nearby catalog airports. Date flexibility applies independently to local arrival and departure, including validation of actual returned flights. Changes take effect without saving a second planning document. Existing API clients with flight-only trips can still use their stored flight documents until destinations are defined.

**Find flights** prepares a bounded set of provider requests and queues Ignav calls. Invalid requests return HTTP 400 with planning issues; accepted searches return HTTP 202 with a polling URL. There is no destination-count limit. The total-trip search window is derived from the stays, including trips longer than 60 days. Airport catalog sources and home-airport selection rules are in [Data/README.md](../src/TripPlanner.Api/Data/README.md).

The browser supplies the current user time zone through
`Intl.DateTimeFormat().resolvedOptions().timeZone`; there is no time-zone input.
Airport time zones come from the catalog and are used internally to handle
overnight travel and date-line crossings. Calendar values remain date-only strings.
Planning combines party members' requirements, explains missing inputs and
conflicts, and uses `Planning:FareRequestLimit` as the sampled fare-request budget per
party (default 160), increasing it to at least one request per leg for longer routes. Multi-destination searches reserve request slots across
all legs before paired fares. `Planning:DatePairLimit` defaults to 40 for round-trip date
candidates before airport expansion. Fresh cache hits conservatively count toward
the request cap, so actual provider calls can be fewer. The return-flight date is the date the flight home begins and maps directly
to the provider request's return date. The API validates actual itinerary timing,
required presence, journey duration, and layover geography when reading cached fares.

Route planning shares dated legs across candidates and queries one-way fares plus
paired outbound/homebound open-jaw fares through Ignav's flexible endpoint. It
prioritizes first-leg searches and returns per-column provisional flights alongside complete itineraries as searches finish. A first-leg choice carries into the complete-route picker when a
compatible itinerary is found. It
combines complete offers, validates actual flight times and all stays, and ranks
complete itineraries by price, stops, preferred airlines, home airport, and travel
time. Separate tickets between stays are allowed and labeled; self-transfer
connections are excluded. Results are a bounded sample, not a guarantee of the
cheapest possible itinerary. The same asynchronous flight-search operation,
one-hour cache, and selected-flight JSONB booking data serve both planning modes.
On phones and larger screens, route results show horizontally scrollable destination columns plus a return-home column. Phone columns stay 240–300px wide, with horizontal swipe scrolling and gentle column snapping; the rest of the page stays within the screen. Filters and selection actions wrap above the grid, and controls have larger touch targets. Each arriving flight card has a stable identity within its visit, including repeat destinations. Selected flights sort first. The split sort button orders the remaining cards by price, departure, arrival, or duration in either direction; unknown values stay last. Flight numbers for every segment appear below the airline name. Hover or keyboard focus draws and highlights complete server-validated paths containing that flight; alternatives in a column with a chosen flight do not trigger highlighting. Once all flights are chosen, their connecting line remains visible without hovering, including restored choices whose current search graph is unavailable. This line shows the chosen sequence; route feasibility is still assessed separately. Provisional flights show when no complete route has been found. Compact connection graphs preserve every valid path among the returned flight cards for any number of visits, independently of price ranking. Separate outbound fare contexts preserve bundled returns, currencies, and whole-trip duration constraints. Shared connection indexes avoid repeating flight details or enumerating every combination. At least one complete itinerary is retained for each compatible flight. Multi-stop hover reports connected flights instead of counting only the sampled itineraries. Card fares come from the cheapest complete path through that flight compatible with the current selections and filters, rather than an unrelated cheapest provider offer. Combined outbound/return fares are labeled explicitly; once both flights are selected, their shared fare appears once and the return says it is included in the outbound fare. Booking links and booked status are managed directly on each card. Flights without a compatible complete path retain their details but show no unverified fare. Graph responses identify bundled returns explicitly so the UI can distinguish their included return from a separately priced ticket. Clicking a card selects only that flight, in any column; clicking it again asks for confirmation before clearing it. Alternatives in selected columns dim, while other columns retain only flights on complete paths compatible with all selections. Each flight selection is saved immediately, including partial selections made out of order. A card’s **Booking Link** button and **Booked** switch use saved booking details, including partial selections. Preferred airlines have a **Preferred Airline** tag. When every selected leg forms a valid route, the complete itinerary is saved automatically for Plans and activity availability. Filters remain local. **Clear selections** reopens the grid after confirmation. Replacing a saved choice also requires confirmation. The cost slider’s minimum and maximum update from complete paths compatible with the current selections, airline filter, and stops filter as results arrive. Its own price cap does not shrink those bounds; a previously set cap is clamped to the updated range. The maximum total-trip-cost slider uses graph fare costs (charging each bundled fare once), rather than individual card prices or the sampled itineraries. Stops (nonstop, one, or two-plus) and airline multiselects apply to every flight/segment in the path; currencies are filtered separately. Forward/backward minimum-cost searches enforce the cap again when hovering or adding selections, so separately affordable branches cannot form an over-budget highlighted path. Search responses retain the complete weighted graph after selections are saved. Fluent UI skeleton cards appear in empty columns and below arriving results until the search finishes.

Hover queries reuse a prepared graph with integer flight indexes and reusable cost buffers. Card content is memoized separately from highlight classes, and detailed flight information mounts only when expanded. A stable resize observer caches each card's geometry; pointer movement does not reread layout. All highlighted connections are drawn as subpaths in one SVG path, and highlighting has no fade animation. Geometry is refreshed when results, filters, selections, expanded details, or viewport size change.

The sequential picker remains a fallback for older planning data without destination visits. It shows airline names, flight numbers, layover airports and durations, and airline booking options for the current flight. In either layout, failed saves restore the previous selection and show the server's error beside the flights. Each saved choice also
recomposes complete routes around
the chosen flights from cached and retained fares, so the global result cap does not hide
later-leg alternatives. This does not make another Ignav request while the
cache is fresh. The server verifies each choice against its cached or previously retained fare and
uses that fare's searched cities to identify and prioritize the next leg, even
when Ignav returns a different airport within a city.
Partial choices store server-owned provider offers alongside nullable flight keys and stable origin/destination visit IDs in the existing `flight_choices` JSONB resource. After a stop is inserted, deleted, reordered, or redated, reads reconcile choices against the current visits before rendering, composing routes, booking, or skipping searches. Older choices without visit IDs are recovered only when retained search endpoints and local flight dates identify one current leg unambiguously. Unchanged flights, including the return home, move to their current columns. Flights that no longer fit are retained in a review notice and excluded from the active route; unrelated saves preserve their offers and purchase records. **Clear selections** removes both active and displaced selections after confirmation. No database migration or provider search is required. Only offers containing a chosen flight are retained; paired offers stay indivisible. Opening Flights immediately restores selected cards from saved flight details, even after the one-hour search cache expires and while search-status or result requests are pending or fail. New search results merge with these cards without duplicating them; displaying a retained selection does not imply a newly validated route or refreshed quote. The trip overview also reads these saved partial selections and shows their flight numbers between the corresponding destinations, including a return chosen first. It uses retained flight details without starting a fare search; current choices, including reconciled empty choices, take precedence over that party’s older complete itinerary, while unselected legs remain links to plan flights. Subsequent searches queue only unselected legs and omit bundled searches that would repeat a selected leg. Clearing a choice releases its retained offers unless another selected flight still needs the same bundle, and makes that leg searchable again. No automatic provider search is needed to restore saved cards. The retained amounts are saved quotes; airline booking prices and availability may change. Flight cards show provider-confirmed prices without a verification tag. Unverified or missing verification status (including older saved quotes) displays “Price unconfirmed” without an amount. Only explicitly verified prices contribute to displayed trip totals, cost filters, and price differences; unpriced flights remain selectable. Grid columns keep selected flights first. A split sort button selects price, departure, arrival, or duration from its menu; its main button reverses the current direction. Missing values and unconfirmed prices stay last. The return column shows its planned or selected departure date (or the available date range). Grid flight details show a compact per-segment aircraft/operator summary. Verification describes the provider’s quote at retrieval, not a price guarantee at checkout. Each grid card has an on-demand **Booking Link** button. Chosen flights also show a **Booked** switch, enabled once their booking details are saved. Preferred airlines carry a tag directly on their cards. The grid saves choices immediately and has no separate review section. Selecting all legs also saves the server-validated complete itinerary for Plans and activity availability; changing or clearing choices removes any old complete route until the new choices form a valid complete itinerary. Booking links display the provider fare name and total price, with a compact difference badge such as `+$150` or `−$50` beside the name. The badge compares the original quote for the same flights and currency; its tooltip and accessible label retain the full comparison. Distinct fare products remain visible even when they share a URL. Shared bookings show separately priced direction links when returned; these are labeled by flight and are not compared against the whole round-trip quote. Missing names, prices, or comparable quotes are stated explicitly. The labels use Ignav’s [per-link fare metadata](https://ignav.com/docs/booking-links), without guessing fare brands or currency conversions. A one-way booking works before the rest of the route is selected or a complete path exists. A shared outbound/return offer becomes bookable only after both flights are selected; both cards expose the shared booking link and Booked state; changing either switch updates the whole booking. Purchases store server-validated provider offer IDs in the same `flight_choices` JSONB resource, survive cache expiry and reloads, and keep pricing tied to the purchased offer. Deselecting either half releases the shared purchase status. Saving a complete itinerary carries these statuses into Plans; subsequent purchase edits stay synchronized when the complete itinerary and flight choices match.
The reusable flight card labels each endpoint with its city and airport code,
for example Atlanta (ATL) → Phuket (HKT). In the sequential fallback, a flight-step TabList shows the
current leg, chosen legs, and upcoming legs. Known legs show their airport
codes. Earlier tabs reopen those choices when a paired fare or route constraint
narrows the returns. The completed route separates flights with the number of
nights between local arrival and departure dates.
The route price shown with each option is the total trip price; paired fares
cannot be priced leg by leg. Cards on the cheapest complete route carry a
badge; any flight leg using a travel party's preferred airline carries a
separate **Preferred Airline** badge. After choosing the last flight, review
the route and save the complete itinerary. **Deselect itinerary** below the
save action clears the saved itinerary and flight choices so selection restarts
at the first flight using the available results. Only HTTPS airline-direct
links returned by Ignav are shown; third-party seller links are omitted.
The Plans overview also shows airline booking options for each leg of a saved
route using cached or retained provider offers. If the provider no longer recognizes a retained offer, deselect that flight and run **Find flights** again to obtain a new offer.
Saving a complete route sends its leg identifiers and displayed price alongside the result key and index. The API resolves that quote against cached or retained, validated results, so additional search results cannot invalidate an unchanged selection. Changed flights or prices require reviewing the current results. The picker recognizes saved flights independently of temporary cache keys and result ordering, preserving its selected state and purchase indicators across refreshes.

The owner can mark each flight as purchased on the saved route or in Plans;
those booleans persist in the trip's selected-flight JSONB booking data. Flights in a shared booking change purchase status together. Travel
companions can see the status but cannot change it. Prices include a local
currency symbol alongside the currency code, such as USD $900.

This prototype counts each account holder as an adult passenger. Language-model suggestions and research are supplied by the connected user agent.
Invitations and full preference scoring are subsequent
steps. See [Milestone 1](necessary_slop/milestone_1.md) for limits,
[Milestone 2](necessary_slop/milestone_2.md) for the activity-planning contract and iteration notes,
and [later milestones](necessary_slop/later_milestones.md) for the deferred trip revision history.

## Asynchronous flight planning

**Find flights** saves the displayed planning document, then starts a flight search and
returns immediately after queueing work. The client polls the generic operation API,
so searches continue when the page closes and are discovered when it opens again.
Results show their retrieval time and expiry. The API reevaluates each cached
itinerary against the current mandatory requirements, and the UI recommends only
eligible flights. Rejected and unverifiable flights remain inspectable with reasons;
full preference scoring is still pending.

Each round-trip fare reuses the flight-information card for its outbound and
return legs. The cards show city and airport names, localized time-only segment
times, flight numbers, travel times, and connection durations.
**Book this fare** obtains an Ignav booking link only for that cached itinerary
and opens the provider's booking option in a new tab.

**Overview** uses destination and itinerary links for activities and flights, plus
a **Share** button for party access. Each subpage has its own URL and a breadcrumb back to Overview. An eligible fare can be selected, replaced, or deselected for its party.
`GET /trips/{tripId}/flights` returns saved choices, or 204 when none have been
selected; `PUT` and `DELETE` on `/{partyId}` replace or clear one. The API checks a new choice against
the current cached search and stores an saved itinerary in `trips.selected_flights`,
so the Plans overview still shows it after the fare cache expires. This is a
saved planning choice, not a booking. Stays is currently a placeholder.
`PUT /trips/{tripId}/flights/{partyId}/purchases` saves one
purchase boolean per selected flight. `GET /airports/cities` resolves
airport codes to the city labels used by the flight cards.
Partial route choices are saved in `trips.flight_choices` through
`/trips/{tripId}/flights/choices`, so they survive a page refresh and can
prioritize pending searches for the next leg. Migration `0002` adds this column
without clearing existing trips or purchases.

The JSONB column is part of migration `0001`. Databases that already applied
`0001` need the column added and any old `selected_flights` rows copied into it
before dropping that table.

Set the server-only key, then restart local development:

```zsh
./scripts/secrets --set-ignav
./scripts/server --detach
```

The secret name is `ignav-api-key`; `scripts/secrets set ignav-api-key` also works.
`scripts/secrets status` checks its presence. Local startup loads it from Key Vault
into the API container. Release config supplies `Ignav__ApiKey` using a managed-identity
Key Vault reference, and `scripts/release` checks that the secret exists. The browser
never receives it. No live fare searches are performed by the automated tests.

- `POST /trips/{tripId}/flights:search` accepts `{ requestId: "UUID" }`, reads the
  trip's saved flight constraints, and returns **202**, a `Location` polling URL,
  `Retry-After: 2`, and the operation. Reuse a request ID when retrying an uncertain
  submission.
- `GET /trips/{tripId}/flights/search` derives the required cache keys from the
  current saved flight constraints and returns available fresh Ignav responses. It returns
  404 when none are available, signaling that POST must be run. Multi-city results
  are composed into complete routes as soon as cached searches permit; later
  search results expand the available routes.
- `POST /trips/{tripId}/flights/search/{cacheKey}/bookingLinks` accepts a cached
  itinerary's `ignavId` and returns the provider booking options. It rejects a
  cache key or itinerary that does not belong to the authenticated owner's current
  trip results.
- `POST /trips/{tripId}/flights/choices/{partyId}/bookingLinks` requests airline links for a retained provider offer whose flights are all selected. It works without a complete itinerary and after cache expiry; it rejects unrelated or partially selected offers. `PUT /trips/{tripId}/flights/choices/{partyId}` optionally includes the full `purchasedOfferIds` set, validates non-overlapping whole bookings, and rejects purchase updates against changed selections. Omitting that field preserves still-compatible purchase statuses. Flight booking controls remain REST/UI features, alongside the existing flight APIs; the MCP tools currently cover trip and activity resources.
- `GET /operations?top=50&skip=0&type=flightSearch` lists the authenticated
  user's operations in reverse chronological order. `GET /operations/{id}`
  returns one operation belonging to that user.
- Operations have `type: "flightSearch"`, `status` (`pending`, `InProgress`,
  `Completed`, or `Failed`), and `progress: { items, completedItems, failedItems }`.
  The generic `operations` table contains only its owner, optional resource ID, type,
  status, scalar progress counts, and timestamps. Workers update status and counts;
  provider requests and responses are not stored in operation rows.
- The coalesced `0001_CreateUsers.sql` migration creates `operations` and
  `fare_searches`; there is no operation-items table. Enqueueing an operation and
  assigning its cache misses is one database transaction.
- `PlanningWorker` is a .NET `BackgroundService` hosted in the API process. App Service
  Always On keeps the host running. PostgreSQL `FOR UPDATE SKIP LOCKED` claims a
  request for one worker. Claims use lease IDs so expired workers cannot overwrite
  a newer attempt.
- The cache key is SHA-256 of the normalized provider request plus endpoint. All
  request fields affect it; unrelated preferences and user IDs do not. Successful
  JSON responses (including empty results) are reusable for **one hour from retrieval**.
  Hits do not extend expiry; failures are not cached. Expired cache rows are replaced
  on the next search.
- Two workers run concurrently per API instance by default (`Planning:WorkerConcurrency`,
  1–8). A shared semaphore in the singleton Ignav client limits all provider requests,
  including booking links, to two per instance (`Ignav:MaxConcurrentRequests`, 1–32).
  Provider timeout defaults to 480 seconds (`Ignav:TimeoutSeconds`, 1–1800).
  A lease lasts the timeout plus two minutes. Shutdown/crash recovery resumes after
  lease expiry. Transient network errors, timeouts, invalid provider JSON, HTTP 408,
  429, and 5xx responses retry up to three total attempts with short backoff; other
  provider errors finish the item as failed.
  Processing is at least once: a crash after a paid call but before its database commit
  can require repeating that call. No PostgreSQL transaction is held during HTTP calls.

To include PostgreSQL tests, set `TRIPPLANNER_TEST_POSTGRES` to a connection string
for a dedicated local test database. Include `Search Path=gustavo_planner,public`
and use a role that can create databases and install PostGIS. Some tests write to
the configured database. The queue tests create a separate `planner_test_*`
database, exercise concurrent claims and cache/lease expiry, and remove it
afterward. In-memory tests use `InMemoryPlannerDb`.
