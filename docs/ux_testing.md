# UX testing with Codex

Use [`$ux-audit`](../.agents/skills/ux-audit/SKILL.md) to have Codex attempt
a user goal in a running web app. The skill uses Playwright for desktop and
mobile browser emulation. Each run produces a styled HTML report and a JSON record. The report embeds
cited screenshots and links to the original screenshots and interaction logs.

## Start the local app

Run the audit against the Docker development app at `http://localhost:5173`.
From the repository root, start the stack and install Playwright Chromium.

```zsh
scripts/server --detached
(cd src/TripPlanner.Web && corepack pnpm exec playwright install chromium)
```

To use production trip data, create a [local database copy](database.md#copy-production-data-locally)
and start the stack with that database.

```zsh
copy_name="$(scripts/copy_production_db --temporary-firewall)"
scripts/server --detached --database "$copy_name"
```

For signed-in journeys, run `scripts/ux-audit sign-in` once. Sign in to the local
app in the browser window and complete onboarding if prompted. The command
saves the Trip Planner session cookie under `artifacts/ux/auth/localhost.json`.
For an automated local sign-in, start the disposable stack with
`scripts/server --detached --local-users --database "$copy_name"` and run
`scripts/ux-audit sign-in --local-user 1`. Use `2` to test with the second
local account.

Use it with `--storage-state` to give each attempt a fresh browser context with
the same sign-in. Refresh the file when the session expires. Keep the cookie file
private and out of reports.

Run `scripts/ux-audit list` to see the available scenarios and rules. With your
saved session, try this request in Codex.

> Use $ux-audit to run find-destination-dates on desktop and mobile web against
> the local Docker app. Use the saved local audit session. Save the reports
> under artifacts/ux/destination-dates.

The `find-destination-dates` scenario in the
[audit config](../.agents/skills/ux-audit/references/ux_audit_config.yml) works with a dated trip from the selected database. Pick the same trip and
destination when repeating a regression audit. For a fresh development database,
[seed sample trips](local_development.md#seed-sample-trips). For an exploratory
audit, give Codex a task or area to investigate. Keep the scenario file and ID
when you want to repeat the same task.

## Audit trip planning progress

Run `finish-seeded-trip-plan` with a fresh fixture for each profile and attempt.
After signing in, create the fixture for that account in the local development database.

```zsh
scripts/seed_database --planning-audit "Planning audit mobile" local-user-1@example.test
scripts/ux-audit session --platform mobile-web --scenario finish-seeded-trip-plan \
  --storage-state artifacts/ux/auth/localhost.json --fixture planning-audit-v1 \
  --allow-fixture-writes --out artifacts/ux/planning-progress
```

Give the traveler the exact trip name. The seed creates two dated visits,
two scheduled activities, one unscheduled activity, and one missing travel leg.
It creates a new trip and leaves existing trips alone. For a desktop run, use
`--platform desktop` and seed another name.

## How a journey is evaluated

1. Codex delegates browser interactions to a fresh `gpt-6-luna` subagent with
   `low` reasoning effort. It gives the subagent the goal, persona, and starting
   state.
2. The subagent uses Playwright to attempt the goal. It chooses where to click,
   tap, scroll, or type, checks the visible outcome, and tries an alternative
   from the same starting state. Playwright captures screenshots and logs its
   actions.
3. The parent agent reviews the evidence, evaluates usability, and generates the
   report. Findings link to the applicable rule and evidence. Severity reflects
   impact, and confidence reflects the strength of the evidence.

A click, tap, text-entry sequence, keyboard command, scroll, or drag counts as
one interaction. Browser keydown events are recorded separately where available.
Observing the page and waiting for it to load are free. Action efficiency is the
shortest successful path the audit verified divided by the observed action
count. Decision and memory counts describe what the interface asks the traveler
to do. They do not measure human workload.

Sessions default to read-only. The browser integration blocks non-read HTTP
methods, closes WebSockets, and disables service workers. An editing journey
requires a loopback origin, a named disposable fixture, a scenario with writes
enabled, and `--allow-fixture-writes`. Reset that fixture before trying a second
path. To check offline startup and service-worker caching, run the
[offline browser regression](web_app.md#offline-browser-regression).

## Web UI complexity

Apply these starting thresholds to mobile single-task screens and drawers. Check
the same task on desktop for responsive differences. Rate each dimension
independently and use the highest rating to prioritize review. The bands are
Trip Planner review thresholds informed by public design guidance and research.

| Dimension | Low (1) | Moderate (2) | High (3) | Critical (4) |
| --- | --- | --- | --- | --- |
| Navigation choices visible together | 0–5 | 6–8 | 9+ | Users repeatedly choose the wrong destination and cannot recover unaided |
| Form controls exposed in the current step | 0–4 | 5–8 | 9+ | Users cannot determine what they must enter to complete the task |
| Independent vertical scrolling areas | 0–1 | 2 separate, clearly bounded areas | 2 nested on the same axis, or 3+ independent areas | Touch or keyboard users cannot reach required content or an action |
| Distance to the next action | Fully visible and usable without scrolling | Up to one visible viewport height of scrolling in the expected direction | More than one viewport height, or reaching it requires discovering a second scrolling area | The action is unreachable or remains obstructed |

- Count links and tabs that take the user to another view and are visible in one
  viewport. For a modal, count the active surface. Count one input per field or
  choice group across the expanded step, including visible disabled inputs and
  fields below the fold. A search field counts as one input. Save, Cancel, and
  disclosure buttons are actions. Measure the disclosed step after opening it.
- Count independently scrollable regions with actual overflow, including the page
  when it can still scroll while the surface is active. Record when the same
  vertical gesture can move both a child and its parent.
- Measure the shortest scroll needed to fully reveal the next action as soon as it
  becomes relevant. Record the distance in CSS pixels and divide by the visual
  viewport height. For **Add activity**, measure after a valid name enables
  **Save activity**. On a phone, check with the software keyboard open and
  dismissed. Record when a physical-device check is unavailable.
- Use Critical for an observed or reproducible barrier to completing the task.
  Capture the viewport and task state, counts or distances, and screenshots.

Google recommends three to five peer destinations for a compact navigation bar.
GOV.UK starts with one question and groups related questions when appropriate.
Baymard's checkout research supports reducing the fields users must consider.
[Android navigation guidance](https://developer.android.com/develop/ui/compose/components/navigation-bar) · [GOV.UK question pages](https://design-system.service.gov.uk/patterns/question-pages/) · [Baymard checkout research](https://baymard.com/research-articles/checkout-flow-average-form-fields)

Apple recommends avoiding same-axis nested scroll views. W3C prioritizes easy
access to the most important action. Fluent describes persistent drawer actions
and accounts for short viewports and high zoom.
[Apple scroll views](https://developer.apple.com/design/human-interface-guidelines/scroll-views) · [W3C cognitive accessibility guidance](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o2-find/) · [Fluent drawer guidance](https://fluent2.microsoft.design/components/web/react/core/drawer/usage)

## Drive an audit from the terminal

From the repository root, start an interactive session for one profile. Use a new
output directory for each audit version. Pass the revision or build identifier
that corresponds to the app served by the fixture.

```zsh
scripts/ux-audit session --platform desktop --scenario find-destination-dates \
  --storage-state artifacts/ux/auth/localhost.json --fixture local-seeded \
  --app-version "$(git rev-parse --short HEAD)" --out artifacts/ux/destination-dates
```

The default URL is `http://localhost:5173`. Use the selected database name as
`--fixture` for audits against a production copy. Keep that identifier and the
journey inputs consistent across a baseline and rerun.

Send one JSON command per line. Start with `{"type":"observe"}` until the trip
list appears. Use the current snapshot’s numbered control to click the trip.
Observe again when the destination card loads. Finish the attempt with a reason
grounded in the screen, for example `{"type":"finish","status":"success","reason":"The selected destination card shows the stay dates."}`.

Repeat for `mobile-web`, using a tap for the trip card. Omit `--attempt` for the
initial path. Pass `--attempt via-search` or another descriptive name for an
alternative. See the
[session command reference](../.agents/skills/ux-audit/references/operations.md#interactive-session)
for command examples and supported inputs.

## Run a sequence of checkpoints

Each checkpoint starts from the browser and trip state left by the previous
one. The starter scenarios cover these paths.

| Scenario | Checkpoints |
| --- | --- |
| `trip-lifecycle` | Create the trip → rename it → delete it |
| `add-destination-to-new-trip` | Create the trip → add a destination |
| `add-activity-to-new-trip` | Create the trip → add a destination → add an activity there |
| `plan-multi-city-trip-without-flights` | Create the trip → add four dated cities → save train, car, and walking legs → add ten activities → check the map across views → schedule nine activities → move one to a different day and reload |

Start a write audit in a disposable local database. Use a unique trip name
for each attempt and pass the database name as the fixture.

```zsh
scripts/ux-audit session --platform desktop --scenario trip-lifecycle \
  --storage-state artifacts/ux/auth/localhost.json --fixture "$copy_name" \
  --allow-fixture-writes --app-version "$(git rev-parse --short HEAD)" \
  --out artifacts/ux/trip-lifecycle
```

Record each checkpoint’s outcome and findings with the
[`checkpoint` command](../.agents/skills/ux-audit/references/operations.md#run-checkpoints-in-order).
A successful checkpoint unlocks the next one in the same session. A failed or
blocked checkpoint ends the attempt and marks later checkpoints skipped. The
HTML and JSON reports retain the outcomes and evidence for every reached
checkpoint.

## Reports and regression comparisons

Generate one report per profile using the same output directory as the sessions.

```zsh
scripts/ux-audit report --platform desktop --out artifacts/ux/destination-dates
scripts/ux-audit report --platform mobile-web --out artifacts/ux/destination-dates
```

Each command writes `audit.html` and `audit.json` under the profile’s directory.
Open `audit.html` in a browser. Findings link to the embedded screenshot gallery,
and the journey cards link to attempts and their logs. Keep the run directory to
retain the originals and JSON links when sharing the report. The terminal
commands above generate measurements and deterministic findings. Codex can
supply a qualitative assessment with `--assessment` using the
[evaluation guide](../.agents/skills/ux-audit/references/evaluation.md). The second
report includes a desktop and mobile workflow comparison. Regenerate the first
report after both exist to include the comparison in both.

For a regression check, retain a reviewed `audit.json` as a baseline, run the
same journey against the new build in a fresh directory, and pass the previous
report with `--baseline`. Use a separate baseline for each profile.

```zsh
scripts/ux-audit report --platform desktop --out artifacts/ux/destination-dates-current \
  --baseline .agents/skills/ux-audit/references/trip-planner/baselines/desktop.json
```

Comparisons check the scenario, persona, browser profile and version, fixture,
and effective rule configuration. Compatible runs show changes in completion,
actions, navigation, checks, and findings. Reports flag incompatible inputs and
withhold their deltas. Store reviewed synthetic baselines in
[the skill’s baselines directory](../.agents/skills/ux-audit/references/trip-planner/baselines/README.md). Keep raw runs in the ignored
`artifacts/ux/` directory. Treat reports from a production copy as private
because the HTML embeds screenshots and logs may include real trip details.

## Extend the audit

Edit [`ux_audit_config.yml`](../.agents/skills/ux-audit/references/ux_audit_config.yml)
to add personas and scenarios or adjust the audit settings.

- **Personas and scenarios** use the `personas` and `scenarios` sections. Each
  scenario references a persona by ID. Set its action budget on the scenario.
- **Project rules** live in
  [`design-guidelines/`](../.agents/skills/ux-audit/references/trip-planner/design-guidelines/).
  Rules can apply to platforms or components and declare thresholds or exceptions.
- **Audit settings** in the same config set the browser profiles, adjust rule
  weights and severity, or disable a rule.

See the [contribution guide](../.agents/skills/ux-audit/references/contributions.md)
for the schemas and optional deterministic validators. To verify changes to the
audit tooling, install the web dependencies and Chromium as above, then run its
tests from the repository root.

```zsh
UX_AUDIT_DEPS="$PWD/src/TripPlanner.Web" node --test .agents/skills/ux-audit/tests/*.test.mjs
```
