using System.Text.Json;
using System.Text.Json.Serialization;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.Models;

public sealed record TransportationReference(string Kind, Guid Id);

public sealed record TransportationGeometry(string Type, JsonElement Coordinates);

public sealed record TransportationProperties(
    string? Name = null,
    string? Address = null,
    TransportationReference? Reference = null,
    int? Sequence = null,
    string? Mode = null,
    string? Line = null,
    string? Direction = null,
    string? Instructions = null,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan? Duration = null
);

public sealed record TransportationFeature(
    string Id,
    TransportationGeometry? Geometry,
    TransportationProperties Properties
)
{
    public string Type => "Feature";
}

public sealed record Transportation(
    Guid Id,
    string Name,
    string Notes,
    string? Mode,
    DateOnly? DepartureDate,
    [property: JsonConverter(typeof(IsoTimeOnlyConverter))] TimeOnly? DepartureTime,
    string? TimeZone,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan? Duration,
    TransportationFeature[] Features,
    long Version = 0,
    bool RouteStale = false
)
{
    public string Type => "FeatureCollection";
    public string Etag => $"transportation-{Id:D}-{Version}";
}

public sealed record Hotel(
    Guid Id,
    Guid TripId,
    string Name,
    string? Address,
    GeoJsonPoint Geometry,
    string? TimeZone,
    long Version = 0
)
{
    public string Etag => $"hotel-{Id:D}-{Version}";
}
