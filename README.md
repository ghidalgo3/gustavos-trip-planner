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
| `scripts/install` | Install and validate the local macOS toolchain |
| `scripts/buildout` | Provision or update Azure resources |
| `scripts/release` | Test, build, configure, deploy, and verify a release |

The trip store is intentionally in memory. It is behind `ITripStore` so a durable store can be selected later without changing the API surface.

## Local development

Install the macOS development toolchain and project dependencies first:

```bash
scripts/install
```

The local scripts target macOS and use zsh. `scripts/install` installs Azure CLI, Corepack and Node, .NET 10, Git, Docker Desktop, Azure Bicep, the pinned pnpm version, NuGet packages, and web dependencies. It does not silently launch Docker Desktop. Check an existing installation without changing it with `scripts/install --check`.

Start Docker Desktop, then run:

```bash
docker compose up --build
```

Open <http://localhost:5173>. Vite proxies `/api` calls to the API container at `http://api:8080`; editing either project triggers HMR or `dotnet watch`. The API is also exposed at <http://localhost:8080>.

Useful commands when Node.js and .NET are installed locally:

```bash
dotnet test GustavoTripPlanner.sln
cd src/TripPlanner.Web
corepack enable
pnpm install
pnpm run lint
pnpm test
pnpm run build
```

Local development presents the Google and Apple buttons, but real sign-in starts working only after provider credentials are configured in Azure. The `/api/user` endpoint remains anonymous when App Service Authentication is disabled.

## Authentication

Authentication is handled by Azure App Service Authentication (Easy Auth), not by browser-side secrets. The API reads the trusted `X-MS-CLIENT-PRINCIPAL` header injected by App Service and returns only a small safe profile from `/api/user`.

Create provider registrations with these callbacks after the first infrastructure deployment:

- Google: `https://<api-app>.azurewebsites.net/.auth/login/google/callback`
- Apple: `https://<api-app>.azurewebsites.net/.auth/login/apple/callback`

Export these variables before running `scripts/release` to enable both providers:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APPLE_CLIENT_ID` (the Apple Services ID)
- `APPLE_CLIENT_SECRET` (a signed Apple client-secret JWT)

All four must be supplied together. Apple client-secret JWTs expire after at most six months and must be rotated. Azure's native Sign in with Apple provider is currently in preview.

## Azure infrastructure and deployment

The intended target is **Gustavo Hidalgo personal subscription**, region **East US 2**. Bicep provisions:

- Azure Container Registry (Basic, admin credentials disabled) with a daily purge task
- Linux App Service plan and containerized Web App
- managed-identity `AcrPull` assignment
- Azure Static Web App (Free, PR staging environments enabled)
- optional Google and Apple App Service authentication configuration

Release prerequisites are installed by `scripts/install`: Azure CLI, Docker with a running daemon, .NET 10 SDK, Node.js with Corepack, Git, and curl.
The signed-in Azure identity needs permission to create resources and role assignments in the target resource group (Owner, or Contributor plus Role Based Access Control Administrator).

Sign into the correct tenant, then provision the infrastructure:

```bash
az login --tenant 8ac19fe6-f2db-412e-9750-97a9772a6786
./scripts/buildout \
  --subscription "Gustavo Hidalgo personal subscription" \
  --resource-group rg-tripplanner-dev \
  --location eastus2
```

`buildout` validates `infra/main.bicep` and `infra/main.bicepparam`, creates the resource group, deploys the resources, configures a daily ACR purge task, and prints the endpoints. It is idempotent and safe to rerun when the infrastructure definition changes. Basic ACR does not support the native retention policy, so the scheduled task removes untagged manifests at 02:00 UTC by default; override its cron expression with `ACR_PURGE_SCHEDULE`.

Deploy application code and runtime configuration separately:

```bash
./scripts/release \
  --subscription "Gustavo Hidalgo personal subscription" \
  --resource-group rg-tripplanner-dev
```

`release` runs API and web tests, builds the production client with the deployed API URL, builds and pushes the API container as `tripplanner-api:release`, applies `infra/release.bicep` with `infra/release.bicepparam`, uploads the client to Azure Static Web Apps, restarts the API, and waits for `/health`. Reusing the stable tag leaves the previous manifest untagged; the purge task installed by `buildout` removes it on its next run.

Authentication values are deliberately passed from the shell rather than committed to a parameter file:

```bash
export GOOGLE_CLIENT_ID='...'
export GOOGLE_CLIENT_SECRET='...'
export APPLE_CLIENT_ID='...'
export APPLE_CLIENT_SECRET='...'
./scripts/release
```

All four values must be present on every authenticated release. With none present, the release explicitly disables App Service Authentication. Run either script with `--help` for all options.

There is no GitHub Actions CI/CD configuration. Releases are intentional local operations performed using your current Azure CLI login. Azure CLI manages the subscription, resources, configuration, registry, and deployment token; the project-pinned Microsoft Static Web Apps CLI performs the final static artifact upload because `az staticwebapp` does not provide a content-upload command.

## API routes

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/health` | App Service liveness probe |
| GET | `/api` | Service metadata |
| GET | `/api/user` | Current App Service authenticated profile or anonymous state |
| GET | `/api/trips` | List trips |
| POST | `/api/trips` | Create a trip |
| GET | `/api/trips/{id}` | Fetch a trip |
| DELETE | `/api/trips/{id}` | Delete a trip |

OpenAPI is available at `/openapi/v1.json` in Development.
