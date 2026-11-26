# Application architecture

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/TripPlanner.Web` | React 19 + React Router + Vite + TypeScript + Fluent UI web app |
| `src/TripPlanner.Api` | .NET 10 minimal API |
| `src/TripPlanner.iOS` | SwiftUI iPhone/iPad storyboard prototype for milestone 6, phase 1 |
| `tests/TripPlanner.Api.Tests` | Unit and integration tests grouped by production namespace; [reading guide](../tests/TripPlanner.Api.Tests/README.md) |
| `infra/main.bicep` | Azure resource definitions used by `scripts/buildout` |
| `infra/release.bicep` | Runtime and authentication configuration used by `scripts/release` |
| `compose.yaml` | Local Vite HMR and `dotnet watch` environment |
| `scripts/setup` | Install and validate the macOS development toolchain |
| `scripts/install` | Restore .NET and frontend project dependencies |
| `scripts/format` | Format frontend code with Prettier, add required C# braces, and run CSharpier |
| `scripts/buildout` | Provision or update Azure resources |
| `scripts/secrets` | Store and rotate authentication and Ignav credentials, plus developer eval keys in Azure Key Vault |
| `scripts/server` | Load local auth configuration and start the development containers |
| `scripts/seed_database` | Seed sample trips through the C# database services in the local development database |
| `scripts/release` | Run the Task release graph to test, build, deploy, and verify |
| `Taskfile.yml` | Release dependencies and parallel execution |

## Persistence and the trip document

Users, trips, and travel parties are stored through `IPlannerDb`, with `PostgresPlannerDb` used by the application. The in-memory planner and activity-log stores live in `tests/TripPlanner.Api.Tests/Database`; they are test doubles and are not included in the API assembly. Planner data uses Npgsql; OAuth storage uses Entity Framework through OpenIddict.

The [trip document](trip_document.md) is the portable, versioned trip model.
`GET /trips/{tripId}/document` returns people with roles and ownership, shared places,
an itinerary calendar, and editable preferences. Calendar items contain complete
activity, transportation, city-visit, and lodging details with their own timing;
unscheduled items are tasks and scheduled items are events. Calculated
assessments and flight-planning views are fetched through their APIs and cached
separately for offline viewing after being loaded. Optional bare ETag tokens and context versions are direct properties of their entities,
with named collection validators on their owning sections. Clients add the required ETag quotes when building HTTP headers. API routes remain in client
adapters; response bodies and HTTP response metadata stay outside the file. The JSON Schema is public at
`/schemas/trip-document-v1.json`. Web and iOS clients adapt the domain model to
screen and editing resources locally; the document and REST contracts can evolve
independently. PostgreSQL remains authoritative and gathers consistent export
inputs in one query. Use `Accept-Encoding: gzip` and `If-None-Match` for efficient
downloads. The download ETag validates that representation; individual edits use
the resource's own `If-Match` and context validators. See
[`before.json`](before.json) and [`after.json`](after.json) for the captured
Japan trip before and after conversion.

## Frontend and API organization

Frontend code under `src/TripPlanner.Web/src` is grouped by responsibility:

- `features/activities`, `features/flights`, `features/trips`, `features/party`, and
  `features/profile` contain each feature's components, API clients, and helpers.
- `maps` owns the Azure Maps integration and marker transitions. Features use the
  `MapsClient` interface through `mapsClient`. `createAzureMapsClient` implements
  city/place searches, city geocoding, token caching, SDK loading, and map-control
  factories. `ActivityMap` retains its SDK instance across destinations;
  `destinationFlight.ts` blends panning and zooming in a cancellable camera flight,
  adaptively fitting both endpoint views at its widest point. It defaults to
  1.5 seconds with sine ease-in-out. Reduced motion uses an immediate camera change.
- `shared/components`, `shared/hooks`, and `shared/time` hold reusable UI and utilities.
- `api` holds shared API access, `app` holds application composition and theming,
  and `telemetry` holds browser instrumentation.

Tests live beside the modules they cover. `main.tsx` and the global `styles.css`
remain at the source root.

The API's `Services` folders group code by feature: `ActivityPlanning` (assessment,
optimization, routing evidence and calendars), `Flights`, `Destinations`, `Maps`,
and `Jobs` (the flight-search
background worker). Each folder has a matching namespace. Authentication, MCP
registration, database registration/auditing, hosting, and input validation live
in the corresponding top-level folders.

Backend code uses the injectable `IAzureMapsClient` for city, address, and place
geocoding, IANA time-zone resolution, route geometry, and travel-time estimates.
The Azure implementation owns request construction, authentication, provider
response parsing, and coordinate validation. Callers exchange typed coordinates,
address candidates, routes, and durations. Planning applies its own taxi pickup
allowance and evidence lifetime to those results. Maps routing uses bounded
request budgets, retries and response-size limits. Time-zone resolution uses
local boundary data before calling Azure. Agents supply sourced research through
ordinary activity and accommodation resource updates.

`ActivityPlanningContext` in `Models` holds the planning inputs and owns the pure
`Evaluate(plan, now)` calculation. Its data is declared in
`ActivityPlanningContext.cs`, with evaluation in `ActivityPlanningContext.Evaluation.cs`.
Manual plans and optimizer proposals use the same method to obtain an assessment.

`PartyRole` and `ActivityState` are C# enums in `Models`. JSON still uses the exact
names `Traveller` / `Planner` and `Maybe` / `Yes` / `No`, including
stored PostgreSQL JSON and MCP tool inputs. Numeric values and unknown names are
rejected. Migration `0022` renames stored activity states without changing selection or scheduling.

## Dates, times, durations, and coordinates

Activity planning uses `TimeOnly` for local clock times, `TimeSpan` for durations,
and `Microsoft.Spatial.GeographyPoint` for positions. C# uses named `Latitude` and
`Longitude` properties. JSON uses ISO 8601 clock times (`09:30:00`), durations
(`PT1H30M`), dates, and offset timestamps. Fields reflect their values:
`durationMinutes` is now `duration`, `slackMinutes` is `slackDuration`, and the
other duration fields follow the same convention. GeoJSON positions remain
`[longitude, latitude]` arrays. Clock times use strict ISO parsing and the built-in
`System.Text.Json` writer; durations use a converter backed by `XmlConvert`.
Elapsed durations support days, hours, minutes, and seconds, with no calendar
years/months. Optional values remain nullable; planning inputs still require
whole-minute precision. Migrations `0012_IsoClockTimes.sql` and
`0013_IsoDurations.sql` upgrade saved activities, preferences, plans, evidence,
and job results. The website converts ISO durations to minutes for editing and display.
The CP-SAT
adapter converts durations to integer minutes for the solver. Local clock offsets are
kept separate from elapsed time so daylight-saving transitions remain explicit.
