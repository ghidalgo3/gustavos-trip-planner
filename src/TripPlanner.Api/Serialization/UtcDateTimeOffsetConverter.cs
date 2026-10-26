using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TripPlanner.Api.Serialization;

public sealed class UtcDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options
    ) => reader.GetDateTimeOffset().ToUniversalTime();

    public override void Write(
        Utf8JsonWriter writer,
        DateTimeOffset value,
        JsonSerializerOptions options
    ) => writer.WriteStringValue(Format(value));

    public static string Format(DateTimeOffset value) =>
        value.UtcDateTime.ToString(
            "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'",
            CultureInfo.InvariantCulture
        );
}
