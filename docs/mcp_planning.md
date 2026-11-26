# Travel-agent MCP planning and evaluations

See [ChatGPT MCP access](mcp.md) for connection and authorization setup.

TripPlanner never calls an LLM on behalf of travelers. The connected agent uses
its own model and browsing tools, under the caller's billing, to research venues,
interpret preferences and propose an itinerary. MCP supplies trip context and
validated tools to save complete resources. There is no LLM feature flag, server
OpenAI credential, AI research endpoint, photo import, or trip-form generation.
The deterministic scheduler, Maps routing/geocoding and flight searches remain.
The separate developer eval runner calls OpenAI using its own Key Vault key.
Historical database research-job records and the retired flag column are left
untouched; the application no longer reads or writes them.

Agents start activity recommendations and daily planning with `get_planning_context(tripId)`.
This read-only MCP tool returns the portable trip document (destinations, visit dates,
existing ideas and schedules), the connected user's profile preferences, shared trip
and destination preferences, and versioned guidance.
It requires read or write scope and trip visibility. It excludes other travelers' raw
private profiles. No new REST route is needed for this aggregate MCP read.

For activity creation, edits, audits, and agent-driven imports, use a host with
web search and page reading enabled. The OpenAI eval host exposes `web_search`
by default. Research the exact branch and its complete postal address first.
Prefer the official venue, then regional sources such as NAVITIME, MapFan and
Yahoo! Maps Japan, followed by OpenStreetMap, Wikidata and reputable maps or
directories. Use local-language names when relevant.

`geocode_address(tripId, destinationId, address)` returns a single
high-confidence candidate near the destination, including its GeoJSON point,
formatted address and provider. Check the candidate against the researched
address and branch. If the candidate is missing, ambiguous, inconsistent, or
the geocoder fails, immediately search the web for independent coordinates.
Examine published venue points, structured metadata or venue-specific map links,
and corroborate the intended location with a second source when possible.
Independently verified coordinates can be saved directly.

Every MCP activity create or update requires `properties.locationVerification`.
`VerifiedVenue` and `VerifiedEntrance` require a verified `properties.address`,
a GeoJSON Point in `[longitude, latitude]` order, a verification method and
source URLs present in `properties.links`. Use `RepresentativeArea` for a
sourced entrance or landmark that represents an area, and `Nonphysical` for
activities with no physical location. `Unresolved` uses null geometry, keeps
any verified address, and records attempted sources and the specific uncertainty.
Keep the description and other activity fields intact. If the host lacks web
research, report any entries that could not be verified.

For an audit, call `list_activities` for each requested destination. The MCP tool
returns `features`, `total`, and `nextSkip`, with 25 entries per page by default
and a maximum of 100. Collect all pages before processing them. Review existing
points with questionable precision as well as missing addresses and points.
Use the current activity ETag and destination contextVersion for edits and
call `get_activity` after each write to confirm the saved location, evidence
and unrelated fields. Check existing scheduling with `get_activity_plan`.
Report completed, unresolved and exempt activities and disclose any entries
that could not be processed or verified.

`plan_destination(tripId, destinationCity)` is also available through MCP `prompts/list`
and `prompts/get` for clients that support user-selected prompt templates. The first
part of initialization instructions points agents to planning context so ordinary tool
use does not depend on selecting that prompt. Refresh the MCP connection after release
to discover the new tool, prompt and activity schemas.

All MCP-facing instructions and prompt text live in
`src/TripPlanner.Api/Instructions/McpInstructions.cs`, with one sentence per source
line. Multiline raw string literals keep longer instructions readable in C#.
The catalog includes initialization instructions, versioned planning guidance and
preference precedence, the destination prompt, tool and parameter descriptions,
shared field/schema descriptions, and MCP recovery messages. Tool handlers, prompt
registration and shared validation metadata reference these strings through standard
`DescriptionAttribute` metadata instead of owning prose. Keep protocol names, validation constraints,
authorization and handler logic at their existing call sites. Bump
`McpInstructions.Planning.Version` when changing agent behavior. Rebuild/release the
API and refresh the client's MCP connection to pick up revised instructions.

Each day should have a coherent theme based on interests, geography or an anchor activity; this remains prompting guidance and is
not a persisted theme or scheduling constraint. Conflicting preferences use the current
explicit request, destination, trip, profile, then application defaults; unrelated
preferences combine. Conversational preferences are saved only when the user requests
or accepts remembering them.

Activity kind selection is optional: `kinds` is a duplicate-free array of free-form
strings and may be empty.
Each label must be nonblank and at most 200 characters; there is no fixed catalog.
The web editor supports adding, editing, and removing custom kind labels, with
suggestions from the signed-in user's existing activities.

`GET /user/activity-kinds` and the read-only MCP `list_activity_kinds` tool list
distinct labels across trips owned by the connected user. Shared trips owned by
someone else are excluded. Optional `search` matches a case-insensitive literal
substring (up to 200 characters); `top` defaults to 20 (maximum 100) and `skip`
defaults to 0 (maximum 100000). Results are sorted by label and return
`{ "kinds": [...], "hasMore": true|false }`. Labels are read directly from saved
activities, so changes and deletions affect subsequent queries. Responses are
private and not cached. Autocomplete remains optional: users and agents can
always enter new labels. The iOS API client supports the same query contract.

`address` is nullable; `ticketRequirement` is `Unknown`, `Required`, or `NotRequired`
(default `Unknown`). Existing `links` carry official websites and research sources.
Unknown prices remain null rather than zero. Missing ticket evidence never implies free
or ticketless entry. The web editor saves related metadata together with the complete
activity; portable documents and the native decoder preserve it. Older activity payloads
without classification must be updated before use with this contract; no classification
is inferred during decoding. Activity data remains in the existing JSON document column.

## Running behavioral evaluations

Run `./scripts/evals --smoke` to build, start, check and stop the isolated fixtures
without model calls or Azure access. After `az login`, `./scripts/evals --repeat 3`
loads `openai-api-key` from the deployed Azure Key Vault and runs behavioral evals
using `gpt-6-luna` with Flex processing by default and up to four cases in parallel.
Override concurrency with `-- --max-concurrency COUNT` (use `1` for serial runs).
It uses the same deployment,
subscription, resource-group and tenant settings as `scripts/server`; existing key
environment variables are not used by this wrapper. The fetched key is passed in
memory to the model runner and is not saved in artifacts.
`--model MODEL` or `TRIPPLANNER_EVAL_MODEL` overrides the model;
`--service-tier default` or `TRIPPLANNER_EVAL_SERVICE_TIER=default` selects Standard
processing instead of discounted, slower Flex processing. Batch requires a separate asynchronous scheduler and is not
supported by this interactive runner. The defaults live in `evals/mcp/defaults.json`.
The eval client defers tool schemas through hosted Responses tool search, keeping
planning context immediately available and loading other tools when needed.
`TRIPPLANNER_EVAL_TOOL_LOADING=full` enables the full-catalog baseline. Identical
structured/text JSON results are supplied once to the model; original MCP responses
remain in traces. Saved outputs include per-request token/cache counts and context
sizes so usage can be inspected. This client optimization does not control how
other MCP clients load tools.
The eval agent also has hosted OpenAI web search enabled by default, with searches,
source URLs and answer citations retained in results. This is independent of the
isolated MCP fixture's storage and deterministic planning and requires paid API calls.
The runner saves results under `.promptfoo/runs`;
`./scripts/evals --view` opens the saved results viewer. The runner pins Promptfoo in
`evals/mcp/promptfoo-version`, waits for its own server's readiness, and cleans up its
fixture and CLI processes on exit. Azure access is limited to account/deployment
lookup and reading the OpenAI secret; the fixtures never access production trip data.
Author realistic cases with users in `evals/mcp/promptfooconfig.yaml`: the template
uses `docs/after.json` as the Japan starting trip and has placeholders for conversation
history, the next request, and reviewer-only expected outcomes. Each execution gets
an independent in-memory copy. Blank requests make no model calls. No behavioral
grading is attached yet; a completed run does not establish that expectations were met.
See [MCP evals](../evals/mcp/README.md) for authoring and runner options.
