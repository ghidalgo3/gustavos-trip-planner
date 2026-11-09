const assert = require("node:assert/strict");

async function main() {
  const base = process.env.TRIPPLANNER_EVAL_URL ?? "http://127.0.0.1:5188";
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname))
    throw new Error("Eval fixtures must use a loopback URL.");
  const sessions = new Set();
  const trips = new Set();
  // Include repetitions of the same case to verify independent concurrent sessions.
  await Promise.all(
    ["known_dates", "missing_dates", "known_dates", "missing_dates"].map(
      async (scenario) => {
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
        const fixture = await post("/start", { scenario });
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
          const context = await rpc("tools/call", {
            name: "get_planning_context",
            arguments: { tripId: fixture.tripId },
          });
          assert.notEqual(context.isError, true);
          const data = context.structuredContent.data;
          assert.ok(data.activityKinds.includes("Art"));
          assert.ok(data.guidanceVersion);
          assert.match(
            data.profilePreferences.instructions,
            /quiet afternoons/,
          );
          const prompts = await rpc("prompts/list");
          assert.ok(
            prompts.prompts.some(
              (prompt) => prompt.name === "plan_destination",
            ),
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
          assert.equal(
            visits[0].arrivalDate,
            scenario === "known_dates" ? "2027-06-10" : null,
          );
          const after = await post("/finish", {});
          sessionId = undefined;
          assert.deepEqual(after, fixture.before);
          console.log(
            `${scenario}: MCP discovery, prompt, context and isolation passed`,
          );
        } finally {
          if (sessionId) await post("/finish", {});
        }
      },
    ),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
