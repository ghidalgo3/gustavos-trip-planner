using System.Text.Json.Serialization;

namespace TripPlanner.Api.Models;

public sealed record GeoJsonPoint(string Type, double[] Coordinates);

public sealed record GeoJsonFeature<T>(
    string Type,
    string Id,
    GeoJsonPoint? Geometry,
    T Properties
);

public sealed record GeoJsonCollection<T>(
    string Type,
    IReadOnlyList<GeoJsonFeature<T>> Features,
    IReadOnlyList<DestinationRouteItem>? Route = null
);

public sealed record DestinationRouteItem(string DestinationId, Guid StayId);

public sealed record DestinationStay(
    Guid Id,
    int Order,
    DateOnly? ArrivalDate,
    DateOnly? DepartureDate,
    string ArrivalAt,
    string DepartureAt
);

public sealed record DestinationVisitInput(
    string Name,
    string CountryCode,
    DateOnly? ArrivalDate,
    DateOnly? DepartureDate,
    double? Longitude = null,
    double? Latitude = null
);

public sealed record DestinationStayInput(DateOnly? ArrivalDate, DateOnly? DepartureDate);

public sealed record DestinationVisit(
    Guid TripId,
    string CityId,
    Guid StayId,
    int Order,
    DateOnly? ArrivalDate,
    DateOnly? DepartureDate
);

public sealed record DestinationProperties(
    string Name,
    string CountryCode,
    string? TimeZone,
    string ContextVersion,
    DateOnly? ArrivalDate,
    DateOnly? DepartureDate,
    IReadOnlyList<DestinationStay> Stays,
    bool IsActive = true
);

public sealed record DestinationPlace(
    Guid TripId,
    string CityId,
    string Name,
    string CountryCode,
    string TimeZone,
    double Longitude,
    double Latitude,
    string ContextVersion = ""
);

public sealed record ActivityCost(decimal Amount, string Currency, string Basis);

public sealed record ActivityProperties(
    string Name,
    int? DurationMinutes,
    string Description,
    ActivityCost? Cost,
    string State,
    string? PlaceName = null
);

public sealed record Activity(
    Guid Id,
    Guid TripId,
    string CityId,
    GeoJsonPoint? Geometry,
    ActivityProperties Properties,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    Guid? SourceOperationId = null
)
{
    public GeoJsonFeature<ActivityProperties> ToFeature() =>
        new("Feature", Id.ToString("D"), Geometry, Properties);
}

public sealed record ActivityInput(
    string Type,
    string? Id,
    GeoJsonPoint? Geometry,
    ActivityProperties Properties
);

public sealed record ActivitySuggestionRequest(
    Guid RequestId,
    string Input,
    string DestinationContext
);

public sealed record ActivityCandidate(
    string Name,
    string? PlaceName,
    int? DurationMinutes,
    string? Description,
    decimal? CostAmount,
    string? CostCurrency,
    string? CostBasis,
    double? Longitude,
    double? Latitude
);

public sealed record ActivityJob(
    Guid OperationId,
    Guid UserId,
    Guid TripId,
    string CityId,
    string DestinationContext,
    string Input,
    byte[]? Image,
    string? ImageMimeType,
    Guid LeaseId,
    int Attempts
);

public sealed record ActivitySuggestionResult(
    Guid OperationId,
    GeoJsonCollection<ActivityProperties> Activities,
    string[] Warnings
);
