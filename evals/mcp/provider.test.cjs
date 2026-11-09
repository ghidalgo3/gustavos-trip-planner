const { test } = require("node:test");
const assert = require("node:assert/strict");
const Provider = require("./provider.cjs");
const grade = require("./assertions.cjs");
function setEnv(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

test("agent receives discovered MCP guidance and schemas and executes tools before answering", async (t) => {
  setEnv(t, "OPENAI_API_KEY", "fixture-key");
  setEnv(t, "TRIPPLANNER_EVAL_MODEL", "fixture-model");
  setEnv(t, "TRIPPLANNER_EVAL_SERVICE_TIER", "default");
  setEnv(t, "TRIPPLANNER_EVAL_URL", "http://127.0.0.1:5188");
  let turns = 0;
  const visited = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    visited.push(new URL(url).pathname);
    const reply = (value) => ({ ok: true, json: async () => value });
    if (url.endsWith("/start"))
      return reply({
        sessionId: "session",
        tripId: "trip",
        destinationCity: "paris-fr",
        before: { visits: [], activities: [] },
      });
    if (url.endsWith("/finish")) return reply({ visits: [], activities: [] });
    if (url.endsWith("/rpc")) {
      assert.equal(options.headers["X-Eval-Session"], "session");
      if (body.method === "initialize")
        return reply({ result: { instructions: "Actual server guidance" } });
      if (body.method === "tools/list")
        return reply({
          result: {
            tools: [
              {
                name: "get_planning_context",
                description: "Actual tool",
                inputSchema: { type: "object" },
              },
            ],
          },
        });
      assert.equal(body.params.name, "get_planning_context");
      return reply({
        result: {
          structuredContent: { data: { guidance: "Detailed server guidance" } },
        },
      });
    }
    assert.equal(body.instructions, "Actual server guidance");
    assert.equal(body.tools[0].description, "Actual tool");
    assert.equal(body.model, "fixture-model");
    assert.equal(body.service_tier, "default");
    assert.equal(body.store, false);
    if (++turns === 1)
      return reply({
        output: [
          {
            type: "function_call",
            name: "get_planning_context",
            arguments: '{"tripId":"trip"}',
            call_id: "call",
          },
        ],
      });
    assert.equal(body.input.at(-1).type, "function_call_output");
    return reply({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "A themed day" }],
        },
      ],
      usage: { total_tokens: 10, input_tokens: 7, output_tokens: 3 },
    });
  });
  const result = await new Provider({}).callApi("Plan this trip", {
    vars: { scenario: "known_dates" },
  });
  const output = JSON.parse(result.output);
  assert.equal(output.answer, "A themed day");
  assert.equal(output.calls[0].name, "get_planning_context");
  assert.equal(
    output.calls[0].result.structuredContent.data.guidance,
    "Detailed server guidance",
  );
  assert.equal(visited.at(-1), "/finish");
  assert.equal(
    grade(result.output, { vars: { scenario: "known_dates" } }).pass,
    true,
  );
});

test("grader rejects missing context and invented ticket certainty", () => {
  const result = grade(
    JSON.stringify({
      answer: "",
      calls: [],
      before: { visits: [], activities: [] },
      after: {
        visits: [],
        activities: [
          {
            id: "new",
            properties: {
              kinds: ["Art", "Culture"],
              ticketRequirement: "Required",
              cost: null,
            },
          },
        ],
      },
    }),
    { vars: { scenario: "save_activity" } },
  );
  assert.equal(result.pass, false);
  assert.match(result.reason, /context/);
  assert.match(result.reason, /unverified/);
});

test("provider refuses non-loopback fixture services", async (t) => {
  setEnv(t, "OPENAI_API_KEY", "fixture-key");
  setEnv(t, "TRIPPLANNER_EVAL_MODEL", "fixture-model");
  setEnv(t, "TRIPPLANNER_EVAL_SERVICE_TIER", "default");
  setEnv(t, "TRIPPLANNER_EVAL_URL", "https://example.com");
  await assert.rejects(
    new Provider({}).callApi("Plan", { vars: { scenario: "known_dates" } }),
    /loopback/,
  );
});

for (const scenario of [
  {
    name: "Luna default",
    tier: "flex",
    envTier: "",
    model: "gpt-6-luna",
    config: {},
  },
  {
    name: "Luna Standard override",
    tier: "default",
    envTier: "flex",
    model: "gpt-6-luna",
    config: { serviceTier: "default" },
  },
  {
    name: "Luna Flex",
    tier: "flex",
    envTier: "flex",
    model: "gpt-6-luna",
    config: {},
  },
  {
    name: "provider override",
    tier: "flex",
    envTier: "default",
    model: "override-model",
    config: { model: "override-model", serviceTier: "flex" },
  },
]) {
  test(`${scenario.name} sends the requested model/tier and records actual processing`, async (t) => {
    setEnv(t, "OPENAI_API_KEY", "fixture-key");
    setEnv(t, "TRIPPLANNER_EVAL_MODEL", "");
    setEnv(t, "TRIPPLANNER_EVAL_SERVICE_TIER", scenario.envTier);
    setEnv(t, "TRIPPLANNER_EVAL_URL", "http://127.0.0.1:5188");
    t.mock.method(AbortSignal, "timeout", (milliseconds) => {
      const signal = new AbortController().signal;
      signal.testTimeout = milliseconds;
      return signal;
    });
    t.mock.method(globalThis, "fetch", async (url, options) => {
      const body = JSON.parse(options.body);
      const reply = (value) => ({ ok: true, json: async () => value });
      if (url.endsWith("/start"))
        return reply({
          sessionId: "session",
          tripId: "trip",
          destinationCity: "paris-fr",
          before: { visits: [], activities: [] },
        });
      if (url.endsWith("/finish")) return reply({ visits: [], activities: [] });
      if (url.endsWith("/rpc"))
        return reply({
          result:
            body.method === "initialize"
              ? { instructions: "Server guidance" }
              : { tools: [] },
        });
      assert.equal(body.model, scenario.model);
      assert.equal(body.service_tier, scenario.tier);
      assert.equal(
        options.signal.testTimeout,
        scenario.tier === "flex" ? 600000 : 60000,
      );
      return reply({
        service_tier: scenario.tier,
        output: [
          { type: "message", content: [{ type: "output_text", text: "Done" }] },
        ],
      });
    });
    const result = await new Provider({ config: scenario.config }).callApi(
      "Plan",
      { vars: { scenario: "known_dates" } },
    );
    const output = JSON.parse(result.output);
    assert.equal(output.model, scenario.model);
    assert.deepEqual(output.processing, {
      requestedServiceTier: scenario.tier,
      servedServiceTiers: [scenario.tier],
    });
  });
}

test("Flex capacity failure closes the fixture without falling back to standard pricing", async (t) => {
  setEnv(t, "OPENAI_API_KEY", "fixture-key");
  setEnv(t, "TRIPPLANNER_EVAL_MODEL", "");
  setEnv(t, "TRIPPLANNER_EVAL_SERVICE_TIER", "flex");
  setEnv(t, "TRIPPLANNER_EVAL_URL", "http://127.0.0.1:5188");
  let modelCalls = 0;
  let finished = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    const reply = (value) => ({ ok: true, json: async () => value });
    if (url.endsWith("/start"))
      return reply({
        sessionId: "session",
        tripId: "trip",
        destinationCity: "paris-fr",
      });
    if (url.endsWith("/finish")) {
      finished = true;
      return reply({});
    }
    if (url.endsWith("/rpc"))
      return reply({
        result:
          body.method === "initialize"
            ? { instructions: "Server guidance" }
            : { tools: [] },
      });
    modelCalls++;
    assert.equal(body.service_tier, "flex");
    return {
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "Unavailable" } }),
    };
  });
  await assert.rejects(
    new Provider({}).callApi("Plan", { vars: { scenario: "known_dates" } }),
    /HTTP 429 \(requested tier: flex\)/,
  );
  assert.equal(modelCalls, 1);
  assert.equal(finished, true);
});
