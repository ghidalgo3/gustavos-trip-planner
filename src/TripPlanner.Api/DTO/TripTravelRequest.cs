using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using TripPlanner.Api.Instructions;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.DTO;

public sealed record TravelEndpointRequest(
    [property: StringLength(500), Description(McpInstructions.Fields.TravelPlaceId)]
        string? PlaceId = null,
    Guid? ActivityId = null,
    Guid? VisitId = null
);

public sealed record TravelSegmentRequest(
    [property:
        Required,
        AllowedValues("walk", "bike", "car", "taxi", "bus", "train", "transit", "flight")
    ]
        string Mode,
    [property: Required] TravelEndpointRequest From,
    [property: Required] TravelEndpointRequest To,
    [property: DurationRange(0, 525600), JsonConverter(typeof(IsoDurationConverter))]
        TimeSpan? Duration = null
);

public sealed record TravelConnectionRequest(
    [property: JsonRequired] Guid Id,
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: Required] TravelEndpointRequest From,
    [property: Required] TravelEndpointRequest To,
    [property: AllowedValues(
        null,
        "walk",
        "bike",
        "car",
        "taxi",
        "bus",
        "train",
        "transit",
        "flight"
    )]
        string? Mode = null,
    [property: SupportedDate] DateOnly? DepartureDate = null,
    [property: ClockTime, JsonConverter(typeof(IsoTimeOnlyConverter))]
        TimeOnly? DepartureTime = null,
    [property: TimeZoneId, StringLength(100)] string? TimeZone = null,
    [property: DurationRange(0, 525600), JsonConverter(typeof(IsoDurationConverter))]
        TimeSpan? DurationOverride = null,
    [property: StringLength(500)] string? ServiceId = null,
    [property: MaxLength(100)] TravelSegmentRequest[]? Segments = null
);

public sealed record TripTravelRequest(
    [property: Required, MaxLength(1000)] TravelConnectionRequest[] Connections
);
