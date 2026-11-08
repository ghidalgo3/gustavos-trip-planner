using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace TripPlanner.Api.DTO;

// A portable file contract. Optional validators live with their domain resources.
// API routes and response metadata belong to client adapters.
public sealed record TripDocument(
    [property: Required] Guid Id,
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: Required(AllowEmptyStrings = true), StringLength(4000)] string Description,
    [property: Required] string Revision,
    [property: JsonRequired] DateTimeOffset CreatedAt,
    [property: JsonRequired] DateTimeOffset UpdatedAt,
    [property: Required] string OriginPlaceId,
    [property: Required] JsonObject[] People,
    [property: Required] JsonObject[] Places,
    [property: Required] JsonObject[] Activities,
    [property: Required] JsonObject Transportation,
    [property: Required] JsonObject Itinerary,
    [property: Required] JsonObject Preferences
)
{
    [JsonRequired, Range(1, 1)]
    public int SchemaVersion { get; init; } = 1;

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    [RegularExpression(@"^[!#-~\u0080-\u00ff]+$")]
    public string? Etag { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? CanPlan { get; init; }

    [JsonExtensionData]
    public Dictionary<string, JsonElement> Extensions { get; init; } = [];
}
