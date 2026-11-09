const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTools,
  initialVisibleTools,
  resultForModel,
} = require("./tool-context.cjs");

test("discovery keeps planning context ready and every other real tool available with unchanged validation", () => {
  const catalog = [
    "get_planning_context",
    "create_activity",
    "replace_activity_plan",
    "a_future_tool",
  ].map((name) => ({
    name,
    description: name + " guidance",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
    },
  }));
  const tools = buildTools(catalog, "deferred");
  assert.equal(tools[0].name, "get_planning_context");
  assert.equal(tools[0].defer_loading, undefined);
  assert.ok(tools.some((tool) => tool.type === "tool_search"));
  const functions = tools.flatMap((tool) =>
    tool.type === "namespace"
      ? tool.tools
      : tool.type === "function"
        ? [tool]
        : [],
  );
  assert.deepEqual(
    functions.map((tool) => tool.name).sort(),
    catalog.map((tool) => tool.name).sort(),
  );
  for (const tool of functions) {
    assert.deepEqual(
      tool.parameters,
      catalog.find((t) => t.name === tool.name).inputSchema,
    );
    assert.equal(
      tool.description,
      catalog.find((t) => t.name === tool.name).description,
    );
    if (tool.name !== "get_planning_context")
      assert.equal(tool.defer_loading, true);
  }
  const visible = JSON.stringify(initialVisibleTools(tools));
  assert.ok(!visible.includes("a_future_tool"));
  assert.ok(!visible.includes("create_activity guidance"));
  assert.ok(visible.includes("get_planning_context guidance"));
  const full = buildTools(catalog, "full");
  assert.equal(full.length, catalog.length);
  assert.ok(
    full.every((tool) => tool.type === "function" && !tool.defer_loading),
  );
});

for (const [name, result, expected] of [
  [
    "duplicate JSON with reordered keys",
    {
      isError: false,
      structuredContent: { status: 200, data: { name: "Tokyo" } },
      content: [
        { type: "text", text: '{"data":{"name":"Tokyo"},"status":200}' },
      ],
    },
    {
      isError: false,
      structuredContent: { status: 200, data: { name: "Tokyo" } },
    },
  ],
  [
    "extra explanatory content",
    {
      structuredContent: { status: 200 },
      content: [
        { type: "text", text: '{"status":200}' },
        { type: "text", text: "Check the source before saving." },
      ],
    },
    {
      structuredContent: { status: 200 },
      content: [{ type: "text", text: "Check the source before saving." }],
    },
  ],
  [
    "text-only result",
    { content: [{ type: "text", text: "No structured data" }] },
    { content: [{ type: "text", text: "No structured data" }] },
  ],
  [
    "image and distinct JSON",
    {
      isError: true,
      structuredContent: { status: 400 },
      content: [
        { type: "image", data: "image", mimeType: "image/png" },
        { type: "text", text: '{"message":"Choose a location"}' },
      ],
    },
    {
      isError: true,
      structuredContent: { status: 400 },
      content: [
        { type: "image", data: "image", mimeType: "image/png" },
        { type: "text", text: '{"message":"Choose a location"}' },
      ],
    },
  ],
]) {
  test(`model result preserves information for ${name}`, () => {
    const before = JSON.stringify(result);
    assert.deepEqual(resultForModel(result), expected);
    assert.equal(
      JSON.stringify(result),
      before,
      "The recorded MCP response must remain intact.",
    );
  });
}
