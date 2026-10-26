using System.Text.Json;
using System.Text.Json.Serialization;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.Models;

public sealed record TripTravelEndpoint(string? PlaceId, Guid? ActivityId, Guid? VisitId);

public sealed record TripTravelEstimate(
    string Provider,
    DateTimeOffset RetrievedAt,
    DateTimeOffset ExpiresAt,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan Duration,
    string InputVersion,
    bool Provisional = true
);

public sealed record TripTravelSegment(
    string Mode,
    TripTravelEndpoint From,
    TripTravelEndpoint To,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan? Duration
);

public sealed record TripTravelConnection(
    Guid Id,
    string Name,
    TripTravelEndpoint From,
    TripTravelEndpoint To,
    string? Mode,
    string ModeSelectedBy,
    DateOnly? DepartureDate,
    [property: JsonConverter(typeof(IsoTimeOnlyConverter))] TimeOnly? DepartureTime,
    string? TimeZone,
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan? DurationOverride,
    string? ServiceId,
    TripTravelSegment[] Segments,
    TripTravelEstimate? Estimate = null,
    JsonElement? ServiceDefinition = null
);

public sealed record TripTravelPlan(TripTravelConnection[] Connections, long Version = 0);
