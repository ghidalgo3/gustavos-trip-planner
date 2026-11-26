# Running a UX audit

From the Trip Planner repo root, run `scripts/ux-audit`. For another app, run `node <skill>/scripts/audit.mjs` with `UX_AUDIT_DEPS` pointing to a Node project that has `playwright` (or `@playwright/test`), `yaml` 2.x, and `ajv` 6.x installed. Use Node 22 or newer and install the browsers required by the profiles. The active Playwright adapter is a Node API integration so every input and observation passes through one recorder. Playwright CLI and MCP are useful alternatives to investigate when adopting the skill on a different host.

## Target and scope

Trip Planner audits default to `http://localhost:5173`, served by `scripts/server --detached`. For another app, pass the origin as `--url` or set `targetOrigin` in its project config. Pass the build or commit as `--app-version`. Pick `desktop` or `mobile-web`. The latter has a touch viewport by default. Profiles, engine versions and visible viewports are recorded in results. An unavailable profile stops with an error so it can be marked untested. To test both profiles, use the same output directory and run each platform independently.

For a signed-in Trip Planner journey, reuse the local Playwright state created by `scripts/ux-audit sign-in`. Pass it as `--storage-state artifacts/ux/auth/localhost.json`. Keep that file outside the reports. For another target, start from a fixture account, a read-only test account, or public pages. Audit sessions block non-read HTTP methods by default, close WebSockets, and disable service workers. The runner requires a loopback origin, a named disposable fixture, a write-enabled scenario and `--allow-fixture-writes` to exercise writes. Reset fixture data between independent attempts and supply a fixture identity or version. Local-only writes and the read-only HTTP guard assume GET requests follow HTTP semantics. Use synthetic data where possible and keep raw screenshots and logs private until reviewed.

Use a fresh output directory for every audit version. `list` shows the available scenarios, personas and rules. For discovery, choose a goal from public docs or the rendered app and save a scenario JSON conforming to the scenario schema. Supply it using `--scenario-file`. Repeat the scenario with the same file and ID. During exploration, use only the task and persona, rendered snapshots and screenshots. Discovering a goal and writing its success criteria can be done before the exploration.

## Delegate browser interactions

Start a fresh Codex subagent with model `gpt-6-luna` and reasoning effort `low`.
Give it the goal, persona, browser profile, target, starting state, output
directory, and this runbook. Include the saved sign-in file path when needed.
Keep known paths and expected answers out of the first attempt. Brief the
subagent on one checkpoint goal at a time for a journey that has checkpoints.
If Codex cannot launch the requested model and effort, report the blocker.

The browser subagent runs the Playwright session and decides where to click,
tap, scroll, or type. It records decisions and friction, checks the visible
outcome, and tries an alternative from a fresh starting state when appropriate.
It returns the outcome, actions, and evidence paths to the audit owner.

The audit owner reviews the screenshots and logs, applies the evaluation rules,
and generates the reports.

## Interactive session

```sh
scripts/ux-audit session --platform desktop --scenario find-destination-dates \
  --storage-state artifacts/ux/auth/localhost.json --fixture local-seeded \
  --app-version "$(git rev-parse --short HEAD)" --out artifacts/ux/current
```

Start a long-lived terminal session with stdin. Read the initial JSON state, then send one JSON object per line and wait for its result. When using Codex terminal tools, use a PTY and send each line through the existing session. Never invent a control reference or coordinates. Observe again if a control moves or loading completes. The rendered data is bounded to the viewport. Use keyboard actions and screenshots where useful.

| Command                                         | Example                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Observe without counting an action              | `{"type":"observe"}`                                                                       |
| Desktop click or mobile tap                     | `{"type":"click","ref":3}` or `{"type":"tap","ref":3}`                                     |
| Coordinate interaction                          | `{"type":"tap","point":{"x":110,"y":220}}`                                                 |
| Type into the focused input                     | `{"type":"type","value":"Synthetic trip name"}`                                            |
| Keyboard command                                | `{"type":"press","key":"Shift+Tab"}`                                                       |
| Desktop wheel                                   | `{"type":"scroll","point":{"x":300,"y":400},"dy":300}`                                     |
| Touch scroll or swipe                           | `{"type":"swipe","point":{"x":120,"y":500},"end":{"x":120,"y":250}}`                       |
| Drag                                            | `{"type":"drag","point":{"x":100,"y":200},"end":{"x":180,"y":240}}`                        |
| Browser back                                    | `{"type":"back","tags":["backtrack"]}`                                                     |
| Verify the outcome from the last observed state | `{"type":"finish","status":"success","reason":"The trip overview shows the Tokyo dates."}` |

Callbacks and waits do not count as actions. Take a new observation when the state settles. Annotate material states using optional fields `area`, `stateKey`, `decision`, `alternatives`, and `memory`. `area` is the functional area and `stateKey` is a short description of the visible state. `alternatives` counts credible options for the labeled decision. Use the same labels when revisiting the same demand. Optional interaction tags are `exploration`, `incorrect`, `backtrack`, `repeated-entry`, `confirmation`, and `recovery`. For an unsuccessful task, use `partial`, `failure`, or `blocked` with an evidence-based explanation.

Omit `--attempt` for the initial exploratory attempt. After resetting to the documented starting state, start a new session with `--attempt <name>` to try an alternate sequence such as keyboard or direct navigation through visible links. All attempts retain their own evidence. Only successful completed attempts establish verified path lengths.

## Run checkpoints in order

A scenario can define a sequence of checkpoints. Use one Playwright session
for the whole sequence. Start the next checkpoint on the page and with the
trip left by the previous checkpoint.

The session reports `nextCheckpoint` with the current goal. Verify the result
on the page and send one command per line.

```json
{
  "type": "checkpoint",
  "id": "create-trip",
  "status": "success",
  "reason": "The trip overview shows the new trip name.",
  "findings": ["The New trip button was easy to find."]
}
```

Record the outcome and any short findings before continuing. The runner saves
the most recent observation as evidence and counts the actions taken since the
previous checkpoint. The last successful checkpoint finishes the attempt.
Use `partial`, `failure`, or `blocked` when a checkpoint cannot succeed.
The runner preserves the completed checkpoints and marks later ones skipped.
Scenarios with a single goal can still use `finish`.

For the Trip Planner write scenarios, start with a saved local sign-in and a
disposable database. Pass its name as `--fixture` and add
`--allow-fixture-writes`. Give each attempt a unique trip name. The lifecycle
scenario deletes the trip created during that attempt.

## Report

```sh
scripts/ux-audit report --platform desktop --out artifacts/ux/current \
  --assessment artifacts/ux/current/desktop-assessment.json \
  --baseline .agents/skills/ux-audit/references/trip-planner/baselines/desktop.json
```

Omit `--baseline` for a first run. Write the assessment using the [evaluation guide](evaluation.md). Both fields are optional for deterministic smoke tests. The command writes `audit.html` and `audit.json`. The HTML embeds cited screenshots and links to the original images and attempt logs. Use the JSON as the baseline input. Keep reviewed synthetic baselines under [Trip Planner references](trip-planner/baselines/README.md). Keep the run directory to retain the original images and logs.

Once both platforms have reports under the same output directory, the report command includes their comparable workflows. Rerun the first platform's report if you want that comparison in both files.
