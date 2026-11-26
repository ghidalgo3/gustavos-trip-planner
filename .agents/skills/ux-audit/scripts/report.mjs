import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fingerprint,
  metricsVersion,
  readJson,
  schemaVersion,
  skillVersion,
  validate,
} from "./config.mjs";
import { evaluateJourney, verifyAssessment } from "./evaluate.mjs";
import { efficiency, summarize } from "./metrics.mjs";
import { compare, compareProfiles } from "./compare.mjs";
import { renderHtml } from "./html.mjs";
import { rulesFingerprint, writeJson } from "./session.mjs";

export async function report(options, registry) {
  const { out, platform } = options;
  if (!Object.hasOwn(registry.profiles, platform))
    throw new Error(`Unknown platform ${platform}.`);
  const trust = options["trust-project-validators"] === true;
  const output = join(out, platform);
  const groups = await readAttempts(output);
  const journeys = [];
  const findings = [];
  const limitations = [];
  const untested = [];
  let metadata;
  for (const runs of groups) {
    const observed = runs.find(({ kind }) => kind === "observed");
    if (!observed)
      throw new Error(
        `Scenario ${runs[0].scenario.id} requires an observed attempt.`,
      );
    for (const run of runs) {
      if (
        run.metadata.platform !== platform ||
        run.metadata.rulesFingerprint !== rulesFingerprint(registry)
      ) {
        throw new Error(
          "Attempt platform or rules differ from the report configuration.",
        );
      }
      metadata ??= run.metadata;
      if (
        fingerprint(metadata) !== fingerprint(run.metadata) ||
        fingerprint([run.scenario, run.persona]) !==
          fingerprint([observed.scenario, observed.persona])
      ) {
        throw new Error(
          `Attempt ${run.attempt} has incompatible capture metadata for ${run.scenario.id}.`,
        );
      }
      run.metrics = summarize(run);
    }
    const evidence = {};
    const annotations = [];
    for (const run of runs) {
      for (const state of run.states) {
        if (
          !/^[A-Za-z0-9_-]+$/.test(state.id) ||
          state.screenshot !== `${state.id}.png`
        ) {
          throw new Error(`Invalid screenshot path for ${run.scenario.id}.`);
        }
        const action = run.actions.find(
          ({ before, point, dispatched }) =>
            before === state.id && point && dispatched,
        );
        evidence[state.id] = {
          screenshot: `${run.scenario.id}/${run.attempt}/${state.screenshot}`,
          path: state.path,
          ...(state.modal ? { modal: state.modal } : {}),
        };
        if (action)
          annotations.push({ evidence: state.id, point: action.point });
      }
    }
    const journey = {
      scenario: observed.scenario,
      persona: observed.persona,
      outcome: observed.outcome,
      metrics: { ...observed.metrics, ...efficiency(observed, runs) },
      attempts: runs.map(
        ({
          attempt,
          kind,
          outcome,
          metrics,
          scenario,
          actions,
          checkpoints,
          blockedRequests,
        }) => ({
          attempt,
          kind,
          outcome,
          metrics,
          actions,
          checkpoints,
          blockedRequests,
          log: `${scenario.id}/${attempt}/attempt.json`,
        }),
      ),
      evidence,
      annotations,
    };
    const evaluated = await evaluateJourney(registry, journey, observed, trust);
    journey.ruleChecks = evaluated.checks;
    journeys.push(journey);
    findings.push(...evaluated.findings);
    if (
      !runs.some(
        ({ kind, outcome }) =>
          kind === "alternative" && outcome.status === "success",
      )
    ) {
      limitations.push(
        `${observed.scenario.id}: no alternate route was verified successfully.`,
      );
    }
    if (runs.some(({ blockedRequests }) => blockedRequests?.length)) {
      limitations.push(
        `${observed.scenario.id}: audit policy blocked requests. See the attempt log.`,
      );
    }
    if (observed.outcome.status === "blocked")
      untested.push(observed.scenario.id);
  }
  if (!metadata)
    throw new Error("No attempts are available for this platform.");
  const assessment = options.assessment
    ? await verifyAssessment(
        await readJson(options.assessment),
        registry,
        journeys,
        platform,
      )
    : {
        findings: [],
        positives: [],
        limitations: ["Codex qualitative assessment was not supplied."],
        untested: [],
      };
  findings.push(...assessment.findings);
  const rules = Object.fromEntries(
    [
      ...new Set(
        journeys.flatMap((journey) =>
          journey.ruleChecks.map(({ ruleId }) => ruleId),
        ),
      ),
    ].map((id) => [id, registry.rules[id]]),
  );
  findings.sort((a, b) => {
    const weight = (finding) =>
      rules[finding.ruleId].weight ??
      registry.weights[rules[finding.ruleId].category];
    return (
      b.severity - a.severity ||
      weight(b) - weight(a) ||
      a.id.localeCompare(b.id)
    );
  });
  for (const journey of journeys) {
    await annotate(
      output,
      journey,
      findings.filter(({ scenarioId }) => scenarioId === journey.scenario.id),
    );
    delete journey.annotations;
  }
  const allLimitations = [
    ...limitations,
    ...assessment.limitations,
    "Decision and memory counts reflect evidence annotations of observable interface demands. Human workload was not measured.",
    "The browser captured a bounded, rendered control inventory. Accessibility coverage applies to the checks and states listed per journey.",
    ...(metadata.environment.device
      ? ["Mobile web uses Playwright device emulation."]
      : []),
    ...(!trust && Object.keys(registry.validators).length
      ? ["Project validator scripts were disabled."]
      : []),
  ];
  const audit = {
    schemaVersion,
    skillVersion,
    metricsVersion,
    generatedAt: new Date().toISOString(),
    metadata: { ...metadata, projectValidatorsEnabled: trust },
    scope: { rules, severity: registry.severity, weights: registry.weights },
    journeys,
    findings,
    positives: assessment.positives,
    limitations: [...new Set(allLimitations)],
    untested: [...new Set([...untested, ...assessment.untested])],
    comparison: null,
    responsiveComparison: null,
  };
  if (options.baseline) {
    const baseline = await readJson(options.baseline);
    if (baseline?.schemaVersion === schemaVersion)
      await validate("audit", baseline, options.baseline);
    audit.comparison = compare(audit, baseline);
  }
  const peerPlatform = platform === "desktop" ? "mobile-web" : "desktop";
  const peer = await readJson(join(out, peerPlatform, "audit.json")).catch(
    (error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (peer?.schemaVersion === schemaVersion)
    await validate("audit", peer, "peer audit");
  if (peer) audit.responsiveComparison = compareProfiles(audit, peer);
  await validate("audit", audit);
  const html = join(output, "audit.html");
  const json = join(output, "audit.json");
  const page = await renderHtml(audit, output);
  await writeJson(json, audit);
  await writeFile(html, page, { mode: 0o600 });
  return { html, json };
}

async function readAttempts(output) {
  const groups = [];
  const dirs = (path) =>
    readdir(path, { withFileTypes: true }).then((entries) =>
      entries
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => name)
        .sort(),
    );
  for (const scenario of await dirs(output)) {
    if (scenario === "annotations") continue;
    const group = [];
    for (const attempt of await dirs(join(output, scenario))) {
      const path = join(output, scenario, attempt, "attempt.json");
      const run = await readJson(path);
      if (
        !run.outcome ||
        run.scenario.id !== scenario ||
        run.attempt !== attempt
      ) {
        throw new Error(`Incomplete or mismatched capture: ${path}.`);
      }
      group.push(run);
    }
    if (group.length) groups.push(group);
  }
  return groups;
}

async function annotate(output, journey, findings) {
  const cited = new Map();
  for (const finding of findings) {
    for (const id of finding.evidence) {
      const item = cited.get(id) ?? [];
      item.push(finding.id);
      cited.set(id, item);
    }
  }
  if (!cited.size) return;
  await mkdir(join(output, "annotations"), { recursive: true, mode: 0o700 });
  for (const [id, findingIds] of cited) {
    const source = journey.evidence[id];
    const image = await readFile(join(output, source.screenshot));
    const width = image.readUInt32BE(16);
    const height = image.readUInt32BE(20);
    const points = journey.annotations.filter(
      ({ evidence }) => evidence === id,
    );
    const marks = points
      .map(
        ({ point }) =>
          `<circle cx="${point.x}" cy="${point.y}" r="18" fill="none" stroke="#ff4100" stroke-width="4"/>`,
      )
      .join("");
    const caption = `${id} · ${findingIds.join(", ")}`.slice(0, 120);
    const destination = `annotations/${journey.scenario.id}-${id}.svg`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 28}" viewBox="0 0 ${width} ${height + 28}"><rect width="${width}" height="28" fill="#181818"/><text x="8" y="19" fill="white" font-family="sans-serif" font-size="13">${caption}</text><g transform="translate(0 28)"><image href="data:image/png;base64,${image.toString("base64")}" width="${width}" height="${height}"/>${marks}</g></svg>`;
    await writeFile(join(output, destination), svg, { mode: 0o600 });
    source.annotation = destination;
  }
}
