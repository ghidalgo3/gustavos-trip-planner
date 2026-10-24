using System.Text.Json.Serialization;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.Models;

[JsonConverter(typeof(StringEnumConverter<PartyRole>))]
public enum PartyRole
{
    Traveller,
    Planner,
}
