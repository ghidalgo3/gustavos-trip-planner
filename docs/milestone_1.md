# Milestone 1: Collaborative trip planning and ranked flight suggestions

Status: Living design document; implementation is in progress.

Last updated: 2026-09-22.

This document records the agreed product behavior, the proposed planning architecture, and unresolved questions. Confirmed decisions are requirements. Recommendations and open questions are explicitly labeled and should not be treated as settled behavior.

## 1. Goal and scope

Build a social travel-planning website where users iteratively define a trip, collaborate with other travelers, express requirements and preferences, and ask a scheduling system to produce ranked flight suggestions using Ignav fare data.

Milestone 1 supports one destination per plan and round-trip flights. The initial flight planner is good enough for now; the trip also saves a chosen itinerary per party and shows it in a Plans overview. Fare results may offer a provider booking link, but completing a purchase, multi-stop routing, partial-trip travel parties, and planning transport to a shared departure point are outside this milestone.

### Users and trips

- Maintain a persistent PostgreSQL database of users. After first sign-in, collect each user's home city as the default starting point for planning. Autocomplete populated places in the browser with Azure Maps, using a two-hour SAS issued by the authenticated API and limited to 50 requests per second. Store the selected city as a PostGIS geographic point. The user profile page edits the home city and preferred airlines together through `PUT /api/user/profile`; the avatar menu opens that page and contains Sign out.
- Treat the normalized email supplied by Google or Microsoft as the unique application identity. If the same email signs in through another provider, reuse the user ID and append the provider to that user's provider list.
- Start with sign-in through Google and personal Microsoft accounts.
- Sign in with Apple is outside this milestone and may be reconsidered later.
- Users can create, read, update, and delete their trips. A newly created trip needs only a name; destinations and constraints are added iteratively.
- Trip CRUD is exposed at `/api/user/{userId}/trips`. The authenticated application user must match `{userId}`, and database operations are scoped to that owner. Trip creation is available after home-city onboarding is complete.
- The initial `trips` representation stores an ID, owner user ID, name, description, and a JSONB `constraints` object. A newly created trip has an empty constraints object.
- The initial `parties` representation stores an ID, trip ID, and a UUID array of member user IDs. Creating a trip atomically creates one party containing only its owner; deleting the trip cascades to every party belonging to it.
- The trip owner can search existing users by display name and add or remove them from a party. Membership changes are idempotent. The owner remains in their party, a user belongs to at most one party in a trip, and a party has at most nine travelers. Adding a user to the owner's party shares the trip; that user can view its plan while only the owner may edit. Removing a user revokes access.
- A trip owner can invite other users and manage trip membership and membership in travel parties.
- Constraints are defined per user, per trip. Party membership and shared party preferences supplement those individual constraints.
- An `LLM` feature flag on the user enables an optional free-form trip description. The server uses an OpenAI Responses API function call to propose destination, dates, preferences, and requirements, then returns an unsaved draft for review in the same editor. The server enforces the flag and resolves airports and party members rather than trusting model-provided IDs.
- A trip needs a destination, departure date, return-flight date, and a resolved origin to prepare searches. Additional constraints are optional; calendar selections provide bounded dates without requiring departure/return constraints.

### Initial sign-in provider setup

Production and local sign-in are handled by server-side ASP.NET authentication middleware in the API. Azure App Service Authentication is disabled. Provider client secrets must remain server-side in Azure Key Vault and must never be committed, added to the browser application, or pasted into this document.

Before configuring either provider, deploy or identify the API App Service hostname, represented below as `<api-app>.azurewebsites.net`.

#### Google

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and complete the Google Auth Platform branding and audience setup. Use an external audience for a consumer application. During testing, add the intended test accounts.
2. Create an OAuth 2.0 client ID with application type **Web application**.
3. Add both `https://<api-app>.azurewebsites.net/.auth/callback/google` and `http://localhost:5173/.auth/callback/google` as authorized redirect URIs on this same Web client.
4. Record the generated client ID and client secret. The secret is only displayed at creation time; download or copy it immediately to the approved secret store.

Google requires the redirect URI to match exactly. Only basic `openid`, `profile`, and `email` scopes are needed for initial sign-in. See [Google's OAuth web-server guidance](https://developers.google.com/identity/protocols/oauth2/web-server) and [Azure App Service's Google provider guidance](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-provider-google).

#### Personal Microsoft accounts

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/), select **App registrations**, and create a **New registration**.
2. Select **Personal Microsoft accounts only** as the supported account type.
3. Under **Authentication**, add both Web platform redirect URIs: `https://<api-app>.azurewebsites.net/.auth/callback/microsoft` and `http://localhost:5173/.auth/callback/microsoft`.
4. Leave **Implicit grant and hybrid flows** disabled. Under **API permissions**, add the delegated Microsoft Graph `User.Read` permission so the API can retrieve the signed-in user's profile image.
5. On the Overview page, record the **Application (client) ID**.
6. Under **Certificates & secrets**, create a client secret. Copy its **Value** immediately; the portal will not show it again. Use a short expiration and plan rotation before it expires.

The API uses the personal-Microsoft-account issuer `https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0`. This consumer tenant only accepts personal Microsoft accounts. See [Microsoft's OpenID Connect guidance](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc) and [Microsoft account-type guidance](https://learn.microsoft.com/en-us/security/zero-trust/develop/identity-supported-account-types).

#### Project integration

Store these four values in Azure Key Vault under names recognized by the project scripts:

| Provider | Client ID secret name | Client secret name |
| --- | --- | --- |
| Google | `google-client-id` | `google-client-secret` |
| Microsoft | `microsoft-client-id` | `microsoft-client-secret` |

Run `scripts/secrets set-auth` to store all four values, `scripts/secrets status` to verify their presence without displaying them, and `scripts/release` to configure the API's Google and Microsoft handlers.

#### Localhost development

The same server-side provider handlers own production and local authentication. Vite proxies the local authentication routes so the browser stays on `http://localhost:5173`.

Each provider registration therefore needs two Web callback URLs:

| Provider | Production callback owner and URI | Local callback owner and URI |
| --- | --- | --- |
| Google | ASP.NET Google handler: `https://<api-app>.azurewebsites.net/.auth/callback/google` | ASP.NET Google handler: `http://localhost:5173/.auth/callback/google` |
| Microsoft | ASP.NET OpenID Connect handler: `https://<api-app>.azurewebsites.net/.auth/callback/microsoft` | ASP.NET OpenID Connect handler: `http://localhost:5173/.auth/callback/microsoft` |

The callback paths are application-defined in `Program.cs`; Vite exposes and proxies them on port 5173. The browser initiates either flow at `/.auth/login/google` or `/.auth/login/aad`. These sign-in entry points are separate from the callback URLs registered with Google and Microsoft.

Run `scripts/server` to retrieve the four authentication values from Azure Key Vault and start Docker Compose. The values are passed through the script process only to the API container; they are not written to an `.env` file or exposed through Vite. Running `docker compose up` directly leaves local authentication disabled.

The API issues an encrypted HTTP-only cookie after provider sign-in in both environments. The production API container also serves the React application, so the UI, authentication callbacks, and API share one origin.

### Travel parties and authority

- For this milestone, traveling together means the whole trip: the same outbound and return flights, including every connecting segment, and the shared destination stay. This supersedes the earlier idea of supporting selected portions of a trip.
- All members depart from the trip owner's home city, regardless of their own saved home cities. The owner can change the suggested departure airport in the trip editor. Positioning travel to that airport is outside this planner's scope.
- Each travel party has one shared preference set and a travel leader. Individual mandatory requirements still apply to every proposed party itinerary.
- The party leader accepts proposed constraint changes. The system must not silently relax mandatory requirements.

## 2. Constraint semantics and input

Support both structured input and natural language. An agentic translator using the OpenAI API will translate natural language into structured constraints.

Examples include required presence at the destination, departure and return flexibility, traveling with another user, nonstop-only flights, airline preferences, and excluded layover locations.

| Concept | Agreed meaning |
| --- | --- |
| Required presence in City A between X and Y | Arrive on or before X and depart on day Y or later, using destination-local dates. |
| Date flexibility | Apply independently to departure and return. |
| User-facing return date | The day the flight home begins. It maps directly to Ignav's return date; arriving home may be on a later day. |
| Date input | Accept either preferred dates with a separate ±N-day flexibility for each end, or explicit earliest/latest departure and return windows. |
| Direct flights | Nonstop flights. |
| Layover exclusions | Support an airport, city, country, or named region such as “Middle East.” |
| Traveling with another user | Share the entire round-trip flight itinerary and destination stay. |
| Mandatory constraints | Exclude violating itineraries; suggest explicit relaxations when needed. |
| Preferences | Rank feasible itineraries using the travel party's shared preferences. |

A required presence interval is not a departure/return search window. For example, presence in Paris June 10–12 permits arrival much earlier and departure much later unless additional bounds are supplied.

Flight departure dates alone cannot establish presence compliance. Returned arrival and departure timestamps must be checked, including overnight flights and time-zone changes. A return flight's departure date is also distinct from its arrival date back home.

### Recommended normalization behavior

- Preserve the original input, constraint owner, scope, and structured interpretation so explanations can refer to what the user entered.
- Separate mandatory requirements from preferences. Do not discard contradictions while normalizing input.
- Show natural-language translations for confirmation before they affect planning; clarify ambiguous dates and locations.
- Give named regions inspectable country definitions and retain the interpretation used by an existing constraint.
- Keep natural-language interpretation separate from deterministic constraint validation and fare scoring.

These normalization and confirmation details are recommendations, not yet fully specified interfaces.

## 3. Planning pipeline

The intended pipeline is:

**Normalize constraints → validate parties and requirements → enumerate bounded candidate date pairs → select up to the configured limit → retrieve cached or fresh fares → validate actual itineraries → rank feasible results per party.**

### A. Normalize and validate

Translate input into predicates that can be evaluated by the solver. Check for contradictory requirements and unresolved party membership or origin information before spending on fare searches.

Users who must travel together can be treated as one search party once membership and a shared origin are resolved. Combine their mandatory requirements and apply the party's shared preferences.

Whole-trip togetherness is transitive: if A must travel with B and B with C, their requirements imply a common party. How such requests reconcile with the owner's authority to manage membership remains an open question; do not silently move users between parties.

### B. Generate candidate dates

Use a constraint solver to derive departure/return date pairs within the supplied bounds. Eliminate combinations ruled out by known date constraints before applying the search cap.

These pairs are candidates, not proof of flight feasibility. Actual flight times and other itinerary details are only available after fare retrieval. Do not claim that date-level feasibility guarantees satisfaction of the required destination stay.

The prototype uses bounded date enumeration in C# behind `ISearchPlanBuilder`.
It intersects each party's departure and return-flight windows and retains
requirements needing flight-level validation. No external solver library is
required for this initial finite search.

### Constraint editor and bounded search preparation

- The trip's existing JSONB `constraints` column holds a format-versioned document:
  one destination, selected travel dates, automatically detected user time zone,
  settings per persisted party, and identified optional constraints scoped
  to individual travelers. This format version is not trip revision history.
- The owner can save incomplete drafts. Planning validates the displayed inputs
  without requiring a separate save. Date contradictions are returned as HTTP 400
  issues; malformed inputs and references to users or parties outside the trip are
  also rejected with a 4xx response.
- Structured input covers departure and return-flight windows (either explicit
  bounds or preferred dates with independent flexibility), presence at the one
  destination, whole-trip togetherness, nonstop flights, and layover exclusions.
  Airline preferences belong to the party and are reserved for later fare scoring.
  The initial AI-assisted translator can propose these fields as an unsaved draft
  when the owner has the `LLM` flag; deterministic validation still governs saving
  and planning.
- The initial form asks for a destination and departure/return-flight calendar dates.
  With no date-window constraints, those dates are fixed. An optional window replaces
  the fixed date for its direction; multiple members' windows are intersected.
  Its preferred date, otherwise the selected calendar date, anchors selection.
  Legacy documents containing only windows still load and can be planned.
- Airport autocomplete accepts city names, airport names, and IATA codes, backed by
  a bundled scheduled-passenger-airport catalog (OurAirports plus airportsdata time
  zones). A city selection includes its matching catalog airports, while a named
  airport remains specific; the user may add or remove individual airports.
  Search is debounced, cancelable,
  and cached in the browser; it makes no paid provider requests.
- Every party gets suggested departure airports from the trip owner's saved
  coordinates: prefer a large airport within 75 km, otherwise the nearest passenger
  airport within 250 km, then include the catalog airports in that city.
  This is editable. If no catalog airport is nearby,
  the owner chooses a departure airport explicitly.
- No one enters time zones. The client detects the current browser zone with
  `Intl.DateTimeFormat().resolvedOptions().timeZone`. Date inputs use local calendar
  values; airport zones are supplied automatically for flight-date calculations.
- Cabin, pricing market, maximum journey hours, preferred airlines, and all
  optional constraint editors are behind **Advanced** in the destination-and-dates
  section, grouped by party where applicable.
- Each party can also cap the provider search at zero, one, or two stops. A
  mandatory nonstop constraint overrides that cap with zero stops.
- A configurable maximum duration per direction (default 48 hours,
  including connections; allowed range 1–168) is an additional mandatory
  requirement checked on actual flights. This default is a prototype choice.
- Return dates are supplied directly to Ignav as the date the return flight
  departs. Candidate requests are deduplicated by outbound/return-flight date
  pair. Date-level feasibility is conservative: it does not assume flight
  schedules, travel time, or a guaranteed arrival day. Required presence and
  actual arrival back home must still be checked against flight timestamps.
- Only future/today outbound dates are included, using the origin's local date.
  Each individual input window spans at most 366 days, with dates in 2000–2100;
  at most 100 constraints and 20 parties are accepted in the prototype.
- Each party member currently counts as one adult passenger; parties above nine
  members are blocked. Guests, children, and infants need a later traveler model.
- A named layover region must include an explicit country-code definition.
  City and country exclusions are preserved as pending checks until airport
  geography is resolved during fare evaluation. Preferences never become hard
  provider airline filters.
- The server prepares selected versus eligible date-pair counts, pending flight
  checks, exact request bodies, and SHA-256 cache
  keys for the normalized provider request and endpoint as part of the asynchronous
  planning operation. The client presents the operation and its results rather than
  exposing a separate preview action.
- Trip revision history and persisted planning snapshots are deferred to
  [later milestones](later_milestones.md).

### C. Search and persist fares

For each selected date pair and travel party, call the Ignav round-trip fare API unless suitable fresh cached results already exist.

Persist fare-search requests and responses separately from their party-specific evaluation and scores. This allows reuse and rescoring when changed constraints do not require different fare data.

### D. Validate and rank

Check returned flight segments against every mandatory requirement, including presence dates, nonstop requirements, layover exclusions, and party togetherness. Rank only feasible itineraries using cost and party preferences such as stops, duration, and airline preference.

Return an ordered list for each party. Independent party ranking is sufficient under the current model, which has no additional coordination constraints between separate parties.

The ranking formula, preference weights, and tie-breaking rules remain open.

The first itinerary validator runs on every flight-search GET, without changing
the cached Ignav response. It checks requested airports and flight dates,
destination-local arrival and return-departure dates, every party member's
date windows and required stay, nonstop and stop limits, total journey duration,
and excluded layover airports, cities, countries, or explicit region countries.
Missing provider fields or uncataloged layover geography mark an itinerary
unverifiable. Only eligible options appear in the current price and airline
highlights; excluded and unverifiable options remain inspectable with reasons.
Booking links are refused when an itinerary no longer qualifies under the
saved requirements. Unsaved edits hide existing suggestions; saving reloads
their evaluations, or asks for a new search if the required fare cache is missing.
This is eligibility validation, not the final scoring model.

### E. Explain outcomes

Distinguish:

- Contradictory modeled requirements.
- No matching fares among the dates searched and options returned.
- An incomplete search caused by API failures.

Only the first establishes a conflict in the modeled requirements. Empty or limited provider results do not prove that no real-world itinerary exists.

When suggesting a relaxation, identify the affected requirements and users and have the party leader accept the change before applying it. The policy for choosing which relaxations to suggest remains open.

## 4. Search-cost policy — agreed initial behavior

- Default to **20 date pairs per travel party per planning run**. Make the limit configurable so it can be raised or lowered later.
- Filter out pairs violating known date constraints before applying the cap.
- If more pairs remain, select those closest to the preferred departure and return dates. Distance is the sum of the absolute departure and return deviations in days.
- For explicit windows without preferred dates, use the selected travel dates as ranking anchors, falling back to window midpoints for legacy documents.
- A selected pair with sufficiently fresh cached fares counts toward the 20-pair coverage limit but requires no new fare-search call. The cap limits searched pairs, not just cache misses.
- Show coverage, for example: “Searched 20 of 81 eligible date pairs.” Distinguish selected, completed, and failed searches where necessary.
- Date proximity chooses which pairs to search. It does not by itself determine the final ranking of returned fares.

Five possible departure dates and four possible return dates produce 20 pairs. Flexibility of ±4 days at both ends produces 9 × 9 = 81 pairs before filtering; ±5 days produces 121. Wider flexibility remains allowed, but only the closest pairs up to the cap are searched.

This policy can miss cheaper fares farther from the preferred dates. The interface must describe results as the best options found within the searched subset, not an exhaustive optimum.

For the prototype, proximity sums deviations from each member's preferred dates
(or selected travel dates, falling back to window midpoints for legacy drafts).
Ties use outbound departure date, then return departure date, ascending.
The configured `Planning:DatePairLimit` defaults to 20 and is bounded to 1–200.
The cap applies to distinct provider date pairs. Each selected date pair expands
into one Ignav request per distinct origin/destination airport combination;
multi-airport choices therefore increase the request count and cache entries.
Automatic replacement of failed or empty searches is not yet specified.

## 5. Ignav integration and caching

The following findings were checked against Ignav's public documentation on 2026-09-19:

- Round-trip results contain outbound choices and compatible returns, not every possible flight combination. Search prices are not reserved fares or guarantees of one combined ticket. See the [round-trip API documentation](https://ignav.com/docs/round-trip).
- Requests include origin, destination, dates, passenger counts, cabin, pricing market, and optional filters. Passenger composition matters; a single-passenger search multiplied by party size is not an equivalent group search. The documented maximum is nine passengers per request. See the [request parameters](https://ignav.com/docs/one-way).
- Ignav recommends caching identical fare searches for minutes and avoiding cached results older than a few hours for live fare use. Empty itinerary lists are valid successful responses. See the [production and caching guidance](https://ignav.com/docs/production-checklist).

### Implemented asynchronous search execution

The Plan action now saves the current constraints, queues real Ignav round-trip calls,
and returns HTTP 202 with a polling URL. Operations belong to their initiating user
and identify the trip as their resource; client polling is internal to the interface.
The browser displays progress and can recover work when the trip is reopened. Types
are explicit (currently `flightSearch`); statuses
are `pending`, `InProgress`, `Completed`, and `Failed`, with progress counts
`items`, `completedItems`, and `failedItems`. Partial successes remain available.

A .NET BackgroundService uses PostgreSQL as its durable message queue. The generic
`operations` table stores only scalar status and progress fields. `fare_searches`
stores normalized provider requests, cached responses, and queue leases; there is no
operation-items table. Enqueue and operation creation are atomic; lease claims use
SKIP LOCKED and fenced completion. Successful responses, including empty results,
are cached for one hour after retrieval; errors are not cached. GET derives required
cache keys from the trip's current constraints and returns 404 when the cache is
incomplete or expired. Request IDs make HTTP submission retries idempotent.

The API key is stored as `ignav-api-key` in Key Vault, set with
`scripts/secrets --set-ignav`. Default concurrency is two requests per API instance;
default provider timeout is eight minutes, with a ten-minute recovery lease.
Interrupted work can retry up to three provider attempts. Provider failures/timeouts
are surfaced rather than blindly retried. A crash between provider success and durable
completion may repeat a billed request: execution is at least once, not exactly once.

The one-hour freshness window is separate from storage retention. An hourly
pg_cron job deletes fare-search rows six hours after their successful retrieval,
or six hours after creation for a request that never produced a response. Rows
assigned to an active operation are protected until the operation completes.

Raw provider responses remain cached. Flight-search GET adds a transient
per-itinerary eligibility result and reasons based on the saved trip. Full
preference scoring and ranked recommendations remain follow-up work.

The trip page now has route-backed Flights, Stays, and Plans tabs. Stays is a
placeholder; Plans shows the trip description and selected flight for each party.
The owner may select, replace, or clear one itinerary per party through
`/api/trips/{tripId}/selectedFlights`. Selecting requires an eligible itinerary
from the trip's current fresh fare cache. `trips.selected_flights` stores a JSONB snapshot of
the search request and itinerary independently of cache cleanup. The choice
remains visible after fares expire and is not a booking.

### Recommended cache design

- Identify reusable searches by their normalized provider request, including every parameter that changes results; do not key only by dates or party ID.
- Store retrieval time and enough request provenance to explain coverage. Separate historical persistence from eligibility for fresh-price reuse.
- Re-score existing results when only ranking preferences change and the cached search still covers the required request.
- Re-evaluate mandatory constraints against cached itineraries when possible. Relaxing a filter used in the original API request may require a new search because excluded fares were never retrieved.
- Do not assume a broader provider search is exhaustive or equivalent to a narrower follow-up query.
- Deduplicate identical in-flight requests and reuse eligible results across runs where appropriate.

Cache freshness is one hour and row retention is six hours, cleaned hourly by
pg_cron. Initial worker concurrency and recovery behavior are defined above.
Richer retry policies, provider-filter strategy, and handling of parties larger
than the provider's passenger limit remain open. The 20-pair cap is not a
complete budget for retries, ancillary API calls, or repeated planning runs.

## 6. Remaining decisions

| Area | Unanswered question or recommended direction |
| --- | --- |
| Membership conflicts | What happens when a “travel with” constraint disagrees with assigned parties? Recommendation: flag the conflict for the owner rather than moving users automatically. |
| Party lifecycle | Who appoints or replaces the leader? How are unassigned travelers handled? |
| Permissions | Who can edit individual constraints, shared preferences, and the destination, or initiate paid planning runs? |
| Relaxation authority | The leader accepts changes, but do affected members also need to approve changes to their individual mandatory requirements? |
| Ranking | How should price, stops, total duration, and airline preferences trade off? What is the stable ordering for tied scores? |
| Relaxation selection | Prefer fewer changed rules, fewer shifted days, user-assigned importance, or another measure? |
| Location resolution | Bundled airport autocomplete and geographic owner-home-airport suggestions are implemented. Later: catalog refresh automation and richer metro-airport grouping. |
| Date precision | Are airport arrival/departure dates sufficient, or will users need times of day and airport-to-city travel buffers? |
| Natural-language translation | The first form proposal and review flow are implemented. Later: multi-turn clarification, richer ambiguity handling, and unsupported requests. |
| Region definitions | Choose the geographic source, inspectable membership, and versioning behavior for named areas. |
| Travelers | Must all passengers have accounts? Are guests and children supported? |
| Accounts and invitations | Google and personal Microsoft accounts are linked by normalized email. Define invitation acceptance, discovery, and visibility of user profiles and trip constraints. |
| Remaining persistence | Users, trips, parties, the JSONB constraints document, operations, queue messages, and cached fare responses are durable. Eligibility is computed when reading fares; full preference scoring remains to be implemented. |
| Concurrent edits and history | Trip revisions and persisted input snapshots are deferred to later milestones. Concurrent saves currently use last-write-wins. |
| Search operations | One-hour cache, six-hour fare-row retention, bounded worker concurrency, timeouts, partial results, and recovery leases are implemented. Define limits across repeated runs. |

## 7. Scenarios to validate when implementing

- Create a trip with only a name; add its destination, members, and constraints later.
- Combine individual mandatory constraints within a party and explain contradictions without relaxing them automatically.
- Suggest the trip owner's home airport for every party without planning members' positioning travel.
- Convert both date-input styles into bounded ranges and apply departure and return flexibility independently.
- Reject an overnight flight that arrives after X even when its departure date appeared acceptable.
- Select the nearest 20 eligible pairs, reuse cached selected pairs, and disclose limited coverage.
- Re-score after a preference change without a new fare call when cached data remains suitable; search again when the needed request changes.
- Enforce nonstop and airport/city/country/region layover exclusions using actual itinerary segments.
- Keep contradictory requirements, no returned matches, and provider failures as distinct outcomes.
- Require explicit leader acceptance of proposed relaxations and avoid presenting stale-input results as current.

## 8. Maintaining this document

Update confirmed decisions and the corresponding open questions together as the design evolves. Keep recommendations distinguishable from accepted requirements. Record substantive scope changes here rather than relying on conversation history.
