using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;
using TripPlanner.Api.Models;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.DTO;

public sealed record TransportationReferenceRequest(
    [property: Required, AllowedValues("activity", "airport", "hotel", "home")] string Kind,
    [property: JsonRequired] Guid Id
);

public sealed record TransportationGeometryRequest(
    [property: Required, AllowedValues("Point", "LineString", "MultiLineString")] string Type,
    [property: JsonRequired, TransportationCoordinates] JsonElement Coordinates
);

public sealed record TransportationPropertiesRequest(
    [property: StringLength(200)] string? Name = null,
    [property: StringLength(2000)] string? Address = null,
    TransportationReferenceRequest? Reference = null,
    [property: Range(0, 999)] int? Sequence = null,
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
    [property: StringLength(200)] string? Line = null,
    [property: StringLength(200)] string? Direction = null,
    [property: StringLength(10000)] string? Instructions = null,
    [property: DurationRange(0, 525600), JsonConverter(typeof(IsoDurationConverter))]
        TimeSpan? Duration = null
);

public sealed record TransportationFeatureRequest(
    [property: Required, AllowedValues("Feature")] string Type,
    [property: Required, StringLength(100, MinimumLength = 1)] string Id,
    TransportationGeometryRequest? Geometry,
    [property: Required] TransportationPropertiesRequest Properties
);

public sealed record TransportationRequest(
    [property: Required, AllowedValues("FeatureCollection")] string Type,
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: Required(AllowEmptyStrings = true), StringLength(10000)] string Notes,
    [property: Required, MinLength(2), MaxLength(102), TransportationFeatures]
        TransportationFeatureRequest[] Features,
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
        TimeSpan? Duration = null,
    bool RouteReviewed = false,
    Guid? OriginStayId = null,
    Guid? DestinationStayId = null,
    [property: SupportedTimestamp] DateTimeOffset? DepartureAt = null,
    [property: SupportedTimestamp] DateTimeOffset? ArrivalAt = null
)
{
    public Transportation ToModel(Guid id, long version, bool stale) =>
        new(
            id,
            Name.Trim(),
            Notes,
            Mode,
            DepartureDate,
            DepartureTime,
            TimeZone,
            Duration,
            Features
                .OrderBy(f =>
                    f.Id == "from" ? -2
                    : f.Id == "to" ? -1
                    : f.Properties.Sequence
                )
                .Select(f => new TransportationFeature(
                    f.Id,
                    f.Geometry is null
                        ? null
                        : new(f.Geometry.Type, f.Geometry.Coordinates.Clone()),
                    new(
                        f.Properties.Name,
                        f.Properties.Address,
                        f.Properties.Reference is null
                            ? null
                            : new(f.Properties.Reference.Kind, f.Properties.Reference.Id),
                        f.Properties.Sequence,
                        f.Properties.Mode,
                        f.Properties.Line,
                        f.Properties.Direction,
                        f.Properties.Instructions,
                        f.Properties.Duration
                    )
                ))
                .ToArray(),
            version,
            stale,
            OriginStayId,
            DestinationStayId,
            DepartureAt,
            ArrivalAt
        );
}

public sealed record HotelRequest(
    [property: Required, StringLength(200, MinimumLength = 1)] string Name,
    [property: Required] GeoJsonPoint Geometry,
    [property: StringLength(2000)] string? Address = null,
    [property: TimeZoneId, StringLength(100)] string? TimeZone = null
);

public sealed record TransportationEstimateRequest(
    [property: Required] GeoJsonPoint From,
    [property: Required] GeoJsonPoint To,
    [property: Required, AllowedValues("car", "walk")] string Mode,
    [property: JsonRequired, SupportedTimestamp] DateTimeOffset DepartureAt,
    bool IncludeGeometry = false
);

public sealed record TransportationEstimateResponse(
    [property: JsonConverter(typeof(IsoDurationConverter))] TimeSpan Duration,
    ActivityRoutePath? Geometry = null
);
