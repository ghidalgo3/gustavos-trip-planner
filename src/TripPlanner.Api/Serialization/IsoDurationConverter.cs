using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Xml;

namespace TripPlanner.Api.Serialization;

public sealed class IsoDurationConverter : JsonConverter<TimeSpan>
{
    // Elapsed durations have fixed units; calendar years/months have no fixed TimeSpan.
    // Shared with structured-output schemas: use alternatives, not unsupported lookaround.
    // Each time alternative requires at least hours, minutes, or seconds after T.
    public const string Pattern =
        @"^-?P(?:[0-9]+D|(?:[0-9]+D)?T(?:"
        + @"[0-9]+H(?:[0-9]+M)?(?:[0-9]+(?:\.[0-9]{1,7})?S)?|"
        + @"[0-9]+M(?:[0-9]+(?:\.[0-9]{1,7})?S)?|[0-9]+(?:\.[0-9]{1,7})?S))$";

    public override TimeSpan Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options
    )
    {
        if (
            reader.TokenType != JsonTokenType.String
            || reader.GetString() is not { Length: <= 100 } text
            || text != text.Trim()
            || !Regex.IsMatch(text, Pattern, RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1))
        )
        {
            throw new JsonException(
                "Use an ISO 8601 elapsed duration, for example PT1H30M. Calendar years and months are not supported."
            );
        }
        try
        {
            return XmlConvert.ToTimeSpan(text);
        }
        catch (Exception exception) when (exception is FormatException or OverflowException)
        {
            throw new JsonException(
                "The ISO 8601 duration is invalid or outside the supported range.",
                exception
            );
        }
    }

    public override void Write(
        Utf8JsonWriter writer,
        TimeSpan value,
        JsonSerializerOptions options
    ) => writer.WriteStringValue(XmlConvert.ToString(value));
}
