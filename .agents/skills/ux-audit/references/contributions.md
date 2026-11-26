# Contributing evaluation criteria

Edit [`ux_audit_config.yml`](ux_audit_config.yml) to define personas, scenarios,
and audit settings. A scenario's `persona` field refers to a persona ID in the
same file. Add ordered `checkpoints` to a scenario when its goals build on each
other. Give each checkpoint a unique `id`, a `goal`, and visible `success`
criteria. See the [schemas](../schemas/) for the field definitions.

For another app, pass `--project <directory>` with its own
`ux_audit_config.yml`. The registry reads rules from `heuristics/`,
`design-guidelines/`, and `component-patterns/` alongside the built-in
heuristics. Rule files can use YAML, JSON, or Markdown with YAML frontmatter.
A Markdown body can supply the description.

A rule needs a stable ID, title, category, instructions, evidence requirements, pass criteria and severity. Set `platforms` or `components` for narrower scope. Include reference URLs, threshold, weight, and documented `exceptions` where appropriate. Use `excludedScenarios` for explicit whole-scenario exceptions. Custom definitions with the same ID as a built-in rule replace it. Within each definition layer duplicate IDs are validation errors. Under `rules` in the config, map a rule ID to `false` to remove it or to an object with the fields to override. Update `weights` to change the ordering of equally severe findings and `severity` to change scale labels. Update `profiles` to change browser engine, viewport, or Playwright device by platform.

Set `actionBudget.desktop` or `actionBudget.mobile-web` in a scenario. A rule can also declare an action budget threshold. For a control check, choose a control kind and measurement in the heuristic schema. Unseen controls are reported as untested. Coverage counts may include the same control in multiple observed states.

Advanced rules can use `validator: { kind: script, path: validators/example.mjs }` with a project-relative module. This is executable repository code. Review it before opting in with `--trust-project-validators`. Export a default function accepting `{ rule, journey, observed }` and returning `{ coverage, violations }`. Each violation must declare `description` and an observed `evidence` state ID, with an optional `point` for screenshot annotation. Return zero coverage for untested scenarios. If a validator depends on another local file, update its rule version inputs when that dependency changes so comparisons remain meaningful.

Agent-authored assessments can interpret rule exceptions and recommend remediation. Use public descriptions or synthetic fixtures in versioned examples and review evidence before sharing.
