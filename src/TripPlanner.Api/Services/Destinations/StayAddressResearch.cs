using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;

namespace TripPlanner.Api.Services.Destinations;

public interface IStayVenueSearch
{
    Task<IReadOnlyList<ActivityVenue>> SearchAsync(
        string query,
        string city,
        string countryCode,
        IReadOnlyList<DestinationStay> stays,
        CancellationToken cancellationToken
    );
}

public interface IStayAddressResearch
{
    Task<IReadOnlyList<StayAddressSuggestion>> FindAsync(
        string query,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken cancellationToken
    );
}

public sealed class StayAddressResearch(
    IStayVenueSearch venues,
    IActivityPlaceResolver places,
    ILogger<StayAddressResearch> logger
) : IStayAddressResearch
{
    public async Task<IReadOnlyList<StayAddressSuggestion>> FindAsync(
        string query,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken cancellationToken
    )
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(35));
        var matches = await venues.SearchAsync(
            query,
            destination.Properties.Name,
            destination.Properties.CountryCode,
            destination.Properties.Stays,
            deadline.Token
        );
        using var concurrency = new SemaphoreSlim(2);
        return await Task.WhenAll(
            matches
                .DistinctBy(
                    venue => $"{venue.PlaceName}|{venue.Address}",
                    StringComparer.OrdinalIgnoreCase
                )
                .Take(5)
                .Select(async venue =>
                {
                    await concurrency.WaitAsync(cancellationToken);
                    try
                    {
                        return await LocateAsync(
                            venue,
                            destination,
                            deadline.Token,
                            cancellationToken
                        );
                    }
                    finally
                    {
                        concurrency.Release();
                    }
                })
        );
    }

    private async Task<StayAddressSuggestion> LocateAsync(
        ActivityVenue venue,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken deadline,
        CancellationToken cancellationToken
    )
    {
        GeoJsonPoint? geometry = null;
        using var geocoding = CancellationTokenSource.CreateLinkedTokenSource(deadline);
        geocoding.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            // Geocode researched street addresses, never similarly named fuzzy POIs.
            if (!deadline.IsCancellationRequested)
            {
                geometry = await places.ResolveAddressAsync(
                    venue.Address,
                    destination.Properties.Name,
                    destination.Properties.CountryCode,
                    geocoding.Token,
                    destination.Geometry
                );
            }
        }
        catch (Exception exception)
            when (exception
                    is HttpRequestException
                        or JsonException
                        or OperationCanceledException
                        or InvalidOperationException
                        or IOException
            )
        {
            cancellationToken.ThrowIfCancellationRequested();
            logger.LogWarning(
                "Stay address geocoding unavailable ({FailureType})",
                exception.GetType().Name
            );
        }
        cancellationToken.ThrowIfCancellationRequested();
        return new(
            venue.PlaceName,
            venue.Address,
            venue.Source,
            geometry,
            geometry is null
                ? "Address found, but its map location could not be confirmed. Try searching the full address."
                : null
        );
    }
}
