using System.Text.Json;
using System.Text.Json.Serialization;

namespace TripPlanner.Api.Serialization;

// Keep API, MCP and stored JSON consistent, including when using default serializer options.
public sealed class StringEnumConverter<T> : JsonConverter<T>
    where T : struct, Enum
{
    public override T Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options
    )
    {
        if (
            reader.TokenType == JsonTokenType.String
            && reader.GetString() is { } name
            && Enum.TryParse<T>(name, out var value)
            && Enum.GetName(value) == name
        )
        {
            return value;
        }
        throw new JsonException(
            $"Use a named {typeof(T).Name} value with the documented spelling."
        );
    }

    public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options)
    {
        string name =
            Enum.GetName(value) ?? throw new JsonException($"Undefined {typeof(T).Name} value.");
        writer.WriteStringValue(name);
    }
}
