using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Options;
using Microsoft.Spatial;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using OpenIddict.Abstractions;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Instructions;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Destinations;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Mcp;

[McpServerToolType]
public sealed class TripPlannerTools(
    McpExecutionAdapter adapter,
    IPlannerDb database,
    ICurrentUser currentUser,
    DestinationService destinations,
    IAzureMapsClient maps
)
{
    [McpServerTool(
        Name = "get_trip_document",
        ReadOnly = true,
        Destructive = false,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta(
        "securitySchemes",
        JsonValue = "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.read\"]}]"
    )]
    [Description(McpInstructions.Tools.GetTripDocument)]
    public Task<CallToolResult> GetTripDocument(Guid tripId) =>
        adapter.ExecuteAsync(
            false,
            context =>
                TripDocumentEndpoints.GetDocument(
                    tripId,
                    context,
                    database,
                    currentUser,
                    context.RequestServices.GetRequiredService<TripPlanner.Api.Services.Documents.TripReader>(),
                    context.RequestServices.GetRequiredService<TripPlanner.Api.Services.Documents.TripResourceProjection>()
                )
        );

    private const string ReadSecurity = "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.read\"]}]";
    private const string WriteSecurity =
        "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.write\"]}]";

    [McpServerTool(Name = "get_visit_stay_location", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(McpInstructions.Tools.GetVisitStayLocation)]
    public Task<CallToolResult> GetVisitStayLocation(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
        Guid stayId
    ) =>
        Execute(
            false,
            context =>
                DestinationsEndpoints.GetStayLocation(
                    tripId,
                    destinationId,
                    stayId,
                    context,
                    database,
                    currentUser
                )
        );

    [McpServerTool(
        Name = "replace_visit_stay_location",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(McpInstructions.Tools.ReplaceVisitStayLocation)]
    public Task<CallToolResult> ReplaceVisitStayLocation(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
        Guid stayId,
        StayLocationRequest request
    ) =>
        Execute(
            true,
            context =>
                DestinationsEndpoints.SaveStayLocation(
                    tripId,
                    destinationId,
                    stayId,
                    request,
                    context,
                    database,
                    currentUser
                )
        );

    [McpServerTool(
        Name = "delete_visit_stay_location",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(McpInstructions.Tools.DeleteVisitStayLocation)]
    public Task<CallToolResult> DeleteVisitStayLocation(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
        Guid stayId
    ) =>
        Execute(
            true,
            context =>
                DestinationsEndpoints.DeleteStayLocation(
                    tripId,
                    destinationId,
                    stayId,
                    context,
                    database,
                    currentUser
                )
        );

    [McpServerTool(Name = "get_profile", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(McpInstructions.Tools.GetProfile)]
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
    [Description(McpInstructions.Tools.ListTrips)]
    public Task<CallToolResult> ListTrips(TripListQuery? query = null) =>
        Execute(
            false,
            context =>
                TripsEndpoints.ListTrips(null, query ?? new(), context, database, currentUser)
        );

    [McpServerTool(Name = "get_trip", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(McpInstructions.Tools.GetTrip)]
    public Task<CallToolResult> GetTrip(Guid tripId) =>
        Execute(
            false,
            context => TripsEndpoints.GetTrip(null, tripId, context, database, currentUser)
        );

    [McpServerTool(Name = "create_trip", ReadOnly = false, Destructive = false, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(McpInstructions.Tools.CreateTrip)]
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
    [Description(McpInstructions.Tools.UpdateTrip)]
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
    [Description(McpInstructions.Tools.DeleteTrip)]
    public Task<CallToolResult> DeleteTrip(Guid tripId) =>
        Execute(
            true,
            context => TripsEndpoints.DeleteTrip(null, tripId, context, database, currentUser)
        );

    [McpServerTool(Name = "list_destinations", ReadOnly = true, OpenWorld = false)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(McpInstructions.Tools.ListDestinations)]
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
    [Description(McpInstructions.Tools.AddDestination)]
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
    [Description(McpInstructions.Tools.UpdateDestination)]
    public Task<CallToolResult> UpdateDestination(
        Guid tripId,
        [Required, StringLength(200), Description(McpInstructions.Parameters.DestinationId)]
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
    [Description(McpInstructions.Tools.DeleteDestination)]
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
    [Description(McpInstructions.Tools.UpdateVisit)]
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
    [Description(McpInstructions.Tools.ListActivities)]
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
    [Description(McpInstructions.Tools.GetActivity)]
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

    [McpServerTool(Name = "geocode_address", ReadOnly = true, OpenWorld = true)]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(McpInstructions.Tools.GeocodeAddress)]
    public Task<CallToolResult> GeocodeAddress(
        Guid tripId,
        [Required, StringLength(200), Description(McpInstructions.Parameters.DestinationId)]
            string destinationId,
        [Required, StringLength(500), Description(McpInstructions.Parameters.GeocodingAddress)]
            string address
    ) =>
        Execute(
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

                var destination = await database.GetDestinationPlaceAsync(
                    user!.Id,
                    tripId,
                    destinationId,
                    context.RequestAborted
                );
                if (destination is null)
                {
                    return Results.NotFound();
                }

                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(
                    context.RequestAborted
                );
                deadline.CancelAfter(TimeSpan.FromSeconds(8));
                try
                {
                    var candidates = await maps.GeocodeAddressAsync(
                        address.Trim(),
                        destination.Name,
                        destination.CountryCode,
                        deadline.Token,
                        new(
                            "Point",
                            GeographyPoint.Create(destination.Latitude, destination.Longitude)
                        )
                    );
                    var match = candidates
                        is [
                            {
                                Confidence: AddressMatchConfidence.High,
                                Ambiguous: false,
                                PostalCodeMismatch: false
                            } precise,
                        ]
                        ? precise
                        : null;
                    return Results.Ok(
                        new
                        {
                            geometry = match?.Geometry,
                            formattedAddress = match?.FormattedAddress,
                        }
                    );
                }
                catch (Exception exception)
                    when (exception
                            is HttpRequestException
                                or JsonException
                                or IOException
                                or InvalidOperationException
                                or OperationCanceledException
                    )
                {
                    context.RequestAborted.ThrowIfCancellationRequested();
                    return Results.Problem(
                        statusCode: 502,
                        title: McpInstructions.Messages.GeocodingUnavailable
                    );
                }
            }
        );

    [McpServerTool(
        Name = "create_activity",
        ReadOnly = false,
        Destructive = false,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(McpInstructions.Tools.CreateActivity)]
    public Task<CallToolResult> CreateActivity(
        Guid tripId,
        [Required, StringLength(200)] string destinationId,
        ActivityInput request,
        [
            Required,
            StringLength(200),
            Description(McpInstructions.Parameters.DestinationContextVersion)
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
    [Description(McpInstructions.Tools.UpdateActivity)]
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
            Description(McpInstructions.Parameters.ActivityEtag)
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
    [Description(McpInstructions.Tools.DeleteActivity)]
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
        Name = "get_trip_travel",
        ReadOnly = true,
        Destructive = false,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description(McpInstructions.Tools.GetTripTravel)]
    public Task<CallToolResult> GetTripTravel(Guid tripId) =>
        Execute(
            false,
            context => TripTravelEndpoints.GetTravel(tripId, context, database, currentUser)
        );

    [McpServerTool(
        Name = "replace_trip_travel",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(McpInstructions.Tools.ReplaceTripTravel)]
    public Task<CallToolResult> ReplaceTripTravel(
        Guid tripId,
        TripTravelRequest request,
        [Required, StringLength(40), RegularExpression("""^"travel-[0-9]{1,19}"$""")] string etag
    ) =>
        Execute(
            true,
            context =>
                TripTravelEndpoints.ReplaceTravel(
                    tripId,
                    request,
                    context,
                    database,
                    currentUser,
                    context.RequestServices.GetRequiredService<TripPlanner.Api.Services.Documents.TripReader>(),
                    context.RequestServices.GetRequiredService<TripPlanner.Api.Services.Documents.TripResourceProjection>()
                ),
            etag: etag
        );

    private Task<CallToolResult> Execute(
        bool write,
        Func<HttpContext, Task<IResult>> action,
        string? contextVersion = null,
        string? etag = null
    ) => adapter.ExecuteAsync(write, action, contextVersion, etag);
}
