# Travel-agent MCP evals

These cases exercise the actual server's initialization instructions, tool discovery,
validation, permissions and persistence through disposable in-memory test hosts.
The fixtures do not connect to Azure, a production database, search providers or bookings.
The current model adapter uses OpenAI Responses. Other model providers can reuse
the fixture service and assertions with their own adapters. The model receives the
MCP initialization instructions and actual tool schemas; the harness does not inject
a separate planning prompt. Detailed planning guidance and
preferences must be retrieved through `get_planning_context`.

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
server guidance version, instruction-source SHA-256 and Git revision. Each model
output includes its final answer, actual tool arguments and results, and before/after
fixture state. These bodies contain only
synthetic fixture data.

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

The code assertions check retrieval before writes, preservation of existing data,
classification and uncertainty in saved activities. Review conversation quality too:

| Case | Human review rubric |
| --- | --- |
| Saved dates | Uses June 10, 2027 in Paris; does not ask for known destination/dates; gives a coherent, practical theme. |
| Missing dates | Asks for missing visit dates; does not invent or schedule dates. |
| Preferences | Food overrides music; quiet afternoons and inexpensive meals still apply. |
| Events | Clearly explains that current concerts, prices and tickets cannot be verified without browsing. |
| Save activity | Saves exactly the requested idea, keeps unknown details unknown, and preserves existing data. |

Score each rubric 0 (fails), 1 (partly meets), or 2 (meets). Compare guidance revisions
using fixed cases and rubrics, multiple runs, and the same model configuration. Use
additional provider entries with different `config.model` values to compare models.
The fixture intentionally has no web search tool; add a separate sourced-search suite
before claiming to evaluate browsing quality. Test actual ChatGPT/Codex/other clients
as well: this harness models an MCP client, not their private system instructions.

MCP instructions, prompts, tool descriptions and schema guidance live together in
`src/TripPlanner.Api/Instructions/McpInstructions.cs`; bump `Planning.Version` when
changing agent behavior. The catalog uses constants so tool/schema attributes remain
checked by the compiler.
The daily theme remains guidance rather than a persisted domain field.

Harness checks without model calls: `node --test evals/mcp/provider.test.cjs evals/mcp/scripts.test.cjs` from the repository root.


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
