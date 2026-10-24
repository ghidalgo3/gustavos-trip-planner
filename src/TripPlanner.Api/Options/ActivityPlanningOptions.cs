namespace TripPlanner.Api.Options;

public sealed class ActivityPlanningOptions
{
    public const string SectionName = "ActivityPlanning";
    public int MaxActivities { get; init; } = 100;
    public int MaxDays { get; init; } = 30;
    public int SolverSeconds { get; init; } = 30;
    public int JobTimeoutSeconds { get; init; } = 180;
    public int ProviderRequestLimit { get; init; } = 120;
    public int ProviderTimeoutSeconds { get; init; } = 15;
    public int EvidenceHours { get; init; } = 24;
    public string DecisionsModel { get; init; } = "gpt-6-luna";
    public string? PublicBaseUrl { get; init; }
}
