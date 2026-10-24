using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace TripPlanner.Api.DTO;

[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class SupportedDateAttribute : ValidationAttribute
{
    public override bool IsValid(object? value) =>
        value is null || value is DateOnly { Year: >= 2000 and <= 2100 };

    public override string FormatErrorMessage(string name) =>
        $"{name} must be an ISO date within 2000–2100.";
}

[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class TimeZoneIdAttribute : ValidationAttribute
{
    public override bool IsValid(object? value) =>
        value is null
        || value is string zone
            && (zone == "" || TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _));

    public override string FormatErrorMessage(string name) =>
        $"{name} must be a recognized time zone ID.";
}

[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public class JsonObjectValueAttribute : ValidationAttribute
{
    public override bool IsValid(object? value) =>
        value is null || value is JsonElement { ValueKind: JsonValueKind.Object };

    public override string FormatErrorMessage(string name) => $"{name} must be a JSON object.";
}

[AttributeUsage(AttributeTargets.Property)]
public sealed class DestinationConstraintsAttribute : JsonObjectValueAttribute
{
    public const int MaxFlexibilityDays = 5;

    public override bool IsValid(object? value)
    {
        if (!base.IsValid(value))
        {
            return false;
        }

        if (value is not JsonElement json)
        {
            return true;
        }

        foreach (string key in new[] { "arrivalFlexibilityDays", "departureFlexibilityDays" })
        {
            if (
                json.TryGetProperty(key, out var days)
                && (
                    days.ValueKind != JsonValueKind.Number
                    || !days.TryGetInt32(out int count)
                    || count is < 0 or > MaxFlexibilityDays
                )
            )
            {
                return false;
            }
        }

        return !json.TryGetProperty("keepAfterPrevious", out var order)
            || order.ValueKind is JsonValueKind.True or JsonValueKind.False;
    }

    public override string FormatErrorMessage(string name) =>
        $"{name} must be an object with date flexibility 0–{MaxFlexibilityDays} and a boolean keepAfterPrevious when present.";
}

[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class HttpUrlAttribute : ValidationAttribute
{
    public const string Pattern = "^[Hh][Tt][Tt][Pp][Ss]?://[^/@?#\\s]+(?:[/?#]|$)";

    public override bool IsValid(object? value) =>
        value is string text
        && text == text.Trim()
        && Uri.TryCreate(text, UriKind.Absolute, out var uri)
        && uri.Scheme is "http" or "https"
        && !string.IsNullOrWhiteSpace(uri.Host)
        && string.IsNullOrEmpty(uri.UserInfo);

    public override string FormatErrorMessage(string name) =>
        $"{name} must be an absolute HTTP(S) URL without credentials.";
}

[AttributeUsage(AttributeTargets.Property)]
public sealed class CoordinatesAttribute : ValidationAttribute
{
    public override bool IsValid(object? value) =>
        value is Microsoft.Spatial.GeographyPoint { IsEmpty: false } point
        && point.CoordinateSystem == Microsoft.Spatial.CoordinateSystem.DefaultGeography
        && double.IsFinite(point.Longitude)
        && double.IsFinite(point.Latitude)
        && point.Longitude is >= -180 and <= 180
        && point.Latitude is >= -90 and <= 90;

    public override string FormatErrorMessage(string name) =>
        $"{name} must contain [longitude (-180–180), latitude (-90–90)].";
}

[AttributeUsage(AttributeTargets.Property)]
public sealed class StringItemsAttribute(string pattern, int maxLength) : ValidationAttribute
{
    public string Pattern { get; } = pattern;
    public int MaxLength { get; } = maxLength;
    public bool AllowNullItems { get; set; }

    public override bool IsValid(object? value) =>
        value is null
        || value is IEnumerable<string> items
            && items.All(item =>
                (item is null && AllowNullItems)
                || !string.IsNullOrWhiteSpace(item)
                    && item.Length <= MaxLength
                    && System.Text.RegularExpressions.Regex.IsMatch(
                        item,
                        Pattern,
                        System.Text.RegularExpressions.RegexOptions.CultureInvariant,
                        TimeSpan.FromSeconds(1)
                    )
            );

    public override string FormatErrorMessage(string name) =>
        $"{name} contains an invalid identifier or code.";
}
