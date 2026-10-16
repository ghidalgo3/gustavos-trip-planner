# Repository Guide

This repository contains a small trip-planning web application and its Azure infrastructure.

## Structure

- `src/TripPlanner.Api`: .NET 10 minimal API. Authentication uses Azure App Service Authentication headers; trip data is currently stored in memory behind `ITripStore`.
- `tests/TripPlanner.Api.Tests`: MSTest integration tests for the API.
- `src/TripPlanner.Web`: React + Vite + TypeScript + Fluent UI client. Use the Corepack-managed pnpm version from `package.json`.
- `infra/main.bicep` and `main.bicepparam`: long-lived Azure resources.
- `infra/release.bicep` and `release.bicepparam`: App Service container and authentication configuration applied during a release.
- `compose.yaml`: local Vite HMR and `dotnet watch` environment.
- `scripts/setup`, `scripts/install`, `scripts/format`, `scripts/buildout`, `scripts/secrets`, `scripts/server`, `scripts/release`: zsh scripts for machine setup, project dependency installation, formatting, infrastructure deployment, Key Vault credential management, local development, and application deployment. There is intentionally no GitHub CI/CD.

## Common Commands

```zsh
./scripts/setup --check
./scripts/install
./scripts/format
./scripts/server
dotnet test GustavoTripPlanner.sln -c Release
cd src/TripPlanner.Web && corepack pnpm test && corepack pnpm run lint && corepack pnpm run build
./scripts/buildout
./scripts/secrets status
./scripts/release
```

## Conventions

- The API is RESTful, meaning that routes should modify entire _resources_ at a time, instead of having hundreds of APIs to modify each invidual property of a persisted object.
- Groups of related REST APIs should go into *Endpoints.cs files, not Program.cs.
- Avoid over-posting by defining DTO objects separately from the database object we read/write to the database.
- Put DTO types in a DTO namespace and directory, keep database models in Models namespace/directory.
- Define C# Options classes for configuration binding instead of resolving configuration values by string key.
- Keep shell scripts compatible with zsh and preserve `set -euo pipefail`.
- Format C# with the repository's CSharpier tool before completing changes.
- Keep API tests and frontend tests current when behavior changes.
- The production API image uses the stable `tripplanner-api:release` tag. `buildout` maintains the scheduled ACR task that purges superseded untagged manifests.
- Never commit any secrets; manage them with `scripts/secrets` in the provisioned Azure Key Vault.
- Preserve unrelated working-tree changes and update `README.md` when workflows or architecture change.
- Prefer to write "functional" code, minimizing side effects and I/O until they are necessary, this is easier to test. 
- I/O dependencies (like databases and API calls) should be behind interfaces so we can mock them during unit tests.

## UI Practices

- Mobile UI is the primary design target. Design for small screens.
- Button should always have a border or different background color to signal to the user on mobile that this is a button.

## Test practices

- Tests should verify the code satisfy a requirement, not simply branch coverage.
- Where possible, write parametrized tests instead of more test functions.
- Use color to attract the user's attention to unfinished actions or next steps. Once an action is complete, you may remove color from an element.

## Database practices

- Until this message is deleted, you are allowed to connect to the database, either locally or in the cloud, and drop all schemas and have them be recreated when making schema changes.
- Prefer to write C# methods that write or modify an entire database row at a time instead of having many methods to modify column subsets of a row. 

## MCP Server Maintenance

- When relevant, evaluate all new REST APIs for inclusion in the MCP server tool list.
- Do not make MCP tools that leak things like map tokens or proxy access to Azure APIs.