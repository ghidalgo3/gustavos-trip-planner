# Gustavo's Trip Planner

Starter architecture for a React single-page application and a C# API deployed to Azure.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/TripPlanner.Web` | React 19 + React Router + Vite + TypeScript + Fluent UI web app |
| `src/TripPlanner.Api` | .NET 10 minimal API |
| `tests/TripPlanner.Api.Tests` | API integration tests |
| `infra/main.bicep` | Azure resource definitions used by `scripts/buildout` |
| `infra/release.bicep` | Runtime and authentication configuration used by `scripts/release` |
| `compose.yaml` | Local Vite HMR and `dotnet watch` environment |
| `scripts/setup` | Install and validate the macOS development toolchain |
| `scripts/install` | Restore .NET and frontend project dependencies |
| `scripts/format` | Format frontend code with Prettier and C# code with CSharpier |
| `scripts/buildout` | Provision or update Azure resources |
| `scripts/secrets` | Store and rotate authentication, Ignav, and OpenAI credentials in Azure Key Vault |
| `scripts/server` | Load local auth configuration and start the development containers |
| `scripts/release` | Test, build, configure, deploy, and verify a release |

Users, trips, and travel parties are stored through `IPlannerDb`, with `PostgresPlannerDb` used by the application and `InMemoryPlannerDb` used by tests. PostgreSQL access uses Npgsql; Entity Framework is not used.

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

Running `docker compose up` directly still starts the application, but local sign-in remains disabled because no provider credentials are supplied.

## Database

The API requires `ConnectionStrings:TripPlanner`. Docker Compose supplies a local PostgreSQL connection string with development-only password authentication. In Azure, `buildout` provisions an Azure Database for PostgreSQL Flexible Server with password authentication disabled and assigns the App Service managed identity as its Microsoft Entra administrator. `release` supplies a passwordless TLS connection string and enables managed-identity token acquisition. Npgsql periodically refreshes the database access token through `Azure.Identity`.

At startup, the API acquires a PostgreSQL advisory transaction lock, creates the `gustavo_planner` schema when needed, then creates `gustavo_planner.schema_migrations` and loads and sorts the `.sql` files in `src/TripPlanner.Api/migrations`. Application connections use `gustavo_planner` as their search path, so all application tables and indexes live in that schema. Migration filenames use `0001_MigrationName.sql`; the four-digit prefix is the unique migration version. Applied versions and filenames are recorded in `gustavo_planner.schema_migrations`, and startup fails if an applied version has since been renamed. New migration files are copied into build and publish output automatically.

Run `scripts/drop_db` to permanently drop the production `gustavo_planner` schema. It authenticates with the signed-in user's Microsoft Entra token and requires typing `drop gustavo_planner` before executing the drop. The API recreates the schema and its objects at its next startup, then restores contributor table grants and default privileges. Dropping the schema removes those grants from the old objects; role membership alone does not grant access to tables created afterward.

Migration `0001_CreateUsers.sql` enables PostGIS and creates `users`, `trips`, and `parties`. Each application user has a unique UUID and a unique, lowercase email address. Signing in with another provider that supplies the same email reuses the user ID and adds that provider to the row's comma-separated provider list. The table stores one required display name, a display name for the home city, its location as `geography(Point, 4326)`, and an array of preferred airline codes. Provider subjects, issuer, split given/family names, preferred username, provider verification flags, profile-image URLs, locale, hosted domain, tenant ID, and object ID are not persisted.

The same migration installs pg_cron in the configured `tripplanner` database and schedules `tripplanner-purge-fares` hourly. It removes completed or abandoned `fare_searches` rows six hours after retrieval or creation; rows assigned to an active operation are retained. Azure infrastructure allowlists and preloads pg_cron and sets `cron.database_name` to `tripplanner`. `scripts/buildout` restarts PostgreSQL when a server setting is pending restart, so pg_cron is ready before application migrations run. Editing an already applied `0001` file does not rerun it: databases created before these changes need the updated schema applied during a reset or the new SQL applied separately. The local development database received the `preferred_airlines` and `preferred_airport` columns without dropping its data. Existing cloud databases also need `preferred_airport` applied or a development schema reset; this code change does not deploy infrastructure.

Infrastructure deployment maps the App Service managed identity and a dedicated PostgreSQL provisioning identity into Entra authentication. It creates the `gustavo_planner_contributor` PostgreSQL role and maps the Key Vault operator's Entra object ID to the `gustavo_hidalgo` database login, then grants that login contributor membership. The role can connect to `tripplanner`, create objects in `gustavo_planner`, and read and modify its tables and sequences. `scripts/setup` installs Homebrew's `libpq` client, which provides `psql` for database maintenance.

A trip's editable fields are its name, description, and optional free-form JSON object `constraints` (default `{}`). `/trips` and `/trips/{tripId}` use the authenticated user's identity; members can read shared trips and only the owner can change them. `PUT` replaces all editable fields; omitting constraints resets them to `{}`. The existing `/user/{userId}/trips` routes remain compatibility aliases for the current GUI and preserve constraints on metadata-only updates. A new trip and its initial one-person party are inserted in one transaction.

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

Define destinations and visit dates on **Overview**, and manage party members in its **Travelers** section. The destination drawer owns `properties.constraints.arrivalFlexibilityDays` and `departureFlexibilityDays` (independent ±0–5 day windows) and `keepAfterPrevious` (default true). These city constraints apply to every visit, including repeat visits. Existing unrelated destination constraints are preserved when editing these controls.

**Plan Flights** opens `/trips/{tripId}/flights`, which contains the flight search and selection card. It has no separate party, destination, date, advanced-constraint, or AI trip-description form. Search validation issues offer a return to Overview. Home airports come from the trip owner's profile; airline preferences initialize the search settings. Preferred airlines affect ranking rather than excluding other carriers.

The API derives the effective flight document from the current destination resources on every constraints read, search, result read, booking lookup, and selection. Stable stay IDs identify planned visits. Dates determine chronological order; an enabled ordering constraint requires the preceding visit. Destination coordinates and country select nearby catalog airports. Date flexibility applies independently to local arrival and departure, including validation of actual returned flights. Changes take effect without saving a second planning document. Existing API clients with flight-only trips can still use their stored flight documents until destinations are defined.

**Find flights** prepares a bounded set of provider requests and queues Ignav calls. Invalid requests return HTTP 400 with planning issues; accepted searches return HTTP 202 with a polling URL. The existing engine supports up to three visits and a maximum of 60 trip days. Airport catalog sources and home-airport selection rules are in [Data/README.md](src/TripPlanner.Api/Data/README.md).

The browser supplies the current user time zone through
`Intl.DateTimeFormat().resolvedOptions().timeZone`; there is no time-zone input.
Airport time zones come from the catalog and are used internally to handle
overnight travel and date-line crossings. Calendar values remain date-only strings.
Planning combines party members' requirements, explains missing inputs and
conflicts, and prepares at most `Planning:FareRequestLimit` unique fare requests per
party (default 160). Multi-destination searches reserve request slots across
all legs before paired fares. `Planning:DatePairLimit` defaults to 40 for round-trip date
candidates before airport expansion. Fresh cache hits conservatively count toward
the request cap, so actual provider calls can be fewer. The return-flight date is the date the flight home begins and maps directly
to the provider request's return date. The API validates actual itinerary timing,
required presence, journey duration, and layover geography when reading cached fares.

Route planning shares dated legs across candidates and queries one-way fares plus
paired outbound/homebound open-jaw fares through Ignav's flexible endpoint. It
prioritizes first-leg searches and displays their fares while later-leg searches
continue. A first-leg choice carries into the complete-route picker when a
compatible itinerary is found. It
combines complete offers, validates actual flight times and all stays, and ranks
complete itineraries by price, stops, preferred airlines, home airport, and travel
time. Separate tickets between stays are allowed and labeled; self-transfer
connections are excluded. Results are a bounded sample, not a guarantee of the
cheapest possible itinerary. The same asynchronous flight-search operation,
one-hour cache, and selected-flight JSONB snapshot serve both planning modes.
Route results present one flight at a time, showing airline names, flight
numbers, layover airports and durations, and airline booking options for the
current flight. While searches run, choosing a flight advances the picker to the
next leg as its fares arrive. If saving that choice fails, the picker returns to
the previous leg and shows the server's error beside it. Each saved choice also
recomposes complete routes around
the chosen flights from cached fares, so the global result cap does not hide
later-leg alternatives. This does not make another Ignav request while the
cache is fresh. The server verifies each choice against its cached fare and
uses that fare's searched cities to identify and prioritize the next leg, even
when Ignav returns a different airport within a city.
The reusable flight card labels each endpoint with its city and airport code,
for example Atlanta (ATL) → Phuket (HKT). A flight-step TabList shows the
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
route while its original fare search is fresh. When that search expires, run
**Find flights** again to obtain current links.
Saving a complete route sends its leg identifiers and displayed price alongside the result key and index. The API resolves that quote against current cached, validated results, so additional search results cannot invalidate an unchanged selection. Changed flights or prices require reviewing the current results. The picker recognizes saved flights independently of temporary cache keys and result ordering, preserving its selected state and purchase indicators across refreshes.

The owner can mark each flight as purchased on the saved route or in Plans;
those booleans persist in the trip's selected-flight JSONB snapshot. Travel
companions can see the status but cannot change it. Prices include a local
currency symbol alongside the currency code, such as USD $900.

This prototype counts each account holder as an adult passenger. The earlier flight-form AI proposal API remains available to API clients, but is no longer exposed on the flight page. Activity AI suggestions remain in the activity drawer.
Invitations and full preference scoring are subsequent
steps. See [Milestone 1](docs/milestone_1.md) for limits,
[Milestone 2](docs/milestone_2.md) for the activity-planning contract and iteration notes,
and [later milestones](docs/later_milestones.md) for the deferred trip revision history.

## Activity planning

**Overview** is the default trip page at `/trips/{tripId}`. New trips start with an empty itinerary and an **Add destination** button. It opens a modal drawer from the right on laptops and fills the width on phones. Search for a city, select an autocomplete result, and optionally enter visit dates; the drawer does not ask for a country code. Saving closes the drawer and adds a visit to the overview, with a link to its activities. Canceling discards the draft. Overview lists visits chronologically, with undated visits last in itinerary order. Owners can delete a destination from its card after confirming that all visits and activities for that city will be removed. Breadcrumbs link back through Trips, the trip, and the current section; activity planning also shows the selected city. Activity planning opens with destination tabs showing every visit’s dates and an Azure map centered on the selected city. The map fills the content width on phones and laptops. Activity cards below the map provide **Add activity** and card-level **Edit** actions. Both open a drawer; new activities can use Azure Maps place lookup, an AI prompt, or an image import. AI suggestions and image imports are available when the profile’s AI feature is enabled, and save activities immediately as Proposed. The background worker calls OpenAI with the prompt and destination visit dates, then resolves suggested places through Azure Maps. Migration `0006` upgrades early activity job tables without discarding data. Destination tabs share a scroll position and activity state is selected with a menu button. Activities support user-managed URL/label links for details, bookings, or tickets, editable in the activity drawer. Overview cards show activity counts by state, or **Plan Activities** when empty. Narrow flight cards connect the profile’s home city to the first destination, each chronological visit to the next, and the final destination back home. They show matching selected flight numbers (including connections) or **Plan Flights**, linking to the existing flight planner at `/trips/{tripId}/flights`. Located activity cards offer **Open in Maps**, using Apple Maps links on Apple devices and Google Maps links elsewhere, with browser fallback. AI location lookup uses nearby Azure Maps POIs and a verified landmark fallback; missing AI place names fall back to the activity name. Destination creation and visit-date editing are on Overview. A single inline calendar selects arrival and departure as a range and highlights other cities’ stays, including repeat visits and overlapping dates, with a color legend below the month. Map loading and failures are visible, with a retry that fetches a fresh SAS token. **Activities** remains available at `/trips/{tripId}/activities`; flights, stays, and plans are no longer navigation tabs in this first design pass. Trip-wide dates and flexibility controls will follow. The selected result supplies the city's country and coordinates. Plan activities there before choosing flights. Adding the same city again creates another visit under one city tab, with the complete route order preserved. The city Point is cached in PostgreSQL; activities belong to the city and are shared with all trip members. Members can read them, while the trip owner can create, edit, or delete them. Removing all visits through the API preserves city activities; adding the city again restores editing. Deleting the city resource removes its activities as well. Flight selections do not create, remove, or change destination visits.

`GET /trips/{tripId}/destinations` returns an `application/geo+json` FeatureCollection, empty for a new trip. `POST` to the same route accepts a destination GeoJSON Feature with required Point coordinates from the selected autocomplete result and properties `name`, `countryCode`, optional object `constraints`, and optional `arrivalDate` and `departureDate`. The country code remains API metadata rather than a form field. `PUT /trips/{tripId}/destinations/{destinationCity}/stays/{stayId}` replaces its optional dates; `DELETE` removes the visit. `?includeInactive=true` includes cached past cities. `GET /trips/{tripId}/destinations/{destinationCity}` returns a city Feature. Under that city, `GET` and `POST /activities` list and create complete activity Features, and `GET`, `PUT`, and `DELETE /activities/{activityId}` read, replace, and remove one. Activity writes require the city's `contextVersion` in `Destination-Context`; replacements and deletes also require the current activity ETag in `If-Match`.

The owner can request suggestions with `POST /trips/{tripId}/destinations/{destinationCity}:suggest` or upload one JPEG, PNG, or WebP image with `POST .../{destinationCity}:import`. The import accepts multipart `image`, `requestId`, `destinationContext`, and optional `input`; the image limit is 10 MiB and 20 megapixels. Both routes return a durable operation to poll at `/operations/{id}`. On completion, `GET .../{destinationCity}/suggestions/{operationId}` returns the created Features and warnings. Suggestions are immediately saved with state `Proposed` and remain editable. Generation requires the `LLM` feature flag; manual activity editing does not. The map uses the existing short-lived Maps SAS, and the worker resolves candidate locations separately so an unverified place is saved without a misleading pin.

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

## Azure infrastructure and deployment

The intended target is **Gustavo Hidalgo personal subscription**, region **East US 2**. Bicep provisions:

- Azure Container Registry (Basic, admin credentials disabled) with a daily purge task
- Azure Key Vault (RBAC authorization, soft delete, and purge protection enabled)
- Azure Database for PostgreSQL Flexible Server (PostgreSQL 18, PostGIS, Burstable B1ms)
- Azure Maps Gen2 in East US with browser CORS, a search-only user-assigned identity for SAS authorization, and a least-privilege SAS issuer role for the API
- Linux App Service plan and containerized Web App
- App Service filesystem diagnostics with one-day HTTP log retention
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

Deploy application code and runtime configuration separately:

```bash
./scripts/release \
  --subscription "Gustavo Hidalgo personal subscription" \
  --resource-group rg-tripplanner-dev
```

`release` runs API and web tests, builds the production client, packages it into the API container, pushes `tripplanner-api:release`, applies `infra/release.bicep` with `infra/release.bicepparam`, restarts the application, and verifies both `/health` and the web root. Reusing the stable tag leaves the previous manifest untagged; the purge task installed by `buildout` removes it on its next run.

Authentication credentials live only in the provisioned Key Vault. A release requires all four Google and Microsoft credentials plus the Ignav API key and rejects an incomplete set. Run the scripts with `--help` for their options.

There is no GitHub Actions CI/CD configuration. Releases are intentional local operations performed using your current Azure CLI login. Azure CLI manages the subscription, resources, configuration, registry, and deployment.

## API routes

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
| GET | `/trips/{tripId}/flights` | Read selected trip flights; 204 until a flight has been selected |
| PUT | `/trips/{tripId}/flights/{partyId}` | Select or replace a fare by cache key and itinerary index |
| DELETE | `/trips/{tripId}/flights/{partyId}` | Deselect a party's flight |
| PUT | `/trips/{tripId}/flights/{partyId}/purchases` | Save purchase status for the selected flight's legs |
| GET | `/trips/{tripId}/flights/choices` | Read in-progress route choices |
| PUT | `/trips/{tripId}/flights/choices/{partyId}` | Save in-progress route choices by cache key |
| GET | `/operations?top={top}&skip={skip}&type={type}` | List the authenticated user's operations with paging and optional type filtering |
| GET | `/operations/{operationId}` | Read one authorized operation's status and progress |

In Development, review the interactive API reference at
`http://localhost:5173/scalar` through Vite's API proxy, or directly at
`http://localhost:8080/scalar`. The underlying OpenAPI document remains at
`/openapi/v1.json`.

### SPA updates after release

The API serves `index.html`, including SPA route fallbacks, with `Cache-Control: no-store`. Browser navigation to `/trips/{tripId}` or `/trips/{tripId}/flights` requests `text/html` and receives the SPA shell; API requests to the same URLs retain their JSON behavior. These shared routes send `Vary: Accept` so caches distinguish the representations. Vite's hashed JavaScript and CSS assets are cached for a year as immutable; other static files require revalidation. Reloading the page fetches the current HTML and therefore the current bundle URLs. An already open tab continues running its loaded code until reloaded. Previously cached HTML may need one hard refresh after this policy is first deployed.

`scripts/release` waits for both API health and a SHA-256 match between the public HTML and the locally built `dist/index.html`, using a unique query string to bypass older cached responses. This prevents the previous container's healthy response from being treated as proof that the new UI is live. The stable `release` image tag is unchanged.
