using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using TripPlanner.Api.Models;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.DTO;

public sealed record StayLocationRequest(
    [property: AllowedValues("Feature")] string Type,
    [property: Required] GeoJsonPoint? Geometry,
    [property: Required] StayLocationRequestProperties? Properties
);

public sealed record StayLocationRequestProperties(
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: StringLength(2000)] string? Address = null,
    Guid? HotelId = null
)
{
    [ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))]
    public TimeOnly CheckInTime { get; init; } = new(16, 0);

    [ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))]
    public TimeOnly CheckOutTime { get; init; } = new(11, 0);
}
