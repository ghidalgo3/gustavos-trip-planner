using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TripPlanner.Api.Serialization;

// The built-in writer emits ISO time, but its reader also accepts non-ISO forms.
public sealed class IsoTimeOnlyConverter : JsonConverter<TimeOnly>
{
    public override TimeOnly Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options
    )
    {
        if (
            reader.TokenType != JsonTokenType.String
            || reader.GetString() is not { Length: >= 8 and <= 16 } text
            || text.Length == 9
            || !TimeOnly.TryParseExact(
                text,
                ["HH:mm:ss", "HH:mm:ss.FFFFFFF"],
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var time
            )
        )
        {
            throw new JsonException(
                "Use an ISO 8601 local time (HH:mm:ss, with optional fractional seconds and no UTC offset)."
            );
        }
        return time;
    }

    public override void Write(
        Utf8JsonWriter writer,
        TimeOnly value,
        JsonSerializerOptions options
    ) => JsonSerializer.Serialize(writer, value, JsonSerializerOptions.Default);
}
