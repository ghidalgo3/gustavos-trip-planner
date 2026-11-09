const defaults = require("./defaults.json");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildTools,
  initialVisibleTools,
  resultForModel,
} = require("./tool-context.cjs");

// OpenAI Responses adapter for Promptfoo. Uses the actual MCP initialization, tools
// and handlers; only the user request is templated by the eval configuration.
module.exports = class TripPlannerProvider {
  constructor(options = {}) {
    this.config = options.config ?? {};
  }
  id() {
    return `tripplanner-mcp:${this.model()}:${this.serviceTier()}:${this.toolLoading()}:web-${this.webSearch()}`;
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
  toolLoading() {
    return (
      this.config.toolLoading ||
      process.env.TRIPPLANNER_EVAL_TOOL_LOADING ||
      defaults.toolLoading
    );
  }
  webSearch() {
    return this.config.webSearch ?? defaults.webSearch;
  }
  async callApi(prompt, context) {
    if (!prompt.trim())
      throw new Error(
        "Fill in vars.request in promptfooconfig.yaml before running this case.",
      );
    const conversation = context.vars.conversation ?? [];
    if (
      !Array.isArray(conversation) ||
      conversation.some(
        (message) =>
          !["user", "assistant"].includes(message?.role) ||
          typeof message.content !== "string" ||
          !message.content.trim(),
      )
    ) {
      throw new Error(
        "vars.conversation must be a list of user/assistant messages with nonempty content.",
      );
    }
    const start = context.vars.tripDocument
      ? {
          document: JSON.parse(
            fs.readFileSync(
              path.resolve(__dirname, context.vars.tripDocument),
              "utf8",
            ),
          ),
        }
      : { scenario: context.vars.scenario };
    const model = this.model();
    const serviceTier = this.serviceTier();
    const toolLoading = this.toolLoading();
    const webSearch = this.webSearch();
    if (typeof webSearch !== "boolean")
      throw new Error("webSearch must be true or false.");
    if (!["deferred", "full"].includes(toolLoading))
      throw new Error("toolLoading must be deferred or full.");
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
    const fixture = await bridge("/start", start);
    sessionId = fixture.sessionId;
    let rpcId = 0;
    const rpc = async (method, params = {}) =>
      (await bridge("/rpc", { jsonrpc: "2.0", id: ++rpcId, method, params }))
        .result;
    const calls = [];
    const servedServiceTiers = new Set();
    const requests = [];
    const toolSearches = [];
    const webSearches = [];
    let after;
    try {
      const initialized = await rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "TripPlanner eval", version: "1" },
      });
      const listed = await rpc("tools/list");
      const tools = buildTools(listed.tools, toolLoading);
      if (webSearch) tools.push({ type: "web_search" });
      const catalogContext = {
        toolLoading,
        webSearchEnabled: webSearch,
        toolCount: listed.tools.length,
        fullSchemaCharacters: JSON.stringify(buildTools(listed.tools, "full"))
          .length,
        initialVisibleToolsCharacters: JSON.stringify(
          initialVisibleTools(tools),
        ).length,
      };
      let input = [
        ...conversation.map(({ role, content }) => ({ role, content })),
        {
          role: "user",
          content: `${prompt}\nTrip ID: ${fixture.tripId}. Destination city ID: ${fixture.destinationCity}.`,
        },
      ];
      let answer = "";
      let usage = {
        total: 0,
        prompt: 0,
        completion: 0,
        cached: 0,
        numRequests: 0,
      };
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
            include: [
              "reasoning.encrypted_content",
              ...(webSearch ? ["web_search_call.action.sources"] : []),
            ],
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
        usage.cached += result.usage?.input_tokens_details?.cached_tokens ?? 0;
        usage.numRequests++;
        requests.push({
          turn: turn + 1,
          inputTokens: result.usage?.input_tokens ?? 0,
          outputTokens: result.usage?.output_tokens ?? 0,
          cachedInputTokens:
            result.usage?.input_tokens_details?.cached_tokens ?? 0,
          reasoningTokens:
            result.usage?.output_tokens_details?.reasoning_tokens ?? 0,
        });
        if (result.status === "incomplete" || result.status === "failed")
          throw new Error(`Model response ${result.status}.`);
        input = [...input, ...result.output];
        webSearches.push(
          ...result.output.filter((item) => item.type === "web_search_call"),
        );
        toolSearches.push(
          ...result.output.filter(
            (item) =>
              item.type === "tool_search_call" ||
              item.type === "tool_search_output",
          ),
        );
        if (
          result.output.some(
            (item) =>
              item.type === "tool_search_call" && item.execution === "client",
          )
        )
          throw new Error(
            "Expected hosted tool search, received a client-executed search.",
          );
        const toolCalls = result.output.filter(
          (item) => item.type === "function_call",
        );
        if (!toolCalls.length) {
          answer = result.output
            .flatMap((item) => item.content ?? [])
            .filter((item) => item.type === "output_text")
            .map((item) => item.text)
            .join("\n");
          // A search-only response has not completed the user's request yet.
          if (
            !answer &&
            result.output.some(
              (item) =>
                item.type === "tool_search_output" ||
                item.type === "web_search_call",
            )
          )
            continue;
          if (!answer)
            throw new Error(
              "Model response contained neither a final answer nor executable tool calls.",
            );
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
              webSearches,
              citations: result.output
                .flatMap((item) => item.content ?? [])
                .flatMap((content) => content.annotations ?? [])
                .filter((annotation) => annotation.type === "url_citation"),
              contextUsage: { ...catalogContext, requests, toolSearches },
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
            resultCharacters: JSON.stringify(output).length,
            modelResultCharacters: JSON.stringify(resultForModel(output))
              .length,
          });
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(resultForModel(output)),
          });
        }
      }
      throw new Error("Agent exceeded 16 model turns.");
    } finally {
      if (sessionId) await bridge("/finish", {});
    }
  }
};
