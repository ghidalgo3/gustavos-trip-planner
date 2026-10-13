using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record DestinationVisitInput(
    string Name,
    string CountryCode,
    DateOnly? ArrivalDate,
    DateOnly? DepartureDate,
    double? Longitude = null,
    double? Latitude = null,
    string? TimeZone = null,
    JsonElement? Constraints = null
);

public sealed record DestinationStayInput(DateOnly? ArrivalDate, DateOnly? DepartureDate);

public sealed record ActivityInput(
    string Type,
    string? Id,
    GeoJsonPoint? Geometry,
    ActivityProperties Properties
);

public sealed record ActivitySuggestionRequest(
    Guid RequestId,
    string Input,
    string DestinationContext
);
