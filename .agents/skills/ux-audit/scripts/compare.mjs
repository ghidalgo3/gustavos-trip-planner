import { fingerprint } from "./config.mjs";
import { comparativeMetrics } from "./metrics.mjs";

export function compare(current, baseline) {
  const reasons = [];
  for (const key of ["schemaVersion", "metricsVersion", "skillVersion"]) {
    if (current[key] !== baseline?.[key]) reasons.push(key);
  }
  for (const key of [
    "platform",
    "profileFingerprint",
    "rulesFingerprint",
    "fixture",
    "projectValidatorsEnabled",
    "writable",
  ]) {
    if (current.metadata[key] !== baseline?.metadata?.[key]) reasons.push(key);
  }
  if (
    fingerprint(current.metadata.environment) !==
    fingerprint(baseline?.metadata?.environment ?? null)
  ) {
    reasons.push("browser environment");
  }
  if (reasons.length) return { compatible: false, reasons, journeys: [] };
  if (!Array.isArray(baseline.journeys) || !Array.isArray(baseline.findings)) {
    throw new Error(
      "Baseline must be an audit JSON report with journeys and findings.",
    );
  }
  const before = new Map(
    baseline.journeys.map((journey) => [journey.scenario.id, journey]),
  );
  const journeys = current.journeys.map((journey) => {
    const id = journey.scenario.id;
    const older = before.get(id);
    before.delete(id);
    if (!older)
      return { id, comparable: false, reason: "No matching baseline journey" };
    if (
      fingerprint([journey.scenario, journey.persona]) !==
      fingerprint([older.scenario, older.persona])
    ) {
      return { id, comparable: false, reason: "Scenario or persona changed" };
    }
    if ([older, journey].some(({ outcome }) => outcome.status === "blocked")) {
      return {
        id,
        comparable: false,
        reason: "A run was blocked before the journey could be evaluated",
      };
    }
    const deltas = {};
    for (const key of comparativeMetrics) {
      const previous = older.metrics[key];
      const value = journey.metrics[key];
      if (Number.isFinite(previous) && Number.isFinite(value))
        deltas[key] = value - previous;
    }
    for (const key of Object.keys(journey.metrics.tags)) {
      const previous = older.metrics.tags[key];
      if (Number.isFinite(previous))
        deltas[key] = journey.metrics.tags[key] - previous;
    }
    const beforeIds = new Set(
      baseline.findings
        .filter(({ scenarioId }) => scenarioId === id)
        .map((finding) => finding.id),
    );
    const afterIds = new Set(
      current.findings
        .filter(({ scenarioId }) => scenarioId === id)
        .map((finding) => finding.id),
    );
    const checkStatus = (run) =>
      new Map(run.ruleChecks.map(({ ruleId, status }) => [ruleId, status]));
    const beforeChecks = checkStatus(older);
    const afterChecks = checkStatus(journey);
    const checkChanges = [
      ...new Set([...beforeChecks.keys(), ...afterChecks.keys()]),
    ].flatMap((key) =>
      beforeChecks.get(key) === afterChecks.get(key)
        ? []
        : [
            {
              id: key,
              from: beforeChecks.get(key) ?? null,
              to: afterChecks.get(key) ?? null,
            },
          ],
    );
    return {
      id,
      comparable: true,
      completion: { from: older.outcome.status, to: journey.outcome.status },
      deltas,
      checkChanges,
      findings: {
        introduced: [...afterIds].filter((key) => !beforeIds.has(key)),
        recurring: [...afterIds].filter((key) => beforeIds.has(key)),
        absent: [...beforeIds].filter((key) => !afterIds.has(key)),
      },
    };
  });
  const matched = journeys.filter(({ comparable }) => comparable);
  const rate = (edge) =>
    matched.length
      ? matched.filter(({ completion }) => completion[edge] === "success")
          .length / matched.length
      : null;
  return {
    compatible: true,
    baselineAppVersion: baseline.metadata.appVersion,
    completionRate: {
      baseline: rate("from"),
      current: rate("to"),
      delta: matched.length ? rate("to") - rate("from") : null,
    },
    journeys,
    baselineOnly: [...before.keys()],
  };
}

export function compareProfiles(audit, peer) {
  const desktop = audit.metadata.platform === "desktop" ? audit : peer;
  const mobile = desktop === audit ? peer : audit;
  const sharedKeys = [
    "origin",
    "appVersion",
    "fixture",
    "rulesFingerprint",
    "projectValidatorsEnabled",
    "writable",
  ];
  const reasons = sharedKeys.filter(
    (key) => desktop.metadata[key] !== mobile.metadata[key],
  );
  for (const key of ["schemaVersion", "skillVersion", "metricsVersion"]) {
    if (desktop[key] !== mobile[key]) reasons.push(key);
  }
  if (
    desktop.metadata.platform !== "desktop" ||
    mobile.metadata.platform !== "mobile-web"
  )
    reasons.push("platform");
  if (reasons.length) return { compatible: false, reasons, journeys: [] };
  const desktopRuns = new Map(
    desktop.journeys.map((journey) => [journey.scenario.id, journey]),
  );
  const mobileRuns = new Map(
    mobile.journeys.map((journey) => [journey.scenario.id, journey]),
  );
  const journeys = [
    ...new Set([...desktopRuns.keys(), ...mobileRuns.keys()]),
  ].map((id) => {
    const left = desktopRuns.get(id);
    const right = mobileRuns.get(id);
    if (!left || !right)
      return { id, comparable: false, reason: "Journey ran on one profile" };
    if (
      fingerprint([left.scenario, left.persona]) !==
      fingerprint([right.scenario, right.persona])
    ) {
      return { id, comparable: false, reason: "Scenario or persona changed" };
    }
    if ([left, right].some(({ outcome }) => outcome.status === "blocked")) {
      return { id, comparable: false, reason: "One profile was blocked" };
    }
    const profileMetrics = (journey) =>
      Object.fromEntries(
        comparativeMetrics.map((key) => [key, journey.metrics[key]]),
      );
    return {
      id,
      comparable: true,
      desktop: { outcome: left.outcome.status, metrics: profileMetrics(left) },
      mobile: { outcome: right.outcome.status, metrics: profileMetrics(right) },
    };
  });
  return { compatible: true, journeys };
}
