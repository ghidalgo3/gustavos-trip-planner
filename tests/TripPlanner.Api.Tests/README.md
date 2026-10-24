# Reading the API tests

Test folders and namespaces mirror the production code. For example,
`TripPlanner.Api.Services.ActivityPlanning` is covered by
`TripPlanner.Api.Tests.Services.ActivityPlanning` in `Services/ActivityPlanning`.

The project contains both unit tests and integration tests. Service tests usually
exercise calculations or use fake providers. Endpoint and MCP tests run the real
application with a test host. Database tests check persistence contracts against
the in-memory implementation and, when configured, an isolated PostgreSQL database.

| Folder / namespace suffix | What the tests explain |
| --- | --- |
| `Services/ActivityPlanning` | Restrictions, optimizer alternatives, flight availability, provider evidence, calendars and background jobs |
| `Services/Activities` | Generating activity ideas and researching venues |
| `Services/Destinations` | Resolving coordinate-based IANA timezones, including provider failures and daylight-saving offsets |
| `Services/Flights` | Flight search construction, route choices, fare checks and provider requests |
| `Services/Jobs` | Background processing, retries and cache expiry |
| `Services/Maps` | Azure Maps token generation |
| `Services/TripForms` | Turning free-text trip requests into draft forms |
| `Database` | Queue leases, migrations, atomic plan updates, state synchronization and audit transactions; also contains the in-memory test stores |
| `Endpoints` | HTTP requests and responses, authorization, concurrency and saved resource behavior |
| `Mcp` | Tool discovery, OAuth scopes and complete tool-based planning flows |
| `Authentication` | Sign-in, identity and profile access |
| `Models` | Context-owned schedule evaluation, enum values and their JSON compatibility |
| `Serialization` | Clock times and durations use ISO 8601; geographic positions use GeoJSON; missing values remain unknown |
| `Validation` | Rejected inputs and matching REST/OpenAPI/MCP contracts |
| `Hosting` | SPA routes and static-file behavior |
| `Support` | Shared test host, example plans, database seeds, fake clients and clocks |
| `Verification` | Native solver checks and explicitly invoked live-provider smoke tests |

## Start here to understand activity planning

1. [ActivityPlanningContextTests](Models/ActivityPlanningContextTests.cs):
   start with `Capacity_ReservesMealsRestAndSlack`. It shows why a day has less
   usable time than its full length, then covers meals, fixed times, unknown facts
   and daylight-saving changes.
2. [ActivityPlanRulesTests](Services/ActivityPlanning/ActivityPlanRulesTests.cs):
   how selected activities and repeat visits relate to the saved schedule.
3. [ActivityPlanOptimizerTests](Services/ActivityPlanning/ActivityPlanOptimizerTests.cs):
   how the solver selects a subset, respects locks, balances travellers and
   handles the target workload. The small-fixture test compares its answer with
   every possible subset of that fixture.
4. [ActivityPlanningProviderTests](Services/ActivityPlanning/ActivityPlanningProviderTests.cs)
   and [ActivityFlightAvailabilityTests](Services/ActivityPlanning/ActivityFlightAvailabilityTests.cs):
   where travel, opening hours, interest scores and shared arrival/departure
   limits come from. Provider responses are faked in these tests.
5. [ActivityPlanningDbTests](Database/ActivityPlanningDbTests.cs): how plans,
   activity states, proposal reviews and calendar revocation are persisted.
6. [ActivityPlanEndpointTests](Endpoints/ActivityPlanEndpointTests.cs) and
   [ActivityPlanningMcpTests](Mcp/ActivityPlanningMcpTests.cs): how the website or
   an MCP client reads, assesses, proposes and saves a plan.

When a test uses `Context`, `Plan`, or `Seed`, the shared example data is in
[ActivityPlanningFixture](Support/ActivityPlanningFixture.cs). Assertions describe
the behavior being promised; the fixture supplies the initial situation.

## Run one area

Run commands from the repository root:

```zsh
dotnet test tests/TripPlanner.Api.Tests -c Release --filter 'FullyQualifiedName~ActivityPlanningContextTests'
dotnet test tests/TripPlanner.Api.Tests -c Release --filter 'FullyQualifiedName~TripPlanner.Api.Tests.Services.ActivityPlanning'
dotnet test tests/TripPlanner.Api.Tests -c Release --filter 'FullyQualifiedName~TripPlanner.Api.Tests.Database'
dotnet test GustavoTripPlanner.sln -c Release
```

Set `TRIPPLANNER_TEST_POSTGRES` to an isolated PostgreSQL/PostGIS test database
with search path `gustavo_planner,public` to include database integration tests.
Without it, those cases are skipped. Normal tests do not call live providers;
the explicit verification commands are documented in the repository README.

Location research tests in `Services/Activities/ActivityCoordinateResearchTests.cs` verify that OpenAI identifies a consulted source while coordinates come from independently fetched Wikidata data. They reject different venues, distant points, deprecated claims, and non-Earth coordinates, and check that credentials are not sent to Wikidata. `Endpoints/ActivityEndpointTests.cs` covers preview-only research, the LLM gate, concurrency, provider failure, explicit saving, and unaccepted candidates in suggestion/import jobs. The frontend activity tests cover reviewing, accepting, and dismissing candidates.

`Services/Activities/ActivityDetailsResearchTests.cs` checks duration/cost research against consulted sources, ISO duration rules, free versus unknown prices, partial results, and malformed or incomplete model output. Endpoint and MCP tests verify preview-only behavior, version/scope checks, and accepting one field while preserving the other. Frontend tests cover source display, individual acceptance, dismissal, failure toasts, and clearing evidence on manual edits.
