# Travel-agent MCP evals

These cases exercise the actual server's initialization instructions, tool discovery,
validation, permissions and persistence through disposable in-memory test hosts.
The fixtures do not connect to Azure, a production database, search providers or bookings.
The acting model has OpenAI's hosted `web_search` enabled by default, independently
of these fixture services. Web research runs through the paid Responses API;
`--smoke` and harness unit tests do not invoke it.
The current model adapter uses OpenAI Responses. Other model providers can reuse
the fixture service and assertions with their own adapters. The model receives the
MCP initialization instructions and actual tool schemas; the harness does not inject
a separate planning prompt. Detailed planning guidance and
preferences must be retrieved through `get_planning_context`.

The eval client uses hosted Responses tool search by default (`toolLoading:
deferred` in `defaults.json`). `get_planning_context` stays immediately callable;
the remaining real MCP tools are grouped into small namespaces and their complete
schemas load on demand. No tool is removed from discovery, and the server's actual
tool descriptions, validation constraints and handlers are preserved. This avoids
loading every schema into model context on every turn. See
[OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search).

This models a client with deferred tool loading. Actual ChatGPT/Codex/other clients
choose their own context strategy; the MCP server cannot force them to defer tools.
For a baseline or a model without tool search support, run
`TRIPPLANNER_EVAL_TOOL_LOADING=full ./scripts/evals`. Provider `config.toolLoading`
can also select `full` or `deferred`. Keep this setting fixed when comparing server
instruction revisions; changing it changes the client behavior being tested.

MCP results commonly contain the same JSON in both `structuredContent` and a text
content block for client compatibility. The adapter supplies that data once to the
model, preserving extra text, images, errors and edit validators. Original results
remain intact in the saved call trace; the server's response contract is unchanged.
The whole Japan trip still takes context when the agent reads it; deferral does not
make that trip data free or eliminate the cost of replaying conversation history.

Run the entire workflow from the repository root:

```zsh
./scripts/evals --smoke
```

This builds the test executable, starts isolated fixtures, waits for readiness,
checks MCP discovery/context/prompts, and stops the server. It needs no model key.

For behavioral evals, sign in with `az login`, then run. The script discovers the
deployed Azure Key Vault and reads its `openai-api-key` secret; it supplies that value
to the model runner as `OPENAI_API_KEY`. No manual key export is needed, and existing
`OPENAI_API_KEY` / `LOCAL_OPENAI_API_KEY` values are not used by this wrapper.
The default model is `gpt-6-luna` with Flex processing (`service_tier: flex`);
these defaults live in `defaults.json`:

```zsh
./scripts/evals --repeat 3
./scripts/evals --view
```

Use `--model MODEL` (or `TRIPPLANNER_EVAL_MODEL`) to override the model and
`--output DIRECTORY` to choose an artifact directory. Select Standard processing with:

```zsh
./scripts/evals --service-tier default --repeat 3
```

`TRIPPLANNER_EVAL_SERVICE_TIER=default` is the equivalent environment setting.
Flex uses the same model at discounted rates with slower responses and possible
capacity errors. Model requests get a ten-minute timeout in Flex versus one minute
in Standard. Capacity errors remain errors; the runner never silently switches to
Standard pricing. `results.json` records requested and returned service tiers.
See [OpenAI Flex processing](https://developers.openai.com/api/docs/guides/flex-processing)
and [Luna's model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

Batch processing is a separate asynchronous API. It can be useful for independent
single-turn cases or grading saved transcripts, but this runner executes dependent
model/tool turns. It would need a batch scheduler and resumable fixture state,
rather than a `service_tier` flag, to support that workflow. `--service-tier batch`
is explicitly rejected. See [Batch API](https://developers.openai.com/api/docs/guides/batch).

Forward additional Promptfoo arguments after `--`, for example
`./scripts/evals -- --filter-pattern "Reuse destinations"`. Model calls incur API charges.
Up to four cases (including repetitions) run in parallel, configured by
`evaluateOptions.maxConcurrency` in `promptfooconfig.yaml`. Each case owns a separate
trip and fixture session; its dependent model/tool turns remain sequential. Override
the limit with `./scripts/evals --repeat 3 -- --max-concurrency 2`, or use `1` for a
serial run. The fixture bridge handles MCP requests one at a time while model
requests from separate cases can overlap. The bridge supports up to 32 active sessions.
The script uses the CLI version in `promptfoo-version`; `PROMPTFOO_VERSION` can
explicitly override it. `npx` downloads that version on first use.

Artifacts live under `.promptfoo/runs/<UTC timestamp>-<run ID>/`: `build.log`,
`fixtures.log`, `fixture.json` (including server guidance version), and `results.json`
for behavioral runs. `run.json` records the model, requested service tier, repeats, pinned CLI version,
server guidance version, tool-loading mode, instruction-source SHA-256 and Git revision. Each model
output includes its final answer, actual tool arguments and results, and before/after
fixture state. These bodies contain only
the configured starting trip and its simulated edits. The Japan document includes
traveler names; keep the artifacts local unless you intend to share that data.
Each output's `contextUsage` records full schema size, initial visible discovery
size (characters, not token estimates), hosted search events, and each actual model
request's input/output/cached-input/reasoning token counts. Token usage totals now
include cached-input counts and the actual number of model requests. Cached tokens
are a subset of input tokens; they must not be added again to the total. Each tool
call records raw and model-facing result sizes so duplicate-removal savings are
visible. Promptfoo's execution count still counts cases, not model/tool turns;
inspect `contextUsage.requests` for the underlying requests. These metrics are not
a billing receipt; no dollar cost is inferred from missing provider usage fields.

Vault discovery uses the same `RESOURCE_GROUP`, `SUBSCRIPTION`,
`INFRA_DEPLOYMENT_NAME` and `EXPECTED_TENANT_ID` settings as `scripts/server`.
Defaults target the development infrastructure deployment. Commands select the
subscription explicitly without changing your global Azure CLI selection. Missing
Azure sign-in, unexpected tenant, deployment lookup failure or missing/empty secret
stops the run before starting fixtures or calling a model. Manage the credential
with `scripts/secrets set openai-api-key`. `--smoke` and `--view` never access Azure.

The fetched key stays in memory and is supplied only to the model-runner process;
it is not written to the run manifest, command arguments or log files. Do not commit
keys or captured real-user data. Fixture endpoints bind only to `127.0.0.1:5188`; set `TRIPPLANNER_EVAL_PORT` to
use another port. The script refuses a service with a different readiness identity
and cleans up its fixture and model-runner processes on success, failure or
interruption. Each case has independent IDs and storage, released at completion.

For manual debugging, the fixture service can still be started with
`dotnet run --project tests/TripPlanner.Api.Tests -c Release -- --mcp-eval-server [PORT]`.
`TRIPPLANNER_EVAL_URL` selects its loopback URL in the provider and smoke client.

Author the cases in `promptfooconfig.yaml` with your users. The initial entry is
an unfilled template; duplicate it for each real situation:

- `description`: a short name for the situation.
- `tripDocument`: starting trip, relative to `evals/mcp`; the template uses `../../docs/after.json`.
- `conversation`: earlier `{role: user|assistant, content: ...}` messages, in order.
  Leave `[]` for a fresh conversation. This is supplied as actual message history;
  prior tool calls and writes are not replayed. The starting document must already
  include any earlier saved changes.
- `request`: the next user message, in their own words. Empty requests are rejected
  before fixture or model calls.
- `expectedOutcome`: reviewer notes about what the agent should say, ask, propose
  or save. These notes are never sent to the model and do not grade results.

No behavioral assertions are configured while cases are being authored. Promptfoo
can label a completed execution as passing; that only means it ran without an
execution error. Assessing the expected outcome requires manual review until we
agree on rubrics. The old synthetic-case assertion module remains a harness test
and is not attached to this suite.

A rubric is a set of user-authored review criteria, not an expected answer string.
Start with humans reviewing saved answers alongside the request, history, available
trip context and actual tool calls. For each criterion, record a judgment such as
meets / partly meets / misses / uncertain, with evidence and a reason. Different
valid itineraries can meet the same criteria. Resolve disagreements with users and
keep examples of acceptable and unacceptable responses.

Code can later check objective facts such as unauthorized saved changes, malformed
activities or incorrect dates. Subjective usefulness, pacing and coherence require
review. Promptfoo's optional
[`llm-rubric` assertion](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/)
can ask a separate model to apply written criteria to the response and supplied
evidence. That would be another fallible reviewer, with additional API usage. Before
relying on it, compare its judgments against user-reviewed examples and inspect
disagreements; never treat a high automated score as proof of user satisfaction.
For comparisons, users can also choose which of two anonymized outputs they prefer
and why. No model judge or subjective pass threshold is enabled in this template.

Each execution restores the Japan document's people, destinations, visits, stays,
activities, activity preferences, schedules and saved flight choices in its own
in-memory host. The connected test user acts as the document's owner. Trip IDs,
owner identity, validators and derived itinerary entries are regenerated. Visit,
activity and group IDs and their planning data are retained. Source validator
strings are not imported as locks; derived transfer entries are not restored as
independent saved connections.
The document is fetched through real MCP tools rather than pasted into the user
prompt. `--smoke` checks four independent Japan copies without a model call.

`web_search` searches the internet; `tool_search` discovers available MCP operations.
Set provider `config.webSearch: false` for an explicitly offline case. This defaults
to `true` in `defaults.json`. Saved results include `webSearches` (queries, actions,
and returned sources) and `citations` (URL/title annotations from the final answer).
Hosted search-only responses continue the agent loop rather than ending a case
before an answer. Search tool calls have additional API charges beyond model tokens.

TripPlanner exposes no LLM research or generation endpoints and has no LLM feature
flag. Research belongs to the connected agent. This eval client supplies its own
hosted web search and pays through the developer eval key; user agents use their
own LLM/browsing access. Fixtures only store data and run deterministic planning
with stubbed external Maps/flight services. Booking providers remain stubbed.
Test actual user clients too: this harness does not reproduce their private system
instructions or native browsing behavior.

Human failures can be recorded directly in the Promptfoo viewer: hover an output
and choose the thumbs-down action, then add a comment explaining the unmet outcome.
Those ratings persist in Promptfoo and future exports; previously written run JSON
files are snapshots and are not rewritten by the viewer. `failingExamples` in the
case config stores user-labeled examples for later calibration; it is never sent to
the planning model and does not enable an automatic judge.

MCP instructions, prompts, tool descriptions and schema guidance live together in
`src/TripPlanner.Api/Instructions/McpInstructions.cs`; bump `Planning.Version` when
changing agent behavior. The catalog uses constants so tool/schema attributes remain
checked by the compiler.
The daily theme remains guidance rather than a persisted domain field.

Harness checks without model calls: `node --test evals/mcp/*.test.cjs` from the repository root.


## Real server calls

With Application Insights configured, deployed MCP calls produce spans containing
registered tool name, timestamp, duration, application status, outcome, failure
category, request trace IDs and `mcp.guidance.version`. Use
[the tool-call query](../../docs/observability/mcp-tool-calls.kql) in Application
Insights Logs. Arguments, results, preferences, credentials and chat text are not
exported through these traces. The guidance version labels the server deployment;
it does not establish which cached instructions the client used.

Separate tool calls do not automatically share a conversation ID. A client's W3C
trace context can correlate related requests when supplied. Without client-side
capture, the server cannot know what the user asked or how the agent's final answer
looked. The existing Activity Log complements traces with authorized write history;
it does not record reads or complete conversations.

Use traces to spot tool failures and usage changes, then reproduce real failures
as anonymized fixtures. Assess planning quality using an explicitly captured test
conversation alongside tool calls. Production body capture is a separate feature
requiring an explicit capture scope, redaction and retention; this change does not
enable it.
