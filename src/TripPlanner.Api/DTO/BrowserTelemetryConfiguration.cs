using System.ComponentModel.DataAnnotations;

namespace TripPlanner.Api.DTO;

public sealed record BrowserTelemetryConfiguration(
    [property: MaxLength(4096)] string? ConnectionString
);
