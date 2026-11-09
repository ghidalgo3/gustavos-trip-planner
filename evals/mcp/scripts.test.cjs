const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const root = path.resolve(__dirname, "../..");

function command(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("zsh", [path.join(root, "scripts/evals"), ...args], {
      cwd: root,
      env,
    });
    let output = "";
    child.stdout.on("data", (part) => (output += part));
    child.stderr.on("data", (part) => (output += part));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function setup(t, exitCode) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "tripplanner-eval-script-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  await fs.mkdir(bin);
  const fixture = path.join(directory, "fixture.cjs");
  await fs.writeFile(
    fixture,
    `
const http = require('node:http');
const fs = require('node:fs');
if (process.env.FAKE_STARTUP_FAILURE === 'true') process.exit(12);
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({status:'ready',instance:process.env.TRIPPLANNER_EVAL_INSTANCE}));
});
fs.writeFileSync(process.env.FAKE_PID, String(process.pid));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
server.listen(Number(process.argv[4]), '127.0.0.1');
`,
  );
  await fs.writeFile(
    path.join(bin, "dotnet"),
    '#!/bin/zsh\n[[ "$1" == build ]] && exit 0\nexec node "$FAKE_FIXTURE" "$@"\n',
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, "az"),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_AZ_CALLS, JSON.stringify(args) + '\\n');
const failure = process.env.FAKE_AZ_FAILURE;
if ((args[0] === 'account' && failure === 'login') ||
    (args[0] === 'deployment' && failure === 'deployment') ||
    (args[0] === 'keyvault' && failure === 'secret')) {
  console.error(process.env.FAKE_VAULT_SECRET);
  process.exit(7);
}
if (args[0] === 'account') console.log(failure === 'tenant' ? 'another-tenant' : 'fixture-tenant');
else if (args[0] === 'deployment') console.log(failure === 'missing-vault' ? '' : 'fixture-vault');
else if (args[0] === 'keyvault') console.log(failure === 'empty-secret' ? '   ' : process.env.FAKE_VAULT_SECRET);
else process.exit(8);
`,
    { mode: 0o755 },
  );
  await fs.writeFile(
    path.join(bin, "npx"),
    `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.FAKE_ARGS, JSON.stringify(process.argv.slice(2)));
if (process.argv.includes('eval') && process.env.OPENAI_API_KEY !== process.env.FAKE_VAULT_SECRET) process.exit(91);
if (process.env.FAKE_RUNNER_HANG === 'true') {
  require('node:fs').writeFileSync(process.env.FAKE_RUNNER_PID, String(process.pid));
  setInterval(() => {}, 1000);
} else process.exit(${exitCode});
`,
    { mode: 0o755 },
  );
  const port = await freePort();
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    OPENAI_API_KEY: "old-environment-key",
    LOCAL_OPENAI_API_KEY: "old-local-key",
    FAKE_VAULT_SECRET: "vault-fixture-key",
    FAKE_AZ_CALLS: path.join(directory, "azure-calls"),
    SUBSCRIPTION: "fixture-subscription",
    RESOURCE_GROUP: "fixture-rg",
    INFRA_DEPLOYMENT_NAME: "fixture-deployment",
    EXPECTED_TENANT_ID: "fixture-tenant",
    TRIPPLANNER_EVAL_MODEL: "fixture-model",
    TRIPPLANNER_EVAL_SERVICE_TIER: "default",
    TRIPPLANNER_EVAL_PORT: String(port),
    FAKE_FIXTURE: fixture,
    FAKE_PID: path.join(directory, "pid"),
    FAKE_ARGS: path.join(directory, "args"),
    FAKE_RUNNER_PID: path.join(directory, "runner-pid"),
  };
  return { directory, env };
}

for (const exitCode of [0, 42]) {
  test(`runner forwards options and preserves eval exit ${exitCode} while stopping its fixture`, async (t) => {
    const { directory, env } = await setup(t, exitCode);
    const output = path.join(directory, "results with spaces");
    const result = await command(
      [
        "--repeat",
        "2",
        "--output",
        output,
        "--",
        "--filter-pattern",
        "known dates",
        "--max-concurrency",
        "2",
      ],
      env,
    );
    assert.equal(result.code, exitCode, result.output);
    const args = JSON.parse(await fs.readFile(env.FAKE_ARGS, "utf8"));
    assert.ok(args.includes("promptfoo@0.125.1"));
    assert.deepEqual(args.slice(-4), [
      "--filter-pattern",
      "known dates",
      "--max-concurrency",
      "2",
    ]);
    assert.equal(args[args.indexOf("--repeat") + 1], "2");
    assert.equal(
      args[args.indexOf("--output") + 1],
      path.join(await fs.realpath(output), "results.json"),
    );
    const pid = Number(await fs.readFile(env.FAKE_PID, "utf8"));
    assert.throws(() => process.kill(pid, 0));
    assert.equal(
      JSON.parse(await fs.readFile(path.join(output, "fixture.json"), "utf8"))
        .status,
      "ready",
    );
  });
}

test("runner fails on fixture startup and never invokes the model runner", async (t) => {
  const { directory, env } = await setup(t, 0);
  env.FAKE_STARTUP_FAILURE = "true";
  const result = await command(
    ["--output", path.join(directory, "results")],
    env,
  );
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /fixture startup failed/);
  await assert.rejects(fs.readFile(env.FAKE_ARGS));
});

test("invalid repeat is rejected before creating a fixture", async (t) => {
  const { env } = await setup(t, 0);
  const result = await command(["--repeat", "0"], env);
  assert.equal(result.code, 1);
  assert.match(result.output, /positive integer/);
  await assert.rejects(fs.readFile(env.FAKE_PID));
});

test("viewer runs without credentials or a fixture", async (t) => {
  const { env } = await setup(t, 0);
  delete env.OPENAI_API_KEY;
  delete env.TRIPPLANNER_EVAL_MODEL;
  const result = await command(["--view"], env);
  assert.equal(result.code, 0, result.output);
  assert.equal(
    JSON.parse(await fs.readFile(env.FAKE_ARGS, "utf8")).at(-1),
    "view",
  );
  await assert.rejects(fs.readFile(env.FAKE_PID));
  await assert.rejects(fs.readFile(env.FAKE_AZ_CALLS));
});

test("interrupting the wrapper stops both the CLI and its fixture", async (t) => {
  const { directory, env } = await setup(t, 0);
  env.FAKE_RUNNER_HANG = "true";
  const child = spawn(
    "zsh",
    [
      path.join(root, "scripts/evals"),
      "--output",
      path.join(directory, "results"),
    ],
    { cwd: root, env, stdio: "ignore" },
  );
  t.after(() => {
    child.kill("SIGKILL");
  });
  const closed = new Promise((resolve) =>
    child.on("close", (code) => resolve(code)),
  );
  let runnerPid;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      runnerPid = Number(await fs.readFile(env.FAKE_RUNNER_PID, "utf8"));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.ok(runnerPid, "The model runner did not start.");
  child.kill("SIGTERM");
  assert.equal(await closed, 143);
  assert.throws(() => process.kill(runnerPid, 0));
  const fixturePid = Number(await fs.readFile(env.FAKE_PID, "utf8"));
  assert.throws(() => process.kill(fixturePid, 0));
});

test("runner defaults to Luna Flex processing without a model or tier override", async (t) => {
  const { directory, env } = await setup(t, 0);
  delete env.TRIPPLANNER_EVAL_MODEL;
  delete env.TRIPPLANNER_EVAL_SERVICE_TIER;
  const output = path.join(directory, "results");
  const result = await command(["--output", output], env);
  assert.equal(result.code, 0, result.output);
  const manifest = JSON.parse(
    await fs.readFile(path.join(output, "run.json"), "utf8"),
  );
  assert.equal(manifest.model, "gpt-6-luna");
  assert.equal(manifest.requestedServiceTier, "flex");
});

test("runner records explicit model and Flex overrides", async (t) => {
  const { directory, env } = await setup(t, 0);
  const output = path.join(directory, "results");
  const result = await command(
    ["--model", "another-model", "--service-tier", "flex", "--output", output],
    env,
  );
  assert.equal(result.code, 0, result.output);
  const manifest = JSON.parse(
    await fs.readFile(path.join(output, "run.json"), "utf8"),
  );
  assert.equal(manifest.model, "another-model");
  assert.equal(manifest.requestedServiceTier, "flex");
});

test("runner rejects Batch without starting a fixture", async (t) => {
  const { env } = await setup(t, 0);
  const result = await command(["--service-tier", "batch"], env);
  assert.equal(result.code, 1);
  assert.match(result.output, /asynchronous scheduler/);
  await assert.rejects(fs.readFile(env.FAKE_PID));
});

test("behavioral runs use the configured deployment's vault and never persist the key", async (t) => {
  const { directory, env } = await setup(t, 0);
  delete env.OPENAI_API_KEY;
  delete env.LOCAL_OPENAI_API_KEY;
  const output = path.join(directory, "results");
  const result = await command(["--output", output], env);
  assert.equal(result.code, 0, result.output);
  assert.doesNotMatch(result.output, /vault-fixture-key/);
  const calls = (await fs.readFile(env.FAKE_AZ_CALLS, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(
      call[call.indexOf("--subscription") + 1],
      "fixture-subscription",
    );
    assert.ok(
      !call.includes("set"),
      "The runner must not change the globally selected subscription.",
    );
  }
  const deployment = calls.find((call) => call[0] === "deployment");
  assert.equal(
    deployment[deployment.indexOf("--name") + 1],
    "fixture-deployment",
  );
  assert.equal(
    deployment[deployment.indexOf("--resource-group") + 1],
    "fixture-rg",
  );
  const secret = calls.find((call) => call[0] === "keyvault");
  assert.equal(secret[secret.indexOf("--name") + 1], "openai-api-key");
  assert.equal(secret[secret.indexOf("--vault-name") + 1], "fixture-vault");
  for (const file of await fs.readdir(output)) {
    assert.ok(
      !(await fs.readFile(path.join(output, file), "utf8")).includes(
        env.FAKE_VAULT_SECRET,
      ),
      file,
    );
  }
});

for (const failure of [
  "login",
  "tenant",
  "deployment",
  "missing-vault",
  "secret",
  "empty-secret",
]) {
  test(`vault failure ${failure} stops before fixtures or model calls without exposing the key`, async (t) => {
    const { directory, env } = await setup(t, 0);
    env.FAKE_AZ_FAILURE = failure;
    const result = await command(
      ["--output", path.join(directory, "results")],
      env,
    );
    assert.equal(result.code, 1, result.output);
    assert.doesNotMatch(
      result.output,
      /vault-fixture-key|old-environment-key|old-local-key/,
    );
    await assert.rejects(fs.readFile(env.FAKE_PID));
    await assert.rejects(fs.readFile(env.FAKE_ARGS));
  });
}
