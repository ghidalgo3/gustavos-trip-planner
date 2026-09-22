# Gustavo's Trip Planner

Starter architecture for a React single-page application and a C# API deployed to Azure.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/TripPlanner.Web` | React 19 + Vite + TypeScript + Fluent UI web app |
| `src/TripPlanner.Api` | .NET 10 minimal API |
| `tests/TripPlanner.Api.Tests` | API integration tests |
| `infra/main.bicep` | Azure resource definitions used by `scripts/buildout` |
| `infra/release.bicep` | Runtime and authentication configuration used by `scripts/release` |
| `compose.yaml` | Local Vite HMR and `dotnet watch` environment |
| `scripts/setup` | Install and validate the macOS development toolchain |
| `scripts/install` | Restore .NET and frontend project dependencies |
| `scripts/format` | Format frontend code with Prettier and C# code with CSharpier |
| `scripts/buildout` | Provision or update Azure resources |
| `scripts/secrets` | Store and rotate authentication credentials in Azure Key Vault |
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

The script reads the four authentication values from the deployed Azure Key Vault and issues a two-hour Azure Maps development SAS with a 50 request-per-second limit. It passes those values only to the API container. It does not create an `.env` file or expose provider client secrets to the React application. The browser obtains the short-lived Maps SAS from the authenticated API route. Pass Docker Compose options through the script, for example `scripts/server --detach`; stop detached containers with `docker compose down`.

Open <http://localhost:5173>. Vite proxies `/api` calls to the API container at `http://api:8080`; editing either project triggers HMR or `dotnet watch`. The API is also exposed at <http://localhost:8080>. The web container runs pnpm in noninteractive CI mode so it can reconcile the persistent `node_modules` volume after package-manager upgrades. PostgreSQL 18 with PostGIS 3.6 is exposed at `localhost:5432`, uses the development-only `tripplanner` credentials from `compose.yaml`, and stores its data in the `postgres-18-data` Docker volume. The versioned volume lets PostgreSQL 18 use its required cluster layout while retaining any older `postgres-data` volume for deliberate migration or removal.

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

At startup, the API acquires a PostgreSQL advisory transaction lock, creates `schema_migrations` when needed, then loads and sorts the `.sql` files in `src/TripPlanner.Api/migrations`. Migration filenames use `0001_MigrationName.sql`; the four-digit prefix is the unique migration version. Applied versions and filenames are recorded in `schema_migrations`, and startup fails if an applied version has since been renamed. New migration files are copied into build and publish output automatically.

Migration `0001_CreateUsers.sql` enables PostGIS and creates `users`, `trips`, and `parties`. Each application user has a unique UUID and a unique, lowercase email address. Signing in with another provider that supplies the same email reuses the user ID and adds that provider to the row's comma-separated provider list. The table stores one required display name, a display name for the home city, and its location as `geography(Point, 4326)`. Provider subjects, issuer, split given/family names, preferred username, provider verification flags, profile-image URLs, locale, hosted domain, tenant ID, and object ID are not persisted.

Each trip has an owning user, name, description, and JSONB constraints document. A new trip and its initial party are inserted in one transaction; the initial party's UUID array contains only the owner. Deleting a trip cascades to all of its parties. Trip routes use a read-only user lookup to verify that the authenticated application user matches the user ID in the URL, and all database mutations also filter by owner ID.

`GET /api/user` reads the authenticated ASP.NET principal and asks `IPlannerDb` for the user. The database creates the row only when the provider identity is new. The response includes `completedOnboarding`, which becomes true after a home-city geographic point has been stored. Other requests do not write to `users`.

`GET /api/user/avatar` uses the access token in the current authenticated session to retrieve the profile image from Google UserInfo or Microsoft Graph. The API returns the image without storing its URL or contents; the client falls back to the user's initials when the provider has no image. Microsoft sign-in requests the delegated `User.Read` scope for this lookup.

During onboarding, the client debounces city searches and calls Azure Maps Geocode Autocomplete directly for `PopulatedPlace` results. `GET /api/mapToken` returns an authenticated, short-lived SAS for that browser call. The API creates each SAS with a two-hour lifetime and an approximate limit of 50 requests per second; the browser reuses it until shortly before expiry. Selecting a result and continuing calls `PUT /api/user/homeCity`, which stores the display name and WGS84 point through `IPlannerDb`.

The web client follows the browser's `prefers-color-scheme` setting and updates
between Fluent UI's light and dark themes when that preference changes.

Stop local services with `docker compose down`. Add `--volumes` only when you intentionally want to erase the local database and recreate it from migrations.

## Constraint editor and flight planning

After creating a trip, choose **Plan trip**. Search destinations by city, airport
name, or IATA code, then choose departure and return-flight dates with the calendar
inputs. The party's home city suggests a departure airport that can be changed.
Additional constraints are optional. Departure and return-flight windows allow
independent flexibility; a window replaces the fixed date for that direction.
Cabin, pricing market, maximum journey hours, and preferred airlines are under
**Advanced filters** in the destination-and-dates section, grouped by party.
That section also lets a party limit the search to nonstop flights, or to one or
two stops. A nonstop constraint takes precedence over this setting.

**Save planning details** stores the structured document in the existing JSONB
column. **Plan trip** validates the displayed inputs, prepares the bounded set of
flight searches, and queues the Ignav calls. Invalid planning requests return an
HTTP 400 response with the issues that must be resolved; accepted requests return
HTTP 202 with an operation polling URL. Airport suggestions use a bundled catalog
of scheduled passenger airports, so they require no provider credentials or paid
requests. Catalog sources, license, refresh details, and home-airport selection rules are in
[Data/README.md](src/TripPlanner.Api/Data/README.md). Members with different home
cities must choose a shared origin explicitly.

The browser supplies the current user time zone through
`Intl.DateTimeFormat().resolvedOptions().timeZone`; there is no time-zone input.
Airport time zones come from the catalog and are used internally to handle
overnight travel and date-line crossings. Calendar values remain date-only strings.
Planning combines party members' requirements, explains missing inputs and
conflicts, and prepares up to `Planning:DatePairLimit` requests per party (default
20). The return-flight date is the date the flight home begins and maps directly
to the provider request's return date. Actual itinerary timing, required presence,
journey duration, and layover geography still need validation after fare retrieval.

This prototype counts each account holder as an adult passenger.
Natural-language translation, invitations, itinerary validation, and scoring are subsequent
steps. See [Milestone 1](docs/milestone_1.md) for limits and
[later milestones](docs/later_milestones.md) for the deferred trip revision history.

## Asynchronous flight planning

**Plan trip** saves the displayed planning document, then starts a flight search and
returns immediately after queueing work. The client polls the generic operation API,
so searches continue when the page closes and are discovered when it opens again.
Results show their retrieval time and expiry; they remain provider results until
itinerary constraints and ranking are implemented.

Each fare shows a localized, time-only departure time, the operating flight
numbers, total outbound and return travel times, and each connection duration.
Airline, arrival-time, and stop filters support multiple selections; price can
be set with two range handles or exact minimum and maximum amounts. Selecting
**Book this fare** obtains an Ignav booking link only for that cached itinerary
and opens the provider's booking option in a new tab.

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

- `POST /api/trips/{tripId}/flightSearch` accepts `{ requestId: "UUID" }`, reads the
  trip's saved constraints, and returns **202**, a `Location` polling URL,
  `Retry-After: 2`, and the operation. Reuse a request ID when retrying an uncertain
  submission.
- `GET /api/trips/{tripId}/flightSearch` derives the required cache keys from the
  current saved constraints and returns their fresh Ignav responses. It returns 404
  when any required result is absent or expired, signaling that POST must be run.
- `POST /api/trips/{tripId}/flightSearch/{cacheKey}/bookingLinks` accepts a cached
  itinerary's `ignavId` and returns the provider booking options. It rejects a
  cache key or itinerary that does not belong to the authenticated owner's current
  trip results.
- `GET /api/operations?top=50&skip=0&type=flightSearch` lists the authenticated
  user's operations in reverse chronological order. `GET /api/operations/{id}`
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
- Two searches run concurrently per API instance by default (`Planning:WorkerConcurrency`,
  1–8). Provider timeout defaults to 480 seconds (`Ignav:TimeoutSeconds`, 1–1800).
  A lease lasts the timeout plus two minutes. Shutdown/crash recovery resumes after
  lease expiry, with at most three provider attempts after worker interruptions.
  Ordinary provider errors/timeouts finish the item as failed; a user can plan again.
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

The prompts do not echo secret values. `scripts/release` requires `google-client-id`, `google-client-secret`, `microsoft-client-id`, `microsoft-client-secret`, and `ignav-api-key`. The Web App reads the provider secrets through versionless Key Vault references using its managed identity, so credentials are not copied into Bicep parameters or plain App Service settings. Rotate one value with `./scripts/secrets set microsoft-client-secret` (or another supported name).

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
| GET | `/api` | Service metadata |
| GET | `/api/user` | Current App Service authenticated profile or anonymous state |
| GET | `/api/user/avatar` | Proxy the current user's Google or Microsoft profile image without storing it |
| PUT | `/api/user/homeCity` | Save the authenticated user's selected home city and coordinates |
| GET | `/api/airports?q={query}` | Airport suggestions by city, name, or IATA code (2–100 characters) |
| GET | `/api/mapToken` | Issue an authenticated two-hour Azure Maps SAS limited to 50 requests per second |
| GET | `/api/user/{userId}/trips` | List the authenticated user's trips |
| POST | `/api/user/{userId}/trips` | Create a trip and its initial one-person party |
| GET | `/api/user/{userId}/trips/{tripId}` | Fetch an owned trip |
| PUT | `/api/user/{userId}/trips/{tripId}` | Update an owned trip's name and description |
| DELETE | `/api/user/{userId}/trips/{tripId}` | Delete an owned trip and cascade its parties |
| POST | `/api/trips/{tripId}/flightSearch` | Queue missing or expired Ignav fare searches; 202 with operation polling URL |
| GET | `/api/trips/{tripId}/flightSearch` | Read all fresh cached fares required by the trip's current constraints; 404 when incomplete |
| GET | `/api/operations?top={top}&skip={skip}&type={type}` | List the authenticated user's operations with paging and optional type filtering |
| GET | `/api/operations/{operationId}` | Read one authorized operation's status and progress |
| GET | `/api/user/{userId}/trips/{tripId}/planning` | Load saved constraints and current parties for the editor |
| PUT | `/api/user/{userId}/trips/{tripId}/constraints` | Save a structured constraint draft for an owned trip |

OpenAPI is available at `/openapi/v1.json` in Development.
