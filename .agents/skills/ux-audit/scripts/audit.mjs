import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadRegistry, readJson, scopeRules, validate } from "./config.mjs";
import { report } from "./report.mjs";
import { startSession } from "./session.mjs";

const commands = {
  list: ["project", "platform", "scenario-file"],
  session: [
    "project",
    "platform",
    "scenario",
    "scenario-file",
    "url",
    "out",
    "app-version",
    "fixture",
    "attempt",
    "headed",
    "storage-state",
    "allow-fixture-writes",
  ],
  report: [
    "project",
    "platform",
    "out",
    "assessment",
    "baseline",
    "trust-project-validators",
  ],
};

const usage = `ux-audit list [--project DIRECTORY] [--platform desktop|mobile-web]
ux-audit session --platform PLATFORM --scenario ID --out RUN --app-version VERSION [--url ORIGIN] [--fixture ID] [--attempt NAME]
ux-audit report --platform PLATFORM --out RUN [--assessment FILE] [--baseline AUDIT_JSON]

Session reads one JSON command per line on stdin. See references/operations.md.`;

function emit(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help") {
    process.stdout.write(usage + "\n");
    return;
  }
  if (!Object.hasOwn(commands, command))
    throw new Error(`Unknown command: ${command}.`);
  const booleans = new Set([
    "headed",
    "allow-fixture-writes",
    "trust-project-validators",
  ]);
  const { values } = parseArgs({
    args,
    options: Object.fromEntries(
      commands[command].map((name) => [
        name,
        { type: booleans.has(name) ? "boolean" : "string" },
      ]),
    ),
  });
  const registry = await loadRegistry(values.project);
  if (command === "session") values.url ??= registry.targetOrigin;
  const required =
    command === "session"
      ? ["url", "scenario", "out", "platform", "app-version"]
      : command === "report"
        ? ["out", "platform"]
        : [];
  for (const key of required) {
    if (!values[key]?.trim()) throw new Error(`Provide --${key}.`);
  }
  if (values.out) values.out = resolve(values.out);
  if (values.platform && !Object.hasOwn(registry.profiles, values.platform)) {
    throw new Error(`Unknown platform ${values.platform}.`);
  }
  if (values["scenario-file"]) {
    const path = values["scenario-file"];
    const scenario = await validate("scenario", await readJson(path), path);
    if (!Object.hasOwn(registry.personas, scenario.persona))
      throw new Error(`Unknown persona ${scenario.persona}.`);
    if (Object.hasOwn(registry.scenarios, scenario.id))
      throw new Error(`Scenario ${scenario.id} is already registered.`);
    registry.scenarios = { ...registry.scenarios, [scenario.id]: scenario };
  }
  if (command === "list") {
    const platforms = values.platform
      ? [values.platform]
      : Object.keys(registry.profiles);
    emit({
      targetOrigin: registry.targetOrigin,
      profiles: registry.profiles,
      personas: registry.personas,
      scenarios: Object.values(registry.scenarios).filter(
        ({ platforms: scope }) =>
          !scope || platforms.some((platform) => scope.includes(platform)),
      ),
      rules: Object.fromEntries(
        platforms.map((platform) => [
          platform,
          scopeRules(registry, platform, [
            ...new Set(
              Object.values(registry.rules).flatMap(
                ({ components }) => components ?? [],
              ),
            ),
          ]),
        ]),
      ),
    });
  } else if (command === "session") {
    await startSession(values, registry, emit);
  } else {
    emit(await report(values, registry));
  }
}

main().catch((error) => {
  process.stderr.write(`UX audit: ${error.message}\n`);
  process.exitCode = 1;
});
