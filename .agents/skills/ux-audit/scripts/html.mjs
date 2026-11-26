import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { skill } from "./config.mjs";

const entities = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const text = (value) =>
  String(value).replace(/[&<>"']/g, (char) => entities[char]);
const format = (value) =>
  typeof value === "number" ? String(Number(value.toFixed(3))) : "—";
const percent = (value) =>
  typeof value === "number" ? `${format(value * 100)}%` : "—";
const label = (key) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replaceAll("-", " ")
    .toLowerCase();
const relative = (path) => path.split("/").map(encodeURIComponent).join("/");
const escapeId = (value) => encodeURIComponent(value);
const evidenceId = (journey, id) =>
  `evidence-${escapeId(journey.scenario.id)}:${escapeId(id)}`;

function cards(values) {
  return `<dl class="metrics">${values
    .map(
      ([name, value]) =>
        `<div><dt>${text(name)}</dt><dd>${text(value)}</dd></div>`,
    )
    .join("")}</dl>`;
}

function facts(rows) {
  return `<dl class="facts">${rows
    .map(
      ([name, value]) => `<div><dt>${text(name)}</dt><dd>${value}</dd></div>`,
    )
    .join("")}</dl>`;
}

function list(values) {
  return values.length
    ? `<ul>${values.map((value) => `<li>${value}</li>`).join("")}</ul>`
    : "";
}

function badge(status) {
  return `<span class="badge status-${text(status)}">${text(status)}</span>`;
}

function evidenceLinks(journey, ids) {
  if (!ids.length) return "";
  return `<div class="evidence-links">${ids
    .map(
      (id) =>
        `<a href="#${text(evidenceId(journey, id))}">Screenshot <span>${text(id)}</span></a>`,
    )
    .join("")}</div>`;
}

const section = (id, title, content) =>
  `<section class="report-section" id="${id}"><h2>${title}</h2>${content}</section>`;

export async function renderHtml(audit, directory) {
  const css = await readFile(join(skill, "assets", "report.css"), "utf8");
  const { metadata, journeys, findings } = audit;
  const byId = new Map(
    journeys.map((journey) => [journey.scenario.id, journey]),
  );
  const successful = journeys.filter(
    ({ outcome }) => outcome.status === "success",
  ).length;
  const major = findings.filter(({ severity }) => severity >= 3).length;
  const platform =
    metadata.platform === "mobile-web" ? "Mobile web" : "Desktop";
  const { browser, browserVersion, viewport, device } = metadata.environment;
  const screenshots = await screenshotGallery(audit, directory);
  const sections = [
    ["journeys", "Journeys", journeys.map(renderJourney).join("")],
    [
      "findings",
      "Findings",
      findings.length
        ? `<div class="finding-grid">${findings
            .map((finding) =>
              renderFinding(finding, audit.scope, byId.get(finding.scenarioId)),
            )
            .join("")}</div>`
        : '<p class="callout">The captured journeys produced no findings.</p>',
    ],
    ...(audit.positives.length
      ? [
          [
            "positive",
            "Positive findings",
            `<div class="callout">${list(
              audit.positives.map(
                ({ scenarioId, description, evidence }) =>
                  `${text(description)}${evidenceLinks(byId.get(scenarioId), evidence)}`,
              ),
            )}</div>`,
          ],
        ]
      : []),
    ...(screenshots ? [["evidence", "Screenshot evidence", screenshots]] : []),
    ["regression", "Baseline comparison", renderRegression(audit.comparison)],
    ...(audit.responsiveComparison
      ? [
          [
            "profiles",
            "Desktop and mobile",
            renderProfiles(audit.responsiveComparison),
          ],
        ]
      : []),
    [
      "limitations",
      "Limitations",
      `<div class="callout">${list([
        ...audit.limitations.map(text),
        ...audit.untested.map(
          (item) => `<strong>Untested</strong> ${text(item)}`,
        ),
      ])}</div>`,
    ],
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>UX audit · ${text(platform)}</title>
<style>${css}</style>
</head>
<body>
<a class="skip" href="#journeys">Skip to journeys</a>
<header class="hero">
  <div class="shell">
    <div class="hero-heading">
      <div>
        <p class="platform">${text(platform)}</p>
        <h1>UX audit</h1>
        <p class="subtitle">${text(browser)} ${text(browserVersion)} · ${text(viewport.width)} × ${text(viewport.height)} CSS pixels${device ? ` · ${text(device)} emulation` : ""}</p>
      </div>
      <a class="button" href="audit.json">Open report JSON</a>
    </div>
    ${cards([
      ["Journeys completed", `${successful} / ${journeys.length}`],
      ["Findings", findings.length],
      ["Major or critical", major],
    ])}
    <details class="scope">
      <summary>Audit scope</summary>
      ${facts([
        ["Target", text(metadata.origin)],
        ["Fixture", text(metadata.fixture)],
        ["Build", text(metadata.appVersion)],
        [
          "Run date",
          `<time datetime="${text(audit.generatedAt)}">${text(audit.generatedAt)}</time>`,
        ],
      ])}
    </details>
  </div>
</header>
<div class="shell layout">
  <nav aria-label="Report sections"><ul>${sections.map(([id, name]) => `<li><a href="#${id}">${name}</a></li>`).join("")}</ul></nav>
  <main>${sections.map(([id, name, content]) => section(id, name, content)).join("\n")}</main>
</div>
</body>
</html>
`;
}

function renderJourney(journey) {
  const { scenario, persona, outcome, metrics } = journey;
  const details = [
    ["Persona", `${text(persona.name)} · ${text(persona.familiarity)}`],
    ["Start", text(scenario.setup)],
    [
      "Navigation",
      text(
        `${metrics.maxRouteDepth} route depth · ${metrics.modalTransitions} modal transitions · ${metrics.contextSwitches} context switches · ${metrics.labeledStateTransitions} labeled state transitions`,
      ),
    ],
    [
      "Path cost",
      text(
        `${format(metrics.excessActions)} excess actions · ${percent(metrics.actionOverhead)} overhead`,
      ),
    ],
    [
      "Decisions",
      text(
        `${metrics.observedDecisionPoints} observed · ${metrics.relevantAlternatives} alternatives across ${metrics.alternativesRecordedFor} decisions`,
      ),
    ],
    ["Memory demands", text(metrics.observedMemoryDemands)],
    [
      "Inputs",
      text(
        `${Object.entries(metrics.input)
          .map(([key, value]) => `${label(key)} ${value}`)
          .join(
            ", ",
          )} · ${metrics.charactersTyped} characters · ${metrics.recordedKeydowns} keydowns`,
      ),
    ],
    [
      "Interaction tags",
      text(
        Object.entries(metrics.tags)
          .map(([key, value]) => `${label(key)} ${value}`)
          .join(", "),
      ),
    ],
  ];
  const observations = [...metrics.decisionEvidence, ...metrics.memoryEvidence];
  const checks = journey.ruleChecks.filter(
    ({ status }) => status !== "qualitative",
  );
  return `<article class="panel journey" id="journey-${text(escapeId(scenario.id))}">
    <div class="title-row"><h3>${text(scenario.goal)}</h3>${badge(outcome.status)}</div>
    <p>${text(outcome.reason)}</p>
    ${cards([
      ["Actions", metrics.logicalActions],
      ["Shortest verified", format(metrics.shortestVerifiedActions)],
      ["Efficiency", percent(metrics.actionEfficiency)],
      ["Page transitions", metrics.pageTransitions],
    ])}
    <div class="table-wrap"><table>
      <thead><tr><th scope="col">Attempt</th><th scope="col">Outcome</th><th scope="col">Actions</th><th scope="col">Trace</th></tr></thead>
      <tbody>${journey.attempts
        .map(
          ({ attempt, outcome, metrics, log }) => `
        <tr><th scope="row">${text(attempt)}</th><td>${badge(outcome.status)}</td><td>${text(metrics.logicalActions)}</td>
        <td><a href="${text(relative(log))}">Log</a>${outcome.evidence ? evidenceLinks(journey, [outcome.evidence]) : ""}</td></tr>`,
        )
        .join("")}</tbody>
    </table></div>
    ${journey.attempts.map((attempt) => renderCheckpoints(journey, attempt)).join("")}
    <details><summary>Interaction details and checks</summary>
      ${facts(details)}
      ${list(observations.map((item) => `${text(item.decision ?? item.memory)}${evidenceLinks(journey, [item.id])}`))}
      ${
        checks.length
          ? `<div class="table-wrap"><table>
        <thead><tr><th scope="col">Deterministic check</th><th scope="col">Result</th><th scope="col">Observations</th></tr></thead>
        <tbody>${checks.map(({ ruleId, status, coverage }) => `<tr><th scope="row">${text(ruleId)}</th><td>${text(status)}</td><td>${text(coverage)}</td></tr>`).join("")}</tbody>
      </table></div>`
          : ""
      }
    </details>
  </article>`;
}

function renderCheckpoints(journey, { attempt, kind, checkpoints }) {
  if (!checkpoints?.length) return "";
  return `<details${kind === "observed" ? " open" : ""}>
    <summary>Checkpoints · ${text(attempt)}</summary>
    <ol>${checkpoints
      .map(
        ({ goal, status, reason, evidence, actionCount, findings }) => `
      <li>
        <div class="title-row"><strong>${text(goal)}</strong>${badge(status)}</div>
        <p>${text(reason)}${status === "skipped" ? "" : ` · ${actionCount} ${actionCount === 1 ? "action" : "actions"}`}</p>
        ${list(findings.map(text))}
        ${evidence ? evidenceLinks(journey, [evidence]) : ""}
      </li>`,
      )
      .join("")}</ol>
  </details>`;
}

function renderFinding(finding, scope, journey) {
  const rule = scope.rules[finding.ruleId];
  return `<article class="panel finding severity-${finding.severity}" id="finding-${text(escapeId(finding.id))}">
    <div class="finding-meta"><span class="badge severity">${finding.severity}/4 · ${text(scope.severity[finding.severity])}</span>
      <span>${text(finding.confidence)} confidence · ${text(finding.basis)}</span></div>
    <h3>${text(finding.title)}</h3>
    <p>${text(finding.description)}</p>
    ${facts([
      ["Recommendation", text(finding.remediation)],
      ["Expected improvement", text(finding.expectedImprovement)],
    ])}
    ${evidenceLinks(journey, finding.evidence)}
    <details><summary>Reproduction and rule</summary>
      ${finding.reproduction.length ? `<ol>${finding.reproduction.map((step) => `<li>${text(step)}</li>`).join("")}</ol>` : "<p>Pending verification.</p>"}
      ${facts([
        [
          "Journey",
          `<a href="#journey-${text(escapeId(journey.scenario.id))}">${text(journey.scenario.goal)}</a>`,
        ],
        ["Rule", `<code>${text(rule.id)}</code> ${text(rule.title)}`],
        ["Finding ID", `<code>${text(finding.id)}</code>`],
        ...(rule.references?.length
          ? [["References", rule.references.map(reference).join("<br>")]]
          : []),
      ])}
    </details>
  </article>`;
}

function reference(value) {
  if (/^https?:\/\//i.test(value))
    return `<a href="${text(value)}">${text(value)}</a>`;
  return text(value);
}

async function screenshotGallery({ journeys, findings, positives }, directory) {
  const galleries = [];
  for (const journey of journeys) {
    const scenario = journey.scenario.id;
    const pictured = new Map();
    function include(id, caption) {
      if (!id || !Object.hasOwn(journey.evidence, id)) return;
      const captions = pictured.get(id) ?? new Set();
      captions.add(caption);
      pictured.set(id, captions);
    }
    for (const attempt of journey.attempts) {
      include(attempt.outcome.evidence, `${attempt.attempt} outcome`);
      for (const checkpoint of attempt.checkpoints ?? []) {
        include(checkpoint.evidence, checkpoint.goal);
      }
    }
    for (const { evidence, title } of findings.filter(
      ({ scenarioId }) => scenarioId === scenario,
    )) {
      for (const id of evidence) include(id, title);
    }
    for (const { description, evidence } of positives.filter(
      ({ scenarioId }) => scenarioId === scenario,
    )) {
      for (const id of evidence) include(id, description);
    }
    for (const item of [
      ...journey.metrics.decisionEvidence,
      ...journey.metrics.memoryEvidence,
    ]) {
      include(item.id, item.decision ?? item.memory);
    }
    if (!pictured.size) continue;
    const figures = [];
    for (const [id, captions] of pictured) {
      const { screenshot, annotation, path, modal } = journey.evidence[id];
      const image = await readFile(join(directory, annotation ?? screenshot));
      const mime = annotation ? "image/svg+xml" : "image/png";
      figures.push(`<figure id="${text(evidenceId(journey, id))}" class="panel screen" tabindex="-1">
        <div class="screen-media"><img loading="lazy" decoding="async" src="data:${mime};base64,${image.toString("base64")}"
          alt="${text(`Captured interface at ${path}${modal ? ` in ${modal}` : ""}. ${[...captions].join(". ")}`)}"></div>
        <figcaption>
          <div><h4>${text(id)}</h4><code>${text(path)}${modal ? ` · ${text(modal)}` : ""}</code></div>
          ${list([...captions].map(text))}
          <div class="screen-links">
            ${annotation ? `<a href="${text(relative(annotation))}">Full-size annotation</a>` : ""}
            <a href="${text(relative(screenshot))}">Original screenshot</a>
          </div>
        </figcaption>
      </figure>`);
    }
    galleries.push(
      `<div class="gallery-group"><h3>${text(journey.scenario.goal)}</h3><div class="gallery">${figures.join("")}</div></div>`,
    );
  }
  return galleries.join("");
}

function renderRegression(comparison) {
  if (!comparison) return '<p class="callout">This run has no baseline.</p>';
  if (!comparison.compatible)
    return `<p class="callout">The baseline is incompatible. ${text(comparison.reasons.join(", "))}.</p>`;
  const rate = comparison.completionRate;
  return `<div class="panel comparison">
    <p>Baseline build <code>${text(comparison.baselineAppVersion)}</code></p>
    ${cards([
      ["Baseline completion", percent(rate.baseline)],
      ["Current completion", percent(rate.current)],
    ])}
    ${list(
      comparison.journeys.map((journey) => {
        if (!journey.comparable)
          return `<strong>${text(journey.id)}</strong> · ${text(journey.reason)}`;
        const changes = Object.entries(journey.deltas)
          .filter(([, value]) => value !== 0)
          .map(
            ([key, value]) =>
              `${label(key)} ${value > 0 ? "+" : ""}${format(value)}`,
          );
        const checks = journey.checkChanges.map(
          ({ id, from, to }) =>
            `${id} ${from ?? "unavailable"} → ${to ?? "unavailable"}`,
        );
        const findings = Object.entries(journey.findings)
          .filter(([, ids]) => ids.length)
          .map(([key, ids]) => `${key} ${ids.join(", ")}`);
        return `<strong>${text(journey.id)}</strong> · ${text(journey.completion.from)} → ${text(journey.completion.to)}
        ${list([...changes, ...checks, ...findings].map(text))}`;
      }),
    )}
    ${comparison.baselineOnly.length ? `<p>The baseline also covered ${text(comparison.baselineOnly.join(", "))}.</p>` : ""}
  </div>`;
}

function renderProfiles(comparison) {
  if (!comparison.compatible)
    return `<p class="callout">The profiles are incompatible. ${text(comparison.reasons.join(", "))}.</p>`;
  const comparable = comparison.journeys.filter(({ comparable }) => comparable);
  return `<div class="panel comparison">
    ${
      comparable.length
        ? `<div class="table-wrap"><table>
      <thead><tr><th scope="col">Journey</th><th scope="col">Desktop</th><th scope="col">Mobile web</th></tr></thead>
      <tbody>${comparable
        .map(
          ({ id, desktop, mobile }) =>
            `<tr><th scope="row">${text(id)}</th>${[desktop, mobile]
              .map(
                ({ outcome, metrics }) =>
                  `<td>${badge(outcome)} <span>${text(metrics.logicalActions)} actions · ${text(metrics.pageTransitions)} page transitions</span></td>`,
              )
              .join("")}</tr>`,
        )
        .join("")}</tbody>
    </table></div>`
        : ""
    }
    ${list(
      comparison.journeys
        .filter(({ comparable }) => !comparable)
        .map(
          ({ id, reason }) => `<strong>${text(id)}</strong> · ${text(reason)}`,
        ),
    )}
  </div>`;
}
