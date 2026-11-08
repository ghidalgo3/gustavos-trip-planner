using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Services.Maps;

public interface IAzureMapsClient
{
    Task<GeoJsonPoint?> GeocodeCityAsync(
        string city,
        string countryCode,
        CancellationToken cancellationToken
    );
    Task<IReadOnlyList<AddressLocationCandidate>> GeocodeAddressAsync(
        string address,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null,
        StructuredAddress? structuredAddress = null
    );
    Task<GeoJsonPoint?> GeocodePlaceAsync(
        string placeName,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null
    );
    Task<string?> ResolveTimeZoneAsync(GeographyPoint point, CancellationToken cancellationToken);
    Task<ActivityRoutePath?> RouteAsync(
        GeographyPoint from,
        GeographyPoint to,
        DateTimeOffset departure,
        string mode,
        CancellationToken cancellationToken
    );
    Task<MapRouteEstimate?> EstimateRouteAsync(
        GeographyPoint from,
        GeographyPoint to,
        DateTimeOffset departure,
        string mode,
        PlanningProviderBudget budget,
        CancellationToken cancellationToken
    );
}
