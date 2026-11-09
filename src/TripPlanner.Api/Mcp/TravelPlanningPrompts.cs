using System.ComponentModel;
using ModelContextProtocol.Server;
using TripPlanner.Api.Instructions;

namespace TripPlanner.Api.Mcp;

[McpServerPromptType]
public sealed class TravelPlanningPrompts
{
    [McpServerPrompt(Name = "plan_destination")]
    [Description(McpInstructions.Prompts.PlanDestinationDescription)]
    public static string PlanDestination(
        [Description(McpInstructions.Parameters.TripId)] string tripId,
        [Description(McpInstructions.Parameters.DestinationCity)] string destinationCity
    ) => McpInstructions.Prompts.PlanDestination(tripId, destinationCity);
}
