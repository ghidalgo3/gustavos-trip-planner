using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Tests.Support;

internal class AzureMapsStub : IAzureMapsClient
{
    public virtual Task<GeoJsonPoint?> GeocodeCityAsync(
        string city,
        string countryCode,
        CancellationToken cancellationToken
    ) =>
        Task.FromResult<GeoJsonPoint?>(
            new(
                "Point",
                city == "Paris"
                    ? GeographyPoint.Create(48.8566, 2.3522)
                    : GeographyPoint.Create(41.9028, 12.4964)
            )
        );

    public virtual Task<IReadOnlyList<AddressLocationCandidate>> GeocodeAddressAsync(
        string address,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null,
        StructuredAddress? structuredAddress = null
    ) => Task.FromResult<IReadOnlyList<AddressLocationCandidate>>([]);

    public virtual Task<GeoJsonPoint?> GeocodePlaceAsync(
        string placeName,
        string city,
        string countryCode,
        CancellationToken cancellationToken,
        GeoJsonPoint? center = null
    ) => Task.FromResult<GeoJsonPoint?>(new("Point", GeographyPoint.Create(48.8606, 2.3364)));

    public virtual Task<string?> ResolveTimeZoneAsync(
        GeographyPoint point,
        CancellationToken cancellationToken
    ) => Task.FromResult<string?>(point.Longitude < 5 ? "Europe/Paris" : "Europe/Rome");

    public virtual Task<ActivityRoutePath?> RouteAsync(
        GeographyPoint from,
        GeographyPoint to,
        DateTimeOffset departure,
        string mode,
        CancellationToken cancellationToken
    ) => throw new AssertFailedException("Unexpected route request.");

    public virtual Task<MapRouteEstimate?> EstimateRouteAsync(
        GeographyPoint from,
        GeographyPoint to,
        DateTimeOffset departure,
        string mode,
        PlanningProviderBudget budget,
        CancellationToken cancellationToken
    ) => throw new AssertFailedException("Unexpected route estimate request.");
}
