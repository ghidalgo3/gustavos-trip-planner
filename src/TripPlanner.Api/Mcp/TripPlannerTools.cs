using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using OpenIddict.Abstractions;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Mcp;

[McpServerToolType]
public sealed class TripPlannerTools(
    IHttpContextAccessor contexts,
    IPlannerDb database,
    ICurrentUser currentUser,
    DestinationService destinations,
    IOptions<McpOptions> options
)
{
    private const string ReadSecurity = "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.read\"]}]";
    private const string WriteSecurity =
        "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.write\"]}]";

    [McpServerTool(Name = "get_profile", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "Get the connected TripPlanner user's stable ID and display name. Use this to identify the account in use."
    )]
    public Task<CallToolResult> GetProfile() =>
        Execute(
            false,
            async context =>
            {
                var user = await database.GetUserAsync(
                    Guid.Parse(context.User.GetClaim(OpenIddictConstants.Claims.Subject)!),
                    context.RequestAborted
                );
                return Results.Ok(new { id = user!.Id, name = user.DisplayName });
            }
        );

    [McpServerTool(Name = "list_trips", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "List trips visible to the connected user, including trips shared with them. Use these IDs in later calls."
    )]
    public Task<CallToolResult> ListTrips() =>
        Execute(false, context => TripsEndpoints.ListTrips(null, context, database, currentUser));

    [McpServerTool(Name = "get_trip", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description("Read one visible trip before changing it. Returns the complete trip resource.")]
    public Task<CallToolResult> GetTrip(Guid tripId) =>
        Execute(
            false,
            context => TripsEndpoints.GetTrip(null, tripId, context, database, currentUser)
        );

    [McpServerTool(Name = "create_trip", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Create a trip owned by the connected user. Supply the entire trip request. Creates an Activity Log entry."
    )]
    public Task<CallToolResult> CreateTrip(CreateTripRequest request) =>
        Execute(
            true,
            context => TripsEndpoints.CreateTrip(null, request, context, database, currentUser)
        );

    [McpServerTool(
        Name = "update_trip",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Replace a trip's name, description and constraints. Read the trip first and preserve fields the user did not ask to change. Requires planning permission."
    )]
    public Task<CallToolResult> UpdateTrip(Guid tripId, UpdateTripRequest request) =>
        Execute(
            true,
            context =>
                TripsEndpoints.UpdateTrip(null, tripId, request, context, database, currentUser)
        );

    [McpServerTool(
        Name = "delete_trip",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Delete a trip and all its destinations, activities and plans. Only the owner can delete. Use only when the user explicitly requests deletion."
    )]
    public Task<CallToolResult> DeleteTrip(Guid tripId) =>
        Execute(
            true,
            context => TripsEndpoints.DeleteTrip(null, tripId, context, database, currentUser)
        );

    [McpServerTool(Name = "list_destinations", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "List trip destinations, visits, date ranges, coordinates, route order and contextVersion. Get contextVersion before activity writes."
    )]
    public Task<CallToolResult> ListDestinations(Guid tripId) =>
        Execute(
            false,
            context =>
                DestinationsEndpoints.GetDestinations(
                    tripId,
                    true,
                    context,
                    database,
                    destinations,
                    currentUser
                )
        );

    [McpServerTool(
        Name = "add_destination",
        ReadOnly = false,
        Destructive = false,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Add a destination visit using a complete GeoJSON city Feature, verified longitude/latitude, country and optional dates. Requires planning permission."
    )]
    public Task<CallToolResult> AddDestination(Guid tripId, CreateDestinationRequest request) =>
        Execute(
            true,
            context =>
                DestinationsEndpoints.AddDestination(
                    tripId,
                    request,
                    context,
                    database,
                    destinations,
                    currentUser
                )
        );

    [McpServerTool(
        Name = "update_destination",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Replace a destination's complete city Feature and constraints. Read list_destinations first; preserve unrelated fields. Does not change visit dates."
    )]
    public Task<CallToolResult> UpdateDestination(
        Guid tripId,
        string destinationId,
        ReplaceDestinationRequest request
    ) =>
        Execute(
            true,
            context =>
                DestinationsEndpoints.ReplaceDestination(
                    tripId,
                    destinationId,
                    request,
                    context,
                    database,
                    destinations,
                    currentUser
                )
        );

    [McpServerTool(
        Name = "delete_destination",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Delete a destination, all its visits and activities. Use only when explicitly requested. Requires planning permission."
    )]
    public Task<CallToolResult> DeleteDestination(Guid tripId, string destinationId) =>
        Execute(
            true,
            context =>
                DestinationsEndpoints.DeleteDestination(
                    tripId,
                    destinationId,
                    context,
                    database,
                    currentUser
                )
        );

    [McpServerTool(
        Name = "update_visit",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Replace a destination visit's complete arrival/departure date range. Get destination and stay IDs from list_destinations."
    )]
    public Task<CallToolResult> UpdateVisit(
        Guid tripId,
        string destinationId,
        Guid stayId,
        DestinationStayInput request
    ) =>
        Execute(
            true,
            context =>
                DestinationsEndpoints.ReplaceDestinationStay(
                    tripId,
                    destinationId,
                    stayId,
                    request,
                    context,
                    database,
                    destinations,
                    currentUser
                )
        );

    [McpServerTool(Name = "list_activities", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(
        "List activities for a destination. Use get_activity to obtain an ETag before replacing or deleting an activity."
    )]
    public Task<CallToolResult> ListActivities(Guid tripId, string destinationId) =>
        Execute(
            false,
            context =>
                ActivityEndpoints.GetActivities(
                    tripId,
                    destinationId,
                    context,
                    database,
                    destinations,
                    currentUser
                )
        );

    [McpServerTool(Name = "get_activity", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description("Read an activity's complete Feature and ETag for a later update or delete.")]
    public Task<CallToolResult> GetActivity(Guid tripId, string destinationId, Guid activityId) =>
        Execute(
            false,
            context =>
                ActivityEndpoints.GetActivity(
                    tripId,
                    destinationId,
                    activityId,
                    context,
                    database,
                    destinations,
                    currentUser
                )
        );

    [McpServerTool(
        Name = "create_activity",
        ReadOnly = false,
        Destructive = false,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Create an activity with its complete GeoJSON Feature. Supply contextVersion from list_destinations. Returns ETag. Requires planning permission."
    )]
    public Task<CallToolResult> CreateActivity(
        Guid tripId,
        string destinationId,
        ActivityInput request,
        string contextVersion
    ) =>
        Execute(
            true,
            context =>
                ActivityEndpoints.CreateActivity(
                    tripId,
                    destinationId,
                    request,
                    context,
                    database,
                    destinations,
                    currentUser
                ),
            contextVersion
        );

    [McpServerTool(
        Name = "update_activity",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Replace the complete activity Feature. Preserve unrelated fields. Supply ETag from get_activity and contextVersion from list_destinations. A 412 or 409 means read again before retrying."
    )]
    public Task<CallToolResult> UpdateActivity(
        Guid tripId,
        string destinationId,
        Guid activityId,
        ActivityInput request,
        string contextVersion,
        string etag
    ) =>
        Execute(
            true,
            context =>
                ActivityEndpoints.ReplaceActivity(
                    tripId,
                    destinationId,
                    activityId,
                    request,
                    context,
                    database,
                    destinations,
                    currentUser
                ),
            contextVersion,
            etag
        );

    [McpServerTool(
        Name = "delete_activity",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Delete an activity only when requested. Supply ETag from get_activity and contextVersion from list_destinations. Requires planning permission."
    )]
    public Task<CallToolResult> DeleteActivity(
        Guid tripId,
        string destinationId,
        Guid activityId,
        string contextVersion,
        string etag
    ) =>
        Execute(
            true,
            context =>
                ActivityEndpoints.DeleteActivity(
                    tripId,
                    destinationId,
                    activityId,
                    context,
                    database,
                    destinations,
                    currentUser
                ),
            contextVersion,
            etag
        );

    private async Task<CallToolResult> Execute(
        bool write,
        Func<HttpContext, Task<IResult>> action,
        string? contextVersion = null,
        string? etag = null
    )
    {
        var original =
            contexts.HttpContext
            ?? throw new InvalidOperationException("MCP requires an HTTP request.");
        if (
            !original.User.HasScope(
                write ? McpServiceExtensions.WriteScope : McpServiceExtensions.ReadScope
            ) && (write || !original.User.HasScope(McpServiceExtensions.WriteScope))
        )
            return new()
            {
                IsError = true,
                Content =
                [
                    new TextContentBlock
                    {
                        Text = "Insufficient scope. Reconnect with the required permission.",
                    },
                ],
                Meta = new JsonObject
                {
                    ["mcp/www_authenticate"] = new JsonArray(
                        $"Bearer error=\"insufficient_scope\", scope=\"{(write ? McpServiceExtensions.WriteScope : McpServiceExtensions.ReadScope)}\", resource_metadata=\"{new Uri(new Uri(options.Value.Issuer!), "/.well-known/oauth-protected-resource/mcp")}\""
                    ),
                },
            };
        if (
            !Guid.TryParse(
                original.User.GetClaim(OpenIddictConstants.Claims.Subject),
                out var userId
            )
            || await database.GetUserAsync(userId, original.RequestAborted)
                is not { HomeCityLocation: not null } user
            || !string.Equals(
                user.Email,
                currentUser.Profile?.Email,
                StringComparison.OrdinalIgnoreCase
            )
        )
            return new()
            {
                IsError = true,
                Content =
                [
                    new TextContentBlock
                    {
                        Text = "Complete your TripPlanner profile and reconnect this account.",
                    },
                ],
            };
        var context = new DefaultHttpContext
        {
            RequestServices = original.RequestServices,
            User = original.User,
            RequestAborted = original.RequestAborted,
        };
        context.Request.Headers["Destination-Context"] = contextVersion;
        context.Request.Headers.IfMatch = etag;
        await using var responseBody = new MemoryStream();
        context.Response.Body = responseBody;
        var result = await action(context);
        // Forbid results from shared handlers must be MCP errors, not cookie-login redirects.
        if (result is ForbidHttpResult)
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
        else
            await result.ExecuteAsync(context);
        context.Response.Body.Position = 0;
        using var reader = new StreamReader(context.Response.Body);
        string json = await reader.ReadToEndAsync(original.RequestAborted);
        var output = new JsonObject
        {
            ["status"] = context.Response.StatusCode,
            ["data"] = json.Length == 0 ? null : JsonNode.Parse(json),
            ["etag"] = context.Response.Headers.ETag.FirstOrDefault(),
        };
        return new()
        {
            IsError = context.Response.StatusCode >= 400,
            StructuredContent = JsonSerializer.SerializeToElement(output),
            Content = [new TextContentBlock { Text = output.ToJsonString() }],
        };
    }
}
