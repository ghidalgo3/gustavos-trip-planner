using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
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
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.Destinations;

namespace TripPlanner.Api.Mcp;

[McpServerToolType]
public sealed class TripPlannerTools(
    McpExecutionAdapter adapter,
    IPlannerDb database,
    ICurrentUser currentUser,
    DestinationService destinations,
    IActivityCoordinateResearch coordinateResearch,
    IActivityDetailsResearch detailsResearch,
    IStayAddressResearch stayAddressResearch
)
{
    private const string ReadSecurity = "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.read\"]}]";
    private const string WriteSecurity =
        "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.write\"]}]";

    [McpServerTool(
        Name = "create_stay_address_proposal",
        ReadOnly = false,
        Destructive = false,
        Idempotent = false,
        OpenWorld = true
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Search for up to five matching accommodations using OpenAI web search, then geocode their sourced street addresses. Requires planning permission and LLM. Preview only: let the user choose a result and show its source, address, warning and map. Unknown coordinates stay null. Does not save or change the stay."
    )]
    public Task<CallToolResult> CreateStayAddressProposal(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
        StayAddressSearchRequest request
    ) =>
        Execute(
            true,
            context =>
                DestinationsEndpoints.CreateStayAddressProposal(
                    tripId,
                    destinationId,
                    request,
                    context,
                    database,
                    currentUser,
                    destinations,
                    stayAddressResearch
                )
        );

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
        "Add a destination visit using a complete GeoJSON city Feature, verified longitude/latitude, country and optional dates. The server automatically derives the city's timezone from its coordinates; omit timeZone and do not ask the user for it. Visits may share an arrival/departure day but cannot overlap inside another visit. Requires planning permission."
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
        "Replace a destination's complete city Feature and constraints. Read list_destinations first; preserve unrelated fields. A missing timezone is derived automatically from the city coordinates; do not ask the user for it. Does not change visit dates."
    )]
    public Task<CallToolResult> UpdateDestination(
        Guid tripId,
        [
            Required,
            StringLength(200),
            Description(
                "Opaque destination ID returned by list_destinations; do not construct one."
            )
        ]
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
    public Task<CallToolResult> DeleteDestination(
        Guid tripId,
        [Required, StringLength(200)] string destinationId
    ) =>
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
        "Replace a destination visit's complete arrival/departure date range. Visits may share an arrival/departure day but cannot overlap inside another visit, including repeat visits. Get destination and stay IDs from list_destinations."
    )]
    public Task<CallToolResult> UpdateVisit(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
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
    public Task<CallToolResult> ListActivities(
        Guid tripId,
        [Required, StringLength(200)] string destinationId
    ) =>
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
    public Task<CallToolResult> GetActivity(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
        Guid activityId
    ) =>
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
        "Create an undated activity idea with its complete GeoJSON Feature: what to do, place, duration and details. Keep itinerary dates, start times and day numbers out of its name and description. To fulfill a requested date/time, create the idea first, then read get_activity_plan and use replace_activity_plan to place its returned ID and set fixedDate/fixedStart restrictions. Planned state alone does not schedule it. Supply contextVersion from list_destinations. Returns ETag. Requires planning permission."
    )]
    public Task<CallToolResult> CreateActivity(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
        ActivityInput request,
        [
            Required,
            StringLength(200),
            Description("Copy the destination contextVersion from list_destinations verbatim.")
        ]
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
        "Replace the complete activity idea Feature. Keep its definition independent of itinerary dates, start times and day numbers; change scheduling through get_activity_plan and replace_activity_plan, not through the activity name or description. Planned state alone does not schedule it. Preserve unrelated fields. Supply ETag from get_activity and contextVersion from list_destinations. A 412 or 409 means read again before retrying."
    )]
    public Task<CallToolResult> UpdateActivity(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
        Guid activityId,
        ActivityInput request,
        [Required, StringLength(200)] string contextVersion,
        [
            Required,
            StringLength(32),
            RegularExpression("^\"[0-9]{1,19}\"$"),
            Description(
                "Copy the quoted ETag returned by get_activity verbatim, including the quotation marks."
            )
        ]
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
        [Required, StringLength(200)] string destinationId,
        Guid activityId,
        [Required, StringLength(200)] string contextVersion,
        [Required, StringLength(32), RegularExpression("^\"[0-9]{1,19}\"$")] string etag
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

    [McpServerTool(
        Name = "create_activity_location_proposal",
        ReadOnly = false,
        Destructive = false,
        Idempotent = false,
        OpenWorld = true
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Research a published candidate location for a saved activity. Requires planning permission and the LLM feature. Preview only; an entrance is not verified. Show the source and map to the user. Only after acceptance, use update_activity with the suggested geometry, preserve unrelated fields and source link, and clear locationSuggestion. Supply current ETag and destination context; reread on 409 or 412."
    )]
    public Task<CallToolResult> CreateActivityLocationProposal(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
        Guid activityId,
        [Required, StringLength(200)] string contextVersion,
        [Required, StringLength(32), RegularExpression("^\"[0-9]{1,19}\"$")] string etag
    ) =>
        Execute(
            true,
            context =>
                ActivityEndpoints.CreateLocationProposal(
                    tripId,
                    destinationId,
                    activityId,
                    context,
                    database,
                    destinations,
                    currentUser,
                    coordinateResearch
                ),
            contextVersion,
            etag
        );

    [McpServerTool(
        Name = "create_activity_details_proposal",
        ReadOnly = false,
        Destructive = false,
        Idempotent = false,
        OpenWorld = true
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "Research duration and cost for a saved activity using web search. Requires planning permission and LLM. Preview only: show sources, duration estimates, pricing conditions and dates. Unknown fields stay null. Only after user acceptance, use update_activity to apply selected values and their durationEvidence/costEvidence, preserving unrelated fields. Supply current ETag and destination context; reread after 409/412."
    )]
    public Task<CallToolResult> CreateActivityDetailsProposal(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
        Guid activityId,
        [Required, StringLength(200)] string contextVersion,
        [Required, StringLength(32), RegularExpression("^\"[0-9]{1,19}\"$")] string etag
    ) =>
        Execute(
            true,
            context =>
                ActivityEndpoints.CreateDetailsProposal(
                    tripId,
                    destinationId,
                    activityId,
                    context,
                    database,
                    destinations,
                    currentUser,
                    detailsResearch
                ),
            contextVersion,
            etag
        );

    private Task<CallToolResult> Execute(
        bool write,
        Func<HttpContext, Task<IResult>> action,
        string? contextVersion = null,
        string? etag = null
    ) => adapter.ExecuteAsync(write, action, contextVersion, etag);
}
