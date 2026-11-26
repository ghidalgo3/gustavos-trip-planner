import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../scripts/config.mjs";

const cli = fileURLToPath(new URL("../scripts/audit.mjs", import.meta.url));

test(
  "records live browser journeys, blocks writes, and compares annotated reports",
  { timeout: 90000 },
  async (t) => {
    let writesReceived = 0;
    const server = createServer((request, response) => {
      if (request.method === "POST") writesReceived++;
      response.setHeader("Content-Type", "text/html");
      response.end(
        request.url === "/details"
          ? "<h1>Trip dates</h1><p>April 2 through April 10</p>"
          : `<h1>Trips</h1><button onclick="fetch('/save', { method: 'POST' }).catch(() => {})">Preview</button>
        <input type="search" aria-label="Search trips" style="font-size:12px">
        <a href="/details">Show dates</a>`,
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const directory = await mkdtemp(join(tmpdir(), "ux-browser-"));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    const scenario = join(directory, "scenario.json");
    await writeFile(
      scenario,
      JSON.stringify({
        id: "browser-check",
        version: "1",
        goal: "Find trip dates <em>from the catalog</em>",
        persona: "new-trip-planner",
        setup: "Open the fixture.",
        success: "The dates appear.",
        startPath: "/",
        actionBudget: { desktop: 1, "mobile-web": 1 },
      }),
    );
    const run = (out, platform, name, beforeOpen) =>
      session(t, {
        url,
        scenario,
        out,
        platform,
        name,
        beforeOpen,
      });
    const baseline = join(directory, "baseline");
    await run(baseline, "desktop");
    const first = await output(
      "report",
      "--out",
      baseline,
      "--platform",
      "desktop",
    );
    assert.equal(
      (await readJson(first.json)).journeys[0].metrics.logicalActions,
      1,
    );

    const current = join(directory, "current");
    const observed = await run(
      current,
      "desktop",
      undefined,
      async (step, state) => {
        state = await step({
          type: "click",
          ref: control(state, "Preview"),
          tags: ["exploration"],
        });
        state = await step({
          type: "click",
          ref: control(state, "Search trips"),
        });
        return step({ type: "type", value: "abc" });
      },
    );
    assert.equal(writesReceived, 0);
    assert.deepEqual(observed.blockedRequests, [
      { method: "POST", kind: "write" },
    ]);
    assert.equal(
      observed.actions.find(({ type }) => type === "type").keydowns,
      3,
    );
    await run(current, "desktop", "direct");
    await run(current, "mobile-web");
    const report = await output(
      "report",
      "--out",
      current,
      "--platform",
      "desktop",
      "--baseline",
      first.json,
    );
    const audit = await readJson(report.json);
    const html = await readFile(report.html, "utf8");
    assert.match(html, /^<!doctype html>/);
    assert.match(
      html,
      /Find trip dates &lt;em&gt;from the catalog&lt;\/em&gt;/,
    );
    assert(!html.includes("<em>from the catalog</em>"));
    assert.match(html, /data:image\/png;base64,/);
    assert.match(html, /data:image\/svg\+xml;base64,/);
    assert.match(html, /href="#evidence-browser-check:observed-s1"/);
    assert.match(html, /id="evidence-browser-check:observed-s1"/);
    assert.match(html, /Baseline comparison/);
    await assert.rejects(access(join(current, "desktop", "audit.md")), {
      code: "ENOENT",
    });

    assert.equal(audit.journeys[0].metrics.shortestVerifiedActions, 1);
    assert.equal(audit.journeys[0].metrics.logicalActions, 4);
    assert.equal(audit.comparison.journeys[0].deltas.logicalActions, 3);
    assert(audit.findings.some(({ ruleId }) => ruleId === "TRIP-SEARCH-FONT"));
    assert(
      Object.values(audit.journeys[0].evidence).some(({ annotation }) =>
        annotation?.endsWith(".svg"),
      ),
    );

    const mobile = await output(
      "report",
      "--out",
      current,
      "--platform",
      "mobile-web",
    );
    const mobileAudit = await readJson(mobile.json);
    assert.equal(mobileAudit.journeys[0].metrics.input.tap, 1);
    assert.equal(
      mobileAudit.responsiveComparison.journeys[0].mobile.outcome,
      "success",
    );
  },
);

test(
  "records a sequence in one browser session and skips checkpoints after a failure",
  { timeout: 90000 },
  async (t) => {
    let savedTrip;
    const server = createServer((request, response) => {
      if (request.method === "POST") {
        if (request.url === "/create") savedTrip = "New trip";
        if (request.url === "/edit" && savedTrip) savedTrip = "Renamed trip";
        if (request.url === "/delete") savedTrip = undefined;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ name: savedTrip ?? null }));
        return;
      }
      response.setHeader("Content-Type", "text/html");
      response.end(`<h1>Trips</h1><button type="button">Create</button>
        <script>
          const heading = document.querySelector("h1");
          const button = document.querySelector("button");
          button.onclick = async () => {
            const response = await fetch("/" + button.textContent.toLowerCase(), { method: "POST" });
            const { name } = await response.json();
            heading.textContent = name ?? "Trips";
            button.textContent = name === "New trip" ? "Edit" : name ? "Delete" : "Create";
          };
        </script>`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const out = await mkdtemp(join(tmpdir(), "ux-checkpoints-"));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(out, { recursive: true, force: true });
    });

    const scenario = join(out, "scenario.json");
    await writeFile(
      scenario,
      JSON.stringify({
        id: "checkpoint-check",
        version: "1",
        goal: "Create, edit, and delete a trip.",
        persona: "new-trip-planner",
        setup: "Open the empty trip list.",
        startPath: "/",
        success: "The trip is created, edited, and removed.",
        writes: true,
        checkpoints: [
          {
            id: "create",
            goal: "Create the trip.",
            success: "The new trip appears.",
          },
          {
            id: "edit",
            goal: "Edit the trip.",
            success: "The renamed trip appears.",
          },
          {
            id: "delete",
            goal: "Delete the trip.",
            success: "The trip list returns.",
          },
        ],
      }),
    );

    for (const failed of [false, true]) {
      const name = failed ? "stopped" : undefined;
      savedTrip = undefined;
      const attempt = await driveSession(
        t,
        {
          url: `http://127.0.0.1:${server.address().port}`,
          scenario,
          scenarioId: "checkpoint-check",
          out,
          platform: "desktop",
          name,
          writable: true,
        },
        async ({ initial, send }) => {
          assert.equal(initial.nextCheckpoint.id, "create");
          const earlyFinish = await send(
            { type: "finish", status: "success", reason: "All done." },
            true,
          );
          assert.match(earlyFinish.error, /active checkpoint/);
          const outOfOrder = await send(
            {
              type: "checkpoint",
              id: "edit",
              status: "success",
              reason: "Renamed.",
            },
            true,
          );
          assert.match(outOfOrder.error, /Record checkpoint "create"/);

          const click = async (state, name, expected) => {
            let result = (
              await send({ type: "click", ref: control(state, name) })
            ).state;
            for (
              let retry = 0;
              retry < 8 && !result.text.includes(expected);
              retry++
            ) {
              result = (await send({ type: "observe" })).state;
            }
            assert(result.text.includes(expected));
            return result;
          };
          const record = (id, status, reason, findings) =>
            send({ type: "checkpoint", id, status, reason, findings });
          const created = await click(initial.state, "Create", "New trip");
          const createdResult = await record(
            "create",
            "success",
            "New trip appears.",
            ["Creation was clear."],
          );
          assert.equal(createdResult.nextCheckpoint.id, "edit");
          const log = join(
            out,
            "desktop",
            "checkpoint-check",
            name ?? "observed",
            "attempt.json",
          );
          assert.deepEqual((await readJson(log)).checkpoints, [
            createdResult.checkpoint,
          ]);
          if (failed)
            return record("edit", "blocked", "Editing could not continue.");

          const edited = await click(created, "Edit", "Renamed trip");
          const editedResult = await record(
            "edit",
            "success",
            "Renamed trip appears.",
          );
          assert.equal(editedResult.nextCheckpoint.id, "delete");
          await click(edited, "Delete", "Trips");
          return record("delete", "success", "The trip is gone.");
        },
      );

      assert.equal(attempt.outcome.status, failed ? "partial" : "success");
      assert.deepEqual(
        attempt.checkpoints.map(({ status, actionCount }) => [
          status,
          actionCount,
        ]),
        failed
          ? [
              ["success", 1],
              ["blocked", 0],
              ["skipped", 0],
            ]
          : [
              ["success", 1],
              ["success", 1],
              ["success", 1],
            ],
      );
    }

    const result = await output(
      "report",
      "--out",
      out,
      "--platform",
      "desktop",
    );
    const journey = (await readJson(result.json)).journeys[0];
    assert.equal(
      journey.attempts.find(({ kind }) => kind === "observed").checkpoints[2]
        .status,
      "success",
    );
    const html = await readFile(result.html, "utf8");
    assert.match(html, /Checkpoints · observed/);
    assert.match(html, /Creation was clear/);
    assert.match(html, /status-skipped/);
    const [create] = journey.attempts.find(
      ({ kind }) => kind === "observed",
    ).checkpoints;
    assert(html.includes(`id="evidence-checkpoint-check:${create.evidence}"`));
  },
);

function control(state, name) {
  const result = state.controls.find(({ label }) => label === name);
  assert(result, `Visible control ${name}`);
  return result.ref;
}

async function session(t, options) {
  const { platform, beforeOpen } = options;
  return driveSession(t, options, async ({ initial, send }) => {
    const step = async (action) => (await send(action)).state;
    let { state } = initial;
    if (beforeOpen) state = await beforeOpen(step, state);
    state = await step({
      type: platform === "desktop" ? "click" : "tap",
      ref: control(state, "Show dates"),
    });
    for (
      let retry = 0;
      retry < 6 && !state.text.includes("April 2 through April 10");
      retry++
    ) {
      state = await step({ type: "observe" });
    }
    assert(state.text.includes("April 2 through April 10"));
    return send({
      type: "finish",
      status: "success",
      reason: "The dates were visible.",
    });
  });
}

async function driveSession(
  t,
  {
    url,
    scenario,
    out,
    platform,
    name,
    scenarioId = "browser-check",
    writable = false,
  },
  drive,
) {
  const command = [
    "session",
    "--url",
    url,
    "--platform",
    platform,
    "--out",
    out,
    "--app-version",
    "synthetic",
    "--fixture",
    "test-fixture-v1",
    "--scenario",
    scenarioId,
    "--scenario-file",
    scenario,
  ];
  if (name) command.push("--attempt", name);
  if (writable) command.push("--allow-fixture-writes");
  const child = spawn(process.execPath, [cli, ...command], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => {
    child.stdin.end();
    child.kill();
  });
  const end = once(child, "close");
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (part) => (stderr += part));
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[
    Symbol.asyncIterator
  ]();
  const next = async () => {
    const { value } = await lines.next();
    assert(value, stderr);
    return JSON.parse(value);
  };
  const send = async (data, expectError = false) => {
    child.stdin.write(JSON.stringify(data) + "\n");
    const message = await next();
    if (!expectError) assert(!message.error, message.error);
    return message;
  };
  try {
    const initial = await next();
    assert(initial.ready, initial.error);
    const result = await drive({ initial, send });
    child.stdin.end();
    assert.equal((await end)[0], 0, stderr);
    return readJson(result.file);
  } finally {
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  }
}

async function output(...args) {
  const child = spawn(process.execPath, [cli, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const end = once(child, "close");
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (part) => (stdout += part));
  child.stderr.setEncoding("utf8").on("data", (part) => (stderr += part));
  assert.equal((await end)[0], 0, stderr);
  return JSON.parse(stdout);
}
