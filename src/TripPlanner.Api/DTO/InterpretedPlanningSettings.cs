using System.Text.Json.Serialization;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.DTO;

// Nullable values mean the shared instructions did not specify a setting.
internal sealed record InterpretedPlanningSettings(
    [property: JsonRequired, ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))]
        TimeOnly? SleepStart,
    [property: JsonRequired, ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))]
        TimeOnly? SleepEnd,
    [property: JsonRequired, DurationRange(0, 1440), JsonConverter(typeof(IsoDurationConverter))]
        TimeSpan? SlackDuration
);
