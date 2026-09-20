# Repository Guide

This repository contains a small trip-planning web application and its Azure infrastructure.

## Structure

- `src/TripPlanner.Api`: .NET 10 minimal API. Authentication uses Azure App Service Authentication headers; trip data is currently stored in memory behind `ITripStore`.
- `tests/TripPlanner.Api.Tests`: MSTest integration tests for the API.
- `src/TripPlanner.Web`: React + Vite + TypeScript + Fluent UI client. Use the Corepack-managed pnpm version from `package.json`.
- `infra/main.bicep` and `main.bicepparam`: long-lived Azure resources.
- `infra/release.bicep` and `release.bicepparam`: App Service container and authentication configuration applied during a release.
- `compose.yaml`: local Vite HMR and `dotnet watch` environment.
- `scripts/install`, `scripts/buildout`, `scripts/secrets`, `scripts/server`, `scripts/release`: macOS zsh scripts for setup, infrastructure deployment, Key Vault credential management, local development, and application deployment. There is intentionally no GitHub CI/CD.

## Common Commands

```zsh
./scripts/install --check
./scripts/server
dotnet test GustavoTripPlanner.sln -c Release
cd src/TripPlanner.Web && corepack pnpm test && corepack pnpm run lint && corepack pnpm run build
./scripts/buildout
./scripts/secrets status
./scripts/release
```

## Conventions

- Keep shell scripts compatible with zsh and preserve `set -euo pipefail`.
- Format C# with the repository's CSharpier tool before completing changes.
- Keep API tests and frontend tests current when behavior changes.
- The production API image uses the stable `tripplanner-api:release` tag. `buildout` maintains the scheduled ACR task that purges superseded untagged manifests.
- Never commit Google or Microsoft provider credentials; manage them with `scripts/secrets` in the provisioned Azure Key Vault.
- Preserve unrelated working-tree changes and update `README.md` when workflows or architecture change.
