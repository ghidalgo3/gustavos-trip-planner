const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildTools,
  initialVisibleTools,
  resultForModel,
} = require("./tool-context.cjs");
const document = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../docs/after.json"), "utf8"),
);

async function main() {
  const base = process.env.TRIPPLANNER_EVAL_URL ?? "http://127.0.0.1:5188";
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname))
    throw new Error("Eval fixtures must use a loopback URL.");
  const sessions = new Set();
  const trips = new Set();
  // Include repetitions of the same case to verify independent concurrent sessions.
  await Promise.all(
    [1, 2, 3, 4].map(async (copy) => {
      let sessionId;
      async function post(path, body) {
        const response = await fetch(base + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(sessionId ? { "X-Eval-Session": sessionId } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });
        const result = await response.json();
        assert.ok(response.ok, JSON.stringify(result));
        return result;
      }
      const fixture = await post("/start", { document });
      sessionId = fixture.sessionId;
      let id = 0;
      const rpc = async (method, params = {}) =>
        (await post("/rpc", { jsonrpc: "2.0", id: ++id, method, params }))
          .result;
      try {
        assert.ok(
          !sessions.has(sessionId),
          "Each concurrent case needs its own session.",
        );
        assert.ok(
          !trips.has(fixture.tripId),
          "Each concurrent case needs its own trip.",
        );
        sessions.add(sessionId);
        trips.add(fixture.tripId);
        const initialized = await rpc("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "Eval smoke", version: "1" },
        });
        assert.match(
          initialized.instructions.slice(0, 512),
          /get_planning_context/,
        );
        const tools = await rpc("tools/list");
        assert.ok(
          tools.tools.some((tool) => tool.name === "get_planning_context"),
        );
        const deferred = buildTools(tools.tools, "deferred");
        const functions = deferred.flatMap((tool) =>
          tool.type === "namespace"
            ? tool.tools
            : tool.type === "function"
              ? [tool]
              : [],
        );
        assert.deepEqual(
          functions.map((tool) => tool.name).sort(),
          tools.tools.map((tool) => tool.name).sort(),
        );
        for (const tool of functions) {
          assert.deepEqual(
            tool.parameters,
            tools.tools.find((original) => original.name === tool.name)
              .inputSchema,
          );
        }
        const context = await rpc("tools/call", {
          name: "get_planning_context",
          arguments: { tripId: fixture.tripId },
        });
        assert.notEqual(context.isError, true);
        if (copy === 1) {
          console.log(
            `Catalog: ${tools.tools.length} tools; full schemas ${JSON.stringify(buildTools(tools.tools, "full")).length} characters; initial discovery surface ${JSON.stringify(initialVisibleTools(deferred)).length} characters.`,
          );
          console.log(
            `Planning result: ${JSON.stringify(context).length} characters on MCP; ${JSON.stringify(resultForModel(context)).length} characters sent to the model after removing duplicate JSON.`,
          );
        }
        const data = context.structuredContent.data;
        assert.ok(data.guidance.includes("free-form"));
        assert.ok(data.guidanceVersion);
        assert.equal(data.trip.name, document.name);
        for (const kind of ["visit", "activity", "lodging", "flight"]) {
          const count = (source) =>
            source.itinerary.items.filter((item) => item.kind === kind).length;
          assert.equal(count(data.trip), count(document), kind);
        }
        const prompts = await rpc("prompts/list");
        assert.ok(
          prompts.prompts.some((prompt) => prompt.name === "plan_destination"),
        );
        const prompt = await rpc("prompts/get", {
          name: "plan_destination",
          arguments: {
            tripId: fixture.tripId,
            destinationCity: fixture.destinationCity,
          },
        });
        assert.match(JSON.stringify(prompt), /get_planning_context/);
        const visits = fixture.before.visits;
        assert.equal(visits[0].arrivalDate, "2026-12-25");
        const after = await post("/finish", {});
        sessionId = undefined;
        assert.deepEqual(after, fixture.before);
        console.log(
          `Japan copy ${copy}: MCP discovery, prompt, context and isolation passed`,
        );
      } finally {
        if (sessionId) await post("/finish", {});
      }
    }),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
