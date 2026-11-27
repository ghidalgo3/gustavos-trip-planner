# Repository Guide

This repository contains a trip-planning web application and its Azure infrastructure.

## Pull Requests

- Before every push to a PR branch, including the initial push for a new PR, run `git fetch origin main` followed by `git merge origin/main` on that branch. Resolve any merge conflicts before pushing. The test deployment workflow requires a PR merge snapshot built against the current `main`.
- Humans review and merge pull requests. Agents must leave pull requests open for human review and completion.
- Agents must never merge a pull request, enable auto-merge, or enqueue a pull request for automatic merge. This applies to every pull request, including workflow and documentation changes.

## Structure

- `src/TripPlanner.Api`: .NET 10 minimal API. Authentication uses Azure App Service Authentication headers; trip data is currently stored in memory behind `ITripStore`.
- `tests/TripPlanner.Api.Tests`: MSTest integration tests for the API.
- `src/TripPlanner.Web`: React + Vite + TypeScript + Fluent UI client. Use the Corepack-managed pnpm version from `package.json`.
- `infra/main.bicep` and `main.bicepparam`: long-lived Azure resources.
- `infra/release.bicep` and `release.bicepparam`: App Service container and authentication configuration applied during a release.
- `compose.yaml`: local Vite HMR and `dotnet watch` environment.
- `scripts/setup`, `scripts/install`, `scripts/format`, `scripts/buildout`, `scripts/secrets`, `scripts/server`, `scripts/release`: zsh scripts for machine setup, project dependency installation, formatting, infrastructure deployment, Key Vault credential management, local development, and application deployment. GitHub Actions deploys protected `main` to production and trusted pull requests to the Azure `preview` slot. See the README for provisioning and recovery.

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

## Engineering Conventions

- C# code must always use curly braces for blocks, even single statement blocks.
- Wire dates, clock times, timestamps, and elapsed durations must use ISO 8601 (`YYYY-MM-DD`, `HH:mm:ss`, offset timestamps, and durations such as `PT1H30M`). Keep C# values typed as `DateOnly`, `TimeOnly`, `DateTimeOffset`, and `TimeSpan`.
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
- Update `CHANGELOG.md` for large changes, new features, and bug fixes. Add concise entries under `Unreleased`, describing user-visible or significant development-workflow effects; omit routine formatting and test-only changes. Move entries into a dated release section when a release is made.
- Prefer to write "functional" code, minimizing side effects and I/O until they are necessary, this is easier to test. 
- I/O dependencies (like databases and API calls) should be behind interfaces so we can mock them during unit tests.
- All C# REST APIs must declare property validation attributes to consume in MCP tool definitions and OpenAPI document generation.
- Backward compatibility is not required when refactoring. REST routes, request/response contracts, trip document formats, local caches, PostgreSQL schemas, and fully-qualified type names may change. Update the server, web, iOS, and relevant MCP tools together. Prefer removing obsolete code instead of retaining legacy routes, decoders, adapters, or migrations solely for compatibility.

## Release and changelog instructions

- Before running `scripts/release`, ensure all intended changes, including new files and changelog entries, are committed. Do not automatically discard or commit unrelated work to satisfy the clean-checkout requirement.
- Fetch shared Git tags before releasing when using a shared remote. Successful releases create a local annotated tag named `YYYY.MM.DD.N`, using the date in `America/New_York` and the highest existing sequence for that date plus one (starting at 1). The script does not push commits or tags.
- After a successful release and tag creation, `scripts/release` automatically moves the entries under `## Unreleased` in `CHANGELOG.md` into a new section named with the exact release tag, retaining their Added/Changed/Fixed/Removed groups and leaving an empty `## Unreleased` at the top. It preserves all older releases and the initial baseline. Empty Unreleased sections produce no release section or commit.
- The script commits this changelog rollover separately after the release. The tag identifies the deployed source commit; never move or amend it to include the later changelog commit. If the rollover commit fails, resolve the Git error and commit the changelog separately without redeploying or moving the tag. Only push the tag when publishing to the remote is authorized.
- Failed releases and `--check` runs do not create release tags; leave Unreleased entries in place. If deployment verification succeeds but tagging fails, report that state and resolve it before treating the release as recorded.

## UI Conventions

- UI elements should be self-explanatory and not require descriptive text to explain to the user what they do or how they work.
- Do not add standalone text lines for routine status or progress counts. Show meaningful state on the relevant control or item, and omit information the interface already conveys. Keep feedback that helps users understand a save, an error, or a required action.
- All buttons, including icon-only and dismiss buttons, must be square or wider than they are tall (width >= height). Never make buttons taller than they are wide unless the user explicitly requests it. Preserve required minimum tap-target dimensions when applying this rule.

## Cross platform instructions

- Whenever the server introduces a new route or modifies the requests/responses of a route, all clients must be updated to support this change.
- Use color to attract the user's attention to unfinished actions or next steps. Once an action is complete, you may remove color from an element.

## Web UI Practices

These do not apply to iOS.

- Mobile UI is the primary design target. Design for small screens.
- Use the [web UI complexity rubric](docs/ux_testing.md#web-ui-complexity) for single-task screens and drawers. Aim for at most five visible navigation choices, four exposed form controls, one vertical scroll area, and a next action visible when it becomes relevant.
- All place searches must use the shared `PlaceSearchResultButton` and `PlaceSearchResult` components, with consistent full-width numbered buttons, name/address typography, spacing, selection feedback, and loading placeholders. When a place-search drawer has a map, show the same results as numbered map pins with matching indices; selecting a list result or its pin must perform the same action. Do not create feature-specific radio cards or alternate result layouts.
- Search fields must use the same text sizing in toolbars and edit drawers, with a computed inner-input font size of at least 16 CSS pixels at every viewport width to prevent Safari focus zoom. Do not rely only on mobile-width or coarse-pointer media queries; tablets and touch devices can use wider layouts. Verify computed font sizes in browser checks, including desktop-width layouts, and preserve browser pinch zoom.
- New or modified icon-only actions must provide at least a 44×44 CSS pixel tap target. Search clear/dismiss buttons must be at least 48 CSS pixels wide.
- The offline GUI should not substantially change from the online GUI; it should preserve the same screens, layouts, navigation, and components while preventing edits. Keep read-only interactions such as filtering, sorting, scrolling, and viewing details available, and disable actions that require a network connection.
- Use Skeletons when loading GUI content. Reserve Spinners for long-running operations; short saves should retain existing content with disabled controls and status text.
- Skeletons must mirror the content being loaded, including its layout and approximate dimensions. Define feature-specific placeholders for agendas, search results, forms, and other distinct views instead of reusing a generic card skeleton.
- Button should always have a border or different background color to signal to the user on mobile that this is a button.
- Button hover states must highlight the entire button background. Hover states for other clickable elements must highlight the border only, without changing the element's background or fill.
- Show an explicit Save/Apply button when a form edits related values that must be validated together. Keep those edits in a draft and submit the complete resource after the user finishes the group; do not persist intermediate invalid combinations.
- Save independent, complete, valid actions immediately (for example selecting a stay, toggling a setting, or adding/removing an airline), without a separate Save button. For independent free text, save on blur after local validation rather than on each keystroke. This rule concerns validation, not a guarantee that network requests will succeed.
- Automatic saves must preserve unrelated values, retain existing content during requests, prevent overlapping writes, show saving/error status, and preserve or restore the user's last confirmed value on failure with a retry path. Keep resource-level REST updates and concurrency checks; do not add per-property APIs to implement automatic saves.

## Test practices

- Tests should verify the code satisfy a requirement, not simply branch coverage.
- Where possible, write parametrized tests instead of more test functions.
- Do not add mocked unit tests for release or deployment orchestration. Validate these stateful, I/O-heavy workflows through actual execution and verification of the deployed application. Syntax and static checks are useful supporting checks, but do not establish that a release works.

## Database practices

- Until this message is deleted, you are allowed to connect to the database, either locally or in the cloud, and drop all schemas and have them be recreated when making schema changes.
- Prefer to write C# methods that write or modify an entire database row at a time instead of having many methods to modify column subsets of a row.

## MCP Server Maintenance

- When relevant, evaluate all new REST APIs for inclusion in the MCP server tool list.
- Do not make MCP tools that leak things like map tokens or proxy access to Azure APIs.

## iOS Instructions

Follow all Apple UI Guidelines for iOS 27+.

- All view files should have a preview for XCode development
- The preview of a view should include a side bar with options to set view state, like loading default view data.
- When view prototypes are requested, put each prototype into its own file for quick rendering.
