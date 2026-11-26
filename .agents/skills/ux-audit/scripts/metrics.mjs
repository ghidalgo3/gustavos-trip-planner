const actionTypes = [
  "click",
  "tap",
  "type",
  "press",
  "scroll",
  "drag",
  "swipe",
  "back",
];
const tags = [
  "exploration",
  "incorrect",
  "backtrack",
  "repeated-entry",
  "confirmation",
  "recovery",
];

export function summarize(attempt) {
  const actions = attempt.actions.filter((action) => action.dispatched);
  const states = attempt.states;
  const input = Object.fromEntries(
    actionTypes.map((type) => [
      type,
      actions.filter((action) => action.type === type).length,
    ]),
  );
  const counts = Object.fromEntries(
    tags.map((tag) => [
      tag,
      actions.filter((action) => action.tags.includes(tag)).length,
    ]),
  );
  const transitions = (key) => {
    const values = states
      .map((state) => state[key])
      .filter((value) => value !== undefined);
    return values.slice(1).filter((value, index) => value !== values[index])
      .length;
  };
  const decisions = distinctLabels(states, "decision");
  const memory = distinctLabels(states, "memory");
  return {
    input,
    tags: counts,
    logicalActions: actions.length,
    automationFailures: attempt.actions.length - actions.length,
    charactersTyped: actions.reduce(
      (sum, action) => sum + (action.characters ?? 0),
      0,
    ),
    keyboardCommands: input.press,
    recordedKeydowns: actions.reduce(
      (sum, action) => sum + (action.keydowns ?? 0),
      0,
    ),
    keyboardActionsWithUnknownKeydowns: actions.filter(
      ({ keydowns }) => keydowns === null,
    ).length,
    pageTransitions: transitions("path"),
    maxRouteDepth: Math.max(
      0,
      ...states.map(({ path }) => path.split("/").filter(Boolean).length),
    ),
    modalTransitions: transitions("modal"),
    contextSwitches: transitions("area"),
    labeledStateTransitions: transitions("stateKey"),
    observedDecisionPoints: decisions.length,
    relevantAlternatives: decisions.reduce(
      (sum, state) => sum + (state.alternatives ?? 0),
      0,
    ),
    alternativesRecordedFor: decisions.filter(
      (state) => state.alternatives !== undefined,
    ).length,
    observedMemoryDemands: memory.length,
    decisionEvidence: decisions.map(({ id, decision, alternatives }) => ({
      id,
      decision,
      alternatives,
    })),
    memoryEvidence: memory.map(({ id, memory }) => ({ id, memory })),
  };
}

function distinctLabels(states, key) {
  return [
    ...new Map(
      states.filter((state) => state[key]).map((state) => [state[key], state]),
    ).values(),
  ];
}

export function efficiency(observed, attempts) {
  const shortest = attempts
    .filter((run) => run.outcome.status === "success" && run.outcome.evidence)
    .sort(
      (left, right) =>
        left.metrics.logicalActions - right.metrics.logicalActions,
    )[0];
  const verified = shortest?.metrics.logicalActions ?? null;
  const observedCount = observed.metrics.logicalActions;
  const comparable = verified !== null && observed.outcome.status === "success";
  const excess = comparable ? observedCount - verified : null;
  return {
    shortestVerifiedActions: verified,
    shortestVerifiedAttempt: shortest?.attempt ?? null,
    actionEfficiency:
      comparable && observedCount > 0 ? verified / observedCount : null,
    excessActions: excess,
    actionOverhead: comparable && verified > 0 ? excess / verified : null,
  };
}

export const comparativeMetrics = [
  "logicalActions",
  "pageTransitions",
  "maxRouteDepth",
  "modalTransitions",
  "contextSwitches",
  "labeledStateTransitions",
  "observedDecisionPoints",
  "relevantAlternatives",
  "observedMemoryDemands",
  "shortestVerifiedActions",
  "actionEfficiency",
  "excessActions",
  "actionOverhead",
];
