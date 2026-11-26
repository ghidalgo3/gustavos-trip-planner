# Browser behavior analytics and correlated requests

Application Insights collects named React page views, browser exceptions, and explicit
behavior events. It is focused on product usage: no infrastructure alert rules, metric
exports, application-log exports, or database statement collection are configured.
A Log Analytics workspace is provisioned because workspace-based Application Insights
requires it; this is storage for the application telemetry.

## Configure telemetry

Run `./scripts/buildout` before the next `./scripts/release` to provision the workspace
and Application Insights resource. Release configures `ApplicationInsights__ConnectionString`
for the API. The release script checks that infrastructure exposes Application Insights
and that the resource is accessible. These checks and release Bicep compilation
run alongside the local tests and builds; all must succeed before pushing the container.
Rerun buildout after adding infrastructure resources;
an older successful infrastructure deployment does not contain newly added resources.
The browser fetches only this public ingestion identifier from
`GET /telemetry/config` before mounting React; no rebuild or frontend secret is needed.
This endpoint is intentionally excluded from MCP. Empty configuration disables collection
on both sides. A failed configuration fetch times out after three seconds and the app
continues without analytics.

Local development defaults to no telemetry. To opt in, supply a development Application
Insights connection string through `APPLICATIONINSIGHTS_CONNECTION_STRING` when running
`./scripts/server`; Compose passes it to the API. Direct API runs can use
`ApplicationInsights__ConnectionString`. Use a separate development resource to keep
local/test usage out of production funnels.

## Behavior events and funnels

In the Azure portal, open the deployed Application Insights resource and use **Usage →
Funnels** or **User Flows**. Page names are `Trips`, `Profile`, `Trip overview`, `Trip
activities`, `Trip flights`, `Trip party`, and `Other`. Useful funnels include:

- `sign_in_started` → `session_authenticated` → `onboarding_completed`
- `trip_creation_started` → `trip_creation_submitted` → `trip_created`
- `destination_added` → `flight_search_started` → `flight_search_queued` → `flight_choices_saved`
- `activity_creation_started` → `activity_saved`
- `activity_suggestions_started` → `activity_suggestions_completed`

Additional events record `onboarding_viewed`, `trip_creation_cancelled`,
`trip_creation_failed`, `flight_search_rejected`, and `activity_suggestions_failed`.
`session_authenticated` means an authenticated session was loaded, including a return
visit, rather than exclusively a new login. `flight_search_queued` means the server
accepted the search job, not that background work finished. Activity saves include both
creation and editing. Completion events follow successful API responses; there is no
DOM auto-click capture, session replay, or collection of user-entered form content.

Anonymous user/session identification uses the SDK's first-party `ai_user` and
`ai_session` cookies. Signed-in behavior also carries the app's opaque internal user ID,
never email or display name. Collection currently starts automatically when configured;
there is no consent UI. If the site adds a consent preference, gate SDK initialization
on that preference. Funnel events are sent at 100% sampling, although browser blockers,
closed tabs and connection failures can still cause missing events. Choose a session or
user conversion window appropriate for the funnel; event counts alone are not conversion
rates.

## Request correlation

The browser SDK adds W3C `traceparent` headers only to application API calls, including
an explicitly configured `VITE_API_BASE_URL` origin. Existing API CORS policy accepts
these headers. ASP.NET Core consumes the trace context and OpenTelemetry exports the
matching request span, status, and duration. Outgoing HTTP dependencies within collected
requests and jobs are included with origin-only URLs. Browser telemetry uses role
`TripPlanner.Web` and server telemetry uses `TripPlanner.Api`. Inspect related dependencies
and requests in **Transaction search / end-to-end transaction details** using the shared
operation ID.

## MCP tool calls

MCP transport requests at `/mcp` are collected. Each tool invocation adds a span named
`MCP <registered-tool-name>` with `mcp.tool.name`, `mcp.result.status_code` when available,
`tripplanner.outcome`, the deployed server guidance version (`mcp.guidance.version`),
and a bounded error category (`error.type`). This records validation,
permission and business failures even when the MCP transport returns HTTP 200. Unknown
tool requests use `unknown_tool` and the numeric `rpc.error_code`; arbitrary client-supplied
names, arguments, results, error messages and exception stacks are not exported.

The version tag identifies the deployed server catalog; it does not prove that a client
refreshed cached instructions or that the model read them. Inspect recent real calls with
[the MCP tool-call query](observability/mcp-tool-calls.kql). Tool counts and errors
help find missed context reads, invalid arguments and repeated version conflicts. Server
traces have a request operation ID; they do not establish conversation identity across
separate calls unless the client supplies shared trace context. Counts across unrelated
requests are not a per-conversation instruction-following score.

MCP does not receive the user's complete chat, the model's private reasoning, or its final
answer outside tool calls. Evaluating themes and recommendation quality also needs a
client-side transcript or a controlled eval. Production argument/result recording would
need a separate, explicitly enabled capture path with field redaction and limited
retention; general Application Insights traces continue to exclude those bodies. Start
with a controlled test account, anonymize a real failure into a fixture, and replay it
against instruction revisions rather than replaying writes against a user's live trip.

## Jobs and downstream providers

Each claimed fare-search or activity-planning job creates a
`Job <kind>` server span. Idle polling creates no spans; handled failures and retries mark
the job attempt as failed. HTTP calls made by the job become child dependency spans, so
Ignav and Maps calls are visible even though processing happens after the enqueue request
has finished. Queued jobs currently start a new operation; enqueue-to-worker trace context
is not persisted.

No additional Azure resource or provider-side configuration is needed for Application Map.
After deploying, run a Maps lookup and a fresh fare search, then select a time range covering
those calls in **Application Map**. External dependency nodes should appear for
`atlas.microsoft.com` and `ignav.com` (or the configured provider host). Previously omitted
telemetry cannot be backfilled. See [Microsoft's Application Map documentation](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-map).

To inspect agent failures in the Application Insights Logs view:

```kusto
dependencies
| where timestamp > ago(24h) and cloud_RoleName == "TripPlanner.Api"
| where name startswith "MCP "
| project timestamp, name, success, duration,
    status = customDimensions["mcp.result.status_code"],
    outcome = customDimensions["tripplanner.outcome"],
    serverGuidanceVersion = customDimensions["mcp.guidance.version"],
    error = customDimensions["error.type"],
    rpcError = customDimensions["rpc.error_code"], operation_Id
| order by timestamp desc
```

Provider HTTP calls appear in `dependencies`; job executions appear in `requests` with
names starting `Job `. Both share an operation ID for end-to-end inspection.

URLs lose query strings, fragments and identifiers before export; server requests use
route templates or fixed job names. Third-party browser calls, calendar feeds,
authentication endpoints, avatars, health probes, token endpoints and configuration requests are excluded from
HTTP telemetry. Headers, bodies, free text, page titles and referrers are not collected.
Automatic browser exception messages and stacks are omitted to avoid exposing URLs or
user input; exception types remain available. Existing protections that disable raw
App Service HTTP logs and failed-request tracing remain in place.
