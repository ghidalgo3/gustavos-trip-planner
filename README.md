# gustavo_trip_planner

A .NET minimal API deployed to Azure App Service as a Linux container, with the
infrastructure defined in Bicep and a single script that provisions and ships it.

```
src/TripPlanner.Api      ASP.NET Core minimal API (+ Dockerfile)
tests/TripPlanner.Api.Tests   MSTest integration tests over WebApplicationFactory
infra/main.bicep         ACR + Linux App Service plan + containerised Web App
scripts/deploy/deploy.sh  provision -> build -> push -> restart -> health check
.github/workflows        CI (build/test/container/bicep) and OIDC deploy
```

## API

| Method | Route          | Notes                                    |
| ------ | -------------- | ---------------------------------------- |
| GET    | `/`            | Service name, version, environment       |
| GET    | `/health`      | Liveness probe, also used by App Service  |
| GET    | `/trips`       | List trips                               |
| POST   | `/trips`       | Create a trip, returns 201 + `Location`  |
| GET    | `/trips/{id}`  | Fetch one trip                           |
| DELETE | `/trips/{id}`  | Delete a trip                            |

OpenAPI is served at `/openapi/v1.json` in the Development environment only.

**Trips are stored in process memory.** `InMemoryTripStore` is a placeholder so the
deploy pipeline has something real to exercise — data is lost on restart and is not
shared across instances. Swapping it for a real data store is the obvious next step.

## Run locally

```bash
dotnet run --project src/TripPlanner.Api
```

Then `curl http://localhost:5xxx/health` (the port is printed on startup).

Tests:

```bash
dotnet test GustavoTripPlanner.sln
```

As a container, the same way App Service runs it:

```bash
docker build --platform linux/amd64 -f src/TripPlanner.Api/Dockerfile -t tripplanner-api:local .
docker run --rm -p 8080:8080 tripplanner-api:local
```

If your machine cannot reach nuget.org directly, point the restore at a mirror:

```bash
docker build --build-arg NUGET_SOURCE=https://your-feed/v3/index.json -f src/TripPlanner.Api/Dockerfile -t tripplanner-api:local .
```

The deploy script forwards a `NUGET_SOURCE` environment variable for the same purpose.

## Deploy to Azure

Prerequisites: Azure CLI (`az login`), a running Docker daemon, and permission to
create resources and role assignments in the target subscription.

```bash
./scripts/deploy/deploy.sh --resource-group rg-tripplanner-dev --location eastus
```

The script is idempotent and re-runnable. It creates the resource group, deploys
`infra/main.bicep`, logs in to the provisioned registry, builds and pushes the image
(tagged with the git short SHA plus `latest`), restarts the Web App, and polls
`/health` until the new container is serving. `--help` lists all options; `--skip-infra`
and `--skip-build` are useful for iterating on one stage at a time.

**The first deploy takes several minutes.** The Web App is created pointing at an image
tag that does not exist yet, so it will be down until the push completes and the restart
pulls it. The health poll is what confirms recovery. If it times out:

```bash
az webapp log tail --resource-group rg-tripplanner-dev --name <web-app-name>
```

### What gets provisioned

- **Azure Container Registry** (Basic), with the admin user **disabled**.
- **Linux App Service plan** (B1 by default — the cheapest tier supporting `alwaysOn`).
- **Web App for Containers** with a system-assigned managed identity, `httpsOnly`,
  and `healthCheckPath` set to `/health`.
- An **AcrPull** role assignment granting that identity access to the registry.

Image pulls use the managed identity (`acrUseManagedIdentityCreds`), so no registry
credentials are stored in app settings, in CI secrets, or anywhere else.

Resource names are `<prefix>-<hash>` where the hash derives from the resource group id,
so a given resource group always produces the same globally-unique names.

## CI/CD

`ci.yml` runs on every pull request and push to `main`: build, test, container build,
and `bicep build`.

`deploy.yml` runs on push to `main` (and on demand) and calls the same deploy script.
It authenticates with OIDC federated credentials rather than a stored secret, so it
will fail at the login step until you configure:

- Secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`
- Variables: `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`
- A GitHub Actions environment named `dev`

To set up the identity:

```bash
az ad app create --display-name gustavo-trip-planner-deploy
# note the appId, then create a service principal and a federated credential
# subject: repo:<owner>/<repo>:ref:refs/heads/main  (and repo:<owner>/<repo>:environment:dev)
```

The service principal needs **Contributor** on the resource group (to create resources)
and **User Access Administrator** or **Role Based Access Control Administrator** scoped
to that group, since the template creates the AcrPull role assignment.

## Not included

Application Insights, a persistent data store, authentication, custom domains, staging
slots, and per-environment parameter files. Each is a straightforward addition once the
skeleton is proven end to end.
