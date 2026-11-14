using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TripPlanner.Api.DTO;

[AttributeUsage(AttributeTargets.Property)]
public sealed class TransportationCoordinatesAttribute : ValidationAttribute
{
    public const string SchemaDescription =
        "GeoJSON [longitude, latitude] positions, a LineString of at least two positions, or a MultiLineString. Longitude is -180..180 and latitude -90..90. Geometry type must match the coordinate nesting.";

    public override bool IsValid(object? value) =>
        value is JsonElement coordinates
        && new[] { "Point", "LineString", "MultiLineString" }.Any(type =>
            TransportationFeaturesAttribute.ValidGeometry(type, coordinates)
        );

    public override string FormatErrorMessage(string name) => SchemaDescription;

    public static JsonObject CreateSchema()
    {
        var point = new JsonObject
        {
            ["type"] = "array",
            ["minItems"] = 2,
            ["maxItems"] = 2,
            ["items"] = false,
            ["prefixItems"] = new JsonArray(
                new JsonObject
                {
                    ["type"] = "number",
                    ["minimum"] = -180,
                    ["maximum"] = 180,
                },
                new JsonObject
                {
                    ["type"] = "number",
                    ["minimum"] = -90,
                    ["maximum"] = 90,
                }
            ),
        };
        var line = new JsonObject
        {
            ["type"] = "array",
            ["minItems"] = 2,
            ["maxItems"] = 10000,
            ["items"] = point.DeepClone(),
        };
        var multi = new JsonObject
        {
            ["type"] = "array",
            ["minItems"] = 1,
            ["maxItems"] = 100,
            ["items"] = line.DeepClone(),
        };
        return new JsonObject
        {
            ["description"] = SchemaDescription,
            ["oneOf"] = new JsonArray(point, line, multi),
        };
    }
}
