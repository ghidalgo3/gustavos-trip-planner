import { mkdir, rename, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { openPlaywright } from "../adapters/playwright.mjs";
import { startCheckpoints, validateOutcome } from "./checkpoints.mjs";
import {
  fingerprint,
  metricsVersion,
  skillVersion,
  validate,
} from "./config.mjs";

const attemptName = /^[A-Za-z0-9][A-Za-z0-9_-]{0,30}$/;
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
const inputTypes = [
  "click",
  "tap",
  "type",
  "press",
  "scroll",
  "drag",
  "swipe",
  "back",
];

export async function writeJson(file, value) {
  // A reader sees the previous complete snapshot or the new one.
  const pending = `${file}.${process.pid}.tmp`;
  await writeFile(pending, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(pending, file);
}

export function rulesFingerprint(registry) {
  return fingerprint({
    rules: registry.rules,
    severity: registry.severity,
    weights: registry.weights,
    validators: Object.fromEntries(
      Object.entries(registry.validators).map(([id, rule]) => [
        id,
        rule.fingerprint,
      ]),
    ),
  });
}

export async function startSession(options, registry, emit) {
  const url = new URL(options.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "--url must be an HTTP(S) origin without credentials, a path, or URL parameters.",
    );
  }
  const scenario = registry.scenarios[options.scenario];
  if (!scenario || !Object.hasOwn(registry.scenarios, options.scenario)) {
    throw new Error(
      `Unknown scenario ${options.scenario}. Use list or supply --scenario-file.`,
    );
  }
  const persona = registry.personas[scenario.persona];
  const profile = registry.profiles[options.platform];
  if (
    !Object.hasOwn(registry.profiles, options.platform) ||
    (scenario.platforms && !scenario.platforms.includes(options.platform))
  ) {
    throw new Error(`${scenario.id} is unavailable on ${options.platform}.`);
  }
  const writable = options["allow-fixture-writes"] === true;
  if (
    writable &&
    (!loopback.has(url.hostname) ||
      !scenario.writes ||
      !options.fixture ||
      options.fixture === "live")
  ) {
    throw new Error(
      "Writes require a loopback origin, a named disposable fixture, and a write-enabled scenario.",
    );
  }
  if (scenario.writes && !writable)
    throw new Error("This scenario requires a disposable writable fixture.");
  const origin = url.origin;
  const attempt = options.attempt ?? "observed";
  if (!attemptName.test(attempt))
    throw new Error(
      "Attempt names must contain up to 31 letters, digits, hyphens, or underscores.",
    );
  const directory = join(options.out, options.platform, scenario.id, attempt);
  await mkdir(join(options.out, options.platform, scenario.id), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(directory, { mode: 0o700 });
  let adapter;
  try {
    adapter = await openPlaywright(profile, url, {
      headed: options.headed,
      storageState: options["storage-state"],
      writable,
    });
  } catch (error) {
    await rmdir(directory);
    throw error;
  }
  const states = [];
  const actions = [];
  const checkpoints =
    scenario.checkpoints && startCheckpoints(scenario.checkpoints, actions);
  let latest;
  const metadata = {
    platform: options.platform,
    environment: adapter.environment,
    origin,
    appVersion: options["app-version"],
    fixture: options.fixture ?? "live",
    rulesFingerprint: rulesFingerprint(registry),
    profileFingerprint: fingerprint(profile),
    skillVersion,
    metricsVersion,
    writable,
  };
  const start = new URL(scenario.startPath, url);
  const kind = attempt === "observed" ? "observed" : "alternative";
  const record = {
    metadata,
    scenario,
    persona,
    attempt,
    kind,
    states,
    actions,
    ...(checkpoints && { checkpoints: checkpoints.results }),
  };
  const save = () => writeJson(join(directory, "attempt.json"), record);

  async function observe(annotation = {}) {
    const id = `${attempt}-s${states.length + 1}`;
    const screenshot = `${id}.png`;
    const target = join(directory, screenshot);
    let raw = await adapter.renderedState();
    for (let retry = 0; ; retry++) {
      await adapter.screenshot(target);
      const after = await adapter.renderedState();
      if (after.path === raw.path && after.modal === raw.modal) {
        raw = after;
        break;
      }
      if (retry >= 2)
        throw new Error("The page kept navigating during evidence capture.");
      raw = after;
    }
    const state = { ...raw, ...annotation, id, screenshot };
    states.push(state);
    latest = state;
    await save();
    return { ...state, screenshot: join(directory, screenshot) };
  }

  async function saveOutcome(outcome) {
    record.outcome = outcome;
    record.blockedRequests = adapter.blocked;
    await save();
  }

  async function finish(outcome, checkpoint) {
    await saveOutcome(outcome);
    emit({
      finished: true,
      outcome,
      ...(checkpoint && { checkpoint }),
      file: join(directory, "attempt.json"),
    });
  }

  function interrupted(reason) {
    const evidence = latest?.id ?? null;
    if (!checkpoints) return { status: "blocked", reason, evidence };
    const checkpoint = checkpoints.next();
    checkpoints.record(
      {
        id: checkpoint.id,
        status: "blocked",
        reason: reason.slice(0, 600) || "The browser session stopped.",
      },
      evidence,
    );
    return checkpoints.finish();
  }

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const stop = () => rl.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await adapter.navigate(start);
    emit({
      ready: true,
      scenario: scenario.id,
      attempt,
      environment: adapter.environment,
      nextCheckpoint: checkpoints?.next(),
      state: await observe(),
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let command;
      try {
        command = JSON.parse(line);
        if (command.type === "checkpoint") {
          if (!checkpoints)
            throw new Error("This scenario uses the finish command.");
          const checkpoint = checkpoints.record(command, latest.id);
          const nextCheckpoint = checkpoints.next();
          if (checkpoint.status !== "success" || !nextCheckpoint) {
            await finish(checkpoints.finish(), checkpoint);
            return;
          }
          await save();
          emit({ checkpoint, nextCheckpoint });
          continue;
        }
        if (command.type === "finish") {
          if (checkpoints)
            throw new Error(
              "Record the active checkpoint to finish this scenario.",
            );
          validateOutcome(command);
          await finish({
            status: command.status,
            reason: command.reason,
            evidence: latest.id,
          });
          return;
        }
        if (command.type === "observe") {
          emit({ state: await observe(labels(command)) });
          continue;
        }
        const fresh = await adapter.renderedState();
        const action = prepareAction(
          command,
          latest,
          fresh,
          adapter.environment,
        );
        actions.push(action.entry);
        try {
          const measurements = await adapter.act(action.input);
          action.entry.dispatched = true;
          if (
            Number.isInteger(measurements?.keydowns) ||
            measurements?.keydowns === null
          ) {
            action.entry.keydowns = measurements.keydowns;
          }
        } catch (error) {
          action.entry.error = adapterError(error);
        }
        const result = await observe(labels(command));
        action.entry.after = result.id;
        await save();
        emit({ action: action.entry, state: result });
      } catch (error) {
        emit({ error: adapterError(error) });
      }
    }
    const outcome = interrupted(
      "Audit session ended before an outcome was recorded.",
    );
    await saveOutcome(outcome);
    emit({ finished: false, outcome, file: join(directory, "attempt.json") });
  } catch (error) {
    if (!record.outcome) await saveOutcome(interrupted(adapterError(error)));
    throw error;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    rl.close();
    await adapter.close();
  }
}

function adapterError(error) {
  return String(error.message ?? error)
    .split("\n")[0]
    .replace(/https?:\/\/[^\s]+/g, "[URL]");
}

function labels(command) {
  const result = {};
  for (const key of ["area", "stateKey", "decision", "memory"]) {
    const value = command[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.trim() || value.length > 250)
      throw new Error(`Invalid ${key} label.`);
    result[key] = value.trim();
  }
  if (command.alternatives !== undefined) {
    if (
      !Number.isInteger(command.alternatives) ||
      command.alternatives < 0 ||
      !result.decision
    ) {
      throw new Error(
        "Alternatives must be a non-negative count attached to a decision.",
      );
    }
    result.alternatives = command.alternatives;
  }
  return result;
}

function inside(point, viewport) {
  return (
    point &&
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < viewport.width &&
    point.y < viewport.height
  );
}

function prepareAction(command, latest, fresh, environment) {
  const { viewport, controls } = fresh;
  if (!inputTypes.includes(command.type))
    throw new Error("Unknown interaction. See references/operations.md.");
  if (fresh.path !== latest.path || fresh.modal !== latest.modal)
    throw new Error("The UI changed. Observe the new screen before acting.");
  if (
    command.tags !== undefined &&
    (!Array.isArray(command.tags) ||
      new Set(command.tags).size !== command.tags.length ||
      command.tags.some(
        (tag) =>
          ![
            "exploration",
            "incorrect",
            "backtrack",
            "repeated-entry",
            "confirmation",
            "recovery",
          ].includes(tag),
      ))
  ) {
    throw new Error("Unknown or duplicated interaction tag.");
  }
  labels(command);
  const input = { type: command.type };
  const entry = {
    type: command.type,
    before: latest.id,
    tags: command.tags ?? [],
    dispatched: false,
  };
  let control;
  if (command.ref !== undefined) {
    const prior = latest.controls.find(({ ref }) => ref === command.ref);
    if (prior) {
      control = controls.find(
        ({ label, role, point }) =>
          label === prior.label &&
          role === prior.role &&
          Math.hypot(point.x - prior.point.x, point.y - prior.point.y) < 5,
      );
    }
    if (!control)
      throw new Error(
        "The numbered control moved or disappeared. Observe it again.",
      );
    if (control.disabled)
      throw new Error("This control is disabled in the current UI.");
    entry.label = control.label || control.role;
  }
  switch (command.type) {
    case "click":
    case "tap":
    case "scroll":
    case "drag":
    case "swipe": {
      const point = control?.point ?? command.point;
      if (!inside(point, viewport))
        throw new Error(
          "Pick a visible numbered control or viewport coordinates.",
        );
      if (command.type === "click" && environment.touch)
        throw new Error("Use tap on a touch profile.");
      if (command.type === "tap" && !environment.touch)
        throw new Error("Use click on a desktop profile.");
      if (
        command.type === "swipe" ||
        (environment.touch && ["scroll", "drag"].includes(command.type))
      ) {
        if (!environment.touchGestures)
          throw new Error("This profile does not support touch gestures.");
      }
      input.point = entry.point = point;
      if (
        ["drag", "swipe"].includes(command.type) ||
        (command.type === "scroll" && environment.touch)
      ) {
        if (!inside(command.end, viewport))
          throw new Error("Supply an end point inside the visible viewport.");
        input.end = entry.end = command.end;
      }
      if (command.type === "scroll" && !environment.touch) {
        const dx = command.dx ?? 0;
        const dy = command.dy ?? 0;
        if (
          ![dx, dy].every(
            (value) => Number.isInteger(value) && Math.abs(value) <= 2000,
          ) ||
          !(dx || dy)
        ) {
          throw new Error(
            "Supply a non-zero wheel delta of at most 2000 pixels.",
          );
        }
        input.dx = entry.dx = dx;
        input.dy = entry.dy = dy;
      }
      break;
    }
    case "type": {
      const focused = controls.find((item) => item.focused);
      if (!focused?.editable || focused.sensitive)
        throw new Error(
          "Focus a visible non-sensitive text field before entering text.",
        );
      if (
        typeof command.value !== "string" ||
        !command.value.length ||
        command.value.length > 4000
      ) {
        throw new Error("Provide text between 1 and 4000 characters.");
      }
      input.value = command.value;
      entry.characters = Array.from(command.value).length;
      entry.label = focused.label || focused.role;
      break;
    }
    case "press": {
      if (
        typeof command.key !== "string" ||
        !/^(?:(?:Shift|Alt|Control|Meta|ControlOrMeta)\+)*(?:Tab|Enter|Escape|Space|Arrow(?:Up|Down|Left|Right)|Page(?:Up|Down)|Home|End|Backspace|Delete|Key[A-Z]|Digit[0-9])$/.test(
          command.key,
        )
      ) {
        throw new Error("Use a supported navigation key or key chord.");
      }
      if (
        /\+(?:Key[CVX]|Insert)$/.test(command.key) ||
        (controls.some((item) => item.focused && item.sensitive) &&
          !/^(?:Shift\+)?Tab$|^Escape$/.test(command.key))
      ) {
        throw new Error(
          "Clipboard commands and keyboard input into sensitive fields are unavailable.",
        );
      }
      input.key = entry.key = command.key;
      break;
    }
  }
  return { input, entry };
}
