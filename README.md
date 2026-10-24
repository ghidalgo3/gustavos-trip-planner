# Gustavo's Trip Planner

Starter architecture for a React single-page application and a C# API deployed to Azure.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/TripPlanner.Web` | React 19 + React Router + Vite + TypeScript + Fluent UI web app |
| `src/TripPlanner.Api` | .NET 10 minimal API |
| `tests/TripPlanner.Api.Tests` | Unit and integration tests grouped by production namespace; [reading guide](tests/TripPlanner.Api.Tests/README.md) |
| `infra/main.bicep` | Azure resource definitions used by `scripts/buildout` |
| `infra/release.bicep` | Runtime and authentication configuration used by `scripts/release` |
| `compose.yaml` | Local Vite HMR and `dotnet watch` environment |
| `scripts/setup` | Install and validate the macOS development toolchain |
| `scripts/install` | Restore .NET and frontend project dependencies |
| `scripts/format` | Format frontend code with Prettier, add required C# braces, and run CSharpier |
| `scripts/buildout` | Provision or update Azure resources |
| `scripts/secrets` | Store and rotate authentication, Ignav, and OpenAI credentials in Azure Key Vault |
| `scripts/server` | Load local auth configuration and start the development containers |
| `scripts/release` | Test, build, configure, deploy, and verify a release |

Users, trips, and travel parties are stored through `IPlannerDb`, with `PostgresPlannerDb` used by the application. The in-memory planner and activity-log stores live in `tests/TripPlanner.Api.Tests/Database`; they are test doubles and are not included in the API assembly. Planner data uses Npgsql; OAuth storage uses Entity Framework through OpenIddict.

Frontend code under `src/TripPlanner.Web/src` is grouped by responsibility:

- `features/activities`, `features/flights`, `features/trips`, `features/party`, and
  `features/profile` contain each feature's components, API clients, and helpers.
- `maps` owns the Azure Maps integration and marker transitions.
- `shared/components`, `shared/hooks`, and `shared/time` hold reusable UI and utilities.
- `api` holds shared API access, `app` holds application composition and theming,
  and `telemetry` holds browser instrumentation.

Tests live beside the modules they cover. `main.tsx` and the global `styles.css`
remain at the source root.

The API's `Services` folders group code by feature: `ActivityPlanning` (assessment,
optimization, enrichment and calendars), `Activities` (idea generation and venue
research), `Flights`, `Destinations`, `Maps`, `TripForms`, and `Jobs` (the shared
background worker). Each folder has a matching namespace. Authentication, MCP
registration, database registration/auditing, hosting, and input validation live
in the corresponding top-level folders.

`ActivityPlanningContext` in `Models` holds the planning inputs and owns the pure
`Evaluate(plan, now)` calculation. Its data is declared in
`ActivityPlanningContext.cs`, with evaluation in `ActivityPlanningContext.Evaluation.cs`.
Manual plans and optimizer proposals use the same method to obtain an assessment.

`PartyRole` and `ActivityState` are C# enums in `Models`. JSON still uses the exact
names `Traveller` / `Planner` and `Proposed` / `Planned` / `Rejected`, including
stored PostgreSQL JSON and MCP tool inputs. Numeric values and unknown names are
rejected. Existing supported values require no database migration.

Activity planning uses `TimeOnly` for local clock times, `TimeSpan` for durations,
and `Microsoft.Spatial.GeographyPoint` for positions. C# uses named `Latitude` and
`Longitude` properties. JSON uses ISO 8601 clock times (`09:30:00`), durations
(`PT1H30M`), dates, and offset timestamps. Fields reflect their values:
`durationMinutes` is now `duration`, `slackMinutes` is `slackDuration`, and the
other duration fields follow the same convention. GeoJSON positions remain
`[longitude, latitude]` arrays. Clock times use strict ISO parsing and the built-in
`System.Text.Json` writer; durations use a converter backed by `XmlConvert`.
Elapsed durations support days, hours, minutes, and seconds, with no calendar
years/months. Optional values remain nullable; planning inputs still require
whole-minute precision. Migrations `0012_IsoClockTimes.sql` and
`0013_IsoDurations.sql` upgrade saved activities, preferences, plans, evidence,
and job results. The website converts ISO durations to minutes for editing and display.
The CP-SAT
adapter converts durations to integer minutes for the solver. Local clock offsets are
kept separate from elapsed time so daylight-saving transitions remain explicit.

The test project also owns the explicit smoke-test commands:

```zsh
dotnet run --project tests/TripPlanner.Api.Tests -c Release -- --verify-solver
# Requires the normal provider configuration in the environment; makes live calls.
dotnet run --project tests/TripPlanner.Api.Tests -c Release -- --verify-planning-providers
```

Normal `dotnet test` runs do not call live providers. See the
[plain-language optimizer walkthrough](docs/milestone_3.md#how-the-activity-optimizer-works)
for how the planner chooses and checks suggestions.

## Local development

Set up the macOS development toolchain, then install the project dependencies:

```bash
scripts/setup
scripts/install
```

The local scripts use zsh. `scripts/setup` targets macOS and installs Azure CLI, Corepack and Node, .NET 10, Git, Docker Desktop, Azure Bicep, and the pinned pnpm version. It does not silently launch Docker Desktop. Check the machine toolchain without changing it with `scripts/setup --check`. `scripts/install` performs no Homebrew or machine setup; it restores the repository's .NET tools and NuGet packages and installs the frozen pnpm dependencies.

After provisioning Azure, storing the provider credentials, and signing in with Azure CLI, start Docker Desktop and run:

```bash
scripts/server
```

The script reads the four authentication values and the Ignav and OpenAI keys from the deployed Azure Key Vault, then issues a 23-hour Azure Maps development SAS with a 50 request-per-second limit. It passes those values only to the API container. It does not create an `.env` file or expose provider client secrets to the React application. The browser obtains the Maps SAS from the authenticated API route. Rerun `scripts/server --detach` if a development session lasts beyond the token expiry. Pass Docker Compose options through the script, for example `scripts/server --detach`; stop detached containers with `docker compose down`.

Open <http://localhost:5173>. Vite proxies application API calls to the API container at `http://api:8080`; editing the frontend triggers HMR, while `dotnet watch` rebuilds and restarts the API without interactive hot-reload prompts. The API is also exposed at <http://localhost:8080>. The web container runs pnpm in noninteractive CI mode so it can reconcile the persistent `node_modules` volume after package-manager upgrades. PostgreSQL 18 with PostGIS 3.6 and pg_cron is exposed at `localhost:5432`, uses the development-only `tripplanner` credentials from `compose.yaml`, and stores its data in the `postgres-18-data` Docker volume. The local database image uses Debian packages for pg_cron. The versioned volume lets PostgreSQL 18 use its required cluster layout while retaining any older `postgres-data` volume for deliberate migration or removal.

Useful commands when Node.js and .NET are installed locally:

```bash
scripts/format
dotnet test GustavoTripPlanner.sln
cd src/TripPlanner.Web
corepack enable
pnpm install
pnpm run lint
pnpm test
pnpm run build
```

Frontend tests use at most two Vitest workers to avoid CPU contention and intermittent UI test timeouts during local development and releases. The default five-second test timeout remains in place.

Running `docker compose up` directly still starts the application, but local sign-in remains disabled because no provider credentials are supplied.

## Database

The API requires `ConnectionStrings:TripPlanner`. Docker Compose supplies a local PostgreSQL connection string with development-only password authentication. In Azure, `buildout` provisions an Azure Database for PostgreSQL Flexible Server with password authentication disabled and assigns the App Service managed identity as its Microsoft Entra administrator. `release` supplies a passwordless TLS connection string and enables managed-identity token acquisition. Npgsql periodically refreshes the database access token through `Azure.Identity`.

At startup, the API acquires a PostgreSQL advisory transaction lock, creates the `gustavo_planner` schema when needed, then creates `gustavo_planner.schema_migrations` and loads and sorts the `.sql` files in `src/TripPlanner.Api/migrations`. Application connections use `gustavo_planner` as their search path, so all application tables and indexes live in that schema. Migration filenames use `0001_MigrationName.sql`; the four-digit prefix is the unique migration version. Applied versions and filenames are recorded in `gustavo_planner.schema_migrations`, and startup fails if an applied version has since been renamed. New migration files are copied into build and publish output automatically.

Run `scripts/drop_db` to permanently drop the production `gustavo_planner` schema. It authenticates with the signed-in user's Microsoft Entra token and requires typing `drop gustavo_planner` before executing the drop. The API recreates the schema and its objects at its next startup, then restores contributor table grants and default privileges. Dropping the schema removes those grants from the old objects; role membership alone does not grant access to tables created afterward.

Migration `0001_CreateUsers.sql` enables PostGIS and creates `users`, `trips`, and `parties`. Each application user has a unique UUID and a unique, lowercase email address. Signing in with another provider that supplies the same email reuses the user ID and adds that provider to the row's comma-separated provider list. The table stores one required display name, a display name for the home city, its location as `geography(Point, 4326)`, and an array of preferred airline codes. Provider subjects, issuer, split given/family names, preferred username, provider verification flags, profile-image URLs, locale, hosted domain, tenant ID, and object ID are not persisted.

The same migration installs pg_cron in the configured `tripplanner` database and schedules `tripplanner-purge-fares` hourly. It removes completed or abandoned `fare_searches` rows six hours after retrieval or creation; rows assigned to an active operation are retained. Azure infrastructure allowlists and preloads pg_cron and sets `cron.database_name` to `tripplanner`. `scripts/buildout` restarts PostgreSQL when a server setting is pending restart, so pg_cron is ready before application migrations run. Editing an already applied `0001` file does not rerun it: databases created before these changes need the updated schema applied during a reset or the new SQL applied separately. The local development database received the `preferred_airlines` and `preferred_airport` columns without dropping its data. Existing cloud databases also need `preferred_airport` applied or a development schema reset; this code change does not deploy infrastructure.

Infrastructure deployment maps the App Service managed identity and a dedicated PostgreSQL provisioning identity into Entra authentication. It creates the `gustavo_planner_contributor` PostgreSQL role and maps the Key Vault operator's Entra object ID to the `gustavo_hidalgo` database login, then grants that login contributor membership. The role can connect to `tripplanner`, create objects in `gustavo_planner`, and read and modify its tables and sequences. `scripts/setup` installs Homebrew's `libpq` client, which provides `psql` for database maintenance.

A trip's editable fields are its name, description, and optional free-form JSON object `constraints` (default `{}`). `/trips` and `/trips/{tripId}` use the authenticated user's identity; Travellers can read shared trips; Planners and the owner can edit trip constraints, destinations, activities, and flight plans. Only the owner can delete the trip or manage party membership and roles. The trip response includes `canPlan` for the current user. `PUT` replaces all editable fields; omitting constraints resets them to `{}`. The existing `/user/{userId}/trips` routes remain compatibility aliases for the current GUI and preserve constraints on metadata-only updates. A new trip and its initial one-person party are inserted in one transaction.

Destinations are Point GeoJSON Features at `/trips/{tripId}/destinations/{destinationCity}`, with their own `properties.constraints` object. Destination stays and activities belong to that city resource. Flight planning is independent at `/trips/{tripId}/flights`; its search document lives in separate `flight_constraints` storage and never appears as trip constraints. Migration `0005` preserves existing flight-search documents in that column. The trip page now starts on Overview; trip-wide date and flexibility controls are a follow-up.

`GET /user` reads the authenticated ASP.NET principal and asks `IPlannerDb` for the user. The database creates the row only when the provider identity is new. The response includes `completedOnboarding`, which becomes true after a home-city geographic point has been stored. Other requests do not write to `users`.

`GET /user/avatar` uses the access token in the current authenticated session to retrieve the profile image from Google UserInfo or Microsoft Graph. The API returns the image without storing its URL or contents; the client falls back to the user's initials when the provider has no image. Microsoft sign-in requests the delegated `User.Read` scope for this lookup.

During onboarding, the client debounces city searches and calls Azure Maps Geocode Autocomplete directly for `PopulatedPlace` results. `GET /mapToken` returns an authenticated, short-lived SAS for that browser call. The API creates each SAS with a two-hour lifetime and an approximate limit of 50 requests per second; the browser reuses it until shortly before expiry. Selecting a result and continuing calls `PUT /user/profile` with a complete `UserProfile` object. If the city has multiple passenger airports, the profile requires a preferred airport; a sole airport is selected automatically. `GET /airports/home` resolves that list from the bundled catalog. City flight searches still include all airports, with the saved airport used as a ranking preference. The same route saves home-city, preferred-airport, and airline changes from `/profile` in one database update. The avatar button opens a menu with **Your profile** and **Sign out**. Preferred airlines initialize the owner's party preferences in newly opened planning documents.

Airline preferences in the profile and the airline filter in flight results, use the same searchable multi-select combobox. Chosen airlines appear as removable tags; profile and planning preferences persist airline codes, while result filters preserve carrier names in the route query.

The web client follows the browser's `prefers-color-scheme` setting and updates
between Fluent UI's light and dark themes when that preference changes.
React Router keeps the trips dashboard at `/` and each planner at `/trips/{tripId}`.
The dashboard also uses `/?create=1` and `/?edit={tripId}` for its forms. These
routes support direct loading, refresh, and browser Back/Forward navigation.
Flight-result filters remain in the query string, so refreshing or sharing the URL restores those filters.

Stop local services with `docker compose down`. Add `--volumes` only when you intentionally want to erase the local database and recreate it from migrations.

## Flight planning

Define destinations and visit dates on **Overview**, and manage party members in the **Party** navigation section. New members default to **Traveller**; the owner can choose **Planner** when adding a member or change an existing member’s role. The member `PUT` accepts `{ "role": "Traveller" }` or `{ "role": "Planner" }`; a legacy empty request defaults to Traveller. Roles persist per party member, and demotion removes planning access. The destination drawer owns `properties.constraints.arrivalFlexibilityDays` and `departureFlexibilityDays` (independent ±0–5 day windows) with a fixed destination order. Legacy `keepAfterPrevious` values are accepted but no longer allow reordering. These city constraints apply to every visit, including repeat visits. Existing unrelated destination constraints are preserved when editing these controls.

**Plan Flights** opens `/trips/{tripId}/flights`, which contains the flight search and selection card. It has no separate party, destination, date, advanced-constraint, or AI trip-description form. Search validation issues offer a return to Overview. Home airports come from the trip owner's profile; airline preferences initialize the search settings. Preferred airlines affect ranking rather than excluding other carriers.

The API derives the effective flight document from the current destination resources on every constraints read, search, result read, booking lookup, and selection. Stable stay IDs identify planned visits. Dates determine the same chronological order shown on Overview, with stored visit order breaking ties. Flight searches always preserve that sequence, including repeat visits. Destination coordinates and country select nearby catalog airports. Date flexibility applies independently to local arrival and departure, including validation of actual returned flights. Changes take effect without saving a second planning document. Existing API clients with flight-only trips can still use their stored flight documents until destinations are defined.

**Find flights** prepares a bounded set of provider requests and queues Ignav calls. Invalid requests return HTTP 400 with planning issues; accepted searches return HTTP 202 with a polling URL. There is no destination-count limit. The total-trip search window is derived from the stays, including trips longer than 60 days. Airport catalog sources and home-airport selection rules are in [Data/README.md](src/TripPlanner.Api/Data/README.md).

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
one-hour cache, and selected-flight JSONB snapshot serve both planning modes.
On phones and larger screens, route results show horizontally scrollable destination columns plus a return-home column. Phone columns stay 240–300px wide, with horizontal swipe scrolling and gentle column snapping; the rest of the page stays within the screen. Filters and selection actions wrap above the grid, and controls have larger touch targets. Each arriving flight card has a stable identity within its visit, including repeat destinations. Selected flights sort first. The split sort button orders the remaining cards by price, departure, arrival, or duration in either direction; unknown values stay last. Flight numbers for every segment appear below the airline name. Hover or keyboard focus draws and highlights complete server-validated paths containing that flight; alternatives in a column with a chosen flight do not trigger highlighting. Once all flights are chosen, their connecting line remains visible without hovering, including restored choices whose current search graph is unavailable. This line shows the chosen sequence; route feasibility is still assessed separately. Provisional flights show when no complete route has been found. Compact connection graphs preserve every valid path among the returned flight cards for any number of visits, independently of price ranking. Separate outbound fare contexts preserve bundled returns, currencies, and whole-trip duration constraints. Shared connection indexes avoid repeating flight details or enumerating every combination. At least one complete itinerary is retained for each compatible flight. Multi-stop hover reports connected flights instead of counting only the sampled itineraries. Card fares come from the cheapest complete path through that flight compatible with the current selections and filters, rather than an unrelated cheapest provider offer. Combined outbound/return fares are labeled explicitly; once both flights are selected, their shared fare appears once and the return says it is included in the outbound fare. Booking links and booked status are managed directly on each card. Flights without a compatible complete path retain their details but show no unverified fare. Graph responses identify bundled returns explicitly so the UI can distinguish their included return from a separately priced ticket. Clicking a card selects only that flight, in any column; clicking it again asks for confirmation before clearing it. Alternatives in selected columns dim, while other columns retain only flights on complete paths compatible with all selections. Each flight selection is saved immediately, including partial selections made out of order. A card’s **Booking Link** button and **Booked** switch use saved booking details, including partial selections. Preferred airlines have a **Preferred Airline** tag. When every selected leg forms a valid route, the complete itinerary is saved automatically for Plans and activity availability. Filters remain local. **Clear selections** reopens the grid after confirmation. Replacing a saved choice also requires confirmation. The cost slider’s minimum and maximum update from complete paths compatible with the current selections, airline filter, and stops filter as results arrive. Its own price cap does not shrink those bounds; a previously set cap is clamped to the updated range. The maximum total-trip-cost slider uses graph fare costs (charging each bundled fare once), rather than individual card prices or the sampled itineraries. Stops (nonstop, one, or two-plus) and airline multiselects apply to every flight/segment in the path; currencies are filtered separately. Forward/backward minimum-cost searches enforce the cap again when hovering or adding selections, so separately affordable branches cannot form an over-budget highlighted path. Search responses retain the complete weighted graph after selections are saved. Fluent UI skeleton cards appear in empty columns and below arriving results until the search finishes.

Hover queries reuse a prepared graph with integer flight indexes and reusable cost buffers. Card content is memoized separately from highlight classes, and detailed flight information mounts only when expanded. A stable resize observer caches each card's geometry; pointer movement does not reread layout. All highlighted connections are drawn as subpaths in one SVG path, and highlighting has no fade animation. Geometry is refreshed when results, filters, selections, expanded details, or viewport size change.

The sequential picker remains a fallback for older planning data without destination visits. It shows airline names, flight numbers, layover airports and durations, and airline booking options for the current flight. In either layout, failed saves restore the previous selection and show the server's error beside the flights. Each saved choice also
recomposes complete routes around
the chosen flights from cached and retained fares, so the global result cap does not hide
later-leg alternatives. This does not make another Ignav request while the
cache is fresh. The server verifies each choice against its cached or previously retained fare and
uses that fare's searched cities to identify and prioritize the next leg, even
when Ignav returns a different airport within a city.
Partial choices store server-owned provider offers alongside nullable, position-specific flight keys in the existing `flight_choices` JSONB resource. Only offers containing a chosen flight are retained; paired offers stay indivisible. Opening Flights immediately restores selected cards from saved flight details, even after the one-hour search cache expires and while search-status or result requests are pending or fail. New search results merge with these cards without duplicating them; displaying a retained selection does not imply a newly validated route or refreshed quote. The trip overview also reads these saved partial selections and shows their flight numbers between the corresponding destinations, including a return chosen first. It uses retained flight details without starting a fare search; current nonempty choices take precedence over that party’s older complete itinerary, while unselected legs remain links to plan flights. Subsequent searches queue only unselected legs and omit bundled searches that would repeat a selected leg. Clearing a choice releases its retained offers unless another selected flight still needs the same bundle, and makes that leg searchable again. No automatic provider search is needed to restore saved cards. The retained amounts are saved quotes; airline booking prices and availability may change. Flight cards show provider-confirmed prices without a verification tag. Unverified or missing verification status (including older saved quotes) displays “Price unconfirmed” without an amount. Only explicitly verified prices contribute to displayed trip totals, cost filters, and price differences; unpriced flights remain selectable. Grid columns keep selected flights first. A split sort button selects price, departure, arrival, or duration from its menu; its main button reverses the current direction. Missing values and unconfirmed prices stay last. The return column shows its planned or selected departure date (or the available date range). Grid flight details show a compact per-segment aircraft/operator summary. Verification describes the provider’s quote at retrieval, not a price guarantee at checkout. Each grid card has an on-demand **Booking Link** button. Chosen flights also show a **Booked** switch, enabled once their booking details are saved. Preferred airlines carry a tag directly on their cards. The grid saves choices immediately and has no separate review section. Selecting all legs also saves the server-validated complete itinerary for Plans and activity availability; changing or clearing choices removes any old complete route until the new choices form a valid complete itinerary. Booking links display the provider fare name and total price, with a compact difference badge such as `+$150` or `−$50` beside the name. The badge compares the original quote for the same flights and currency; its tooltip and accessible label retain the full comparison. Distinct fare products remain visible even when they share a URL. Shared bookings show separately priced direction links when returned; these are labeled by flight and are not compared against the whole round-trip quote. Missing names, prices, or comparable quotes are stated explicitly. The labels use Ignav’s [per-link fare metadata](https://ignav.com/docs/booking-links), without guessing fare brands or currency conversions. A one-way booking works before the rest of the route is selected or a complete path exists. A shared outbound/return offer becomes bookable only after both flights are selected; both cards expose the shared booking link and Booked state; changing either switch updates the whole booking. Purchases store server-validated provider offer IDs in the same `flight_choices` JSONB resource, survive cache expiry and reloads, and keep pricing tied to the purchased offer. Deselecting either half releases the shared purchase status. Saving a complete itinerary carries these statuses into Plans; subsequent purchase edits stay synchronized when the complete itinerary and flight choices match.
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
those booleans persist in the trip's selected-flight JSONB snapshot. Flights in a shared booking change purchase status together. Travel
companions can see the status but cannot change it. Prices include a local
currency symbol alongside the currency code, such as USD $900.

This prototype counts each account holder as an adult passenger. The earlier flight-form AI proposal API remains available to API clients, but is no longer exposed on the flight page. Activity AI suggestions remain in the activity drawer.
Invitations and full preference scoring are subsequent
steps. See [Milestone 1](docs/milestone_1.md) for limits,
[Milestone 2](docs/milestone_2.md) for the activity-planning contract and iteration notes,
and [later milestones](docs/later_milestones.md) for the deferred trip revision history.

## Activity planning

**Overview** is the default trip page at `/trips/{tripId}`. New trips start with an empty itinerary and an **Add destination** button. It opens a modal drawer from the right on laptops and fills the width on phones. Search for a city, select an autocomplete result, and optionally enter visit dates; the drawer does not ask for a country code. Saving closes the drawer and adds a visit to the overview, with a link to its activities. Canceling discards the draft. Overview lists visits chronologically, with undated visits last in itinerary order. Owners can delete a destination from its card after confirming that all visits and activities for that city will be removed. Breadcrumbs link back through Trips, the trip, and the current section; activity planning also shows the selected city. Activity planning opens with destination tabs showing every visit’s dates and an Azure map centered on the selected city. The map fills the content width on phones and laptops. Activity cards below the map provide **Add activity** and card-level **Edit** actions. Both open a drawer; new activities can use Azure Maps place lookup, an AI prompt, or an image import. AI suggestions and image imports are available when the profile’s AI feature is enabled, and save activities immediately as Proposed. The background worker calls OpenAI with the prompt and destination visit dates, then resolves suggested places through Azure Maps. Migration `0006` upgrades early activity job tables without discarding data. Destination tabs share a scroll position. Each activity in the Ideas list has a dropdown showing its current state, with Proposed, Planned, Rejected, and Delete activity options; the same menu is available in map details. Deletion requires confirmation. Read-only members see the state without editing controls. Activities support user-managed URL/label links for details, bookings, or tickets, editable in the activity drawer. Overview cards show activity counts by state, or **Plan Activities** when empty. Narrow flight cards connect the profile’s home city to the first destination, each chronological visit to the next, and the final destination back home. They show matching selected flight numbers (including connections) or **Plan Flights**, linking to the existing flight planner at `/trips/{tripId}/flights`. Located activity cards offer **Open in Maps**, using Apple Maps links on Apple devices and Google Maps links elsewhere, with browser fallback. AI location lookup uses nearby Azure Maps POIs and a verified landmark fallback; missing AI place names fall back to the activity name. Destination creation and visit-date editing are on Overview. A single inline calendar selects arrival and departure as a range and highlights other cities’ stays, including repeat visits, with a color legend below the month. Visits can share an arrival/departure day (for example, June 10–15 followed by June 15–20), but cannot overlap inside another visit. The calendar blocks conflicting selections, including ranges spanning another visit; REST and MCP reject conflicting date writes with `409 destination_dates_overlap`. Editing excludes only the current visit, not every visit to its city. PostgreSQL serializes date checks and writes per trip to prevent simultaneous edits from creating overlaps. Map loading and failures are visible, with a retry that fetches a fresh SAS token. **Activities** remains available at `/trips/{tripId}/activities`; flights, stays, and plans are no longer navigation tabs in this first design pass. Trip-wide dates and flexibility controls will follow. The selected result supplies the city's country and coordinates. Plan activities there before choosing flights. Adding the same city again creates another visit under one city tab, with the complete route order preserved. The city Point is cached in PostgreSQL; activities belong to the city and are shared with all trip members. Members can read them, while the trip owner can create, edit, or delete them. Removing all visits through the API preserves city activities; adding the city again restores editing. Deleting the city resource removes its activities as well. Flight selections do not create, remove, or change destination visits.

`GET /trips/{tripId}/destinations` returns an `application/geo+json` FeatureCollection, empty for a new trip. `POST` to the same route accepts a destination GeoJSON Feature with required Point coordinates from the selected autocomplete result and properties `name`, `countryCode`, optional object `constraints`, and optional `arrivalDate` and `departureDate`. The country code remains API metadata rather than a form field. `PUT /trips/{tripId}/destinations/{destinationCity}/stays/{stayId}` replaces its optional dates; `DELETE` removes the visit. `?includeInactive=true` includes cached past cities. `GET /trips/{tripId}/destinations/{destinationCity}` returns a city Feature. Under that city, `GET` and `POST /activities` list and create complete activity Features, and `GET`, `PUT`, and `DELETE /activities/{activityId}` read, replace, and remove one. Activity writes require the city's `contextVersion` in `Destination-Context`; replacements and deletes also require the current activity ETag in `If-Match`.

The owner can request suggestions with `POST /trips/{tripId}/destinations/{destinationCity}:suggest` or upload up to ten JPEG, PNG, or WebP images with `POST .../{destinationCity}:import`. The import accepts repeated multipart `images` files, `requestId`, `destinationContext`, and optional `input`; legacy `image` files remain supported. Limits are ten images, 10 MB and 20 megapixels per image, and 50 MB total. Every image is validated before one durable extraction job is queued. The worker sends all images together, with instructions to extract only explicitly mentioned activities and image-supported details, deduplicate across images, and return no activities when none are mentioned. Image instructions may narrow extraction but cannot add activities. The drawer previews each accepted image and allows individual removal. When more than ten photos are selected, it keeps the first ten and explains the limit. Unsupported, empty, or oversized files are skipped individually with a reason beside the previews; files that would exceed the total size limit are also skipped. Both routes return a durable operation to poll at `/operations/{id}`. On completion, `GET .../{destinationCity}/suggestions/{operationId}` returns the created Features and warnings. Suggestions are immediately saved with state `Proposed` and remain editable. Generation requires the `LLM` feature flag; manual activity editing does not. The map uses the existing short-lived Maps SAS, and the worker resolves candidate locations separately so an unverified place is saved without a misleading pin. For image imports and AI text prompts, unresolved locations trigger an OpenAI Responses `web_search` fallback to identify the existing activity’s venue. Research uses the original prompt’s place names and descriptive clues, but cannot add activities or change candidate descriptions, durations, or costs. Research returns the venue name and its sourced street address separately, preferring the locally published address. A venue must have a supporting URL present in the search sources; that page is attached as a “Venue source” link. The worker sends the address directly to Azure Maps geocoding, bypassing venue-name search. A pin requires a high-confidence Address result in the expected country within 50 km of the destination; ambiguous, broader-area, and conflicting address matches are rejected. The researched address and citation remain available even when geocoding cannot place a pin. If Azure still cannot resolve the address, OpenAI searches for the exact venue’s Wikidata item. The server independently reads its published coordinates, checks the venue label or alias and a 50 km destination radius, and rejects conflicting or non-Earth coordinates. These coordinates are saved separately as a `locationSuggestion`, never automatically as the activity’s map location. In the editor, review the source and map, choose **Use this location**, then **Save activity**. The pin is a published candidate, not a verified visitor entrance. Existing unlocated activities offer **Research saved activity location** when AI is enabled. This preview uses saved activity details through `POST .../activities/{activityId}/location-proposals`, requiring the current `If-Match` and `Destination-Context` headers. MCP exposes the same preview as `create_activity_location_proposal`; use `update_activity` only after acceptance, preserving other fields and the source link. Research does not mutate existing activities. Manual Azure Maps lookup remains available. Ambiguous results or research failures leave the activity unlocated with a warning. This uses the configured OpenAI model and key, with additional search usage and up to 20 seconds per lookup.

Manual activity and stay location searches use Azure Maps Fuzzy Search for venue
names and street addresses (`POI`, `PAD`, and `Addr` indexes). Results remain limited
to six candidates in the destination country and within 50 km of its center.
City and region centroids are excluded from these location searches.
While searching for an activity location, the map shows only numbered search
results matching the list. Select a result from the map or list to use it;
selecting a result or closing the editor restores the saved activity markers.
Map camera changes animate between views, including destination changes. Markers
fade in and out while unchanged markers remain in place. These transitions respect
the device's reduced-motion preference.
After first opening Activities, its map and unsaved editor state remain mounted
while switching sections within the same trip. Returning refreshes destination
and activity data without recreating the map. Fullscreen moves the same map surface
into the dialog, retaining zoom, position, and loaded tiles. Leaving the trip
disposes the map; persistence is in memory, not across page reloads.

In Ideas, **Find location** appears beside **Add activity** when AI is enabled and
activities are missing locations. It researches those activities two at a time and
saves verified published coordinates with their source links, updating map pins as
results arrive. Existing locations and unrelated fields are preserved; conditional
saves reject concurrent edits. Unverified or failed lookups stay unlocated and the
completion toast reports partial results. Leaving the destination cancels remaining
work. This bulk action explicitly fills locations; the editor's individual research
flow still offers a preview before saving. Published coordinates are not necessarily
a visitor entrance.

In the activity editor, **Research duration and cost** uses OpenAI web search on the saved activity and destination visit dates. Review the duration estimate and ticket conditions with their source links, accept either field independently, then save the activity. Existing values are never overwritten by research itself; unsupported fields remain unknown, and a zero price requires an explicit free-admission source. Accepted source links, notes, and research timestamps are retained with each field; manually editing that field clears its old evidence. The lookup requires planning permission and the `LLM` feature flag. `POST .../activities/{activityId}/details-proposals` returns a preview, with the same `If-Match` and `Destination-Context` requirements as location research. MCP exposes `create_activity_details_proposal`; apply accepted values and `durationEvidence`/`costEvidence` through the ordinary whole-resource `update_activity` tool. Research uses the configured model, up to four web-search calls, and a 30-second deadline. It prefers official sources, but estimates and published prices still require review for the intended visit. Manual editing works without AI.


When date requirements leave no flight-date pairs, the API identifies the
conflicting windows and stay dates. The flight-search card displays the affected
numbered requirements and can open the editor at the first one.

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

The trip page has **Flights**, **Stays**, and **Plans** tabs, each reflected in the
URL. An eligible fare can be selected, replaced, or deselected for its party.
`GET /trips/{tripId}/flights` returns saved choices, or 204 when none have been
selected; `PUT` and `DELETE` on `/{partyId}` replace or clear one. The API checks a new choice against
the current cached search and stores an itinerary snapshot in `trips.selected_flights`,
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

To include PostgreSQL queue tests, set `TRIPPLANNER_TEST_POSTGRES` to a local test
administrator connection string when running `dotnet test`. They create an isolated
`planner_test_*` database, apply migrations, exercise concurrent claims and cache/lease
expiry, then remove only that database. In-memory tests use `InMemoryPlannerDb`.

## Authentication

Authentication is handled by the API's ASP.NET Google and OpenID Connect middleware in both production and development. Azure App Service Authentication is explicitly disabled. The API stores provider tokens in its encrypted HTTP-only authentication cookie so it can retrieve profile images without persisting image URLs. The production container serves the React application and API from one origin, allowing a `SameSite=Lax`, `Secure` session cookie; development uses equivalent settings compatible with HTTP localhost. Data Protection keys persist in App Service's mounted `/home` storage and a local Docker volume so sessions survive container replacement. Provider secrets remain server-side in both environments.

Register both callback URLs for each provider on the same OAuth application:

| Provider | Production callback | Local callback |
| --- | --- | --- |
| Google | `https://<api-app>.azurewebsites.net/.auth/callback/google` | `http://localhost:5173/.auth/callback/google` |
| Microsoft | `https://<api-app>.azurewebsites.net/.auth/callback/microsoft` | `http://localhost:5173/.auth/callback/microsoft` |

The API owns both environments' callbacks. Vite proxies the localhost callback paths from port 5173 to the API container. The browser starts sign-in at `/.auth/login/google` or `/.auth/login/aad`; those entry points are separate from the callback URIs registered with each provider.

The sign-in screen uses the providers' official light-theme SVG buttons stored under `src/TripPlanner.Web/public/auth`. Keep their artwork and aspect ratios unchanged when adjusting the surrounding layout.

After running `scripts/buildout`, store the four provider values in Azure Key Vault:

```zsh
./scripts/secrets set-auth
./scripts/secrets status
```

The prompts do not echo secret values. `scripts/release` requires `google-client-id`, `google-client-secret`, `microsoft-client-id`, `microsoft-client-secret`, `ignav-api-key`, and `openai-api-key`. The Web App reads the secrets through versionless Key Vault references using its managed identity, so credentials are not copied into Bicep parameters or plain App Service settings. Rotate one value with `./scripts/secrets set microsoft-client-secret` (or another supported name).

The Microsoft provider is restricted to personal Microsoft accounts through the consumer-account issuer. In the Entra application registration, add both Microsoft callback URLs above to the **Web** platform, leave implicit grant options disabled, and grant the delegated Microsoft Graph `User.Read` permission used to retrieve the profile image. Provider secrets must be rotated before their configured expiration.

## ChatGPT MCP access and Activity Log

The API hosts a stateless Streamable HTTP MCP server at `/mcp`, using the official
C# MCP SDK. Its tools read and manage trips, destination visits, activities, activity preferences and plans, assessments, proposals, operations, and personal calendar subscriptions.
They call the same handlers as the REST API, enforcing existing membership,
Planner/owner permissions, validation, destination context versions, and activity
ETags. MCP requests require OAuth bearer tokens; website cookies cannot authorize
MCP calls. Tool input cannot choose the acting user.

OpenIddict provides an OAuth authorization server alongside the existing Google
and Microsoft sign-in. ChatGPT uses a registered public client (`chatgpt`, no
client secret), authorization-code flow with S256 PKCE, exact callback allowlists,
explicit CSRF-protected consent, and tokens bound to the canonical `/mcp` resource.
`tripplanner.read` permits reads; `tripplanner.write` permits reads and writes that
the connected user is authorized to perform. Request `offline_access` for refresh
tokens. Access tokens last 15 minutes; refresh tokens last 30 days. Reference access
tokens and OAuth protocol state persist in PostgreSQL. Token revocation is checked
on each MCP request. Profile → **Connected agents** can revoke all ChatGPT tokens
for the current user without removing their Activity Log.

One-time production setup:

```zsh
./scripts/secrets init-mcp
./scripts/release
```

`init-mcp` creates a 3072-bit RSA signing/encryption certificate in Key Vault as
`mcp-signing-certificate`, using private temporary files that are removed afterward.
It leaves an existing certificate unchanged. The certificate expires after 730 days;
rotate before expiry. Replacing this certificate invalidates existing encrypted
credentials and users must reconnect. The release requires this secret, enables
MCP, and sets the issuer to the application's public HTTPS URL. Production refuses
to start MCP without persistent keys. No external identity-provider subscription is
needed, and existing Google/Microsoft callback registrations stay the same.

In ChatGPT on the web, add a custom MCP server/plugin with:

| Setting | Value |
| --- | --- |
| Server URL | `https://<api-app>.azurewebsites.net/mcp` |
| Authentication | OAuth |
| OAuth client ID | `chatgpt` |
| Client secret | Leave empty (public client with PKCE) |
| Scopes, if requested | `tripplanner.read tripplanner.write offline_access` |
| Authorization discovery | `https://<api-app>.azurewebsites.net/.well-known/openid-configuration` |
| Protected-resource discovery | `https://<api-app>.azurewebsites.net/.well-known/oauth-protected-resource/mcp` |

The default registered callback is
`https://chatgpt.com/connector_platform_oauth_redirect`. Use the **exact** callback
shown by ChatGPT; if it differs, set `MCP_REDIRECT_URI` when running `scripts/release`.
Create/install the plugin, connect your TripPlanner account, then use it in a
conversation. After choosing **Allow access** or **Cancel**, TripPlanner shows the
consent result. Select **Return to ChatGPT** to finish connecting or canceling;
approval alone does not complete the OAuth handoff. Workspace restrictions can
limit custom MCP access. This registers a private integration; public directory
distribution is a separate workflow. See
[OpenAI's connection guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
and [OAuth requirements](https://developers.openai.com/plugins/build/auth).

Configuration binds to `McpOptions`: `Mcp:Enabled`, `Mcp:Issuer`, `Mcp:Certificate`
(base64 PFX), and `Mcp:RedirectUris`. Development Compose enables MCP through Vite
at `http://localhost:5173/mcp` with ephemeral OAuth keys, so restarting invalidates
development tokens. `LOCAL_MCP_ISSUER` can override the development issuer. For
ChatGPT testing, use a publicly reachable HTTPS host/tunnel and register its login
callbacks with Google/Microsoft; a production ChatGPT client cannot reach localhost.
Vite proxies `/mcp`, `/oauth`, and `/.well-known` to the API.

**Profile → Activity Log** shows new successful trip mutations, newest first, with
the authorizing user, client/source, trip name, resource, action, and timestamp.
Website changes, ChatGPT changes, and activities saved by the background assistant
are attributed separately. The `ChatGPT` label identifies the registered OAuth
client; it is not derived from a caller-supplied header. Logs are visible to the
actor, trip owner, and current trip members. Former members lose visibility into
other people's actions; actors retain their own history. Historical names and
actors survive trip deletion. Existing history is not backfilled.

ChatGPT acts with the connected user's trip permissions: owners and planners can
modify trips after granting `tripplanner.write`; travellers remain read-only.
Trip lists and details both return `canPlan` for that user, so agents can reliably
distinguish editable trips from read-only shares. A read-only OAuth token is never
silently upgraded: write tools return an OAuth reauthorization challenge. Reconnect
with `tripplanner.read tripplanner.write offline_access` to grant write access.

`AuditedPlannerDb` decorates the shared `IPlannerDb` write interface. PostgreSQL
mutations and log inserts share an ambient transaction, so a failed audit insert
rolls back the write. Rejected writes are not logged. The log is append-only via
database triggers and stores no OAuth credentials, provider payloads, image uploads,
or AI prompts. New trip write methods must be added to its explicit action map.
Migrations `0009` and `0010` add the log and OpenIddict's schema through the existing
SQL migrator; no schemas need to be dropped.

## Activity selection and daily planning (milestone 3)

Activities now has **Ideas** and **Plan** views. Ideas are grouped by state
(Proposed, Planned, Rejected, and any custom states), with counts and independently
collapsible group headers. Map marker numbers stay consistent across groups.
A plan selects activities,
assigns each activity at most once across repeat visits, and orders each day.
Plan opens as an agenda. Its map shows only Planned activities (along with the stay).
It starts empty until activities are marked
**Planned** in Ideas. Every dated visit day appears, including days with no activities.
Tap a day header to collapse or expand its activities and daily routines.
Drag an activity's dotted handle to reorder it within its day, using a mouse or
touch. The handle also supports Up/Down arrow keys; Escape cancels a drag. Use the
Day selector to move between days, and Save changes to keep manual edits.
Compact travel cards between activities show the assessed transport method and
duration, with provisional routes labeled estimated. Assessed stay connections
appear at the start and end of the route; missing travel times remain unknown.
The header shows free hours after activities, travel, meals, waiting, and reserved
slack; provisional figures are labeled estimated. Edits automatically preview the
current draft after a short typing pause, without saving it. The preview uses the
same server evaluator with cached evidence, makes no external provider calls, and
creates no saved assessment or background job. Outdated responses are discarded.
Overview destination cards let you edit dates by tapping the date range, with delete
in the top-right corner. Once a visit has saved scheduled activities, its utilization
bar totals available and free time across that visit's days (including empty days).
Free time uses the agenda calculation, after travel, meals, and reserved slack;
estimates are labeled. The bar is green through 60%, warning through 80%, and red
above 80% utilization.

Those activities appear under **To schedule** until assigned to a day. Choose
**Schedule activities** to ask the solver to assign days, order, and times for
exactly the selected activities. It minimizes total travel on daily routes from
the stay, through the activities, and back to the stay when accommodation is set.
Without a stay, it optimizes an open route through the activities, with no travel
before the first or after the last activity. Breakfast precedes the first activity;
the last activity starts after dinner (19:00 by default, plus its meal allowance).
Dining activities can satisfy meal allowances without double-counting. Fixed times
that conflict remain visible and are reported rather than silently moved.
Meals, sleep, waiting, and slack still count;
unknown travel between activities remains an estimate. Choosing accommodation
with **Stay** on Overview adds those connections to subsequent assessments and
scheduling. It refreshes routing evidence and respects fixed
days/times and other restrictions; unavailable routes remain labeled estimates.
If everything cannot fit, it explains that without silently dropping activities.
The **Schedule activities** button saves the solver's best validated schedule directly
to the agenda and calendar. If no schedule fits or inputs change while it runs,
the current plan is preserved and the reason is shown. REST and MCP proposal
creation use `kind: "schedule"` for this mode; they still return proposals to apply
explicitly. `draft` still permits subset selection.
Manual edits show **Save changes** and **Discard changes** only when needed.
Saving applies the manual draft to the shared plan and calendar; discarding
restores the saved plan. Draft alternatives and incremental suggestions still require
explicit review and application.
The detailed assessments, optimizer, and settings are available under
**Planning tools**, which expands below the agenda without hiding it. On phones,
entering the agenda collapses the map.
On tablets and laptops (768px and wider), drag the divider between the activity
column and the map to resize them. Focus the divider and use the arrow keys for
keyboard resizing; Home and End move to the minimum and maximum column sizes.
New destinations automatically resolve their IANA timezone from their coordinates
using [Azure Maps](https://learn.microsoft.com/en-us/rest/api/maps/timezone/get-timezone-by-coordinates).
This applies to website and MCP creation without requiring AI. The daily
plan inherits it for timed calendar events; an explicitly supplied timezone takes
precedence, and repeat visits reuse the saved destination timezone. Lookup failures
are logged and leave the timezone unset rather than guessing; destination creation
still succeeds. Run `./scripts/buildout` to apply the timezone-read permission in
`infra/main.bicep`; existing Search Reader access alone returns HTTP 403 for this
lookup. Under **Default timing and transport**, the destination timezone autocomplete
accepts city searches such as Tokyo or Hong Kong and offers IANA timezone IDs.
Unrecognized timezone text must be corrected before saving or assessing a plan.
Mobile controls move stops earlier/later or to another day. Must-do, fixed day/time,
relative-order, meal, duration, opening-hours, transport, and daily availability
restrictions remain editable. Conflicting plans can be saved with explanations.
Profile interests are private; trip and destination interests are shared. Preference
scoring combines all travellers with equal weight and narrower instructions take
precedence. AI-interpreted timing rules and flight-derived availability require
explicit acceptance.

On phones, Ideas and Plan scroll with the page, and activity editors scroll
through their action buttons. Overview keeps destination names and dates above
the card actions. Action results use dismissible Fluent UI toasts anchored at the viewport’s top-right, above drawers and dialogs without moving when focus changes: successes close
automatically, while failures stay visible for review. Field validation and
loading failures remain beside the relevant content.

Manual planning and deterministic assessments need no AI or provider credentials.
Unknown durations, travel and hours stay provisional with explicit assumptions.
Durable proposal jobs use OR-Tools CP-SAT, publish partial results, and return
reviewable alternatives and incremental changes. Neither research nor optimization
changes the saved plan. Plan replacements require both `If-Match` and the returned
input `contextVersion`; stale proposals must be regenerated. Existing Planned
activities start selected and unscheduled. All new shared mutations use the Activity
Log. Migration `0011_ActivityPlanning.sql` adds the documents, jobs, evidence,
concurrency counters, reference maintenance, and hashed calendar tokens.

Calendar subscriptions contain only accepted, dated activities. Each member can
create and revoke their own bearer URL. The URL is returned once at creation and
is omitted from listings and logs. Removing a member permanently revokes their
subscriptions. Evidence refreshes mark saved timing stale; calendar events retain
the accepted timing until the plan is saved again.

Set up routing and calendar publication before releasing this milestone:

```zsh
./scripts/buildout                 # adds Azure Maps route-read and timezone-read permissions
./scripts/server                  # reads the optional key for local development
```

Azure Maps provides walking and road travel; road defaults to taxi/rideshare.
Migration `0014` converts old transit settings to walking, clears transit duration
overrides and cached transit routes, and invalidates old proposals. Saved calendar
times remain unchanged until revised timing is accepted.
Self-driving is a whole-day choice. Walking is the default; public transit is not
supported. With the existing `LLM` feature flag, OpenAI Decisions scores
preferences and Responses researches dated opening hours using web search. Missing
providers preserve manual planning and estimated assessments.

Configuration binds to `ActivityPlanningOptions`. Defaults are
100 candidates, 30 destination days, 30 solver seconds, a 180-second job deadline,
120 provider requests (including retries), four concurrent provider calls, and a
15-second request timeout. `ActivityPlanning:PublicBaseUrl` must be the public
HTTPS origin (localhost HTTP is allowed for development). Compose and release
configure it.
`ActivityPlanning:DecisionsModel` defaults to `gpt-6-luna`; AI uses the existing
`OpenAI` configuration. Use double underscores for environment configuration keys.

The MCP tools reuse REST validation, authorization and services. Read tools need
`tripplanner.read`; persisted assessments/proposals, replacements and subscription
management need `tripplanner.write` and the applicable trip permission. Profile
scope always means the authenticated user. Use a fresh request UUID for new work,
reuse it only to retry identical work, poll with `get_operation`, read the proposal,
and apply the complete chosen plan with its current ETag and context version.
Calendar URLs are returned only by `create_calendar_subscription`.

See [milestone 3](docs/milestone_3.md) for contracts, solver semantics, provider
limits, verification commands, and live smoke-test steps.

## Browser behavior analytics and correlated requests

Application Insights collects named React page views, browser exceptions, and explicit
behavior events. It is focused on product usage: no infrastructure alert rules, metric
exports, application-log exports, or database statement collection are configured.
A Log Analytics workspace is provisioned because workspace-based Application Insights
requires it; this is storage for the application telemetry.

Run `./scripts/buildout` before the next `./scripts/release` to provision the workspace
and Application Insights resource. Release configures `ApplicationInsights__ConnectionString`
for the API. The release script checks that infrastructure exposes Application Insights
and that the resource is accessible, then compiles the release Bicep files before
building or pushing the container. Rerun buildout after adding infrastructure resources;
an older successful infrastructure deployment does not contain newly added resources.
The browser fetches only this public ingestion identifier from
`GET /telemetry/config` before mounting React; no rebuild or frontend secret is needed.
This endpoint is intentionally excluded from MCP. Empty configuration disables collection
on both sides. A failed configuration fetch times out after three seconds and the app
continues without analytics.

Local development defaults to no telemetry. To opt in, supply a development Application
Insights connection string through `APPLICATIONINSIGHTS_CONNECTION_STRING` when running
`./scripts/server`; Compose passes it to the API. Direct API runs can use
`ApplicationInsights__ConnectionString`. Use a separate development resource to keep
local/test usage out of production funnels.

In the Azure portal, open the deployed Application Insights resource and use **Usage →
Funnels** or **User Flows**. Page names are `Trips`, `Profile`, `Trip overview`, `Trip
activities`, `Trip flights`, `Trip party`, and `Other`. Useful funnels include:

- `sign_in_started` → `session_authenticated` → `onboarding_completed`
- `trip_creation_started` → `trip_creation_submitted` → `trip_created`
- `destination_added` → `flight_search_started` → `flight_search_queued` → `flight_choices_saved`
- `activity_creation_started` → `activity_saved`
- `activity_suggestions_started` → `activity_suggestions_completed`

Additional events record `onboarding_viewed`, `trip_creation_cancelled`,
`trip_creation_failed`, `flight_search_rejected`, and `activity_suggestions_failed`.
`session_authenticated` means an authenticated session was loaded, including a return
visit, rather than exclusively a new login. `flight_search_queued` means the server
accepted the search job, not that background work finished. Activity saves include both
creation and editing. Completion events follow successful API responses; there is no
DOM auto-click capture, session replay, or collection of user-entered form content.

Anonymous user/session identification uses the SDK's first-party `ai_user` and
`ai_session` cookies. Signed-in behavior also carries the app's opaque internal user ID,
never email or display name. Collection currently starts automatically when configured;
there is no consent UI. If the site adds a consent preference, gate SDK initialization
on that preference. Funnel events are sent at 100% sampling, although browser blockers,
closed tabs and connection failures can still cause missing events. Choose a session or
user conversion window appropriate for the funnel; event counts alone are not conversion
rates.

The browser SDK adds W3C `traceparent` headers only to application API calls, including
an explicitly configured `VITE_API_BASE_URL` origin. Existing API CORS policy accepts
these headers. ASP.NET Core consumes the trace context and OpenTelemetry exports the
matching request span, status, and duration. Outgoing HTTP dependencies within collected
requests are included with origin-only URLs. Browser telemetry uses role `TripPlanner.Web`
and server telemetry uses `TripPlanner.Api`. Inspect related dependencies and requests
in **Transaction search / end-to-end transaction details** using the shared operation ID.

URLs lose query strings, fragments and identifiers before export; server requests use
route templates. Third-party browser calls, calendar feeds, authentication endpoints,
avatars, health probes, token endpoints and configuration requests are excluded from
HTTP telemetry. Headers, bodies, free text, page titles and referrers are not collected.
Automatic browser exception messages and stacks are omitted to avoid exposing URLs or
user input; exception types remain available. Existing protections that disable raw
App Service HTTP logs and failed-request tracing remain in place.

## Azure infrastructure and deployment

The intended target is **Gustavo Hidalgo personal subscription**, region **East US 2**. Bicep provisions:

- Azure Container Registry (Basic, admin credentials disabled) with a daily purge task
- Azure Key Vault (RBAC authorization, soft delete, and purge protection enabled)
- Azure Database for PostgreSQL Flexible Server (PostgreSQL 18, PostGIS, Burstable B1ms)
- Azure Maps Gen2 in East US with Korea Central data-processing consent, browser CORS, a user-assigned identity with Search Reader plus route-read and timezone-read roles for SAS authorization, and a least-privilege SAS issuer role for the API
- Application Insights and a backing Log Analytics workspace for browser behavior and correlated HTTP traces
- Linux App Service plan and containerized Web App
- App Service application diagnostics; HTTP-path logs and failed-request tracing are disabled to keep bearer calendar URLs out of logs
- managed-identity access to pull images and read Key Vault secrets
- API-managed Google and personal Microsoft account authentication configuration

Release prerequisites are installed by `scripts/setup`: Azure CLI, Docker with a running daemon, .NET 10 SDK, Node.js with Corepack, Git, and curl. Repository dependencies are installed by `scripts/install`.
The signed-in Azure identity needs permission to create resources and role assignments in the target resource group (Owner, or Contributor plus Role Based Access Control Administrator).

Sign into the correct tenant, then provision the infrastructure:

```bash
az login --tenant 8ac19fe6-f2db-412e-9750-97a9772a6786
./scripts/buildout \
  --subscription "Gustavo Hidalgo personal subscription" \
  --resource-group rg-tripplanner-dev \
  --location eastus2
```

`buildout` validates `infra/main.bicep` and `infra/main.bicepparam`, creates the resource group, deploys the long-lived resources, grants the signed-in user permission to manage Key Vault secrets, configures a daily ACR purge task, and prints the endpoints. It does not manage the Web App's release settings or authentication configuration, so it is safe to rerun after a release. Basic ACR does not support the native retention policy, so the scheduled task removes untagged manifests at 02:00 UTC by default; override its cron expression with `ACR_PURGE_SCHEDULE`.

Azure RBAC assignments can take a few minutes to propagate after the first `buildout`. If `scripts/secrets` initially reports a permission error, wait briefly and retry it.

Azure Maps consents to processing Korean address requests in **Korea Central**, as required by [Azure Maps consent management](https://learn.microsoft.com/en-us/azure/azure-maps/how-to-manage-consent). Both the initial account definition and its subsequent CORS update preserve `properties.locations`, using management API `2024-07-01-preview`. Run `./scripts/buildout` to apply this account setting; an application release alone does not apply it.

Deploy application code and runtime configuration separately:

```bash
./scripts/release \
  --subscription "Gustavo Hidalgo personal subscription" \
  --resource-group rg-tripplanner-dev
```

`release` runs API and web tests, builds the production client, packages it into the API container, pushes `tripplanner-api:release`, applies `infra/release.bicep` with `infra/release.bicepparam`, restarts the application, and verifies both `/health` and the web root. It also checks OAuth discovery and requires an unauthenticated JSON-RPC POST to `/mcp` to return `401`. The stateless MCP transport supports POST only: other methods return `405` with `Allow: POST`, unknown MCP paths return `404`, and the namespace never serves the website fallback (including when MCP is disabled). Reusing the stable tag leaves the previous manifest untagged; the purge task installed by `buildout` removes it on its next run.

Authentication credentials live only in the provisioned Key Vault. A release requires all four Google and Microsoft credentials plus the Ignav API key and rejects an incomplete set. Run the scripts with `--help` for their options.

There is no GitHub Actions CI/CD configuration. Releases are intentional local operations performed using your current Azure CLI login. Azure CLI manages the subscription, resources, configuration, registry, and deployment.

## API routes

### Input contracts

REST endpoints validate request bodies recursively before running handlers. MCP
tools use the same rules at invocation time, and publish them in `inputSchema`
(including nested properties). The development OpenAPI document also derives
string enums and custom formats from these validation attributes. Invalid inputs return HTTP `400` or an MCP error
with `structuredContent.status: 400` and field-specific errors, without saving a
mutation or queuing provider work. Scope, membership, concurrency, and
cross-field/domain checks still run in the existing handlers.

| Input | Contract |
| --- | --- |
| Activity state | Exactly `Proposed`, `Planned`, or `Rejected` (case-sensitive) |
| Activity duration / cost | Duration is null or 1–10080 minutes; cost is nonnegative, with a three-letter currency and `perPerson` or `total` basis |
| Activity text / links | Name 1–200, description 0–10000, place name up to 200 characters; up to 20 absolute HTTP(S) links, URL up to 2048 and label up to 200 characters; URL credentials are forbidden |
| GeoJSON | `Feature` and `Point` literals; exactly `[longitude, latitude]`, finite and within ±180/±90 |
| Destinations / dates | City name 1–150 characters, two-letter country code, recognized optional time zone, ISO `YYYY-MM-DD` dates within 2000–2100; departure cannot precede arrival |
| Destination constraints | Object; arrival/departure flexibility 0–5 and `keepAfterPrevious` boolean when present |
| Trips / profile | Trip name 1–200, description up to 4000; home-city name up to 200; bounded airline/airport codes and valid home coordinates |
| Party role | Exactly `Traveller` or `Planner` |
| Flight planning | Cabin `economy`, `premium_economy`, `business`, or `first`; stops 0–2, journey hours 1–168, flexibility 0–5, trip length 1–36890 days; no destination-count cap; supported constraint/location types |
| Flight selection | Nonnegative itinerary indexes and prices, three-letter currencies, leg identifiers of at most 4096 characters each (null slots allowed for unselected legs in partial choices); choices must match server-owned current or retained fares |
| Activity planning | Proposal kind `draft` or `improvements`; transport `walking`, `taxi`, or `driving`; meals `breakfast`, `lunch`, or `dinner`; clocks ISO 8601 `HH:mm:ss` with zero seconds, allowances 0–1440 minutes, bounded plan arrays |
| IDs / pagination | Nonempty UUIDs; reuse returned opaque destination/context IDs and quoted ETags; operation page size 1–100 and offsets 0–100000; operation filters accept known operation types |
| Authentication / uploads | OAuth parameters remain validated by OpenIddict; login/logout redirects must target local paths or configured origins and cannot contain backslashes/control characters; image uploads retain count, byte-size, MIME-signature, and pixel limits |

Activity states remain strings in storage. Existing custom states are not silently
rewritten; select a supported state before saving an old activity. The website's
state menus offer only supported values. After deployment, refresh the ChatGPT
plugin's tool definitions so it receives the updated schemas.

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
| GET, POST | `/trips/{tripId}/destinations` | Read destination FeatureCollection or add a destination Feature and initial stay |
| GET, PUT, DELETE | `/trips/{tripId}/destinations/{destinationCity}` | Read or replace the place Feature; delete the destination and its stays, activities, and jobs |
| PUT, DELETE | `/trips/{tripId}/destinations/{destinationCity}/stays/{stayId}` | Replace stay dates or remove one visit |
| GET, POST | `/trips/{tripId}/destinations/{destinationCity}/activities` | Read activity FeatureCollection or create an activity Feature |
| GET, PUT, DELETE | `/trips/{tripId}/destinations/{destinationCity}/activities/{activityId}` | Read, replace, or delete an activity Feature |
| POST | `/trips/{tripId}/destinations/{destinationCity}:suggest` | Generate activities from a prompt and save them as Proposed |
| POST | `/trips/{tripId}/destinations/{destinationCity}:import` | Generate Proposed activities from an uploaded image |
| GET | `/trips/{tripId}/destinations/{destinationCity}/suggestions/{operationId}` | Read generation results |
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
| PUT | `/trips/{tripId}/flights/{partyId}` | Select or replace a fare by cache key and itinerary index |
| DELETE | `/trips/{tripId}/flights/{partyId}` | Deselect a party's flight |
| PUT | `/trips/{tripId}/flights/{partyId}/purchases` | Save purchase status for the selected flight's legs |
| GET | `/trips/{tripId}/flights/choices` | Read in-progress route choices |
| PUT | `/trips/{tripId}/flights/choices/{partyId}` | Save in-progress route choices by cache key |
| GET, PUT | `/user/activity-preferences` | Private interests and optional defaults; replacement requires If-Match |
| GET, PUT | `/trips/{tripId}/activity-preferences` | Shared trip preferences |
| GET, PUT | `/trips/{tripId}/destinations/{destinationCity}/activity-preferences` | Shared destination preferences |
| GET, PUT | `/trips/{tripId}/destinations/{destinationCity}/activity-plan` | Complete plan, assessment and input context; conditional replacement |
| POST | `/trips/{tripId}/destinations/{destinationCity}/activity-plan/assessments` | Idempotent persisted assessment, optionally of an unsaved draft |
| POST | `/trips/{tripId}/destinations/{destinationCity}/activity-plan/previews` | Read-only draft evaluation from cached inputs; requires a complete plan and current contextVersion; MCP: `preview_activity_plan` with read scope |
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

### SPA updates after release

The API serves `index.html`, including SPA route fallbacks, with `Cache-Control: no-store`. Browser navigation to `/trips/{tripId}` or `/trips/{tripId}/flights` requests `text/html` and receives the SPA shell; API requests to the same URLs retain their JSON behavior. These shared routes send `Vary: Accept` so caches distinguish the representations. Vite's hashed JavaScript and CSS assets are cached for a year as immutable; other static files require revalidation. Reloading the page fetches the current HTML and therefore the current bundle URLs. An already open tab continues running its loaded code until reloaded. Previously cached HTML may need one hard refresh after this policy is first deployed.

`scripts/release` waits for both API health and a SHA-256 match between the public HTML and the locally built `dist/index.html`, using a unique query string to bypass older cached responses. This prevents the previous container's healthy response from being treated as proof that the new UI is live. The stable `release` image tag is unchanged.

Destination accommodation is managed with the **Stay** button on Overview. The drawer selects a location near the destination through Azure Maps. Each city has one accommodation resource, independent of visit dates and activities: `GET`/`PUT`/`DELETE /trips/{tripId}/destinations/{destinationCity}/stay`. PUT accepts a GeoJSON Point Feature with `properties.name`. It is returned as `properties.stayLocation` on destination Features and rendered as a distinct house marker in both activity map views. Owners and Planners can change it; Travellers can view it. Migration `0008_StayLocations.sql` persists the feature, with deletion cascading when a destination is removed.
