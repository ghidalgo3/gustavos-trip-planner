const defaults = require("./defaults.json");

// OpenAI Responses adapter for Promptfoo. Uses the actual MCP initialization, tools
// and handlers; only the user request is templated by the eval configuration.
module.exports = class TripPlannerProvider {
  constructor(options = {}) {
    this.config = options.config ?? {};
  }
  id() {
    return `tripplanner-mcp:${this.model()}:${this.serviceTier()}`;
  }
  model() {
    return (
      this.config.model || process.env.TRIPPLANNER_EVAL_MODEL || defaults.model
    );
  }
  serviceTier() {
    return (
      this.config.serviceTier ||
      process.env.TRIPPLANNER_EVAL_SERVICE_TIER ||
      defaults.serviceTier
    );
  }
  async callApi(prompt, context) {
    const model = this.model();
    const serviceTier = this.serviceTier();
    if (!["default", "flex"].includes(serviceTier))
      throw new Error(
        "This agent loop supports serviceTier default or flex; Batch needs a separate asynchronous scheduler.",
      );
    if (!process.env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY.");
    const modelTimeout = serviceTier === "flex" ? 600000 : 60000;
    const base = process.env.TRIPPLANNER_EVAL_URL ?? "http://127.0.0.1:5188";
    const target = new URL(base);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
      throw new Error("Eval fixtures must use a loopback URL.");
    let sessionId;
    async function bridge(path, value) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionId ? { "X-Eval-Session": sessionId } : {}),
        },
        body: JSON.stringify(value),
        signal: AbortSignal.timeout(60000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? `Fixture HTTP ${response.status}`);
      return result;
    }
    const fixture = await bridge("/start", { scenario: context.vars.scenario });
    sessionId = fixture.sessionId;
    let rpcId = 0;
    const rpc = async (method, params = {}) =>
      (await bridge("/rpc", { jsonrpc: "2.0", id: ++rpcId, method, params }))
        .result;
    const calls = [];
    const servedServiceTiers = new Set();
    let after;
    try {
      const initialized = await rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "TripPlanner eval", version: "1" },
      });
      const listed = await rpc("tools/list");
      const tools = listed.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        strict: false,
      }));
      let input = [
        {
          role: "user",
          content: `${prompt}\nTrip ID: ${fixture.tripId}. Destination city ID: ${fixture.destinationCity}.`,
        },
      ];
      let answer = "";
      let usage = { total: 0, prompt: 0, completion: 0 };
      for (let turn = 0; turn < 16; turn++) {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            service_tier: serviceTier,
            store: false,
            include: ["reasoning.encrypted_content"],
            instructions: initialized.instructions,
            input,
            tools,
            parallel_tool_calls: false,
          }),
          signal: AbortSignal.timeout(modelTimeout),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            `Model request failed: HTTP ${response.status} (requested tier: ${serviceTier}).`,
          );
        if (typeof result.service_tier === "string")
          servedServiceTiers.add(result.service_tier);
        usage.prompt += result.usage?.input_tokens ?? 0;
        usage.completion += result.usage?.output_tokens ?? 0;
        usage.total += result.usage?.total_tokens ?? 0;
        input = [...input, ...result.output];
        const toolCalls = result.output.filter(
          (item) => item.type === "function_call",
        );
        if (!toolCalls.length) {
          answer = result.output
            .flatMap((item) => item.content ?? [])
            .filter((item) => item.type === "output_text")
            .map((item) => item.text)
            .join("\n");
          after = await bridge("/finish", {});
          sessionId = undefined;
          return {
            output: JSON.stringify({
              answer,
              model,
              processing: {
                requestedServiceTier: serviceTier,
                servedServiceTiers: [...servedServiceTiers],
              },
              calls,
              before: fixture.before,
              after,
            }),
            tokenUsage: usage,
          };
        }
        for (const call of toolCalls) {
          const args = JSON.parse(call.arguments);
          const output = await rpc("tools/call", {
            name: call.name,
            arguments: args,
          });
          calls.push({
            name: call.name,
            arguments: args,
            isError: output.isError === true,
            result: output,
          });
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(output),
          });
        }
      }
      throw new Error("Agent exceeded 16 model turns.");
    } finally {
      if (sessionId) await bridge("/finish", {});
    }
  }
};
