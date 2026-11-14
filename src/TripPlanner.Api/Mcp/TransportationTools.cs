using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Mcp;

[McpServerToolType]
public sealed class TransportationTools(
    McpExecutionAdapter adapter,
    IPlannerDb database,
    ICurrentUser currentUser,
    AirportCatalog airports
)
{
    private const string ReadSecurity = "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.read\"]}]";
    private const string WriteSecurity =
        "[{\"type\":\"oauth2\",\"scopes\":[\"tripplanner.write\"]}]";

    [McpServerTool(
        Name = "list_transportation",
        ReadOnly = true,
        Destructive = false,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description("Read this trip's saved transportation resources and their validators.")]
    public Task<CallToolResult> ListTransportation(Guid tripId) =>
        adapter.ExecuteAsync(
            false,
            c => TransportationEndpoints.List(tripId, c, database, currentUser)
        );

    [McpServerTool(
        Name = "get_transportation",
        ReadOnly = true,
        Destructive = false,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description("Read one transportation resource and its ETag.")]
    public Task<CallToolResult> GetTransportation(Guid tripId, Guid transportationId) =>
        adapter.ExecuteAsync(
            false,
            c => TransportationEndpoints.Get(tripId, transportationId, c, database, currentUser)
        );

    [McpServerTool(
        Name = "create_transportation",
        ReadOnly = false,
        Destructive = false,
        Idempotent = false,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "After user approval, create a complete transportation resource. Transportation is a FeatureCollection with from/to Point or reference Features, notes and ordered optional route geometry. Reference kinds are activity, airport, hotel and home (user ID). No routing or booking is performed."
    )]
    public Task<CallToolResult> CreateTransportation(Guid tripId, TransportationRequest request) =>
        adapter.ExecuteAsync(
            true,
            c => TransportationEndpoints.Create(tripId, request, c, database, currentUser, airports)
        );

    [McpServerTool(
        Name = "replace_transportation",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "After user approval, replace the complete transportation using its latest ETag. Preserve unrelated values. Refresh on conflict."
    )]
    public Task<CallToolResult> ReplaceTransportation(
        Guid tripId,
        Guid transportationId,
        TransportationRequest request,
        [Required, StringLength(100), RegularExpression("^\\\"[^\\\"]+\\\"$")] string etag
    ) =>
        adapter.ExecuteAsync(
            true,
            c =>
                TransportationEndpoints.Replace(
                    tripId,
                    transportationId,
                    request,
                    c,
                    database,
                    currentUser,
                    airports
                ),
            etag: etag
        );

    [McpServerTool(
        Name = "delete_transportation",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description("After user approval, delete the transportation using its latest ETag.")]
    public Task<CallToolResult> DeleteTransportation(
        Guid tripId,
        Guid transportationId,
        [Required, StringLength(100), RegularExpression("^\\\"[^\\\"]+\\\"$")] string etag
    ) =>
        adapter.ExecuteAsync(
            true,
            c => TransportationEndpoints.Delete(tripId, transportationId, c, database, currentUser),
            etag: etag
        );

    [McpServerTool(
        Name = "list_hotels",
        ReadOnly = true,
        Destructive = false,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description("Read this trip's saved hotel resources and their validators.")]
    public Task<CallToolResult> ListHotels(Guid tripId) =>
        adapter.ExecuteAsync(false, c => HotelsEndpoints.List(tripId, c, database, currentUser));

    [McpServerTool(
        Name = "get_hotel",
        ReadOnly = true,
        Destructive = false,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = ReadSecurity)]
    [Description("Read one hotel resource and its ETag.")]
    public Task<CallToolResult> GetHotels(Guid tripId, Guid hotelId) =>
        adapter.ExecuteAsync(
            false,
            c => HotelsEndpoints.Get(tripId, hotelId, c, database, currentUser)
        );

    [McpServerTool(
        Name = "create_hotel",
        ReadOnly = false,
        Destructive = false,
        Idempotent = false,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "After user approval, create a trip-scoped hotel with an identity independent of its stays."
    )]
    public Task<CallToolResult> CreateHotels(Guid tripId, HotelRequest request) =>
        adapter.ExecuteAsync(
            true,
            c => HotelsEndpoints.Create(tripId, request, c, database, currentUser)
        );

    [McpServerTool(
        Name = "replace_hotel",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "After user approval, replace the complete hotel using its latest ETag. Preserve unrelated values. Refresh on conflict."
    )]
    public Task<CallToolResult> ReplaceHotels(
        Guid tripId,
        Guid hotelId,
        HotelRequest request,
        [Required, StringLength(100), RegularExpression("^\\\"[^\\\"]+\\\"$")] string etag
    ) =>
        adapter.ExecuteAsync(
            true,
            c => HotelsEndpoints.Replace(tripId, hotelId, request, c, database, currentUser),
            etag: etag
        );

    [McpServerTool(
        Name = "delete_hotel",
        ReadOnly = false,
        Destructive = true,
        Idempotent = true,
        OpenWorld = false
    )]
    [McpMeta("securitySchemes", JsonValue = WriteSecurity)]
    [Description(
        "After user approval, delete the hotel using its latest ETag. Referencing transportation endpoints become inline location snapshots."
    )]
    public Task<CallToolResult> DeleteHotels(
        Guid tripId,
        Guid hotelId,
        [Required, StringLength(100), RegularExpression("^\\\"[^\\\"]+\\\"$")] string etag
    ) =>
        adapter.ExecuteAsync(
            true,
            c => HotelsEndpoints.Delete(tripId, hotelId, c, database, currentUser),
            etag: etag
        );
}
