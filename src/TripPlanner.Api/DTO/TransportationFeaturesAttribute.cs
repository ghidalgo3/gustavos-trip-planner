using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace TripPlanner.Api.DTO;

[AttributeUsage(AttributeTargets.Property)]
public sealed class TransportationFeaturesAttribute : ValidationAttribute
{
    public override bool IsValid(object? value)
    {
        if (
            value is not TransportationFeatureRequest[] features
            || features.Any(f => f is null || f.Properties is null)
        )
        {
            return false;
        }
        if (
            features.Count(f => f.Id == "from") != 1
            || features.Count(f => f.Id == "to") != 1
            || features.Select(f => f.Id).Distinct().Count() != features.Length
        )
        {
            return false;
        }
        var steps = features.Where(f => f.Id is not ("from" or "to")).ToArray();
        if (
            steps.Any(f =>
                f.Properties.Reference is not null
                || f.Properties.Sequence is null
                || f.Properties.Mode is null
                || f.Geometry?.Type == "Point"
            )
            || steps.Select(f => f.Properties.Sequence).Distinct().Count() != steps.Length
        )
        {
            return false;
        }
        foreach (var f in features)
        {
            if (f.Id is "from" or "to")
            {
                if (f.Properties.Sequence is not null || f.Geometry is { Type: not "Point" })
                {
                    return false;
                }
                if (
                    f.Properties.Reference is null
                    && (f.Geometry is null || string.IsNullOrWhiteSpace(f.Properties.Name))
                )
                {
                    return false;
                }
            }
            if (f.Geometry is { } geometry && !ValidGeometry(geometry.Type, geometry.Coordinates))
            {
                return false;
            }
        }
        return true;
    }

    private static bool Point(JsonElement p) =>
        p.ValueKind == JsonValueKind.Array
        && p.GetArrayLength() == 2
        && p[0].TryGetDouble(out var longitude)
        && double.IsFinite(longitude)
        && longitude is >= -180 and <= 180
        && p[1].TryGetDouble(out var latitude)
        && double.IsFinite(latitude)
        && latitude is >= -90 and <= 90;

    private static bool Line(JsonElement line) =>
        line.ValueKind == JsonValueKind.Array
        && line.GetArrayLength() is >= 2 and <= 10000
        && line.EnumerateArray()
            .All(p =>
                p.ValueKind == JsonValueKind.Array
                && p.EnumerateArray().All(v => v.ValueKind == JsonValueKind.Number)
                && Point(p)
            );

    internal static bool ValidGeometry(string type, JsonElement coordinates) =>
        type switch
        {
            "Point" => coordinates.ValueKind == JsonValueKind.Array
                && coordinates.EnumerateArray().All(v => v.ValueKind == JsonValueKind.Number)
                && Point(coordinates),
            "LineString" => Line(coordinates),
            "MultiLineString" => coordinates.ValueKind == JsonValueKind.Array
                && coordinates.GetArrayLength() is >= 1 and <= 100
                && coordinates.EnumerateArray().All(Line),
            _ => false,
        };

    public override string FormatErrorMessage(string name) =>
        "Include exactly one from and to Point or reference, and uniquely sequenced route steps with valid longitude/latitude geometry. Inline endpoints need a name; route steps need a mode.";
}
