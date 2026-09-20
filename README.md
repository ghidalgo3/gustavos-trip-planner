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

The trip store is intentionally in memory. It is behind `ITripStore` so a durable store can be selected later without changing the API surface.

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

The script reads the four authentication values from the deployed Azure Key Vault into its process environment and passes them only to the API container. It does not create an `.env` file or expose client secrets to the React application. Pass Docker Compose options through the script, for example `scripts/server --detach`; stop detached containers with `docker compose down`.

Open <http://localhost:5173>. Vite proxies `/api` calls to the API container at `http://api:8080`; editing either project triggers HMR or `dotnet watch`. The API is also exposed at <http://localhost:8080>.

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

## Authentication

Production authentication is handled by Azure App Service Authentication (Easy Auth). The API reads the trusted `X-MS-CLIENT-PRINCIPAL` header injected by App Service. In Development, the API uses server-side Google and Microsoft handlers and issues a local HTTP-only cookie. Provider secrets remain server-side in both environments.

Register both callback URLs for each provider on the same OAuth application:

| Provider | Production callback (Azure Easy Auth) | Local callback (API middleware) |
| --- | --- | --- |
| Google | `https://<api-app>.azurewebsites.net/.auth/login/google/callback` | `http://localhost:5173/.auth/callback/google` |
| Microsoft Entra | `https://<api-app>.azurewebsites.net/.auth/login/aad/callback` | `http://localhost:5173/.auth/callback/microsoft` |

The paths differ because Azure Easy Auth owns the production callback and requires its `/.auth/login/<provider>/callback` convention. In local development, the API's Google and OpenID Connect middleware own the callbacks; their paths are configured in `Program.cs`, and Vite proxies them from port 5173 to the API container. The browser starts sign-in at `/.auth/login/google` or `/.auth/login/aad`; those entry points are not provider redirect URIs. The `aad` segment is Azure App Service's identifier for its Microsoft Entra provider.

After running `scripts/buildout`, store the four provider values in Azure Key Vault:

```zsh
./scripts/secrets set-auth
./scripts/secrets status
```

The prompts do not echo secret values. `scripts/release` enables authentication when `google-client-id`, `google-client-secret`, `microsoft-client-id`, and `microsoft-client-secret` all exist. The Web App reads the provider secrets through versionless Key Vault references using its managed identity, so credentials are not copied into Bicep parameters or App Service configuration. Rotate one value with `./scripts/secrets set microsoft-client-secret` (or another supported name).

The Microsoft provider is restricted to personal Microsoft accounts through the consumer-account issuer. In the Entra application registration, add both Microsoft callback URLs above to the **Web** platform. Under **Authentication > Implicit grant and hybrid flows**, enable **ID tokens (used for implicit and hybrid flows)** and leave **Access tokens** disabled; Easy Auth uses the hybrid `code id_token` response type when its client secret is configured. Provider secrets must be rotated before their configured expiration.

## Azure infrastructure and deployment

The intended target is **Gustavo Hidalgo personal subscription**, region **East US 2**. Bicep provisions:

- Azure Container Registry (Basic, admin credentials disabled) with a daily purge task
- Azure Key Vault (RBAC authorization, soft delete, and purge protection enabled)
- Linux App Service plan and containerized Web App
- App Service filesystem diagnostics with one-day HTTP log retention
- managed-identity access to pull images and read Key Vault secrets
- Azure Static Web App (Free, PR staging environments enabled)
- optional Google and personal Microsoft account App Service authentication configuration

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

`release` runs API and web tests, builds the production client with the deployed API URL, builds and pushes the API container as `tripplanner-api:release`, applies `infra/release.bicep` with `infra/release.bicepparam`, uploads the client to Azure Static Web Apps, restarts the API, and waits for `/health`. Reusing the stable tag leaves the previous manifest untagged; the purge task installed by `buildout` removes it on its next run.

Authentication credentials live only in the provisioned Key Vault. With no credentials present, a release disables App Service Authentication; a partial set is rejected. Run the scripts with `--help` for their options.

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
