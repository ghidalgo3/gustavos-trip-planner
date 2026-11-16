# Gustavo's Trip Planner

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

Starter architecture for a React single-page application and a C# API deployed to Azure.

See [CHANGELOG.md](CHANGELOG.md) for significant changes, new features, and bug
fixes. Add new entries under **Unreleased** as part of the change; dated release
sections record released changes. The initial baseline summarizes existing
functionality rather than claiming a historical release date.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/TripPlanner.Web` | React 19 + React Router + Vite + TypeScript + Fluent UI web app |
| `src/TripPlanner.Api` | .NET 10 minimal API |
| `src/TripPlanner.iOS` | SwiftUI iPhone/iPad storyboard prototype for milestone 6, phase 1 |
| `tests/TripPlanner.Api.Tests` | Unit and integration tests grouped by production namespace; [reading guide](tests/TripPlanner.Api.Tests/README.md) |
| `infra/main.bicep` | Azure resource definitions used by `scripts/buildout` |
| `infra/release.bicep` | Runtime and authentication configuration used by `scripts/release` |
| `compose.yaml` | Local Vite HMR and `dotnet watch` environment |
| `scripts/setup` | Install and validate the macOS development toolchain |
| `scripts/install` | Restore .NET and frontend project dependencies |
| `scripts/format` | Format frontend code with Prettier, add required C# braces, and run CSharpier |
| `scripts/buildout` | Provision or update Azure resources |
| `scripts/secrets` | Store and rotate authentication and Ignav credentials, plus developer eval keys in Azure Key Vault |
| `scripts/server` | Load local auth configuration and start the development containers |
| `scripts/seed_database` | Seed sample trips through the C# database services in the local development database |
| `scripts/release` | Run the Task release graph to test, build, deploy, and verify |
| `Taskfile.yml` | Release dependencies and parallel execution |

Users, trips, and travel parties are stored through `IPlannerDb`, with `PostgresPlannerDb` used by the application. The in-memory planner and activity-log stores live in `tests/TripPlanner.Api.Tests/Database`; they are test doubles and are not included in the API assembly. Planner data uses Npgsql; OAuth storage uses Entity Framework through OpenIddict.

The [trip document](docs/trip_document.md) is the portable, versioned trip model.
`GET /trips/{tripId}/document` returns people with roles and ownership, shared places,
an itinerary calendar, and editable preferences. Calendar items contain complete
activity, transportation, city-visit, and lodging details with their own timing;
unscheduled items are tasks and scheduled items are events. Calculated
assessments and flight-planning views are fetched through their APIs and cached
separately for offline viewing after being loaded. Optional bare ETag tokens and context versions are direct properties of their entities,
with named collection validators on their owning sections. Clients add the required ETag quotes when building HTTP headers. API routes remain in client
adapters; response bodies and HTTP response metadata stay outside the file. The JSON Schema is public at
`/schemas/trip-document-v1.json`. Web and iOS clients adapt the domain model to
screen and editing resources locally; the document and REST contracts can evolve
independently. PostgreSQL remains authoritative and gathers consistent export
inputs in one query. Use `Accept-Encoding: gzip` and `If-None-Match` for efficient
downloads. The download ETag validates that representation; individual edits use
the resource's own `If-Match` and context validators. See
[`before.json`](docs/before.json) and [`after.json`](docs/after.json) for the captured
Japan trip before and after conversion.

The web app reads trip views through adapters over its account-scoped document cache, saves through
resource REST APIs, and reloads the document after successful mutations. A stale
write returns `412`; missing edit preconditions return `428`. The UI retains the
draft and offers Refresh; it does not replay stale writes. Cached trips remain
readable offline, with editing disabled. The production service worker caches the
public app shell; authenticated documents are cached separately and cleared on
sign-out or an online access denial. Other tabs/devices do not receive live pushes.

Offline launch also persists the last confirmed display identity and the trip list
in account-scoped local storage; it does not persist authentication credentials.
The installed app can reopen at its home screen without a network connection and
open previously downloaded trips. Trips that have
only appeared in the list need to be opened online once to download their document.
Saved flights include selected individual legs before the route is complete,
purchase status, and displaced selections that need review. Airport cities are
included in the document, so viewing flights and matching them to destination
visits does not require an airport lookup. Offline flights use the same destination
grid as online, with saved selections and booking status. Sorting, filtering,
scrolling, and flight details remain available; search, selection changes, booking
links, and purchase updates are disabled. Offline mode never starts a fare search.
Editing and profile settings remain disabled until the session is verified online.
Offline status appears only after 30 seconds of disconnection, as one compact
line with a Retry button. Short interruptions do not show a banner; read-only
protection takes effect immediately.
When the browser still reports connectivity, the app retries the session every
10 seconds to recover from transient request failures without waiting for a
browser online event.
An explicit signed-out response or `401/403` from the session endpoint clears the
private offline cache. The public shell starts from its cache immediately and
refreshes in the background; failed asset downloads preserve the previous shell.

On iPhone, open the installed home-screen app while connected, sign in there, and
open each trip you want to keep offline. Then return to the trip list, close the
app, enable airplane mode, and relaunch the same icon. You should see the remembered
account and the saved trip list, with links to downloaded trips. Trip-name search
and paging remain available over saved entries; maps and flight searches,
and edits require connectivity. Clearing website data or
browser storage eviction removes offline availability. The service worker is only
registered by production builds, so `scripts/server` alone does not test it.

Run the production browser regression (WebKit and Chromium, including closing the
browser process and reopening offline) with:

```zsh
cd src/TripPlanner.Web
corepack pnpm exec playwright install webkit chromium
corepack pnpm run test:offline
```

The test serves production assets and deterministic local API fixtures; it does not
contact a real account or database.


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

Frontend code under `src/TripPlanner.Web/src` is grouped by responsibility:

- `features/activities`, `features/flights`, `features/trips`, `features/party`, and
  `features/profile` contain each feature's components, API clients, and helpers.
- `maps` owns the Azure Maps integration and marker transitions. Features use the
  `MapsClient` interface through `mapsClient`. `createAzureMapsClient` implements
  city/place searches, city geocoding, token caching, SDK loading, and map-control
  factories. `ActivityMap` retains its SDK instance across destinations;
  `destinationFlight.ts` blends panning and zooming in a cancellable camera flight,
  adaptively fitting both endpoint views at its widest point. It defaults to
  1.5 seconds with sine ease-in-out. Reduced motion uses an immediate camera change.
- `shared/components`, `shared/hooks`, and `shared/time` hold reusable UI and utilities.
- `api` holds shared API access, `app` holds application composition and theming,
  and `telemetry` holds browser instrumentation.

Tests live beside the modules they cover. `main.tsx` and the global `styles.css`
remain at the source root.

The API's `Services` folders group code by feature: `ActivityPlanning` (assessment,
optimization, routing evidence and calendars), `Flights`, `Destinations`, `Maps`,
and `Jobs` (the flight-search
background worker). Each folder has a matching namespace. Authentication, MCP
registration, database registration/auditing, hosting, and input validation live
in the corresponding top-level folders.

Backend code uses the injectable `IAzureMapsClient` for city, address, and place
geocoding, IANA time-zone resolution, route geometry, and travel-time estimates.
The Azure implementation owns request construction, authentication, provider
response parsing, and coordinate validation. Callers exchange typed coordinates,
address candidates, routes, and durations. Planning applies its own taxi pickup
allowance and evidence lifetime to those results. Maps routing uses bounded
request budgets, retries and response-size limits. Time-zone resolution uses
local boundary data before calling Azure. Agents supply sourced research through
ordinary activity and accommodation resource updates.

`ActivityPlanningContext` in `Models` holds the planning inputs and owns the pure
`Evaluate(plan, now)` calculation. Its data is declared in
`ActivityPlanningContext.cs`, with evaluation in `ActivityPlanningContext.Evaluation.cs`.
Manual plans and optimizer proposals use the same method to obtain an assessment.

`PartyRole` and `ActivityState` are C# enums in `Models`. JSON still uses the exact
names `Traveller` / `Planner` and `Maybe` / `Yes` / `No`, including
stored PostgreSQL JSON and MCP tool inputs. Numeric values and unknown names are
rejected. Migration `0022` renames stored activity states without changing selection or scheduling.

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
```

Normal `dotnet test` runs do not call live providers. See the
[plain-language optimizer walkthrough](docs/milestone_3.md#how-the-activity-optimizer-works)
for how the planner chooses and checks suggestions.

Page, map, picker, and list loading states use Fluent UI skeletons that mirror the incoming content: agenda timelines, destination cards with flight separators, compact search options, stay names and addresses, traveller rows, and form controls. Feature-specific skeletons live beside their views; the shared wrapper handles loading announcements and simple map/text placeholders without a generic card fallback. Existing content remains visible during short saves, with disabled controls and status text. Spinners are reserved for long-running flight searches and scheduling operations.

The browser favicon is a 48×48 PNG under 10 KB at `src/TripPlanner.Web/public/icons/trip-planner-icon.png`. Its full-resolution source and generation prompt live in `docs/design/`, outside the deployed web assets.

## iOS application (milestone 6)

Open `src/TripPlanner.iOS/TripPlanner.iOS.xcodeproj` in Xcode, select the
`TripPlanner.iOS` scheme and an iPhone simulator, and Run (Cmd-R). The existing
project targets iOS 27.0 or later; the prototype uses the installed Xcode toolchain
and has no external packages. A simulator build does not require a signing team.

The app opens on **Trips** without requiring sign-in. Trip names, descriptions,
and dates are persisted locally with SwiftData. Sign-in enables cloud trip access
and an explicit, one-way move to cloud storage. Cloud edits use cached content,
optimistic saves, ETags, and a durable pending-write journal; cloud trips are
read-only offline. Selecting a cloud trip shows destinations from its server
document, with cached data available offline. Online planners can add an
Apple Maps city, change an existing destination city, and edit stay dates. City
replacement preserves the destination ID and planning constraints, keeping its
activities and visits attached. Dates and city changes use separate resource
updates with the ETags captured in the editing document. Save closes the editor
immediately and displays the pending draft while the request continues, including
after navigation. Success commits a refreshed server document; failure asks the
user to refresh destinations before editing again. Pending writes prevent another
destination write to that trip until completion. Shared services are owned by
`AppDependencies`: `AppModel` handles session and trip-level state, while a typed
`ResourceStore` owns optimistic drafts and pending operations across navigation.
`DestinationsModel` handles destination loading, MapKit search, and save requests.
The resource store is reset at sign-out, cancelling pending work and ignoring late
responses from the previous session. Local destination edits are stored on the
current device. Apple Maps search requires connectivity.

The destinations list shows a transportation card between consecutive stops.
Open **Compare options** to view MapKit driving and walking alternatives, or a
public transit ETA with a link to directions in Apple Maps. Cloud planners can
run the existing trip-wide flight search from the sheet. The sheet shows results
for the selected pair of stays and draws illustrative great-circle arcs between
each flight segment’s airports. Selecting a route or flight highlights it in
the sheet for comparison. Saved flights appear in the destination timeline from
the cached or live trip document, including arrival and departure flights.
**Edit → Remove destination** removes a local stop or, for a cloud trip, the
city and all its stays and activities after confirmation.

In Debug builds, filter the Xcode console for the `HTTP` log category to see
request and response pairs for the trip API and OAuth token exchange. Each pair
shares a short ID and includes the status, duration, and byte counts. To diagnose
destination removal, look for the DELETE followed by the document GET. Request
headers, query strings, and payload contents are omitted from the HTTP log.

Cloud promotion uses `PUT /trips/{tripId}/document` with the portable version-1
document used by GET export. Imports currently accept metadata-only
trips and reject unsupported itinerary content. An internal import receipt makes
retries safe; there is no separate `/trip-imports` route.

This is a SwiftUI storyboard, rather than an Interface Builder `.storyboard`
file. Open `ContentView.swift` or a file under `TripPlanner.iOS/Storyboard`, show
the Xcode Canvas (**Editor → Canvas**), and select one of its named `#Preview`
scenes. The storyboard remains available for design review. See
[milestone 6’s screen map and review guide](docs/milestone_6.md) for the design
decisions, walkthrough, and phase 2 boundary.

```zsh
xcodebuild -project src/TripPlanner.iOS/TripPlanner.iOS.xcodeproj \
  -scheme TripPlanner.iOS -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/tripplanner-ios-build CODE_SIGNING_ALLOWED=NO build
```

## Local development

Set up the macOS development toolchain, then install the project dependencies:

```bash
scripts/setup
scripts/install
```

The local scripts use zsh. `scripts/setup` targets macOS and installs Azure CLI, Corepack and Node, .NET 10, Git, Docker Desktop, Azure Bicep, Task (`go-task` in Homebrew), and the pinned pnpm version. It does not silently launch Docker Desktop. Check the machine toolchain without changing it with `scripts/setup --check`. `scripts/install` performs no Homebrew or machine setup; it restores the repository's .NET tools and NuGet packages and installs the frozen pnpm dependencies.

After provisioning Azure, storing the provider credentials, and signing in with Azure CLI, start Docker Desktop and run:

```bash
scripts/server
```

The script reads the four authentication values and the Ignav key from the deployed Azure Key Vault, then issues a 23-hour Azure Maps development SAS with a 50 request-per-second limit. It passes those values only to the API container. It does not create an `.env` file or expose provider client secrets to the React application. The browser obtains the Maps SAS from the authenticated API route. Rerun `scripts/server --detach` if a development session lasts beyond the token expiry. Pass Docker Compose options through the script, for example `scripts/server --detach`; stop detached containers with `docker compose down`.

Open <http://localhost:5173>. Vite proxies application API calls to the API container at `http://api:8080`; editing the frontend triggers HMR, while `dotnet watch` rebuilds and restarts the API without interactive hot-reload prompts. The API is also exposed at <http://localhost:8080>. The web container runs pnpm in noninteractive CI mode so it can reconcile the persistent `node_modules` volume after package-manager upgrades. PostgreSQL 18 with PostGIS 3.6 and pg_cron is exposed at `localhost:5432`, uses the development-only `tripplanner` credentials from `compose.yaml`, and stores its data in the `postgres-18-data` Docker volume. The local database image uses Debian packages for pg_cron. The versioned volume lets PostgreSQL 18 use its required cluster layout while retaining any older `postgres-data` volume for deliberate migration or removal.

After signing in locally once, run `scripts/seed_database` to create **Trip Small** (New York), **Trip Medium** (Amsterdam → London), and **Trip Large** (New York → London → Rome → Istanbul → Hong Kong → Seoul → Tokyo → Sydney → Honolulu → Los Angeles → Chicago). Each trip includes the signed-in user as its owner and party member, destination coordinates and time zones, and visits in the listed order with three days (three nights) at each destination. Trip names and owner identify existing samples: rerunning refreshes their visit dates while preserving trip/visit IDs and other fields; a rerun on the same day skips already matching dates. If there are multiple users, select the owner with `scripts/seed_database you@example.com`. The script runs the .NET 10 console tool in `tools/TripPlanner.SeedDatabase`, which calls the application's `IPlannerDb` methods with the same auditing decorator used by the API. Each new trip, its initial party, destinations, and visits commit together. It connects only to the local PostgreSQL instance exposed by Docker Compose at `localhost:5432`.

For a larger UI test dataset, run `scripts/seed_database --count 1000` (optionally followed by the owner's email). The count includes the three named examples; additional trips cycle through the small, medium, and large destination sets with names such as **Trip Small 0004**. The first ten samples are past trips, with the tenth ending yesterday; the remaining 990 start tomorrow and run consecutively, with one day between trips. Each destination departs three days after arrival, and the next destination starts on that departure date. For the 1,000-trip dataset this reaches roughly 40 years into the future. Dates are based on the machine's local calendar day and stay within the application's supported years (2000–2100). A smaller count creates the initial examples from the same schedule; increasing the count expands it, and reducing it preserves trips beyond that count. Reruns reuse existing trips and refresh dates on the requested samples; other trips and other fields are left unchanged.

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

At startup, the API acquires a PostgreSQL advisory transaction lock, creates the `gustavo_planner` schema when needed, then creates `gustavo_planner.schema_migrations` and loads and sorts the `.sql` files in `src/TripPlanner.Api/migrations`. Application connections use `gustavo_planner` as their search path, so all application tables and indexes live in that schema. Migration filenames use `0001_MigrationName.sql`; the four-digit prefix is the unique migration version. Applied versions and filenames are recorded in `gustavo_planner.schema_migrations`, and startup fails if an applied version has since been renamed. Keep the filename of each applied migration, including `0018_SnapshotModificationTime.sql`. New migration files are copied into build and publish output automatically.

Run `scripts/drop_db` to permanently drop the production `gustavo_planner` schema. It authenticates with the signed-in user's Microsoft Entra token and requires typing `drop gustavo_planner` before executing the drop. The API recreates the schema and its objects at its next startup, then restores contributor table grants and default privileges. Dropping the schema removes those grants from the old objects; role membership alone does not grant access to tables created afterward.

Migration `0001_CreateUsers.sql` enables PostGIS and creates `users`, `trips`, and `parties`. Each application user has a unique UUID and a unique, lowercase email address. Signing in with another provider that supplies the same email reuses the user ID and adds that provider to the row's comma-separated provider list. The table stores one required display name, a display name for the home city, its location as `geography(Point, 4326)`, and an array of preferred airline codes. Provider subjects, issuer, split given/family names, preferred username, provider verification flags, profile-image URLs, locale, hosted domain, tenant ID, and object ID are not persisted.

The same migration installs pg_cron in the configured `tripplanner` database and schedules `tripplanner-purge-fares` hourly. It removes completed or abandoned `fare_searches` rows six hours after retrieval or creation; rows assigned to an active operation are retained. Azure infrastructure allowlists and preloads pg_cron and sets `cron.database_name` to `tripplanner`. `scripts/buildout` restarts PostgreSQL when a server setting is pending restart, so pg_cron is ready before application migrations run. Editing an already applied `0001` file does not rerun it: databases created before these changes need the updated schema applied during a reset or the new SQL applied separately. The local development database received the `preferred_airlines` and `preferred_airport` columns without dropping its data. Existing cloud databases also need `preferred_airport` applied or a development schema reset; this code change does not deploy infrastructure.

Infrastructure deployment maps the App Service managed identity and a dedicated PostgreSQL provisioning identity into Entra authentication. It creates the `gustavo_planner_contributor` PostgreSQL role and maps the Key Vault operator's Entra object ID to the `gustavo_hidalgo` database login, then grants that login contributor membership. The role can connect to `tripplanner`, create objects in `gustavo_planner`, and read and modify its tables and sequences. `scripts/setup` installs Homebrew's `libpq` client, which provides `psql` for database maintenance.

A trip's editable fields are its name, description, and optional free-form JSON object `constraints` (default `{}`). `/trips` and `/trips/{tripId}` use the authenticated user's identity; Travellers can read shared trips; Planners and the owner can edit trip constraints, destinations, activities, and flight plans. Only the owner can delete the trip or manage party membership and roles. The trip response includes `canPlan` for the current user. `PUT` replaces all editable fields; omitting constraints resets them to `{}`. The existing `/user/{userId}/trips` routes remain compatibility aliases for the current GUI and preserve constraints on metadata-only updates. A new trip and its initial one-person party are inserted in one transaction.

The signed-in web dashboard starts with **New trip** and a name search. `GET /trips` and `GET /user/{userId}/trips` return `{ "trips": [...], "hasMore": true }`, with at most 10 trips per page. Query parameters are `skip` (default 0), `search` (case-insensitive name substring), `past` (true for completed trips, false for ongoing/future/undated trips, omitted for all), and `today` (`YYYY-MM-DD`, supplied in the client's local calendar date; defaults to the server's UTC date). Ongoing trips sort first, followed by the nearest future dates, then undated trips; past trips sort most recent first. Name and ID break ties. The dates come from the first and last visits in itinerary order, using the other date on that boundary visit when one is missing. A trip is past when its end date is before today. The dashboard shows available dates, keeps past trips collapsed initially, expands them when searching, and loads another 10 on demand for either section. The database filters and pages before returning results, avoiding per-trip read queries. Offline mode uses the same search, ordering, sections, and paging over the remembered catalog while disabling edits. Loaded pages merge into that catalog without removing downloaded trip documents. The iOS client follows the paged response, and the MCP `list_trips` tool accepts the same query fields.

Destinations are Point GeoJSON Features at `/trips/{tripId}/destinations/{destinationCity}`, with their own `properties.constraints` object. Destination stays and activities belong to that city resource. Flight planning is independent at `/trips/{tripId}/flights`; its search document lives in separate `flight_constraints` storage and never appears as trip constraints. Migration `0005` preserves existing flight-search documents in that column. The trip page now starts on Overview; trip-wide date and flexibility controls are a follow-up.

`GET /user` reads the authenticated ASP.NET principal and asks `IPlannerDb` for the user. The database creates the row only when the provider identity is new. The response includes `completedOnboarding`, which becomes true after a home-city geographic point has been stored. Other requests do not write to `users`.

`GET /user/avatar` uses the access token in the current authenticated session to retrieve the profile image from Google UserInfo or Microsoft Graph. The API returns the image without storing its URL or contents; the client falls back to the user's initials when the provider has no image. Microsoft sign-in requests the delegated `User.Read` scope for this lookup.

During onboarding, the client debounces city searches and calls Azure Maps Geocode Autocomplete directly for `PopulatedPlace` results. `GET /mapToken` returns an authenticated, short-lived SAS for that browser call. The API creates each SAS with a two-hour lifetime and an approximate limit of 50 requests per second; the browser reuses it until shortly before expiry. Selecting a result and continuing calls `PUT /user/profile` with a complete `UserProfile` object. If the city has multiple passenger airports, the profile requires a preferred airport; a sole airport is selected automatically. `GET /airports/home` resolves that list from the bundled catalog. City flight searches still include all airports, with the saved airport used as a ranking preference. The same route saves home-city, preferred-airport, and airline changes from `/profile` in one database update. The avatar button opens a menu with **Your profile** and **Sign out**. Preferred airlines initialize the owner's party preferences in newly opened planning documents.

Airline preferences in the profile and the airline filter in flight results, use the same searchable multi-select combobox. Chosen airlines appear as removable tags; profile and planning preferences persist airline codes, while result filters preserve carrier names in the route query.

The UI uses explicit Save/Apply buttons for groups of values that need validation together, and saves independent valid actions directly. Independent free text saves on blur. Automatic saves retain confirmed values or drafts on failure and provide an error and a retry path. Requests still replace complete resources; independent edits preserve other confirmed values rather than submitting unrelated unfinished drafts.

| Editor or action | Save behavior | Reason |
| --- | --- | --- |
| Existing trip name and description | Each field saves on blur | Each field is independently validated; an empty name stays in the editor until corrected |
| Destination visit dates and constraints | **Save dates** | Arrival, departure, flexibility, and ordering must be valid together |
| Stay search result | Selecting a located result saves immediately; removal also saves immediately | A result is a complete accommodation choice; searching alone does not change the saved stay |
| Activity details | **Save activity** | Required name, location, links, duration, and other details are edited as one validated activity draft |
| Home city and preferred airport | **Save home city** | The preferred airport must belong to the selected city's airport choices |
| Preferred airlines | Adding or removing an airline saves immediately | Independent selection; unfinished city edits are preserved locally |
| Private, trip, and destination interests | Each text field saves on blur | Each interest text is independently valid within its length limit |
| Daily activity plan | **Save** in the event editor; drag/drop saves immediately | Complete timing changes are validated and saved with the versioned plan |
| Day name | On blur | Optional independent text; saves the confirmed plan with the new name while retaining unsaved schedule edits |
| Schedule or proposal preview | **Apply schedule / Apply this proposal** | Explicitly accepts an entire proposed replacement plan |
| Complete flight itinerary | **Save complete itinerary** | Commits the complete connected set of itinerary legs; individual flight choices already save when selected |
| New trip, destination, traveler, and onboarding | Explicit **Create**, **Add**, or **Continue** action | Submits a complete new resource or the coupled home-city/airport form |

The web client follows the browser's `prefers-color-scheme` setting and updates
between Fluent UI's light theme and the shared navy/slate dark palette in
`src/TripPlanner.Web/src/app/theme.ts` when that preference changes. Page
backgrounds are solid; drawers and menu portals inherit the same theme tokens.
React Router keeps the trips dashboard at `/` and each planner at `/trips/{tripId}`.
The dashboard also uses `/?create=1` and `/?edit={tripId}` for its forms. These
routes support direct loading, refresh, and browser Back/Forward navigation.
Flight-result filters remain in the query string, so refreshing or sharing the URL restores those filters.

Stop local services with `docker compose down`. Add `--volumes` only when you intentionally want to erase the local database and recreate it from migrations.

## Flight planning

Define destinations and visit dates on **Overview**, and manage party members through **Share** at the top right of Overview. New members default to **Traveller**; the owner can choose **Planner** when adding a member or change an existing member’s role. The member `PUT` accepts `{ "role": "Traveller" }` or `{ "role": "Planner" }`; a legacy empty request defaults to Traveller. Roles persist per party member, and demotion removes planning access. The destination drawer owns `properties.constraints.arrivalFlexibilityDays` and `departureFlexibilityDays` (independent ±0–5 day windows) with a fixed destination order. Legacy `keepAfterPrevious` values are accepted but no longer allow reordering. These city constraints apply to every visit, including repeat visits. Existing unrelated destination constraints are preserved when editing these controls.

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
steps. See [Milestone 1](docs/milestone_1.md) for limits,
[Milestone 2](docs/milestone_2.md) for the activity-planning contract and iteration notes,
and [later milestones](docs/later_milestones.md) for the deferred trip revision history.

## Activity planning

**Overview** is the default trip page at `/trips/{tripId}`. New trips start with an empty itinerary and an **Add destination** button. It opens a modal drawer from the right on laptops and fills the width on phones. Search for a city, select an autocomplete result, and optionally enter visit dates; the drawer does not ask for a country code. Saving closes the drawer and adds a visit to the overview, with a link to its activities. Canceling discards the draft. Overview lists visits chronologically, with undated visits last in itinerary order. Owners can delete a destination from its card after confirming that all visits and activities for that city will be removed. Overview opens activities from destination cards, flights from **Plan Flights** itinerary links, and party sharing controls from **Share** at the top right. A **Trips › Overview › current page** breadcrumb replaces trip section tabs and returns to Overview from each subpage, including while offline. Activity planning opens with destination tabs showing every visit’s dates and an Azure map centered on the selected city. The map fills the content width on phones and laptops. Activity cards below the map provide **Add activity** and card-level **Edit** actions. Both open a drawer; new activities use manual entry and Azure Maps place lookup. Destination tabs share a scroll position. Considering, Planned, and Not Interested display the stored Maybe, Yes, and No planning decisions, respectively. Each activity in the Ideas list has a dropdown showing its current status, with Considering (bookmark), Planned (calendar-check), Not Interested (minus-circle), and Remove (trash) options; the same menu is available in map details. Deletion requires confirmation. Read-only members see the state without editing controls. Activities have separate Description and Notes fields: Description explains the activity itself; Notes holds planner-written scheduling details, reminders, and other related information. Both support up to 10,000 characters, grow with their text in the drawer, and are saved with the complete activity. Notes remain visible in read-only details and travel with the exported trip document; they do not enforce scheduling rules. Activities support user-managed URL/label links for details, bookings, or tickets, editable in the activity drawer. Overview cards show activity counts by state, or **Plan Activities** when empty. Narrow flight cards connect the profile’s home city to the first destination, each chronological visit to the next, and the final destination back home. They show matching selected flight numbers (including connections) or **Plan Flights**, linking to the existing flight planner at `/trips/{tripId}/flights`. Located activity cards offer **Open in Maps**, using Apple Maps links on Apple devices and Google Maps links elsewhere, with browser fallback. Destination creation and visit-date editing are on Overview. A single inline calendar selects arrival and departure as a range and highlights other cities’ stays, including repeat visits, with a color legend below the month. Visits can share an arrival/departure day (for example, June 10–15 followed by June 15–20), but cannot overlap inside another visit. The calendar blocks conflicting selections, including ranges spanning another visit; REST and MCP reject conflicting date writes with `409 destination_dates_overlap`. Editing excludes only the current visit, not every visit to its city. PostgreSQL serializes date checks and writes per trip to prevent simultaneous edits from creating overlaps. Map loading and failures are visible, with a retry that fetches a fresh SAS token. **Activities** remains available at `/trips/{tripId}/activities`; flights, stays, and plans are no longer navigation tabs in this first design pass. Trip-wide dates and flexibility controls will follow. The **Choose stay** drawer searches Maps by hotel name or address. Users select a pin to save the accommodation for that visit.

`GET /trips/{tripId}/destinations` returns an `application/geo+json` FeatureCollection, empty for a new trip. `POST` to the same route accepts a destination GeoJSON Feature with required Point coordinates from the selected autocomplete result and properties `name`, `countryCode`, optional object `constraints`, and optional `arrivalDate` and `departureDate`. The country code remains API metadata rather than a form field. `PUT /trips/{tripId}/destinations/{destinationCity}/stays/{stayId}` replaces its optional dates; `DELETE` removes the visit. `?includeInactive=true` includes cached past cities. `GET /trips/{tripId}/destinations/{destinationCity}` returns a city Feature. Under that city, `GET` and `POST /activities` list and create complete activity Features, and `GET`, `PUT`, and `DELETE /activities/{activityId}` read, replace, and remove one. Activity writes require the city's `contextVersion` in `Destination-Context`; replacements and deletes also require the current activity ETag in `If-Match`.

Activity-planning routes and MCP tools accept a destination ID (for example
`tokyo-jp`, preferred) or its exact saved name (`Tokyo`, case-insensitively) in
`destinationCity`. Reads, replacements, preferences, assessments and proposals
resolve to the same ID; ambiguous names require the ID. A destination with no
saved plan returns HTTP 200 with an initial plan, version 0, ETag `"0"`, and a
planning context version. Initialize it by replacing that complete plan using
those validators; no separate initialization call is needed. A missing destination
returns `destination_not_found` (404), an ambiguous name returns
`destination_ambiguous` (409), and an existing destination whose planning context
cannot be loaded returns `planning_lookup_failed` (503).

Each destination's activity-plan day has an optional `name` of up to 200 characters,
such as **EPCOT Visit**. Names appear with the date in the calendar heading and
its date picker. Open **Day details** to edit the name; existing days save on blur
with saving/error status and Retry. Offline and read-only views retain the same
layout with editing disabled. Names are labels and do not constrain the scheduler or move with
activities. Removing a day removes its name; changing a date does not shift names
by day number.

Names live in `preferences.destinations[].schedule.days[].name` in the trip document
and in the existing activity-plan GET/PUT and MCP contracts. Surrounding whitespace
is trimmed and blank names become `null`. Name autosave replaces the complete last
confirmed plan using its ETag and context version while retaining unrelated local
schedule drafts. A name-only replacement preserves saved assessment/timing and its
staleness, increments the plan version, and makes earlier proposals stale. It does
not refresh evidence or run the scheduler. Plans remain stored as JSONB with no
additional table or column.

Manual activity location searches use Azure Maps Fuzzy Search for venue
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

To include PostgreSQL queue tests, set `TRIPPLANNER_TEST_POSTGRES` to a local test
administrator connection string when running `dotnet test`. They create an isolated
`planner_test_*` database, apply migrations, exercise concurrent claims and cache/lease
expiry, then remove only that database. In-memory tests use `InMemoryPlannerDb`.

## Authentication

Authentication is handled by the API's ASP.NET Google and OpenID Connect middleware in both production and development. Azure App Service Authentication is explicitly disabled. The API stores provider tokens in its encrypted HTTP-only authentication cookie so it can retrieve profile images without persisting image URLs. Google and Microsoft sign-ins persist across browser restarts for 30 days. Sliding expiration renews the cookie when a request arrives after more than half its lifetime has elapsed; 30 days without renewal requires signing in again. Signing out clears the cookie. The production container serves the React application and API from one origin, allowing a `SameSite=Lax`, `Secure` persistent cookie; development uses equivalent settings compatible with HTTP localhost. Data Protection keys persist in App Service's mounted `/home` storage and a local Docker volume so sessions survive container replacement. Provider secrets remain server-side in both environments. Existing session cookies become persistent after the next sign-in.

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

MCP server instructions, tool descriptions and input schemas distinguish activity
ideas from scheduling. Agents should first create or reuse an undated idea such as
**Insadong crafts, tea, and Jogyesa**, then read `get_activity_plan` and use
`replace_activity_plan` to select and place its ID on the requested visit/date.
Requested times and dates belong in plan `rules` (`fixedDate`/`fixedStart`), with
ordered activity IDs in `days`; `Yes` alone means selected, not scheduled.
`days[].stayId` is the destination visit ID from `context.visits`, not the hotel ID.
Names and descriptions should not carry itinerary dates or day numbers. These are
agent instructions; existing activity names are preserved, and genuine dated event
names remain valid.

OpenIddict provides an OAuth authorization server alongside the existing Google
and Microsoft sign-in. ChatGPT and Muse use separate registered public clients
(`chatgpt` and `muse`, no client secrets), authorization-code flow with S256 PKCE,
exact callback allowlists, explicit CSRF-protected consent, and tokens bound to the
canonical `/mcp` resource.
`tripplanner.read` permits reads; `tripplanner.write` permits reads and writes that
the connected user is authorized to perform. Request `offline_access` for refresh
tokens. Access tokens last 15 minutes; refresh tokens last 30 days. Reference access
tokens and OAuth protocol state persist in PostgreSQL. Token revocation is checked
on each MCP request. Profile → **Connected agents** can revoke all MCP agent tokens
for the current user without removing their Activity Log.

Profile → **Activity Log** shows compact rows, loads five changes at a time, and
offers **Load more activity** for older entries. The **Activity source** filter
selects all changes, API (website and API-client changes), or MCP (ChatGPT and other
MCP agents). `GET /user/activity-log?skip=0&source=MCP` returns `{ entries, hasMore }`;
`source` is optional (`API` or `MCP`), and filtering happens before pagination.

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

For Muse, use the same MCP server URL and OAuth discovery URLs, client ID `muse`,
and no client secret (token endpoint authentication method `none`). Its exact
registered callback is `https://agent.meta.ai/api/hatch/oauth/callback`. Request
`openid offline_access tripplanner.read tripplanner.write` using response type
`code`, authorization-code flow with S256 PKCE, and the canonical `/mcp` resource.
Refresh tokens use the `refresh_token` grant. After **Allow access** or **Cancel**,
Muse shows **Access approved** or **Access not granted**, with **Return to Muse**
to finish the OAuth handoff. This avoids browser restrictions on cross-site
redirects after the consent form POST. Both clients are registered or updated at API startup, including
after a release; adding Muse does not change ChatGPT's registration.

Configuration binds to `McpOptions`: `Mcp:Enabled`, `Mcp:Issuer`, `Mcp:Certificate`
(base64 PFX), `Mcp:RedirectUris` (ChatGPT callbacks), and `Mcp:AgentClients`
(additional public MCP clients, defaulting to Muse with the callback above).
Agent client IDs must be unique across MCP and native clients, and MCP callbacks
must be exact HTTPS URLs. Development Compose enables MCP through Vite
at `http://localhost:5173/mcp` with ephemeral OAuth keys, so restarting invalidates
development tokens. `LOCAL_MCP_ISSUER` can override the development issuer. For
ChatGPT testing, use a publicly reachable HTTPS host/tunnel and register its login
callbacks with Google/Microsoft; a production ChatGPT client cannot reach localhost.
Vite proxies `/mcp`, `/oauth`, and `/.well-known` to the API.

Native clients use the same issuer with public client registrations in
`Mcp:NativeClients` (the shared OAuth issuer must be enabled with `Mcp:Enabled`).
`infra/release.bicep` registers `tripplanner-ios` (display name `TripPlanner iOS`)
with the exact callback `tripplanner:/oauth/callback` on each release. For example:

```json
{
  "Mcp": {
    "Enabled": true,
    "Issuer": "https://your-tripplanner-host/",
    "NativeClients": [{
      "ClientId": "tripplanner-ios",
      "DisplayName": "TripPlanner iOS",
      "RedirectUris": ["tripplanner:/oauth/callback"]
    }]
  }
}
```

Use the system authentication browser and authorization code flow with PKCE S256,
`state`, an exact registered callback, and `resource=https://your-tripplanner-host/api`.
Request `tripplanner.read` and, when needed, `tripplanner.write offline_access`.
Exchange/refresh at `/oauth/token` with the public `client_id` and no client secret;
keep refresh tokens in the platform's secure credential store. Send the access
token in `Authorization: Bearer ...` for REST requests. Cookies, an Origin header,
and browser CORS behavior are not part of this contract. REST authentication
failures return `401/403` instead of HTML login redirects. API and MCP token
audiences are separate. OAuth server metadata is at `/.well-known/oauth-authorization-server` and API resource metadata
at `/.well-known/oauth-protected-resource/api`. Native clients should persist the
last successful document per account/trip and follow the same explicit conflict
refresh protocol as the web app. Offline writes are not queued.

**Profile → Activity Log** shows new successful trip mutations, newest first, with
the authorizing user, client/source, trip name, resource, action, and timestamp.
Website changes, agent changes, and activities saved by the background assistant
are attributed separately. The `ChatGPT` and `Muse` labels identify the registered
OAuth client; they are not derived from a caller-supplied header. Logs are visible to the
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

Activities has **Ideas** and **Schedule** views. Ideas has independent pill filters
for Considering, Planned, and Not Interested, each with its status icon and count.
All three start enabled. Counts reflect the current search, and enabled statuses
share one list in their original order. Filters remain available offline and in
read-only mode. Map marker numbers stay consistent when filtering the list.
A plan selects activities,
assigns each activity at most once across repeat visits, and orders each day.
Schedule centers a day calendar with an hour rail and time-proportional event blocks.
On wide screens, a searchable activity list sits to its left and the map to its
right; both dividers resize with dragging or keyboard arrows. On smaller screens,
the list and map stack below the calendar and scroll with the page.
Drag an activity from the list onto the calendar to schedule it, move an event
to change its time, or drag its start/end handles to resize it. Timing snaps to
15 minutes, previews before release, and saves the complete versioned plan on
drop. Drag near the calendar's top or bottom to scroll; hover the previous/next
day button to move an event to another visit day. Escape or dropping outside
the calendar cancels the gesture. Failed saves keep the confirmed event and offer
a retry. Touch users drag activities by their dotted handle.
Use previous/next or the date picker to navigate visit days, including empty days.
Activities without timing appear in **Unscheduled**. Tap one, or use **Add event**, to choose
its visit date, start, and end. **Save** submits the complete plan with its ETag and
planning context; **Cancel** discards the editor draft. Moving an event schedules
it exactly once, retains its other restrictions, and validates flight availability
before saving. Overnight events use **Ends next day**. Times use the destination's
time zone, which appears in the calendar toolbar. Saved meals and flights appear
alongside activities. Overlapping events occupy separate columns.

Tap a travel block between activities (or to/from a saved stay) to choose
**Driving** or **Walking**. **Calculate travel time** calls the Azure Maps Route
Matrix API from the browser using its authenticated Maps SAS. Estimates use
historical traffic without a specific departure time and round up to whole minutes.
Users can also enter a travel allowance directly. Changing mode clears the draft
allowance. **Save** updates the complete plan with a leg-specific mode and ISO 8601
duration; individual choices take precedence over the day's default mode.
Failed calculations retain the allowance and can be retried. **View route** previews
the selected mode on the map without saving the draft. No standalone transportation form appears on Overview.

The calendar remains available offline with date navigation, scrolling, event
inspection, and disabled editing/calculation controls. Save failures retain the
draft for correction or refresh; pending saves prevent overlapping writes. Day
names remain editable on blur under **Day details**, using a complete versioned
plan update. Scheduling proposals, detailed assessments, and advanced restrictions
remain available through REST/MCP rather than a second planning form below the
calendar. Existing saved restrictions are preserved when editing event timing.

Overview destination cards let you edit dates by tapping the date range. Their
utilization bars use saved assessments of travel, meals, activities, and reserved
slack; gaps between scheduled events remain free time.

On tablets and laptops (768px and wider), drag the divider between the activity
column and the map to resize them. Focus the divider and use the arrow keys for
keyboard resizing; Home and End move to the minimum and maximum column sizes.
New destinations automatically resolve and save their IANA timezone from the city's
coordinates using the bundled [GeoTimeZone boundary data](https://github.com/mattjohnsonpint/GeoTimeZone).
Normal city lookups work offline and require no Azure Maps permission or user input.
Azure Maps timezone lookup remains a fallback when no recognized civil zone is found
in the local data; synthetic ocean offsets are not used as city timezones. API clients
can omit `timeZone`; repeat visits reuse the saved city timezone. Older destinations
with a missing timezone also resolve it in destination and planning responses without
mutating shared data during a read. Destination replacement resolves an omitted zone
before saving, and saved plans missing a zone inherit the city's zone when loaded.
The Schedule view displays the resolved city timezone in the calendar toolbar;
it does not ask users to choose a timezone. Explicit API overrides remain supported.
If both lookup sources fail, the zone remains unknown with a retry explanation;
manual planning remains available and calendar entries need known timing rather than a guessed zone.
The event editor changes dates, start/end times, and transportation. Must-do,
relative-order, meal, opening-hours, and availability restrictions remain supported
by REST/MCP and are preserved by web timing edits. Conflicting plans can be saved with explanations.
Profile interests are private; trip and destination interests are shared. Preference
scoring combines all travellers with equal weight and narrower instructions take
precedence. Agent-proposed timing rules and flight-derived availability require
explicit acceptance.

The activity map stays visible in Ideas and Schedule. Ideas has a search icon beside **Add activity**. Opening it replaces the heading
and actions with a focused search field and an X button. The filter searches all
activity field values, works offline, and stays active until X clears and closes
it. Map markers and their numbering remain unchanged.
On phones, Ideas and Schedule scroll with the page, and activity editors scroll
through their action buttons. The calendar's hour grid scrolls independently. Overview keeps destination names and dates above
the card actions. Action results use dismissible Fluent UI toasts anchored at the viewport’s top-right, above drawers and dialogs without moving when focus changes: successes close
automatically, while failures stay visible for review. Field validation and
loading failures remain beside the relevant content.
Dismissing a focused toast restores focus to its previous control so an open
dialog remains accessible for retrying the action.

Manual planning and deterministic assessments need no AI or provider credentials.
Unknown durations, travel and hours stay provisional with explicit assumptions.
Durable proposal jobs use OR-Tools CP-SAT, publish partial results, and return
reviewable alternatives and incremental changes. Neither research nor optimization
changes the saved plan. Plan replacements require both `If-Match` and the returned
input `contextVersion`; stale proposals must be regenerated. Existing activities marked Yes
start selected and unscheduled. All new shared mutations use the Activity
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
Automatic transport chooses the shortest supported walking or driving duration
for each leg at its scheduled departure, including accommodation connections.
Both modes are requested during routing enrichment; preference scores only break
same-duration ties. Fresh provider evidence takes precedence over an unverified
estimate for a missing alternative. Until evidence is available, distance-based
estimates are explicitly provisional. `fastest` is the default day transport mode;
legacy day-level `walking` settings use the same automatic behavior. Explicit
per-leg walking/driving/taxi choices and manual durations remain in force; a
whole-day driving choice still uses driving for the day. Public transit is not
supported. Language-model research and preference interpretation are performed by the user’s agent. The server uses supplied activity metadata and explicit scheduling restrictions.

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
and that the resource is accessible. These checks and release Bicep compilation
run alongside the local tests and builds; all must succeed before pushing the container.
Rerun buildout after adding infrastructure resources;
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
requests and jobs are included with origin-only URLs. Browser telemetry uses role
`TripPlanner.Web` and server telemetry uses `TripPlanner.Api`. Inspect related dependencies
and requests in **Transaction search / end-to-end transaction details** using the shared
operation ID.

MCP transport requests at `/mcp` are collected. Each tool invocation adds a span named
`MCP <registered-tool-name>` with `mcp.tool.name`, `mcp.result.status_code` when available,
`tripplanner.outcome`, the deployed server guidance version (`mcp.guidance.version`),
and a bounded error category (`error.type`). This records validation,
permission and business failures even when the MCP transport returns HTTP 200. Unknown
tool requests use `unknown_tool` and the numeric `rpc.error_code`; arbitrary client-supplied
names, arguments, results, error messages and exception stacks are not exported.

The version tag identifies the deployed server catalog; it does not prove that a client
refreshed cached instructions or that the model read them. Inspect recent real calls with
[the MCP tool-call query](docs/observability/mcp-tool-calls.kql). Tool counts and errors
help find missed context reads, invalid arguments and repeated version conflicts. Server
traces have a request operation ID; they do not establish conversation identity across
separate calls unless the client supplies shared trace context. Counts across unrelated
requests are not a per-conversation instruction-following score.

MCP does not receive the user's complete chat, the model's private reasoning, or its final
answer outside tool calls. Evaluating themes and recommendation quality also needs a
client-side transcript or a controlled eval. Production argument/result recording would
need a separate, explicitly enabled capture path with field redaction and limited
retention; general Application Insights traces continue to exclude those bodies. Start
with a controlled test account, anonymize a real failure into a fixture, and replay it
against instruction revisions rather than replaying writes against a user's live trip.

Each claimed fare-search or activity-planning job creates a
`Job <kind>` server span. Idle polling creates no spans; handled failures and retries mark
the job attempt as failed. HTTP calls made by the job become child dependency spans, so
Ignav and Maps calls are visible even though processing happens after the enqueue request
has finished. Queued jobs currently start a new operation; enqueue-to-worker trace context
is not persisted.

No additional Azure resource or provider-side configuration is needed for Application Map.
After deploying, run a Maps lookup and a fresh fare search, then select a time range covering
those calls in **Application Map**. External dependency nodes should appear for
`atlas.microsoft.com` and `ignav.com` (or the configured provider host). Previously omitted
telemetry cannot be backfilled. See [Microsoft's Application Map documentation](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-map).

To inspect agent failures in the Application Insights Logs view:

```kusto
dependencies
| where timestamp > ago(24h) and cloud_RoleName == "TripPlanner.Api"
| where name startswith "MCP "
| project timestamp, name, success, duration,
    status = customDimensions["mcp.result.status_code"],
    outcome = customDimensions["tripplanner.outcome"],
    serverGuidanceVersion = customDimensions["mcp.guidance.version"],
    error = customDimensions["error.type"],
    rpcError = customDimensions["rpc.error_code"], operation_Id
| order by timestamp desc
```

Provider HTTP calls appear in `dependencies`; job executions appear in `requests` with
names starting `Job `. Both share an operation ID for end-to-end inspection.

URLs lose query strings, fragments and identifiers before export; server requests use
route templates or fixed job names. Third-party browser calls, calendar feeds,
authentication endpoints, avatars, health probes, token endpoints and configuration requests are excluded from
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

Release prerequisites are installed by `scripts/setup`: Azure CLI, Docker with a running daemon, .NET 10 SDK, Node.js with Corepack, Task 3.54 or newer (`brew install go-task`), Git, and curl. Repository dependencies are installed by `scripts/install`.
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

Commit all changes before releasing, including staged, unstaged, and untracked
files; ignored build outputs are allowed. The script checks the checkout before
running prerequisites and again before publishing, and verifies that HEAD still
matches the starting commit. After deployment verification it checks once more
and creates an annotated Git tag on that commit, named `YYYY.MM.DD.N` (for example,
`2026.11.13.1`). The date uses `America/New_York`; N starts at 1 each day and is
one greater than the highest existing local release tag for that date. Fetch
shared tags before releasing from another checkout. Tags are created locally;
the script does not push Git commits or tags. Failed pipelines do not create a
release tag. If tagging itself fails after verification, the deployment has
already completed; resolve the tagging failure before recording the release.

After tagging, the script automatically moves the **Unreleased** changelog entries
into a section named with that exact tag, retains an empty **Unreleased** section
above it, and creates a separate commit containing only `CHANGELOG.md`. The tag
remains on the deployed source commit; neither the tag nor the changelog commit
is pushed. Empty **Unreleased** sections produce no release section or commit.
The changelog structure is validated before deployment. If the rollover commit
fails after tagging, the script reports the completed deployment and tag; resolve
the Git error and commit the rollover separately without moving the tag or
redeploying. See [AGENTS.md](AGENTS.md#release-and-changelog-instructions) for agent
release instructions.

`scripts/release` runs the dependency graph in `Taskfile.yml`, with zsh stages in `scripts/release-tasks`. Azure preflight checks, Bicep validation, C# formatting checks, and frontend dependency installation can overlap. Frontend lint, tests, and the production build share one frozen pnpm install and then run independently. The API test suite and Docker image build wait for the frontend tests to finish, so native solver threads and container compilation do not compete with timed UI interactions. The Docker image also waits for the frontend build because it packages `dist` into `wwwroot`, and for the release airport-catalog refresh. A failed catalog download or incomplete result stops release preparation. Publishing the stable image tag waits for every required check and the image build to succeed; deployment, restart, and readiness verification follow in order. A failed prerequisite cancels the remaining preparation work immediately. Infrastructure outputs are fetched once per release.

The release defaults to four concurrent Task commands. Reduce CPU and memory pressure with `RELEASE_CONCURRENCY=2 ./scripts/release` (or use `1` for sequential execution). `--skip-tests` skips C# formatting checks, API tests, and frontend lint/tests while retaining preflight checks, builds, and deployed-app verification. Each invocation uses a temporary context directory that is removed on success or failure; deployment steps always run and are not cached.
Only one release or release check can run in a checkout at a time, since they
share build outputs and the local image tag. If a process is forcibly killed,
verify the PID in `.task/release.lock/pid` has stopped before removing that lock.

The Task entry point forwards the same script options after `--`:

```zsh
task release -- --resource-group rg-tripplanner-dev
```

Use `./scripts/release --check` (or `task release:check`) to run the same Azure
preflight checks, validations, and builds through the local Docker image without
publishing the registry tag, deploying, restarting the application, or creating a
Git release tag. It requires the same clean checkout; changelog entries remain
under **Unreleased**.

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

Travel blocks in the daily Plan open a transportation editor. **View route** opens the map, draws the previewed street route in the selected mode, and frames the path, including travel to and from the visit's stay. Changing the plan or destination clears the selection. Route previews are available to Travellers as well as Planners and do not save the draft. The API derives both locations and the departure from the authorized day's plan; it does not accept arbitrary routing coordinates. This map-only preview is deliberately excluded from MCP tools. Route responses whose start or end is over 500 metres from the requested location are rejected instead of drawn. Azure can return coarse paths on sparse road coverage in Japan; a successful HTTP response does not establish a usable street route there.

### SPA updates after release

The API serves `index.html`, including SPA route fallbacks, with `Cache-Control: no-store`. Browser navigation to `/trips/{tripId}` or `/trips/{tripId}/flights` requests `text/html` and receives the SPA shell; API requests to the same URLs retain their JSON behavior. These shared routes send `Vary: Accept` so caches distinguish the representations. Vite's hashed JavaScript and CSS assets are cached for a year as immutable; other static files require revalidation. Reloading the page fetches the current HTML and therefore the current bundle URLs. An already open tab continues running its loaded code until reloaded. Previously cached HTML may need one hard refresh after this policy is first deployed.

`scripts/release` waits for both API health and a SHA-256 match between the public HTML and the locally built `dist/index.html`, using a unique query string to bypass older cached responses. This prevents the previous container's healthy response from being treated as proof that the new UI is live. The stable `release` image tag is unchanged.

Place searches in activity and stay drawers share numbered full-width result buttons, name/address typography, and loading placeholders. Stay search results appear as matching numbered pins in the drawer map; selecting a result or its pin saves the same stay location.

Destination accommodation is managed with the stay button on each visit card on Overview. Repeat visits to the same city have independent accommodations. `GET`/`PUT`/`DELETE /trips/{tripId}/destinations/{destinationCity}/stays/{stayId}/location` reads, replaces, or removes that visit's accommodation; PUT accepts a GeoJSON Point Feature with `properties.name`. Destination Features return it as `properties.stays[].stayLocation`. Each visit's accommodation appears as a distinct house marker on the activity map. Owners and Planners can change it; Travellers can view it. The evaluator, route enrichment, and solver use the correct visit's hotel for the day's outbound and return travel; a visit without a hotel keeps the existing open-route behavior. Changing accommodation invalidates the planning input context without moving saved calendar events. MCP exposes `get_visit_stay_location`, `replace_visit_stay_location`, and `delete_visit_stay_location` with the same authorization and validation as REST. Address research remains a city-scoped preview; saving the chosen result always requires a visit ID.

Each saved accommodation has visit-specific `properties.checkInTime` and `properties.checkOutTime` ISO local clocks (`HH:mm:ss`), defaulting to `16:00:00` and `11:00:00`. The stay drawer's **Details** section edits both in a draft and saves the complete accommodation resource, preserving the selected hotel. These times are stored on the visit's accommodation selection, survive portable documents and offline hydration, and appear as check-in/check-out events on the visit's arrival/departure dates in Schedule. Repeat visits to the same hotel can use different times. Migration `0023_StayCheckInOutTimes.sql` adds and defaults the two clocks for existing selections. The existing `replace_visit_stay_location` MCP tool accepts the same clocks.

Changing either date of a visit atomically unschedules activities assigned to that visit and clears their fixed dates/times, its saved day settings and availability choices, and its dated travel overrides. Activities retain their decision states, durations, and preferences and can be scheduled again. Other visits, including repeat visits to the same destination, retain their schedules. Saving unchanged dates or rejecting an invalid date change leaves schedules intact; old plan versions cannot restore invalidated assignments.

Migration `0015_VisitStayLocations.sql` copies each old city-wide accommodation onto all of its existing visits, preserving current choices while allowing independent edits afterwards. New visits start with no accommodation, and deleting a visit cascades only to its own accommodation. The old city-wide `/stay` read/write routes are replaced by the visit-specific resource so clients cannot accidentally update all visits.

The activity editor uses a duration slider from 30 minutes to 12 hours in half-hour steps, with a readable value and keyboard controls. Unknown durations can be set to 30 minutes or chosen with the slider, and **Clear duration** restores an unknown value. Existing researched durations, including values outside those increments, remain unchanged until edited. API durations continue using ISO 8601.


### Travel-agent MCP planning

TripPlanner never calls an LLM on behalf of travelers. The connected agent uses
its own model and browsing tools, under the caller's billing, to research venues,
interpret preferences and propose an itinerary. MCP supplies trip context and
validated tools to save complete resources. There is no LLM feature flag, server
OpenAI credential, AI research endpoint, photo import, or trip-form generation.
The deterministic scheduler, Maps routing/geocoding and flight searches remain.
The separate developer eval runner calls OpenAI using its own Key Vault key.
Historical database research-job records and the retired flag column are left
untouched; the application no longer reads or writes them.

Agents start activity recommendations and daily planning with `get_planning_context(tripId)`.
This read-only MCP tool returns the portable trip document (destinations, visit dates,
existing ideas and schedules), the connected user's profile preferences, shared trip
and destination preferences, and versioned guidance.
It requires read or write scope and trip visibility. It excludes other travelers' raw
private profiles. No new REST route is needed for this aggregate MCP read.

After researching a venue's street address, agents can call the read-only
`geocode_address(tripId, destinationId, address)` tool. TripPlanner uses the saved
destination's country and coordinates to guide the lookup. A single precise
match returns a GeoJSON Point in `data.geometry` and a `data.formattedAddress`
to check against the source. Agents can pass that Point as `request.geometry`
to `create_activity` or `update_activity`. The tool returns null fields when it
cannot identify a precise match; this is a provider limitation, not evidence that
the venue cannot be located. Null, failed, ambiguous or geographically inconsistent
results require an independent web-based coordinate search before declaring the
location unresolved. Search the venue's official and local-language names and full
address with terms such as GPS coordinates, latitude longitude, 緯度 経度 and 地図.
Consult relevant official venue maps, Google Maps, NAVITIME, MapFan, Yahoo! Maps
Japan, OpenStreetMap, Wikidata, government/tourism sources and reputable directories.
Extract coordinates from published points, map metadata, structured data or
documented map links; a viewport center alone does not identify a venue. Check the
establishment, branch, building or entrance and corroborate with a second independent
source when possible. Independently verified coordinates can be saved directly;
they do not require validation by `geocode_address`. Government records are useful
but are not required, and a failure at one provider is never sufficient to stop.

The versioned planning guidance describes the full location workflow. Physical
venues need a meaningful point; areas use a representative entrance or landmark,
and nonphysical activities may have null geometry. Agents always save a researched
address in `properties.address`, even when coordinates remain unresolved, preserving
a more complete verified address over an abbreviated geocoder result. Coordinate
provenance uses the existing `properties.links` for source URLs and
`properties.description` for resolution method, precision classification
(Verified entrance, Verified venue, Representative area, Approximate, Unresolved),
verification status and uncertainty. Approximate points are labeled for preliminary
planning and do not fulfill a specific venue's reliable GPS requirement. Every
identifiable physical venue must have a saved verified address and reliable GPS
point, or an explicit Unresolved record after reasonable independent alternatives
are exhausted, listing attempted sources and the specific reason no reliable point
could be established. Unresolved locations retain null geometry. Agents preserve
existing fields, state and scheduling, use the current activity ETag and destination
contextVersion, and read back with `get_activity` to verify both address and GeoJSON
Point coordinates in `[longitude, latitude]` order. Address resolution and coordinate
resolution are separate outcomes; exhausted research is reported without repeatedly
submitting identical unsuccessful geocoding requests.

`plan_destination(tripId, destinationCity)` is also available through MCP `prompts/list`
and `prompts/get` for clients that support user-selected prompt templates. The first
part of initialization instructions points agents to planning context so ordinary tool
use does not depend on selecting that prompt. Refresh the MCP connection after release
to discover the new tool, prompt and activity schemas.

All MCP-facing instructions and prompt text live in
`src/TripPlanner.Api/Instructions/McpInstructions.cs`, with one sentence per source
line. Multiline raw string literals keep longer instructions readable in C#.
The catalog includes initialization instructions, versioned planning guidance and
preference precedence, the destination prompt, tool and parameter descriptions,
shared field/schema descriptions, and MCP recovery messages. Tool handlers, prompt
registration and shared validation metadata reference these strings through standard
`DescriptionAttribute` metadata instead of owning prose. Keep protocol names, validation constraints,
authorization and handler logic at their existing call sites. Bump
`McpInstructions.Planning.Version` when changing agent behavior. Rebuild/release the
API and refresh the client's MCP connection to pick up revised instructions.

Each day should have a coherent theme based on interests, geography or an anchor activity; this remains prompting guidance and is
not a persisted theme or scheduling constraint. Conflicting preferences use the current
explicit request, destination, trip, profile, then application defaults; unrelated
preferences combine. Conversational preferences are saved only when the user requests
or accepts remembering them.

Activity kind selection is optional: `kinds` is a duplicate-free array of free-form
strings and may be empty.
Each label must be nonblank and at most 200 characters; there is no fixed catalog.
The web editor supports adding, editing, and removing custom kind labels, with
suggestions from the signed-in user's existing activities.

`GET /user/activity-kinds` and the read-only MCP `list_activity_kinds` tool list
distinct labels across trips owned by the connected user. Shared trips owned by
someone else are excluded. Optional `search` matches a case-insensitive literal
substring (up to 200 characters); `top` defaults to 20 (maximum 100) and `skip`
defaults to 0 (maximum 100000). Results are sorted by label and return
`{ "kinds": [...], "hasMore": true|false }`. Labels are read directly from saved
activities, so changes and deletions affect subsequent queries. Responses are
private and not cached. Autocomplete remains optional: users and agents can
always enter new labels. The iOS API client supports the same query contract.

`address` is nullable; `ticketRequirement` is `Unknown`, `Required`, or `NotRequired`
(default `Unknown`). Existing `links` carry official websites and research sources.
Unknown prices remain null rather than zero. Missing ticket evidence never implies free
or ticketless entry. The web editor saves related metadata together with the complete
activity; portable documents and the native decoder preserve it. Older activity payloads
without classification must be updated before use with this contract; no classification
is inferred during decoding. Activity data remains in the existing JSON document column.

Run `./scripts/evals --smoke` to build, start, check and stop the isolated fixtures
without model calls or Azure access. After `az login`, `./scripts/evals --repeat 3`
loads `openai-api-key` from the deployed Azure Key Vault and runs behavioral evals
using `gpt-6-luna` with Flex processing by default and up to four cases in parallel.
Override concurrency with `-- --max-concurrency COUNT` (use `1` for serial runs).
It uses the same deployment,
subscription, resource-group and tenant settings as `scripts/server`; existing key
environment variables are not used by this wrapper. The fetched key is passed in
memory to the model runner and is not saved in artifacts.
`--model MODEL` or `TRIPPLANNER_EVAL_MODEL` overrides the model;
`--service-tier default` or `TRIPPLANNER_EVAL_SERVICE_TIER=default` selects Standard
processing instead of discounted, slower Flex processing. Batch requires a separate asynchronous scheduler and is not
supported by this interactive runner. The defaults live in `evals/mcp/defaults.json`.
The eval client defers tool schemas through hosted Responses tool search, keeping
planning context immediately available and loading other tools when needed.
`TRIPPLANNER_EVAL_TOOL_LOADING=full` enables the full-catalog baseline. Identical
structured/text JSON results are supplied once to the model; original MCP responses
remain in traces. Saved outputs include per-request token/cache counts and context
sizes so usage can be inspected. This client optimization does not control how
other MCP clients load tools.
The eval agent also has hosted OpenAI web search enabled by default, with searches,
source URLs and answer citations retained in results. This is independent of the
isolated MCP fixture's storage and deterministic planning and requires paid API calls.
The runner saves results under `.promptfoo/runs`;
`./scripts/evals --view` opens the saved results viewer. The runner pins Promptfoo in
`evals/mcp/promptfoo-version`, waits for its own server's readiness, and cleans up its
fixture and CLI processes on exit. Azure access is limited to account/deployment
lookup and reading the OpenAI secret; the fixtures never access production trip data.
Author realistic cases with users in `evals/mcp/promptfooconfig.yaml`: the template
uses `docs/after.json` as the Japan starting trip and has placeholders for conversation
history, the next request, and reviewer-only expected outcomes. Each execution gets
an independent in-memory copy. Blank requests make no model calls. No behavioral
grading is attached yet; a completed run does not establish that expectations were met.
See [MCP evals](evals/mcp/README.md) for authoring and runner options.

## Place artwork

The web trip header and list cards display one Flagpack flag per destination country; destination
cards and activity tabs display City Icons where the city and country match.
Both SVG collections are bundled locally and cached with the offline application
shell. Cities without matching artwork keep their text labels. Credits and license
notices are available on the **Notices** page linked from the page footer.

City Icons artwork is by [Studio Partdirector](https://svgcities.com/), licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Flagpack is by
[Yummygum](https://flagpack.xyz/), licensed under MIT. The bundled artwork is visually
unchanged; standalone SVGs are converted into symbols with namespaced internal IDs.
Source commits are recorded in `src/TripPlanner.Web/public/artwork/sources.json`.
Trip summaries include unique country codes from active destinations, allowing
list cards to show flags without loading each trip document. Downloaded documents
retain these summaries in the offline catalog.
To refresh the assets from local upstream checkouts, run
`python3 tools/vendor_place_artwork.py /path/to/city-icons /path/to/flagpack-core`,
then format the generated JSON with the web project's Prettier command.

### Open source notices

The public `/notices` page shows the required City Icons and OpenStreetMap
attributions. A linked **Third-party software licenses** document retains the
required copyright, license, and NOTICE text for distributed browser software,
Flagpack, and airport data, grouping identical notices. Server-only packages and
licenses without notice requirements are excluded. Both pages work signed out
and offline.

After changing dependencies, run `corepack pnpm run notices` from
`src/TripPlanner.Web` after installing web dependencies.
This regenerates the checked-in `src/features/notices/notices.json` attributions
and `public/notices/software-licenses.txt` from installed runtime packages.
Upstream license files missing from npm distributions are retained in
`tools/notices/licenses`, with their sources recorded in `tools/notices/sources.json`.
Review and commit the regenerated inventory with dependency or artwork updates.
