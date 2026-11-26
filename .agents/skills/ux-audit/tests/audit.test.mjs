import { strict as assert } from "node:assert";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadRegistry, scopeRules } from "../scripts/config.mjs";
import { evaluateJourney, verifyAssessment } from "../scripts/evaluate.mjs";
import { efficiency, summarize } from "../scripts/metrics.mjs";
import { compare, compareProfiles } from "../scripts/compare.mjs";
import { startSession } from "../scripts/session.mjs";

test("logs observations separately from deliberate actions and handles unverified ratios", () => {
  const metrics = summarize({
    actions: [
      { type: "drag", dispatched: true, tags: [] },
      { type: "type", dispatched: true, characters: 5, keydowns: 4, tags: [] },
      { type: "press", dispatched: true, keydowns: 2, tags: [] },
      { type: "click", dispatched: false, tags: [] },
    ],
    states: [
      {
        id: "a",
        path: "/",
        modal: null,
        decision: "Choose a trip",
        alternatives: 2,
      },
      { id: "b", path: "/trips/1", modal: "Confirm", memory: "Recall date" },
      { id: "c", path: "/trips/1", modal: null, memory: "Recall date" },
    ],
  });
  assert.equal(metrics.logicalActions, 3);
  assert.equal(metrics.automationFailures, 1);
  assert.equal(metrics.input.drag, 1);
  assert.equal(metrics.recordedKeydowns, 6);
  assert.equal(metrics.charactersTyped, 5);
  assert.equal(metrics.modalTransitions, 2);
  assert.equal(metrics.pageTransitions, 1);
  assert.equal(metrics.observedMemoryDemands, 1);
  assert.equal(metrics.relevantAlternatives, 2);

  const attempt = (logicalActions, status, name) => ({
    attempt: name,
    outcome: { status, evidence: "state" },
    metrics: { logicalActions },
  });
  const observed = attempt(3, "success", "observed");
  const successful = attempt(2, "success", "alternate");
  const failed = attempt(1, "failure", "failed");
  assert.deepEqual(efficiency(observed, [observed, failed, successful]), {
    shortestVerifiedActions: 2,
    shortestVerifiedAttempt: "alternate",
    actionEfficiency: 2 / 3,
    excessActions: 1,
    actionOverhead: 0.5,
  });
  assert.equal(efficiency(failed, [failed]).actionEfficiency, null);
  const zero = attempt(0, "success", "zero");
  assert.equal(efficiency(zero, [zero]).actionOverhead, null);
});

test("discovers scoped Markdown and applies overrides and explicitly enabled validators", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "ux-rules-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const directory = join(project, "design-guidelines", "custom");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(project, "ux_audit_config.yml"),
    `personas:
  - id: first-time-reader
    version: "1"
    name: First-time reader
    familiarity: First visit
    description: Wants to find a saved trip.
scenarios:
  - id: find-trip
    version: "1"
    goal: Find a saved trip.
    persona: first-time-reader
    setup: Open the dashboard.
    startPath: /
    success: The trip details are visible.
rules:
  COG-001: false
  CUSTOM: { severity: 4 }
`,
  );
  await writeFile(
    join(project, "validator.mjs"),
    `export default ({ observed }) => ({
    coverage: 1, violations: [{ description: "Missing trip details", evidence: observed.states[0].id }],
  });`,
  );
  await writeFile(
    join(directory, "rule.md"),
    `---
id: CUSTOM
title: Custom
category: design
instructions: Inspect.
evidence: [Screenshot]
pass: Add trip details.
severity: 1
platforms: [mobile-web]
components: [trip-list]
validator: { kind: script, path: validator.mjs }
---
This description comes from the Markdown body.
`,
  );
  const registry = await loadRegistry(project);
  assert.equal(registry.scenarios["find-trip"].persona, "first-time-reader");
  assert.equal(
    registry.personas["first-time-reader"].name,
    "First-time reader",
  );
  assert.equal(registry.rules["COG-001"], undefined);
  assert.equal(registry.rules.CUSTOM.severity, 4);
  assert.match(registry.rules.CUSTOM.description, /Markdown body/);
  assert(
    !scopeRules(registry, "desktop", ["trip-list"]).some(
      ({ id }) => id === "CUSTOM",
    ),
  );
  const observed = {
    scenario: { id: "test", components: ["trip-list"] },
    metadata: { platform: "mobile-web" },
    states: [{ id: "observed-s1", controls: [] }],
    outcome: { status: "success" },
  };
  const journey = {
    annotations: [],
    scenario: observed.scenario,
    evidence: { "observed-s1": {} },
  };
  const disabled = await evaluateJourney(registry, journey, observed, false);
  assert.equal(
    disabled.checks.find(({ ruleId }) => ruleId === "CUSTOM").status,
    "disabled",
  );
  const enabled = await evaluateJourney(registry, journey, observed, true);
  assert.equal(enabled.findings[0].severity, 4);
  assert.equal(enabled.findings[0].evidence[0], "observed-s1");
  await assert.rejects(
    verifyAssessment(
      {
        findings: [
          { ...enabled.findings[0], id: "manual", evidence: ["missing"] },
        ],
        positives: [],
        limitations: [],
        untested: [],
      },
      registry,
      [journey],
      "mobile-web",
    ),
    /Missing evidence/,
  );
});

test("compares versioned journeys and withholds incompatible deltas", () => {
  const baseline = {
    schemaVersion: 1,
    skillVersion: "1",
    metricsVersion: 1,
    metadata: {
      platform: "desktop",
      rulesFingerprint: "fixed",
      environment: { viewport: "desktop" },
    },
    journeys: [
      {
        scenario: { id: "test", version: "1" },
        persona: { id: "first-time" },
        metrics: { logicalActions: 1, tags: { backtrack: 0 } },
        outcome: { status: "success" },
        ruleChecks: [],
      },
    ],
    findings: [{ id: "existing", scenarioId: "test" }],
  };
  const changed = structuredClone(baseline);
  changed.journeys[0].metrics.logicalActions = 2;
  changed.journeys[0].metrics.tags.backtrack = 1;
  changed.findings.push({ id: "new", scenarioId: "test" });
  const result = compare(changed, baseline);
  assert.equal(result.journeys[0].deltas.logicalActions, 1);
  assert.equal(result.journeys[0].deltas.backtrack, 1);
  assert.deepEqual(result.journeys[0].findings, {
    introduced: ["new"],
    recurring: ["existing"],
    absent: [],
  });
  const mobile = structuredClone(changed);
  mobile.metadata.platform = "mobile-web";
  assert.equal(
    compareProfiles(baseline, mobile).journeys[0].mobile.metrics.logicalActions,
    2,
  );
  assert.deepEqual(compare(baseline, mobile).reasons, ["platform"]);
  changed.journeys[0].scenario.version = "2";
  assert.equal(compare(changed, baseline).journeys[0].comparable, false);
  changed.metadata.rulesFingerprint = "different";
  assert.deepEqual(compare(changed, baseline).reasons, ["rulesFingerprint"]);
});

test("an unavailable browser profile leaves no incomplete attempt", async (t) => {
  const out = await mkdtemp(join(tmpdir(), "ux-unavailable-"));
  t.after(() => rm(out, { recursive: true, force: true }));
  const registry = await loadRegistry();
  registry.profiles.desktop.device = "Unavailable profile for testing";
  await assert.rejects(
    startSession(
      {
        url: "http://127.0.0.1:4174",
        scenario: "find-destination-dates",
        platform: "desktop",
        out,
        "app-version": "test",
      },
      registry,
      () => {},
    ),
    /Unknown Playwright device/,
  );
  await assert.rejects(
    access(join(out, "desktop", "find-destination-dates", "observed")),
    { code: "ENOENT" },
  );
});
