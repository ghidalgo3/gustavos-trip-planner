import { pathToFileURL } from "node:url";
import { fingerprint, scopeRules, validate } from "./config.mjs";

export async function evaluateJourney(registry, journey, observed, trust) {
  const { scenario, metadata, states } = observed;
  const checks = [];
  const findings = [];
  for (const rule of scopeRules(
    registry,
    metadata.platform,
    scenario.components ?? [],
  )) {
    let result;
    if (rule.excludedScenarios?.includes(scenario.id)) {
      result = { status: "exception", coverage: 0, violations: [] };
    } else if (!rule.validator) {
      result = { status: "qualitative", coverage: 0, violations: [] };
    } else {
      result = await deterministic(registry, rule, journey, observed, trust);
    }
    const { status, coverage, violations } = result;
    for (const violation of violations) {
      if (!states.some(({ id }) => id === violation.evidence)) {
        throw new Error(
          `Validator ${rule.id} returned missing evidence ${violation.evidence}.`,
        );
      }
    }
    checks.push({
      ruleId: rule.id,
      status,
      coverage,
      evidence: [...new Set(violations.map(({ evidence }) => evidence))],
    });
    if (!violations.length) continue;
    findings.push({
      id: `auto-${fingerprint([rule.id, scenario.id]).slice(0, 16)}`,
      ruleId: rule.id,
      scenarioId: scenario.id,
      title: rule.title,
      description: [
        ...new Set(violations.map(({ description }) => description)),
      ]
        .slice(0, 6)
        .join(" "),
      severity: rule.severity,
      confidence: "high",
      basis: "observed",
      reproduction: [
        "Start at the documented journey entry and follow the observed interaction log to the cited state.",
      ],
      evidence: [...new Set(violations.map(({ evidence }) => evidence))],
      remediation: rule.pass,
      expectedImprovement: `The interface satisfies ${rule.title.toLowerCase()} on the affected journey.`,
    });
    journey.annotations.push(
      ...violations
        .filter(({ point }) => point)
        .map(({ evidence, point }) => ({ evidence, point })),
    );
  }
  return { checks, findings };
}

async function deterministic(registry, rule, journey, observed, trust) {
  const { validator } = rule;
  let coverage = 0;
  const violations = [];
  if (validator.kind === "script") {
    if (!trust) return { status: "disabled", coverage, violations };
    const { path } = registry.validators[rule.id];
    const module = await import(pathToFileURL(path));
    if (typeof module.default !== "function")
      throw new Error(`${path} must export a default validation function.`);
    const result = await module.default({ rule, journey, observed });
    if (
      !Number.isInteger(result?.coverage) ||
      result.coverage < 0 ||
      !Array.isArray(result.violations) ||
      result.violations.some(
        (item) =>
          !item ||
          typeof item.evidence !== "string" ||
          !item.description?.trim() ||
          (item.point &&
            (![item.point.x, item.point.y].every(Number.isFinite) ||
              item.point.x < 0 ||
              item.point.y < 0)),
      )
    ) {
      throw new Error(`Invalid validator output for ${rule.id}.`);
    }
    if (result.violations.length && !result.coverage)
      throw new Error(`Missing validator coverage for ${rule.id}.`);
    return {
      ...result,
      status: result.violations.length
        ? "fail"
        : result.coverage
          ? "pass"
          : "untested",
    };
  }
  if (validator.kind === "action-budget") {
    const limit =
      observed.scenario.actionBudget?.[observed.metadata.platform] ??
      rule.threshold;
    if (limit !== undefined && observed.outcome.status === "success") {
      coverage = 1;
      const actual = journey.metrics.logicalActions;
      if (actual > limit) {
        violations.push({
          evidence: observed.outcome.evidence,
          description: `The observed journey took ${actual} actions against a budget of ${limit}.`,
        });
      }
    }
  } else {
    for (const state of observed.states) {
      for (const control of state.controls) {
        if (!control.componentKinds.includes(validator.control)) continue;
        coverage++;
        const failure = measure(control, validator.check, rule.threshold);
        if (failure)
          violations.push({
            evidence: state.id,
            point: control.point,
            description: failure,
          });
      }
    }
  }
  return {
    status: violations.length ? "fail" : coverage ? "pass" : "untested",
    coverage,
    violations,
  };
}

function measure(control, check, threshold) {
  const label = control.label
    ? `“${control.label}”`
    : `An unnamed ${control.role}`;
  switch (check) {
    case "accessible-name":
      return (
        !control.accessibleName && `${label} has no detectable accessible name.`
      );
    case "width-at-least-height":
      return (
        control.width < control.height &&
        `${label} measures ${control.width}×${control.height} CSS pixels.`
      );
    case "min-width":
      return (
        control.width < threshold &&
        `${label} is ${control.width} CSS pixels wide, below the ${threshold}-pixel minimum.`
      );
    case "min-height":
      return (
        control.height < threshold &&
        `${label} is ${control.height} CSS pixels tall, below the ${threshold}-pixel minimum.`
      );
    case "min-font":
      return (
        control.fontSize < threshold &&
        `${label} uses ${control.fontSize} CSS pixels, below the ${threshold}-pixel minimum.`
      );
  }
}

export async function verifyAssessment(
  assessment,
  registry,
  journeys,
  platform,
) {
  await validate("assessment", assessment);
  const byId = new Map(
    journeys.map((journey) => [journey.scenario.id, journey]),
  );
  const ids = new Set();
  for (const finding of assessment.findings) {
    await validate("finding", finding, finding?.id);
    const journey = byId.get(finding.scenarioId);
    if (!journey || ids.has(finding.id) || finding.id.startsWith("auto-")) {
      throw new Error(
        `${finding.id} must have a unique ID and cite an executed scenario.`,
      );
    }
    ids.add(finding.id);
    const rule = scopeRules(
      registry,
      platform,
      journey.scenario.components ?? [],
    ).find(({ id }) => id === finding.ruleId);
    if (!rule || rule.excludedScenarios?.includes(finding.scenarioId)) {
      throw new Error(
        `${finding.id} references a rule missing from this journey's scope.`,
      );
    }
    if (
      finding.basis !== "hypothesis" &&
      (!finding.evidence.length || !finding.reproduction.length)
    ) {
      throw new Error(`${finding.id} needs evidence and reproducible steps.`);
    }
    if (finding.basis === "hypothesis" && finding.confidence !== "low") {
      throw new Error(
        `${finding.id} is an unverified hypothesis and must have low confidence.`,
      );
    }
    evidenceExists(finding.evidence, journey);
  }
  for (const positive of assessment.positives) {
    const journey = byId.get(positive.scenarioId);
    if (!journey)
      throw new Error(
        `Positive result references an unknown scenario ${positive.scenarioId}.`,
      );
    evidenceExists(positive.evidence, journey);
  }
  return assessment;
}

function evidenceExists(ids, journey) {
  for (const id of ids) {
    if (!Object.hasOwn(journey.evidence, id))
      throw new Error(`Missing evidence ${id} for ${journey.scenario.id}.`);
  }
}
