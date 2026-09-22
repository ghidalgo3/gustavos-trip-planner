namespace TripPlanner.Api.Options;

public sealed class AzureMapsOptions
{
    public const string SectionName = "AzureMaps";

    public string? SasToken { get; init; }

    public DateTimeOffset SasTokenExpiresAt { get; init; }

    public string? ResourceId { get; init; }

    public string? SasPrincipalId { get; init; }

    public string? Endpoint { get; init; }
}
