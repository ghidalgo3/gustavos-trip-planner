using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record DestinationVisitInput(
    string Name,
    string CountryCode,
    [property: SupportedDate] DateOnly? ArrivalDate,
    [property: SupportedDate] DateOnly? DepartureDate,
    double? Longitude = null,
    double? Latitude = null,
    string? TimeZone = null,
    JsonElement? Constraints = null
);

public sealed record DestinationStayInput(
    [property: SupportedDate] DateOnly? ArrivalDate,
    [property: SupportedDate] DateOnly? DepartureDate
);

public sealed record ActivityInput(
    [property: AllowedValues("Feature")] string Type,
    [property: RegularExpression(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    )]
        string? Id,
    GeoJsonPoint? Geometry,
    ActivityProperties Properties
);
