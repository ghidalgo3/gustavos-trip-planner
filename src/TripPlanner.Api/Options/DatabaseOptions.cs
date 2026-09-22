namespace TripPlanner.Api.Options;

public sealed class DatabaseOptions
{
    public const string SectionName = "Database";

    public string? ConnectionString { get; set; }

    public bool UseAzureManagedIdentity { get; init; }
}
