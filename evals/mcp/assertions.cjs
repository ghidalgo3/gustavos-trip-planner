module.exports = (output, context) => {
  const data = JSON.parse(output);
  const failures = [];
  const calls = data.calls;
  const read = calls.findIndex(
    (call) => call.name === "get_planning_context" && !call.isError,
  );
  if (read < 0) failures.push("Did not retrieve planning context.");
  const firstWrite = calls.findIndex((call) =>
    /^(create|replace|update|delete)_/.test(call.name),
  );
  if (firstWrite >= 0 && (read < 0 || firstWrite < read))
    failures.push("Wrote before reading planning context.");
  const kinds = new Set([
    "Food",
    "Shopping",
    "Culture",
    "Music",
    "Art",
    "Nature",
    "Relax",
    "Event",
    "Holiday",
  ]);
  for (const activity of data.after.activities) {
    const p = activity.properties;
    if (
      !p.kinds?.length ||
      p.kinds.some((kind) => !kinds.has(kind)) ||
      new Set(p.kinds).size !== p.kinds.length
    )
      failures.push("Invalid activity classification.");
    if (!["Unknown", "Required", "NotRequired"].includes(p.ticketRequirement))
      failures.push("Invalid ticket requirement.");
  }
  if (JSON.stringify(data.before.visits) !== JSON.stringify(data.after.visits))
    failures.push("Changed saved destination dates.");
  for (const original of data.before.activities) {
    const preserved = data.after.activities.find((a) => a.id === original.id);
    if (!preserved || JSON.stringify(preserved) !== JSON.stringify(original))
      failures.push("Changed an existing activity without a request.");
  }
  const created = data.after.activities.filter(
    (a) => !data.before.activities.some((b) => b.id === a.id),
  );
  if (context.vars.scenario === "save_activity") {
    if (created.length !== 1)
      failures.push("Expected exactly one new activity.");
    const p = created[0]?.properties;
    if (!p?.kinds.includes("Art") || !p?.kinds.includes("Culture"))
      failures.push("Did not save both requested kinds.");
    if (
      p?.ticketRequirement !== "Unknown" ||
      p?.cost != null ||
      p?.address != null
    )
      failures.push("Invented unverified details.");
  }
  if (context.vars.scenario === "missing_dates" && firstWrite >= 0)
    failures.push("Wrote a plan before clarifying missing dates.");
  if (context.vars.scenario === "event_unknown") {
    for (const a of created) {
      if (
        a.properties.cost != null ||
        a.properties.ticketRequirement !== "Unknown"
      )
        failures.push("Asserted unverified current event details.");
    }
  }
  return {
    pass: failures.length === 0,
    score: failures.length ? 0 : 1,
    reason:
      failures.join(" ") ||
      "Context, classification and preservation checks passed.",
  };
};
