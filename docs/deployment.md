# Azure infrastructure and deployment

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

## Provision Azure

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

## Release the application

See the [changelog](../CHANGELOG.md) for significant changes, new features, and bug fixes.
Dated sections record releases, and the initial baseline summarizes functionality that predates release tracking.

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
redeploying. See [AGENTS.md](../AGENTS.md#release-and-changelog-instructions) for agent
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

## GitHub deployments

After provisioning, GitHub Actions verifies that each production deployment came from
a merged pull request on protected `main`. It builds and tests the API and web app,
publishes `tripplanner-api:release` and verifies the running commit, website, and
MCP authentication. Production configuration and Key Vault credentials stay in
Azure. Apply production configuration changes through the existing release
process. The Actions deployment leaves Git release tags and changelog rollover to
the manual release process. Avoid running both deployment paths at the same time.

Run `scripts/configure-deployments` once as a GitHub repository administrator and
with an Azure CLI login that can create resources, role assignments, and Entra app
registrations. It enables a PR-only ruleset on `main` with no bypass actors and no
required approving reviewer, so a sole maintainer can merge through a PR. GitHub
requires Pro or equivalent branch protection support for private repositories.
`scripts/protect-main` applies the ruleset independently.

The setup configures a Standard or higher App Service plan and a test
environment in the Azure slot named `preview`. The test environment shares the
existing PostgreSQL server and container registry. Its databases and images are
separate from production. GitHub authenticates through separate Azure
deployment identities using OIDC. The test environment uses Trip Planner's
production sign-in page, with separate Google and Microsoft OAuth registrations.
Only approved reviewer accounts can sign in. Use `--production-only` or
`--preview-only` to configure one deployment independently.

For an existing installation, run `scripts/configure-preview-oidc` before
merging the workflow change that uses the `azure-preview` GitHub environment.
The script requires GitHub repository admin access and Azure permission to
manage federated credentials on the preview identity. It allows only the
`main` branch to use the environment and adds the matching Azure credential.
Automatic previews can then start alongside CI, and manual and scheduled runs
use the same environment.

Register `https://<test-slot-host>/.auth/callback/google` and
`https://<test-slot-host>/.auth/callback/microsoft` with the respective test clients.
Store their credentials as `test-google-client-id`, `test-google-client-secret`,
`test-microsoft-client-id`, and `test-microsoft-client-secret` in Key Vault. Run
`zsh scripts/configure-test-sign-in` with `TEST_GOOGLE_REVIEWER_EMAIL` set to the
reviewer's Gmail address, `TEST_MICROSOFT_REVIEWER_OBJECT_ID` set to their
personal Microsoft account object ID, or both. The slot can read only those
four test secrets from the vault. During deployments an App Service access
guard stays enabled until the candidate reports that reviewer access is active.
The workflow then stops the slot, switches to Trip Planner sign-in, and
verifies the app after restarting it.
An existing test deployment switches to the app's sign-in page on the first
successful PR deployment using the updated workflow.

A pull request from a branch in this repository builds its proposed merge with
`main` and deploys to the single shared slot. The preview workflow runs alongside
API and web checks. When the slot already serves that PR and its backend matches
the candidate apart from Vite application source or entry HTML, the workflow
publishes hashed assets through the slot's SCM endpoint and switches the HTML
entry point. Otherwise it packages and deploys the container. GitHub Actions
posts a PR comment with the sign-in
link the first time a commit is ready. The **Azure test environment** status
also links to the workflow run. Each successful deployment replaces the
previous one. Closing the active PR stops the slot. Fork PRs are excluded
because test code can read the copied trip data. The test environment excludes
production provider credentials, MCP sign-in records, and calendar subscription
tokens. It also disables background planning workers and MCP.

Each container deployment takes a fresh logical snapshot of the production
`gustavo_planner` schema using a read-only database identity. It restores trip
data and migration history to a separate database on the existing PostgreSQL
server and runs pending migrations there. A failed migration or startup restores
the prior deployment when available. The slot is never swapped into production.
The database copy is refreshed daily at 07:17 UTC while the test environment is
active.

To run the workflow manually, open **Actions → Deploy PR test environment →
Run workflow** on `main`. Leave the PR number blank to refresh the active
deployment's database. Enter an open PR number to build and deploy its latest
commit. Select **announce_only** to post the sign-in link for the specified PR
already running in the test environment. This option verifies the live commit,
health, and sign-in without rebuilding or resetting its database. To retry a
deployment with a prior tested run ID, leave **announce_only** unchecked. The
workflow reuses the image only if the PR head and tested application sources
still match. If GitHub reports an outdated merge snapshot, use **Update branch**
on the PR and rerun the workflow.

## SPA updates after release

The API serves `index.html`, including SPA route fallbacks, with `Cache-Control: no-store`. Browser navigation to `/trips/{tripId}` or `/trips/{tripId}/flights` requests `text/html` and receives the SPA shell; API requests to the same URLs retain their JSON behavior. These shared routes send `Vary: Accept` so caches distinguish the representations. Vite's hashed JavaScript and CSS assets are cached for a year as immutable; other static files require revalidation. Reloading the page fetches the current HTML and therefore the current bundle URLs. An already open tab continues running its loaded code until reloaded. Previously cached HTML may need one hard refresh after this policy is first deployed.

`scripts/release` waits for both API health and a SHA-256 match between the public HTML and the locally built `dist/index.html`, using a unique query string to bypass older cached responses. This prevents the previous container's healthy response from being treated as proof that the new UI is live. The stable `release` image tag is unchanged.
