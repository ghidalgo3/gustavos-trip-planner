# Local development

Run the commands from the repository root unless a command changes directories.

Set up the macOS development toolchain, then install the project dependencies:

```bash
scripts/setup
scripts/install
```

The local scripts use zsh. `scripts/setup` targets macOS and installs Azure CLI, Corepack and Node, .NET 10, Git, Docker Desktop, Azure Bicep, Task (`go-task` in Homebrew), and the pinned pnpm version. It does not silently launch Docker Desktop. Check the machine toolchain without changing it with `scripts/setup --check`. `scripts/install` performs no Homebrew or machine setup; it restores the repository's .NET tools and NuGet packages and installs the frozen pnpm dependencies.

## Start the app locally

See [Azure provisioning](deployment.md#provision-azure) and [provider credentials](authentication.md).

After provisioning Azure, storing the provider credentials, and signing in with Azure CLI, start Docker Desktop and run:

```bash
scripts/server
```

The script reads the four authentication values and the Ignav key from the deployed Azure Key Vault, then issues a 23-hour Azure Maps development SAS with a 50 request-per-second limit. It passes those values only to the API container. It does not create an `.env` file or expose provider client secrets to the React application. The browser obtains the Maps SAS from the authenticated API route. Rerun `scripts/server --detached` if a development session lasts beyond the token expiry. Pass Docker Compose options through the script, for example `scripts/server --detached`; stop detached containers with `docker compose down`.

Open <http://localhost:5173>. Vite proxies application API calls to the API container at `http://api:8080`; editing the frontend triggers HMR, while `dotnet watch` rebuilds and restarts the API without interactive hot-reload prompts. The API is also exposed at <http://localhost:8080>. The web container runs pnpm in noninteractive CI mode so it can reconcile the persistent `node_modules` volume after package-manager upgrades. PostgreSQL 18 with PostGIS 3.6 and pg_cron is exposed at `localhost:5432`, uses the development-only `tripplanner` credentials from `compose.yaml`, and stores its data in the `postgres-18-data` Docker volume. The local database image uses Debian packages for pg_cron. The versioned volume lets PostgreSQL 18 use its required cluster layout while retaining any older `postgres-data` volume for deliberate migration or removal.

Use a [production database copy](database.md#copy-production-data-locally)
when you need realistic trip data in the local stack.

## Use local test users

Start the Docker app with the local-user switch.

```zsh
scripts/server --detached --local-users
```

On the sign-in screen, choose **Use local user**, then choose **Local user 1**
or **Local user 2**. Both accounts are created in the selected local database
with a home city so they can start planning immediately. The switch works
in development and requires a local database.

## Seed sample trips

After signing in locally once, run `scripts/seed_database` to create **Trip Small** (New York), **Trip Medium** (Amsterdam → London), and **Trip Large** (New York → London → Rome → Istanbul → Hong Kong → Seoul → Tokyo → Sydney → Honolulu → Los Angeles → Chicago). Each trip includes the signed-in user as its owner and party member, destination coordinates and time zones, and three nights at each destination. Large trips include 15 activity ideas per destination, with map pins, descriptions, and estimated durations.

The first trip starts tomorrow, based on the machine's local calendar day. Later trips follow with one day between trips. The script identifies existing samples by trip name and owner. Reruns refresh visit dates and fill in missing sample activities, including any deleted samples. They preserve trip and visit IDs and activity edits. A rerun skips a trip when its dates and sample activities are already in place. With multiple users, select the owner with `scripts/seed_database you@example.com`.

The script runs the .NET 10 console tool in `tools/TripPlanner.SeedDatabase`, which calls the application's `IPlannerDb` methods with the same auditing decorator used by the API. Each new trip, its initial party, destinations, visits, and activities commit together. The script connects to the local PostgreSQL instance exposed by Docker Compose at `localhost:5432`.

For a larger UI test dataset, run `scripts/seed_database --count 1000` (optionally followed by the owner's email). The count includes the three named examples. Additional trips cycle through the small, medium, and large templates with names such as **Trip Small 0004**. Each destination departs three days after arrival, and the next destination starts on that departure date. For the 1,000-trip dataset this reaches roughly 40 years into the future. Dates stay within the application's supported years (2000–2100). A smaller count creates the initial examples from the same schedule. Increasing the count expands it, and reducing it preserves trips beyond that count.

## Format, build, and test

For browser testing, see [offline regression tests](web_app.md#offline-browser-regression) and [UX testing with Codex](ux_testing.md).

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

Running `docker compose up` directly starts the application with authentication
disabled by default. Use `scripts/server` to configure sign-in.

## Codex cloud development

On the Linux x64 cloud machine, use the same repository entry points with `--cloud`:

```bash
scripts/setup --cloud
scripts/install --cloud
scripts/server --cloud database
```

Then run `scripts/server --cloud api` and `scripts/server --cloud web` in separate shells. The cloud profile uses the machine's Node.js, Corepack and Docker, installs a checksum-verified .NET 10 SDK, and runs the API and Vite directly. PostgreSQL still runs in Docker with PostGIS and pg_cron. The database image uses Debian's signed pg_cron package and omits the optional LLVM JIT package.

Cloud startup works without Azure credentials. Live sign-in, maps and fare searches require the relevant provider settings. Set `Mcp__Enabled=true` only after configuring application authentication. To run the test commands above in a cloud zsh session, first run `source scripts/lib/cloud.zsh && activate_cloud_environment` from the repository root. To stop the cloud database while keeping its volume, run `docker compose -f compose.yaml -f compose.cloud.yaml stop database` from that directory.

## Solver verification

The test project also owns the explicit smoke-test commands:

```zsh
dotnet run --project tests/TripPlanner.Api.Tests -c Release -- --verify-solver
```

Normal `dotnet test` runs do not call live providers. See the
[plain-language optimizer walkthrough](necessary_slop/milestone_3.md#how-the-activity-optimizer-works)
for how the planner chooses and checks suggestions.

## Stopping local services

Stop local services with `docker compose down`. Add `--volumes` only when you intentionally want to erase the local database and recreate it from migrations.
