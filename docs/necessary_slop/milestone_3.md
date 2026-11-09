# Milestone 3: Activity planning

Historical milestone notes: server-side LLM features described here have been
removed. Current architecture and workflows are documented in [README](../../README.md);
the connected user agent performs and pays for model calls and research.


The implementation provides one shared destination schedule through the website,
REST and the stateless MCP server. Selection, scheduling, research and optimization
remain separate choices. Proposed drafts and incremental suggestions never apply
without a conditional plan replacement.

Clock times and elapsed durations use `TimeOnly` and `TimeSpan` in C#. REST and MCP
use ISO 8601: `fixedStart: "09:30:00"`, `duration: "PT1H30M"`, and
`slackDuration: "PT1H"`. Dates and timestamps retain ISO dates and offset timestamps.
The website presents durations in minutes for editing. Migrations 0012 and 0013
convert saved clock values and the former numeric `*Minutes` fields; optional
durations remain null, distinct from zero (`PT0S`).

## How the activity optimizer works

Think of it as filling a weekly calendar with activities you care about, while
leaving enough room for getting around and everyday needs. It works on one
destination at a time, including repeat visits to that destination.

1. **Read the current situation.** Collect the activities, visit dates, shared
   schedule, travellers' interests, saved restrictions, accommodation, and any
   known opening hours or travel estimates. Provider research is optional.
2. **Check your current plan.** `planningContext.Evaluate(plan, now)` walks through each day in order and
   adds activity time, travel, waiting, meals, and slack within your awake hours.
   It reports conflicts and unknown facts. It does not change your plan.
3. **Make an initial draft.** A quick pass tries required activities first, then
   activities sorted by their coordinates. This gives the solver a starting
   point; the location sorting is a simple heuristic, not a space-filling curve
   or a guarantee of the shortest route.
4. **Search for better drafts.** OR-Tools CP-SAT chooses which activities to
   include, which day each belongs to, their order, and tentative start times.
   Must-do activities, fixed days/times, exclusions, and accepted ordering rules
   constrain that search. Sleep, meals, travel and slack consume available time.
5. **Look for three kinds of draft.** Overall fit maximizes the sum of everyone's
   activity-interest points, giving each traveller equal weight. Balanced
   interests first helps the traveller whose interests are least covered, then
   improves the total. Less travel minimizes travel while retaining at least
   90% of the best group fit discovered. Otherwise equivalent choices prefer
   fewer changes to your existing plan.
6. **Check the drafts independently.** The context's evaluation method rebuilds actual timelines
   from the proposed days and order; it does not blindly trust the solver's
   tentative times. Conflicting or incomplete candidates are discarded. Missing
   facts can still make a draft provisional. If route refresh was requested,
   shortlisted routes are checked again for their proposed departure times.
7. **Offer choices.** Return full drafts and small changes, such as moving one
   activity, returning it to Ideas, or changing a travel mode. Suggestions show
   their effects. Saving an accepted choice rechecks versions and restrictions;
   generating a proposal does not replace the saved schedule.

For example, a museum and a nearby gallery may fit comfortably in one afternoon.
Adding a distant attraction also adds journeys to and from it. The planner may
suggest another day or leaving that attraction in Ideas. If it is marked must-do,
the planner must keep it and find space elsewhere—or explain the conflict.

There is no single magic score that overrides your rules. Feasibility checks,
interest points, and travel time serve different purposes. Without current
preference scores, every activity receives the same neutral value of 2 per
traveller, so the optimizer does not yet know which experiences you value most.
AI can supply interest scores and research; CP-SAT performs the schedule search.

The default search budget is 30 seconds inside a job deadline of three minutes.
Useful drafts can appear before the search finishes. A timeout means the search
ran out of time, not that the draft is best or that no feasible plan exists.
Only specific contradictory restrictions are reported as proven infeasible.

`ActivityPlanningContext.Evaluate(plan, now)` in `Models` checks a schedule.
In `Services/ActivityPlanning`, `ActivityPlanOptimizer` searches for alternatives,
`ActivityPlanningEnrichment` gathers evidence, and `ActivityPlanningJobProcessor`
coordinates background work. `ActivityPlanRules` holds shared schedule rules.

## Experience and rules

- **Ideas** retains the existing activity list, details and map. **Daily plan** adds
  selected-but-unscheduled activities, ordered timelines, meal breaks, travel,
  waiting, slack, evidence and explanations. Buttons and day selectors support
  keyboard and small-screen editing without dragging.
- `Proposed` means available, `Planned` means selected, and `Rejected` means excluded.
  Returning to Ideas sets Proposed. Existing Planned activities initialize as
  unscheduled. The C# `ActivityState` enum uses these same three JSON names.
- Activities occur at most once across repeat destination visits. Each local date
  has one shared schedule and references its visit ID. Visit dates can be changed
  independently; out-of-visit assignments remain explainable conflicts. Deleting
  visits or activities removes dangling assignments and restrictions.
- Restrictions include must-do, fixed date/start, predecessor, duration override,
  dining credit, known opening windows/closures, availability and transport. Keep
  this choice records a required activity, its date and predecessor. Restriction
  changes that could resolve a conflict are offered separately for review.
- Defaults are sleep 23:00–07:00, breakfast 30 minutes, lunch/dinner 45 minutes each,
  and 60 minutes slack. Each day may override them. Dining duration reduces its
  corresponding meal allowance once. Fixed early-morning starts after midnight
  belong to the preceding planning day's extended awake window. Opening-window
  dates refer to their actual local calendar date.
- Assessment states are `fits`, `provisional`, `conflicting`, and `incomplete`.
  Unknown duration uses an explicit 60-minute assumption. Travel without known
  endpoints uses an explicit 20-minute assumption; known coordinates use a labelled
  distance estimate. Unknown facts are never treated as verified zero-cost inputs.
- Other travellers' raw profile instructions never enter shared responses. Derived
  fit is visible per traveller. Decisions receives profile → trip → destination
  instructions, with the narrower instruction taking precedence on the same topic.
  Text-derived timing rules require acceptance before becoming structured settings.

## REST contracts and concurrency

Let `D = /trips/{tripId}/destinations/{destinationCity}`. Routes have no `/api` prefix.
DTOs and nested input validation attributes also generate MCP and OpenAPI schemas.

| Resource | Methods and paths |
| --- | --- |
| Profile preferences | `GET/PUT /user/activity-preferences` |
| Shared preferences | `GET/PUT /trips/{tripId}/activity-preferences`, `GET/PUT D/activity-preferences` |
| Saved plan | `GET/PUT D/activity-plan` |
| Assessment | `POST D/activity-plan/assessments`, `GET .../assessments/{id}` |
| Proposal | `POST D/activity-plan/proposals`, `GET .../proposals/{id}` |
| Review | `PUT D/activity-plan/proposals/{id}/review` |
| Operations | `GET /operations`, `GET /operations/{operationId}` |
| Personal subscriptions | `POST/GET /trips/{tripId}/calendar-subscriptions`, `DELETE .../{id}` |
| Calendar | `GET /calendars/{token}.ics` |

A preferences replacement sends `{ instructions, defaults }` and `If-Match`.
A plan replacement sends `{ plan, contextVersion, proposalId?, choiceId? }` and
`If-Match`. The complete plan contains selected/excluded IDs, days, rules,
transport overrides, settings and timezone. Days contain visit ID, local date,
ordered activity IDs, optional settings, accepted availability, and explicit flight
matches when needed. Preserve unrelated fields when editing a complete resource.

Plan GET returns the current assessment, the accepted assessment, shared context,
flight-availability candidates, `timingStale`, a numeric plan version, and an opaque
context version. The ETag is quoted. Missing `If-Match` returns 428, mismatching
ETags return 412, and changed input context returns 409. Context covers activities,
visits, destination metadata, preferences, membership, selected flights,
accommodation and evidence. Both stores compare versions inside their write lock
or transaction. Plan selection and activity state updates are atomic.

Assessment/proposal creation sends a unique `requestId`, `contextVersion`, optional
unsaved `plan`, `refreshEvidence`, and `useAi`; proposals also accept `kind` (`draft`
or `improvements`). Identical retries return the same job; reusing an ID with
changed inputs returns 409. Cached-only assessments complete immediately and
persist their result. Enrichment and optimization return 202 and an operation ID.
Poll operations or the result URL for progressive results. Assessing an unsaved
plan does not save that plan.

A review replaces `{ dismissedSuggestionIds }`, using the result's review ETag and
`Planning-Context` header. Dismissals suppress equivalent suggestions while plan
and input versions match. Applying a proposal sends its full server-returned plan
and both IDs through plan PUT. The server verifies the choice, versions and domain
rules again. Stale choices cannot overwrite newer work.

Owners and Planners may change shared planning resources. Travellers can read and
manage their own profile preferences and calendar subscriptions. Foreign resources
are hidden with 404. Workers recheck both Planner permission and the LLM flag
before provider work, evidence writes and result completion.

## Implementation and persistence

`ActivityPlanningContext` owns the pure `Evaluate(plan, now)` method. The
context includes private profiles and must never be returned or logged. Database,
routing, preference scoring and research are interfaces. Evaluation reports
hard conflicts, affected activity IDs, time totals, per-traveller/group utility,
provenance and explicit assumptions. It uses elapsed timezone-aware time for DST,
rejects ambiguous/skipped anchors, includes accommodation legs and opening windows,
and keeps infeasible schedules intact for explanation.

`IActivityPlanningDb` is part of `IPlannerDb`, with PostgreSQL and in-memory
implementations. Migration `0011_ActivityPlanning.sql` follows Activity Log and
OAuth migrations. It persists preferences, plan aggregates with accepted schedule
projections, evidence, assessments/proposals/reviews, leased jobs, input revisions,
and calendar-token hashes. Database triggers synchronize direct activity/visit
changes, advance revisions and revoke subscriptions on membership loss. Jobs share
existing operations and retain initiating actor/source. A worker crash permits
lease recovery; completion uses the lease ID to reject outdated workers.

`AuditedPlannerDb` records successful shared preference changes, plan replacements,
proposal reviews and personal subscription lifecycle actions. The authenticated
actor and Website/ChatGPT/MCP source come from the shared request context. Failed
authorization/concurrency checks produce no mutation entry. Profile instructions,
provider payloads and subscription secrets are excluded from the Activity Log.

## Optimization and evidence

The native .NET OR-Tools CP-SAT model selects activities, assigns days, orders a
circuit through day depots, and constrains elapsed start times, fixed anchors,
manual opening windows, exclusions and predecessor rules. Spatial ordering provides
an independently assessed initial candidate and solver hints. Every published
schedule is re-evaluated independently; approximate travel or meal constraints in
the solver cannot silently certify a conflicting plan.

Objectives are overall equal-weight group utility; least-covered traveller's
interest coverage followed by group utility; and lower travel retaining at least
90% of the best discovered group utility. Otherwise equal choices prefer fewer
changes. Larger workloads may return a useful incumbent before search finishes.
Statuses distinguish timeout, insufficient evidence, limit exceeded, no improvement,
no validated candidate and proven contradictory restrictions. Exhaustive global
optimality is not claimed when time runs out or factual evidence is approximate.

Default limits are 100 candidates and 30 destination days (across visits), 30 solver
seconds and a three-minute job deadline. Solver cancellation, provider deadlines,
request budgets and bounded candidate review limit work. Manual planning supports
up to 1,000 activities/366 days independently of optimization limits.

Providers are server-only and have fixed service hosts:

- Azure Maps walking/road matrices. Taxi/rideshare adds an explicit provisional
  pickup allowance. Self-driving must be selected for the entire day; per-leg
  choices do not model repositioning a private car.
- Public transit is not supported. Walking is the default; car routes use Azure Maps.
  Migration `0014` converts legacy transit settings to walking and discards cached transit routes.
  Saved calendar timing is preserved until revised timing is accepted.
- OpenAI Decisions scores activity affinity and returned transport choices with
  explicit 0–4 rubrics. It does not supply factual routing durations.
- Responses with web search researches opening windows and interprets shared text.
  Research retains dates and source links; links must occur in consulted results,
  be public HTTP(S) URLs without credentials, and match requested activities/dates.
  Uncertain/conflicting research remains provisional. Manually supplied windows
  take precedence. Expired or changed-activity evidence is not a verified fact.

Shortlisted travel is rechecked at proposed departure times, with up to three
passes as timing changes. Provider calls use at most four concurrent requests,
a 15-second timeout, a shared 120-request budget including retries, bounded bodies,
and one retry for selected transient errors. HTTP cache directives bound routing
retention; no-store responses are not persisted. Useful partial evidence and safe
failure explanations survive a failed provider. AI requires the existing `LLM`
feature flag; manual assessment and CP-SAT do not.

Flight availability is proposed from selected flights, with editable airport and
transfer buffers. It takes the latest traveller arrival and earliest departure.
Ambiguous matches return named candidates for explicit per-traveller selection;
assessment resolves selected matches. Users accept availability or enter it
manually. Destination dates are never changed by flight inference.

## MCP tools

`ActivityPlanningTools` uses `McpExecutionAdapter` and the same REST DTOs, handlers,
permissions and services. Inputs cannot choose an acting user. Tools return
structured status/data, ETag/context version, operation ID and result identifiers
where applicable.

| Capability | Tools |
| --- | --- |
| Preferences | `get_activity_preferences`, `replace_activity_preferences` |
| Plan | `get_activity_plan`, `replace_activity_plan` |
| Assessment | `create_activity_plan_assessment`, `get_activity_plan_assessment` |
| Proposal/review | `create_activity_plan_proposal`, `get_activity_plan_proposal`, `replace_activity_plan_proposal_review` |
| Jobs | `list_operations`, `get_operation` |
| Calendar | `list_calendar_subscriptions`, `create_calendar_subscription`, `revoke_calendar_subscription` |

Preference scope is a typed profile/trip/destination enum with matching resource
IDs. Profile always means the authenticated user. Reads use `tripplanner.read`;
persisted assessments/proposals, replacement and subscription changes require
`tripplanner.write` plus resource authorization. Tool metadata declares read-only,
destructive, open-world and implemented idempotency semantics. No map token,
provider credential, arbitrary proxy URL or raw routing endpoint is exposed.

An entirely MCP-driven flow is: read plan/context → create assessment → create
proposal with a request UUID → poll operation → inspect proposal → replace plan
with exact choice, proposal ID, current ETag and context. Reread and reassess after
a stale-version error. Previewing is distinct from applying.

## Calendars and secret handling

Each member owns revocable subscriptions across the whole trip. Creation returns
the bearer URL once; normal lists return only IDs and lifecycle timestamps.
Database storage contains SHA-256 hashes of random 256-bit tokens. Membership loss
permanently revokes access, including after a member is re-added.

ICS feeds use stable trip/activity UIDs, revision sequences, UTC instants derived
from the destination timezone, locations, coordinates, links and provisional
labels. Undated/unscheduled activities and unaccepted proposals are omitted.
Removing an activity removes its event. Provider refresh changes assessment context
but does not move events until revised timing is explicitly saved.

The API disables automatic request-path diagnostics for bearer calendar URLs.
Bicep disables App Service HTTP logs and failed-request tracing, which cannot redact
those path segments. Keep external reverse-proxy/access logs configured similarly.
Provider HTTP loggers are removed to keep credentials out of diagnostics.

## Configuration and verification

`ActivityPlanningOptions` binds `MaxActivities`, `MaxDays`, `SolverSeconds`,
`JobTimeoutSeconds`, `ProviderRequestLimit`, `ProviderTimeoutSeconds`,
`EvidenceHours`, `DecisionsModel`, and `PublicBaseUrl`.
Compose and release set the calendar origin; production requires HTTPS.

```zsh
./scripts/buildout  # applies the read-only Azure Maps routing role and log settings
./scripts/server
./scripts/format
dotnet test GustavoTripPlanner.sln -c Release
cd src/TripPlanner.Web
CI=true corepack pnpm test
CI=true corepack pnpm run lint
CI=true corepack pnpm run build
```

PostgreSQL parity tests also run when `TRIPPLANNER_TEST_POSTGRES` points to an
isolated PostgreSQL/PostGIS test database with search path `gustavo_planner,public`.
Do not point automated tests at production. They exercise the migration, state
synchronization, reference cleanup, reviews and permanent token revocation.

Production-native solver and independent live-provider checks:

```zsh
docker build --platform linux/amd64 -f src/TripPlanner.Api/Dockerfile -t tripplanner-api:milestone3-validation .
# Publish the test-owned verifier for the container's platform, then run it in
# the production runtime image without adding test code to that image.
dotnet publish tests/TripPlanner.Api.Tests -c Release --os linux --arch x64 --self-contained false -o /tmp/tripplanner-verification
docker run --rm --platform linux/amd64 --entrypoint dotnet \
  --mount type=bind,source=/tmp/tripplanner-verification,target=/verification,readonly \
  tripplanner-api:milestone3-validation /verification/TripPlanner.Api.Tests.dll --verify-solver
# In an environment already configured with the normal provider credentials:
dotnet run --project tests/TripPlanner.Api.Tests -c Release -- --verify-planning-providers
```

The provider command performs bounded live Azure walking, Azure car, Decisions
and opening-hours checks and prints safe pass/fail summaries. It does not modify
trip data or dump credentials. Live Decisions and Responses checks passed during
implementation. Azure Maps returned 403 with the pre-milestone Search-only SAS
identity; applying the new route-read role is required before retesting.

Calendar-client smoke test after starting a configured server:

1. Save a dated plan and create a subscription from Daily plan.
2. Subscribe from a calendar client and verify destination-local event times,
   accommodation/location links and provisional labels.
3. Refresh evidence and refresh the client: accepted event times must stay fixed.
4. Accept revised timing, refresh, and verify stable event identity with a newer
   sequence. Return an activity to Ideas and verify event removal.
5. Revoke the subscription, then confirm the feed returns 404 and cannot refresh.
   Remove the test subscription from the client afterward. Clients differ in their
   refresh cadence and may retain their last downloaded copy after revocation.

Automated coverage includes capacity, meals, rest, anchors, repeat visits,
overnight/DST behavior, missing/stale evidence, group flights, independent solver
fixtures and larger inputs, provider failures/budgets, REST/MCP parity and scopes,
private-profile isolation, worker permission changes, stale writes, idempotency,
audit attribution, mobile editing, saved calendar projections and revocation.
A real calendar-client refresh cycle is a separate deployment smoke test.

## Deferred scope

Split-group schedules, repeated activity occurrences, automatic bookings, two-way
calendar editing, monetary-budget optimization, mixed-mode private-car positioning,
and trip revision-history UI remain deferred.

Implementation validation on 2026-10-16: 284 API tests passed with PostgreSQL
integration enabled against a fresh isolated database; 163 frontend tests passed.
CSharpier, frontend lint, production build and both Bicep template compilations
passed. The web build retains its bundle-size advisory. OR-Tools native loading
was verified locally and in Linux ARM64 and AMD64 images. The external live-check
limitations above remain explicit release follow-ups.

Provider contract references: [Azure Maps route matrix](https://learn.microsoft.com/en-us/rest/api/maps/route/post-route-matrix?view=rest-maps-2025-01-01),
[OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions),
and [Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search).
