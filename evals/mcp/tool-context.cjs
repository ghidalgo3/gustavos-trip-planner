const { isDeepStrictEqual } = require("node:util");

// Client-side discovery labels, not additional trip-planning instructions.
const groups = [
  [
    "trips",
    "User identity, trip discovery, portable documents and trip management.",
    [
      "get_profile",
      "list_trips",
      "get_trip",
      "get_trip_document",
      "create_trip",
      "update_trip",
      "delete_trip",
    ],
  ],
  [
    "destinations",
    "Destinations, visit dates and repeat visits.",
    [
      "list_destinations",
      "add_destination",
      "update_destination",
      "update_visit",
      "delete_destination",
    ],
  ],
  [
    "activities",
    "Read, audit, geocode, add, update or delete activity ideas and their metadata.",
    [
      "list_activities",
      "get_activity",
      "geocode_address",
      "create_activity",
      "update_activity",
      "delete_activity",
    ],
  ],
  [
    "preferences",
    "Read or replace profile, trip and destination activity preferences.",
    ["get_activity_preferences", "replace_activity_preferences"],
  ],
  [
    "activity_planning",
    "Read, preview, assess, propose, review and save daily activity schedules.",
    [
      "get_activity_plan",
      "preview_activity_plan",
      "create_activity_plan_assessment",
      "get_activity_plan_assessment",
      "create_activity_plan_proposal",
      "get_activity_plan_proposal",
      "replace_activity_plan_proposal_review",
      "replace_activity_plan",
    ],
  ],
  [
    "stays_and_travel",
    "Visit accommodations and transport connections between places.",
    [
      "get_visit_stay_location",
      "replace_visit_stay_location",
      "delete_visit_stay_location",
      "get_trip_travel",
      "replace_trip_travel",
    ],
  ],
  [
    "operations",
    "Find and poll asynchronous operation progress.",
    ["list_operations", "get_operation"],
  ],
  [
    "calendars",
    "Create, list or revoke calendar subscriptions.",
    [
      "create_calendar_subscription",
      "list_calendar_subscriptions",
      "revoke_calendar_subscription",
    ],
  ],
];

function buildTools(catalog, mode) {
  const functions = catalog
    .map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "full") return functions;
  if (mode !== "deferred")
    throw new Error("toolLoading must be deferred or full.");
  const remaining = new Map(functions.map((tool) => [tool.name, tool]));
  // The server's entry point stays callable without a discovery step.
  const tools = [];
  const context = remaining.get("get_planning_context");
  if (context) {
    tools.push(context);
    remaining.delete(context.name);
  }
  for (const [name, description, names] of groups) {
    const members = names
      .filter((name) => remaining.has(name))
      .map((name) => {
        const tool = remaining.get(name);
        remaining.delete(name);
        return { ...tool, defer_loading: true };
      });
    if (members.length)
      tools.push({ type: "namespace", name, description, tools: members });
  }
  // Newly registered tools must remain discoverable before this grouping is updated.
  if (remaining.size)
    tools.push({
      type: "namespace",
      name: "other",
      description: "Additional TripPlanner operations.",
      tools: [...remaining.values()].map((tool) => ({
        ...tool,
        defer_loading: true,
      })),
    });
  tools.push({ type: "tool_search" });
  return tools;
}

function initialVisibleTools(tools) {
  return tools.map((tool) =>
    tool.type === "namespace"
      ? { type: tool.type, name: tool.name, description: tool.description }
      : tool,
  );
}

function resultForModel(result) {
  if (result.structuredContent == null || !Array.isArray(result.content))
    return result;
  const content = result.content.filter((block) => {
    if (block.type !== "text") return true;
    try {
      return !isDeepStrictEqual(
        JSON.parse(block.text),
        result.structuredContent,
      );
    } catch {
      return true;
    }
  });
  const { content: original, ...rest } = result;
  return content.length ? { ...rest, content } : rest;
}

module.exports = { buildTools, initialVisibleTools, resultForModel };
