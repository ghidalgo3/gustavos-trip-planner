using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Instructions;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;

namespace TripPlanner.Api.Mcp;

[McpServerToolType]
public sealed class PlanningContextTools(
    McpExecutionAdapter adapter,
    IPlannerDb database,
    ICurrentUser currentUser,
    TripReader reader,
    TripResourceProjection projection
)
{
    [McpServerTool(
        Name = "get_planning_context",
        ReadOnly = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta(
        "securitySchemes",
        JsonValue = "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.read\"]}]"
    )]
    [Description(McpInstructions.Tools.GetPlanningContext)]
    public Task<CallToolResult> GetPlanningContext(Guid tripId) =>
        adapter.ExecuteAsync(
            false,
            async context =>
            {
                var (_, user, error) = await PlanningEndpointHelpers.AuthorizeAsync(
                    tripId,
                    false,
                    context,
                    database,
                    currentUser
                );
                if (error is not null)
                {
                    return error;
                }
                var data = await reader.ReadAsync(user!.Id, tripId, context.RequestAborted);
                if (data is null)
                {
                    return Results.NotFound();
                }
                if (data.Parties.Length > 1)
                {
                    return Results.Conflict(
                        new
                        {
                            code = "multiple_parties_unsupported",
                            title = McpInstructions.Messages.ConsolidatePartiesBeforePlanning,
                        }
                    );
                }
                var profile = await database.GetActivityPreferencesAsync(
                    user.Id,
                    "profile",
                    cancellationToken: context.RequestAborted
                );
                context.Response.Headers.CacheControl = "private, no-store";
                return Results.Ok(
                    new PlanningContextResponse(
                        McpInstructions.Planning.Version,
                        McpInstructions.Planning.Instructions,
                        Enum.GetNames<ActivityKind>(),
                        McpInstructions.Planning.PreferencePrecedence,
                        projection.Project(data).Document,
                        profile.Preferences,
                        data.TripPreferences.Preferences,
                        data.DestinationPreferences.OrderBy(pair => pair.Key)
                            .Select(pair => new DestinationPlanningPreferences(
                                pair.Key,
                                pair.Value.Preferences
                            ))
                            .ToArray()
                    )
                );
            }
        );
}
