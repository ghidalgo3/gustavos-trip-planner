using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace TripPlanner.Api.DTO;

public sealed record SnapshotResource(
    [property: Required] string Href,
    [property: Required] string Etag,
    JsonElement Data,
    int Status = 200,
    string ContentType = "application/json",
    string? ContextVersion = null
);

public sealed record TripSnapshotResponse(
    [property: JsonPropertyName("@context"), Required] JsonObject Context,
    [property: JsonPropertyName("@id"), Required] string Id,
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    string Description,
    [property: Required] string Revision,
    [property: Required] JsonObject TripOrigin,
    [property: Required] JsonObject Itinerary,
    [property: Required] JsonObject[] Places,
    [property: Required] JsonObject[] People,
    [property: Required] JsonObject[] Travellers,
    [property: Required] JsonObject Owner,
    [property: Required] JsonObject[] Services,
    [property: Required] JsonObject[] Flights,
    [property: Required] JsonObject[] Reservations,
    [property: Required] JsonObject Plan,
    [property: Required] JsonObject Planning,
    [property: Required] IReadOnlyDictionary<string, SnapshotResource> Resources
)
{
    [JsonPropertyName("@type"), JsonRequired, AllowedValues("Trip")]
    public string Type { get; init; } = "Trip";

    [JsonRequired, Range(1, 1)]
    public int SchemaVersion { get; init; } = 1;

    [JsonExtensionData]
    public Dictionary<string, JsonElement> Extensions { get; init; } = [];
}
