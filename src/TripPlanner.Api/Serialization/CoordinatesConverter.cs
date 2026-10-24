using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Spatial;

namespace TripPlanner.Api.Serialization;

// GeoJSON uses longitude first; Microsoft.Spatial's factory uses latitude first.
public sealed class CoordinatesConverter : JsonConverter<GeographyPoint>
{
    public override GeographyPoint Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options
    )
    {
        using var document = JsonDocument.ParseValue(ref reader);
        var value = document.RootElement;
        if (
            value.ValueKind != JsonValueKind.Array
            || value.GetArrayLength() != 2
            || value[0].ValueKind != JsonValueKind.Number
            || value[1].ValueKind != JsonValueKind.Number
            || !value[0].TryGetDouble(out double longitude)
            || !value[1].TryGetDouble(out double latitude)
            || !double.IsFinite(longitude)
            || !double.IsFinite(latitude)
            || longitude is < -180 or > 180
            || latitude is < -90 or > 90
        )
        {
            throw new JsonException("Use [longitude (-180–180), latitude (-90–90)].");
        }
        return GeographyPoint.Create(latitude: latitude, longitude: longitude);
    }

    public override void Write(
        Utf8JsonWriter writer,
        GeographyPoint value,
        JsonSerializerOptions options
    )
    {
        writer.WriteStartArray();
        writer.WriteNumberValue(value.Longitude);
        writer.WriteNumberValue(value.Latitude);
        writer.WriteEndArray();
    }
}
