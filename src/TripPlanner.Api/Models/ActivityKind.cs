using System.Text.Json.Serialization;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.Models;

[JsonConverter(typeof(StringEnumConverter<ActivityKind>))]
public enum ActivityKind
{
    Food,
    Shopping,
    Culture,
    Music,
    Art,
    Nature,
    Relax,
    Event,
    Holiday,
}
