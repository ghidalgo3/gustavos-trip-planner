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

test("agent web research works independently of MCP and retains sources and citations", async (t) => {
  setEnv(t, "OPENAI_API_KEY", "fixture-key");
  setEnv(t, "TRIPPLANNER_EVAL_URL", "http://127.0.0.1:5188");
  let turns = 0;
  let finished = 0;
  const search = {
    type: "web_search_call",
    id: "web-1",
    status: "completed",
    action: {
      type: "search",
      query: "vegan Shibuya",
      sources: [{ type: "url", url: "https://venue.example/menu" }],
    },
  };
  const citation = {
    type: "url_citation",
    url: "https://venue.example/menu",
    title: "Venue menu",
    start_index: 0,
    end_index: 5,
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    const reply = (value) => ({ ok: true, json: async () => value });
    if (url.endsWith("/start"))
      return reply({
        sessionId: "session",
        tripId: "trip",
        destinationCity: "tokyo-jp",
        before: {},
      });
    if (url.endsWith("/finish")) {
      finished++;
      return reply({});
    }
    if (url.endsWith("/rpc")) {
      if (body.method === "initialize")
        return reply({ result: { instructions: "Actual server guidance" } });
      if (body.method === "tools/list")
        return reply({
          result: {
            tools: [
              {
                name: "get_planning_context",
                description: "Research venues",
                inputSchema: { type: "object" },
              },
            ],
          },
        });
      return reply({
        result: {
          isError: true,
          structuredContent: { status: 200, data: {trip: "Japan"} },
        },
      });
    }
    assert.ok(body.tools.some((tool) => tool.type === "web_search"));
    assert.ok(body.include.includes("web_search_call.action.sources"));
    turns++;
    if (turns === 1)
      return reply({
        output: [
          {
            type: "function_call",
            name: "get_planning_context",
            namespace: "planning",
            call_id: "research",
            arguments: '{"tripId":"trip"}',
          },
        ],
      });
    if (turns === 2) {
      assert.equal(
        JSON.parse(body.input.at(-1).output).structuredContent.status,
        200,
      );
      return reply({ output: [search] });
    }
    assert.ok(body.input.some((item) => item.type === "web_search_call"));
    return reply({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Named venues with sources",
              annotations: [citation],
            },
          ],
        },
      ],
    });
  });
  const response = await new Provider({}).callApi("Research a vegan day", {
    vars: { scenario: "known_dates" },
  });
  const output = JSON.parse(response.output);
  assert.equal(turns, 3);
  assert.equal(finished, 1);
  assert.equal(output.calls[0].isError, true);
  assert.deepEqual(output.webSearches, [search]);
  assert.deepEqual(output.citations, [citation]);
  assert.equal(output.contextUsage.webSearchEnabled, true);
  assert.equal(output.answer, "Named venues with sources");
});

test("hosted discovery executes namespaced MCP tools, deduplicates context, and accounts for every model request", async (t) => {
  setEnv(t, "OPENAI_API_KEY", "fixture-key");
  setEnv(t, "TRIPPLANNER_EVAL_URL", "http://127.0.0.1:5188");
  let turn = 0;
  const payload = {
    status: 200,
    data: { tripId: "trip", activities: [] },
    etag: "current",
  };
  const raw = {
    isError: false,
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
  const observed = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    const reply = (value) => ({ ok: true, json: async () => value });
    if (url.endsWith("/start"))
      return reply({
        sessionId: "session",
        tripId: "trip",
        destinationCity: "tokyo-jp",
        before: { activities: [] },
      });
    if (url.endsWith("/finish")) return reply({ activities: [] });
    if (url.endsWith("/rpc")) {
      if (body.method === "initialize")
        return reply({ result: { instructions: "Actual server guidance" } });
      if (body.method === "tools/list")
        return reply({
          result: {
            tools: ["get_planning_context", "create_activity"].map((name) => ({
              name,
              description: "Server guidance for " + name,
              inputSchema: { type: "object" },
            })),
          },
        });
      observed.push(body.params.name);
      return reply({ result: raw });
    }
    turn++;
    assert.ok(body.tools.some((tool) => tool.type === "tool_search"));
    assert.equal(body.tools[0].name, "get_planning_context");
    const group = body.tools.find((tool) => tool.name === "activities");
    assert.equal(group.tools[0].defer_loading, true);
    if (turn === 1)
      return reply({
        output: [
          {
            type: "function_call",
            name: "get_planning_context",
            call_id: "read",
            arguments: '{"tripId":"trip"}',
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          total_tokens: 110,
          input_tokens_details: { cached_tokens: 20 },
        },
      });
    if (turn === 2) {
      assert.deepEqual(JSON.parse(body.input.at(-1).output), {
        isError: false,
        structuredContent: payload,
      });
      return reply({
        output: [
          {
            type: "tool_search_call",
            execution: "server",
            arguments: { paths: ["activities"] },
          },
          { type: "tool_search_output", execution: "server", tools: [group] },
          {
            type: "function_call",
            namespace: "activities",
            name: "create_activity",
            call_id: "write",
            arguments: '{"tripId":"trip"}',
          },
        ],
        usage: {
          input_tokens: 200,
          output_tokens: 20,
          total_tokens: 220,
          input_tokens_details: { cached_tokens: 50 },
        },
      });
    }
    assert.ok(
      body.input.some((item) => item.type === "tool_search_output"),
      "Search history must be replayed so loaded schemas stay callable.",
    );
    assert.equal(body.input.at(-1).call_id, "write");
    return reply({
      output: [
        { type: "message", content: [{ type: "output_text", text: "Done" }] },
      ],
      usage: {
        input_tokens: 300,
        output_tokens: 30,
        total_tokens: 330,
        output_tokens_details: { reasoning_tokens: 5 },
      },
    });
  });
  const result = await new Provider({
    config: { toolLoading: "deferred" },
  }).callApi("Save an activity", { vars: { scenario: "known_dates" } });
  const output = JSON.parse(result.output);
  assert.deepEqual(observed, ["get_planning_context", "create_activity"]);
  assert.deepEqual(output.calls[0].result, raw);
  assert.ok(
    output.calls[0].modelResultCharacters < output.calls[0].resultCharacters,
  );
  assert.equal(output.contextUsage.toolSearches.length, 2);
  assert.equal(output.contextUsage.requests.length, 3);
  assert.equal(output.contextUsage.requests[2].reasoningTokens, 5);
  assert.deepEqual(result.tokenUsage, {
    total: 660,
    prompt: 600,
    completion: 60,
    cached: 70,
    numRequests: 3,
  });
});

test("full-catalog mode supports models or clients without tool search", async (t) => {
  setEnv(t, "OPENAI_API_KEY", "fixture-key");
  setEnv(t, "TRIPPLANNER_EVAL_URL", "http://127.0.0.1:5188");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    const reply = (value) => ({ ok: true, json: async () => value });
    if (url.endsWith("/start"))
      return reply({
        sessionId: "session",
        tripId: "trip",
        destinationCity: "tokyo-jp",
        before: {},
      });
    if (url.endsWith("/finish")) return reply({});
    if (url.endsWith("/rpc"))
      return reply({
        result:
          body.method === "initialize"
            ? { instructions: "Server" }
            : {
                tools: [
                  {
                    name: "create_activity",
                    description: "Actual tool",
                    inputSchema: { type: "object" },
                  },
                ],
              },
      });
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].type, "function");
    assert.equal(body.tools[0].defer_loading, undefined);
    assert.ok(!body.include.includes("web_search_call.action.sources"));
    return reply({
      output: [
        { type: "message", content: [{ type: "output_text", text: "Done" }] },
      ],
    });
  });
  const result = await new Provider({
    config: { toolLoading: "full", webSearch: false },
  }).callApi("Request", { vars: { scenario: "known_dates" } });
  assert.equal(JSON.parse(result.output).contextUsage.toolLoading, "full");
  assert.equal(JSON.parse(result.output).contextUsage.webSearchEnabled, false);
});

for (const scenario of [
  {
    name: "search-only response",
    first: {
      output: [
        { type: "tool_search_call", execution: "server" },
        { type: "tool_search_output", execution: "server", tools: [] },
      ],
    },
    turns: 2,
  },
  {
    name: "incomplete answer",
    first: {
      status: "incomplete",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Partial answer" }],
        },
      ],
    },
    error: /response incomplete/,
  },
  {
    name: "empty answer",
    first: { output: [] },
    error: /neither a final answer/,
  },
]) {
  test(`${scenario.name} is not mistaken for completed work`, async (t) => {
    setEnv(t, "OPENAI_API_KEY", "fixture-key");
    setEnv(t, "TRIPPLANNER_EVAL_URL", "http://127.0.0.1:5188");
    let turns = 0;
    let finished = 0;
    t.mock.method(globalThis, "fetch", async (url, options) => {
      const body = JSON.parse(options.body);
      const reply = (value) => ({ ok: true, json: async () => value });
      if (url.endsWith("/start"))
        return reply({ sessionId: "session", tripId: "trip", before: {} });
      if (url.endsWith("/finish")) {
        finished++;
        return reply({});
      }
      if (url.endsWith("/rpc"))
        return reply({
          result:
            body.method === "initialize"
              ? { instructions: "Server" }
              : { tools: [] },
        });
      return reply(
        ++turns === 1
          ? scenario.first
          : {
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "Complete answer" }],
                },
              ],
            },
      );
    });
    const run = new Provider({}).callApi("Request", {
      vars: { scenario: "known_dates" },
    });
    if (scenario.error) await assert.rejects(run, scenario.error);
    else {
      const result = await run;
      assert.equal(JSON.parse(result.output).answer, "Complete answer");
      assert.equal(turns, scenario.turns);
    }
    assert.equal(finished, 1);
  });
}

test("Japan cases load the starting document, preserve conversation order, and hide expected outcomes", async (t) => {
  setEnv(t, "OPENAI_API_KEY", "fixture-key");
  setEnv(t, "TRIPPLANNER_EVAL_URL", "http://127.0.0.1:5188");
  const conversation = [
    { role: "user", content: "Earlier request" },
    { role: "assistant", content: "Earlier reply" },
  ];
  let modelCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    const reply = (value) => ({ ok: true, json: async () => value });
    if (url.endsWith("/start")) {
      assert.equal(body.document.name, "Japan December 2026");
      assert.equal(
        body.document.itinerary.items.filter((i) => i.kind === "activity")
          .length,
        76,
      );
      assert.equal(body.scenario, undefined);
      return reply({
        sessionId: "session",
        tripId: "fresh-trip",
        destinationCity: "tokyo-jp",
        before: {},
      });
    }
    if (url.endsWith("/rpc"))
      return reply({
        result:
          body.method === "initialize"
            ? { instructions: "Server guidance" }
            : { tools: [] },
      });
    if (url.endsWith("/finish")) return reply({});
    modelCalls++;
    assert.deepEqual(body.input.slice(0, 2), conversation);
    assert.match(body.input[2].content, /^Next request\nTrip ID: fresh-trip/);
    assert.ok(!options.body.includes("PRIVATE REVIEW NOTES"));
    return reply({
      output: [
        { type: "message", content: [{ type: "output_text", text: "Done" }] },
      ],
    });
  });
  await new Provider({}).callApi("Next request", {
    vars: {
      tripDocument: "../../docs/after.json",
      conversation,
      expectedOutcome: "PRIVATE REVIEW NOTES",
    },
  });
  assert.equal(modelCalls, 1);
});

for (const [name, prompt, conversation] of [
  ["blank request", "  ", []],
  [
    "invalid conversation role",
    "Request",
    [{ role: "system", content: "Instructions" }],
  ],
  ["blank conversation content", "Request", [{ role: "user", content: "" }]],
]) {
  test(`${name} is rejected before fixture or model calls`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      throw new Error("Unexpected API call");
    });
    await assert.rejects(
      new Provider({}).callApi(prompt, { vars: { conversation } }),
      /Fill in vars.request|vars.conversation/,
    );
    assert.equal(calls, 0);
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
