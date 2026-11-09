using System.ComponentModel.DataAnnotations;
using TripPlanner.Api.Instructions;

namespace TripPlanner.Api.DTO;

[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class DurationRangeAttribute(int minimumMinutes, int maximumMinutes)
    : ValidationAttribute
{
    public int MinimumMinutes { get; } = minimumMinutes;
    public int MaximumMinutes { get; } = maximumMinutes;

    public string SchemaDescription =>
        McpInstructions.Schema.DurationRange(
            TimeSpan.FromMinutes(MinimumMinutes),
            TimeSpan.FromMinutes(MaximumMinutes)
        );

    public override bool IsValid(object? value) =>
        value is null
        || value is TimeSpan duration
            && duration.Ticks % TimeSpan.TicksPerMinute == 0
            && duration >= TimeSpan.FromMinutes(MinimumMinutes)
            && duration <= TimeSpan.FromMinutes(MaximumMinutes);

    public override string FormatErrorMessage(string name) => $"{name}: {SchemaDescription}";
}
