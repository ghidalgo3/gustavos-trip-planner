using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record DestinationInputProperties(
    string Name,
    string CountryCode,
    string? TimeZone = null,
    JsonElement? Constraints = null
);

public sealed record DestinationCreateProperties(
    string Name,
    string CountryCode,
    DateOnly? ArrivalDate = null,
    DateOnly? DepartureDate = null,
    string? TimeZone = null,
    JsonElement? Constraints = null
);

public sealed record CreateDestinationRequest(
    string Type,
    GeoJsonPoint? Geometry,
    DestinationCreateProperties Properties
);

public sealed record ReplaceDestinationRequest(
    string Type,
    string? Id,
    GeoJsonPoint? Geometry,
    DestinationInputProperties Properties
);
