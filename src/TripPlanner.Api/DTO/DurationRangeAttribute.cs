using System.ComponentModel.DataAnnotations;

namespace TripPlanner.Api.DTO;

[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class DurationRangeAttribute(int minimumMinutes, int maximumMinutes)
    : ValidationAttribute
{
    public int MinimumMinutes { get; } = minimumMinutes;
    public int MaximumMinutes { get; } = maximumMinutes;

    public string SchemaDescription =>
        $"ISO 8601 elapsed duration, from {System.Xml.XmlConvert.ToString(TimeSpan.FromMinutes(MinimumMinutes))} to {System.Xml.XmlConvert.ToString(TimeSpan.FromMinutes(MaximumMinutes))}, in whole minutes.";

    public override bool IsValid(object? value) =>
        value is null
        || value is TimeSpan duration
            && duration.Ticks % TimeSpan.TicksPerMinute == 0
            && duration >= TimeSpan.FromMinutes(MinimumMinutes)
            && duration <= TimeSpan.FromMinutes(MaximumMinutes);

    public override string FormatErrorMessage(string name) => $"{name}: {SchemaDescription}";
}
