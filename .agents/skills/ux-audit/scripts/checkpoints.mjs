const outcomeStatuses = ["success", "partial", "failure", "blocked"];

export function startCheckpoints(definitions, actions) {
  const results = [];
  let actionStart = 0;
  const next = () => definitions[results.length];

  function record({ id, status, reason, findings = [] }, evidence) {
    const checkpoint = next();
    if (!checkpoint || checkpoint.id !== id) {
      throw new Error(
        `Record checkpoint "${checkpoint?.id ?? "none"}" before moving on.`,
      );
    }
    validateOutcome({ status, reason });
    if (
      !Array.isArray(findings) ||
      findings.length > 20 ||
      findings.some(
        (finding) =>
          typeof finding !== "string" ||
          !finding.trim() ||
          finding.length > 600,
      )
    ) {
      throw new Error(
        "Provide up to 20 short checkpoint findings as an array of text.",
      );
    }

    const result = {
      id,
      goal: checkpoint.goal,
      status,
      reason: reason.trim(),
      evidence,
      actionCount: actions
        .slice(actionStart)
        .filter(({ dispatched }) => dispatched).length,
      findings: findings.map((finding) => finding.trim()),
    };
    actionStart = actions.length;
    results.push(result);
    return result;
  }

  function finish() {
    const last = results.at(-1);
    const earlierSuccess = results
      .slice(0, -1)
      .some(({ status }) => status === "success");
    const status =
      last.status !== "success" && earlierSuccess ? "partial" : last.status;
    for (const { id, goal } of definitions.slice(results.length)) {
      results.push({
        id,
        goal,
        status: "skipped",
        reason: "An earlier checkpoint stopped the journey.",
        evidence: null,
        actionCount: 0,
        findings: [],
      });
    }
    return {
      status,
      reason:
        last.status === "success" ? last.reason : `${last.goal} ${last.reason}`,
      evidence: last.evidence,
    };
  }

  return { results, next, record, finish };
}

export function validateOutcome({ status, reason }) {
  if (
    !outcomeStatuses.includes(status) ||
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.length > 600
  ) {
    throw new Error(
      "Provide an outcome and a brief explanation grounded in the current UI.",
    );
  }
}
