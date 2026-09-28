namespace TripPlanner.Api.Options;

public sealed class PlanningOptions
{
    public const string SectionName = "Planning";

    public int DatePairLimit { get; init; } = 40;

    public int FareRequestLimit { get; init; } = 40;

    public int WorkerConcurrency { get; init; } = 2;

    public bool WorkerEnabled { get; init; } = true;
}
