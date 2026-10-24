namespace TripPlanner.Api.Models;

public sealed record StayAddressSuggestion(
    string Name,
    string Address,
    ActivityLink Source,
    GeoJsonPoint? Geometry,
    string? Warning
)
{
    public string? MapAddress { get; init; }
}
