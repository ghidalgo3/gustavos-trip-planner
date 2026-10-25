namespace TripPlanner.Api.Models;

public sealed record VenueAddressSuggestion(
    string Name,
    string Address,
    ActivityLink Source,
    GeoJsonPoint? Geometry,
    string? Warning
)
{
    public string? MapAddress { get; init; }
    public ActivityLink? LocationSource { get; init; }
}
