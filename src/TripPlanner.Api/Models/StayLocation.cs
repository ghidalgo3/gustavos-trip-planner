using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.Models;

public sealed record StayLocationProperties(
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
