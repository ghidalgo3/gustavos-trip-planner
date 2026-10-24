using System.Text.Json.Serialization;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.Models;

[JsonConverter(typeof(StringEnumConverter<ActivityState>))]
public enum ActivityState
{
    Proposed,
    Planned,
    Rejected,
}
