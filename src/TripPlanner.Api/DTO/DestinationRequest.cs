using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record DestinationInputProperties(
    [property: Required, StringLength(150, MinimumLength = 1)] string Name,
    [property: Required, RegularExpression("^[A-Za-z]{2}$")] string CountryCode,
    [property: TimeZoneId, StringLength(100)] string? TimeZone = null,
    [property: DestinationConstraints] JsonElement? Constraints = null
);

public sealed record DestinationCreateProperties(
    [property: Required, StringLength(150, MinimumLength = 1)] string Name,
    [property: Required, RegularExpression("^[A-Za-z]{2}$")] string CountryCode,
    [property: SupportedDate] DateOnly? ArrivalDate = null,
    [property: SupportedDate] DateOnly? DepartureDate = null,
    [property: TimeZoneId, StringLength(100)] string? TimeZone = null,
    [property: DestinationConstraints] JsonElement? Constraints = null
);

public sealed record CreateDestinationRequest(
    [property: AllowedValues("Feature")] string Type,
    [property: Required] GeoJsonPoint? Geometry,
    DestinationCreateProperties Properties
);

public sealed record ReplaceDestinationRequest(
    [property: AllowedValues("Feature")] string Type,
    [property: StringLength(200, MinimumLength = 1)] string? Id,
    [property: Required] GeoJsonPoint? Geometry,
    DestinationInputProperties Properties
);
