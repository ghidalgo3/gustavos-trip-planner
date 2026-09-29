namespace TripPlanner.Api.Options;

public sealed class IgnavOptions
{
    public const string SectionName = "Ignav";

    public string? ApiKey { get; init; }

    public int TimeoutSeconds { get; init; } = 480;

    public int MaxConcurrentRequests { get; init; } = 2;
}
