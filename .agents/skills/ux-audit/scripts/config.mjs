import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const skill = fileURLToPath(new URL("../", import.meta.url));
const defaultProject = join(skill, "references", "trip-planner");
const bundledConfig = join(skill, "references", "ux_audit_config.yml");
export const skillVersion = "1.0.0";
export const schemaVersion = 1;
export const metricsVersion = 1;

export function dependency(name) {
  const manifest = resolve(
    process.env.UX_AUDIT_DEPS ?? process.cwd(),
    "package.json",
  );
  try {
    return createRequire(manifest)(name);
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    throw new Error(
      `Install ${name} in the directory named by UX_AUDIT_DEPS (${dirname(manifest)}).`,
      { cause: error },
    );
  }
}

export const readJson = async (path) =>
  JSON.parse(await readFile(path, "utf8"));

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export const fingerprint = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const validators = new Map();
export async function validate(schema, value, source = schema) {
  if (!validators.has(schema)) {
    const Ajv = dependency("ajv");
    const ajv = new Ajv({
      allErrors: true,
      schemaId: "auto",
      ownProperties: true,
    });
    if (schema === "audit") {
      ajv.addSchema(
        await readJson(join(skill, "schemas", "finding.schema.json")),
        "finding",
      );
    }
    validators.set(
      schema,
      ajv.compile(
        await readJson(join(skill, "schemas", `${schema}.schema.json`)),
      ),
    );
  }
  const check = validators.get(schema);
  if (!check(value)) {
    const details = check.errors
      .map(({ dataPath, message }) => `${dataPath || "/"} ${message}`)
      .join("; ");
    throw new Error(`${source}: ${details}`);
  }
  if (
    schema === "scenario" &&
    value.checkpoints &&
    new Set(value.checkpoints.map(({ id }) => id)).size !==
      value.checkpoints.length
  ) {
    throw new Error(`${source}: ${value.id} has repeated checkpoint IDs.`);
  }
  if (
    schema === "heuristic" &&
    value.validator?.kind === "control" &&
    ["min-width", "min-height", "min-font"].includes(value.validator.check) &&
    !(Number.isFinite(value.threshold) && value.threshold >= 0)
  ) {
    throw new Error(
      `${source}: ${value.id} needs a non-negative geometry threshold.`,
    );
  }
  return value;
}

async function records(root, names) {
  const values = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      (error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = extname(path);
      if (![".json", ".yaml", ".yml", ".md"].includes(extension)) continue;
      const { data, body } = await document(path);
      if (data === undefined) continue;
      for (const record of Array.isArray(data) ? data : [data]) {
        values.push({ record, source: path, body });
      }
    }
  }
  for (const name of names) await walk(join(root, name));
  return values;
}

async function document(path) {
  const raw = await readFile(path, "utf8");
  if (extname(path) === ".json") return { data: JSON.parse(raw) };
  const markdown = extname(path) === ".md";
  const frontmatter = markdown
    ? raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)
    : null;
  if (markdown && !frontmatter) return {};
  const data = dependency("yaml").parse(frontmatter?.[1] ?? raw, {
    uniqueKeys: true,
    maxAliasCount: 0,
  });
  return { data, body: frontmatter?.[2].trim() || undefined };
}

async function index(items, schema) {
  const result = new Map();
  for (const { record, source, body } of items) {
    const description =
      record?.description ??
      body ??
      (schema === "heuristic" ? record?.instructions : undefined);
    const item = description ? { ...record, description } : record;
    await validate(schema, item, source);
    if (result.has(item.id))
      throw new Error(`Duplicate ${schema} ID ${item.id} at ${source}.`);
    result.set(item.id, item);
  }
  return Object.fromEntries(result);
}

export async function loadRegistry(project = defaultProject) {
  const root = resolve(project);
  const defaults = await readJson(join(skill, "config", "defaults.json"));
  const projectFile =
    root === defaultProject ? bundledConfig : join(root, "ux_audit_config.yml");
  const local = await document(projectFile)
    .then(({ data }) => data ?? {})
    .catch((error) => {
      if (error.code === "ENOENT" && root !== defaultProject) return {};
      throw error;
    });
  await validate("config", local, projectFile);
  const builtin = await index(
    await records(skill, ["references/heuristics"]),
    "heuristic",
  );
  const provided = await index(
    await records(root, [
      "heuristics",
      "design-guidelines",
      "component-patterns",
    ]),
    "heuristic",
  );
  const rules = { ...builtin, ...provided };
  for (const [id, change] of Object.entries(local.rules ?? {})) {
    if (!Object.hasOwn(rules, id))
      throw new Error(`Unknown rule ID ${id} in ${projectFile}.`);
    if (change === false) {
      delete rules[id];
    } else {
      rules[id] = await validate(
        "heuristic",
        { ...rules[id], ...change, id },
        projectFile,
      );
    }
  }
  const scenarios = await index(
    (local.scenarios ?? []).map((record) => ({ record, source: projectFile })),
    "scenario",
  );
  const personas = await index(
    (local.personas ?? []).map((record) => ({ record, source: projectFile })),
    "persona",
  );
  const validators = {};
  for (const rule of Object.values(rules)) {
    if (!rule.validator) continue;
    if (rule.validator.kind !== "script") continue;
    const path = await realpath(resolve(root, rule.validator.path));
    const actualRoot = await realpath(root);
    if (!path.startsWith(actualRoot + sep) || !path.endsWith(".mjs")) {
      throw new Error(
        `Validator for ${rule.id} must be an .mjs file within the project UX directory.`,
      );
    }
    validators[rule.id] = {
      path,
      fingerprint: fingerprint(await readFile(path, "utf8")),
    };
  }
  for (const scenario of Object.values(scenarios)) {
    if (!Object.hasOwn(personas, scenario.persona))
      throw new Error(`Unknown persona ${scenario.persona} in ${scenario.id}.`);
  }
  return {
    targetOrigin: local.targetOrigin,
    profiles: { ...defaults.profiles, ...local.profiles },
    severity: { ...defaults.severity, ...local.severity },
    weights: { ...defaults.weights, ...local.weights },
    rules,
    scenarios,
    personas,
    validators,
  };
}

export function scopeRules(registry, platform, components) {
  return Object.values(registry.rules).filter((rule) =>
    applies(rule, platform, components),
  );
}

export function applies(rule, platform, components) {
  return (
    (!rule.platforms || rule.platforms.includes(platform)) &&
    (!rule.components ||
      rule.components.some((component) => components.includes(component)))
  );
}
