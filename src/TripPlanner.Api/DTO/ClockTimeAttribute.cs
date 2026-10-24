using System.ComponentModel.DataAnnotations;

namespace TripPlanner.Api.DTO;

[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class ClockTimeAttribute : ValidationAttribute
{
    public const string Pattern = "^(?:[01][0-9]|2[0-3]):[0-5][0-9]:00(?:\\.0{1,7})?$";

    public override bool IsValid(object? value) =>
        value is null || value is TimeOnly time && time.Ticks % TimeSpan.TicksPerMinute == 0;

    public override string FormatErrorMessage(string name) =>
        $"{name} must be a local clock time with whole-minute precision (ISO 8601 HH:mm:ss).";
}
