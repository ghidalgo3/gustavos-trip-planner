using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;

namespace TripPlanner.Api.Services.Maps;

public delegate Task<IReadOnlyList<ActivityVenue>> VenueSearch(
    string query,
    string city,
    string countryCode,
    IReadOnlyList<DestinationStay> stays,
    CancellationToken cancellationToken
);

public sealed class VenueAddressLookup(IAzureMapsClient maps, ILogger<VenueAddressLookup> logger)
{
    public async Task<IReadOnlyList<VenueAddressSuggestion>> FindAsync(
        VenueSearch search,
        string query,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken cancellationToken
    )
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(35));
        var matches = await search(
            query,
            destination.Properties.Name,
            destination.Properties.CountryCode,
            destination.Properties.Stays,
            deadline.Token
        );
        using var concurrency = new SemaphoreSlim(2);
        var located = await Task.WhenAll(
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
        return located.SelectMany(results => results).ToArray();
    }

    private async Task<VenueAddressSuggestion[]> LocateAsync(
        ActivityVenue venue,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken deadline,
        CancellationToken cancellationToken
    )
    {
        IReadOnlyList<AddressLocationCandidate> locations = [];
        using var geocoding = CancellationTokenSource.CreateLinkedTokenSource(deadline);
        geocoding.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            // Geocode researched street addresses, never similarly named fuzzy POIs.
            if (!deadline.IsCancellationRequested)
            {
                locations = await maps.GeocodeAddressAsync(
                    venue.Address,
                    destination.Properties.Name,
                    destination.Properties.CountryCode,
                    geocoding.Token,
                    destination.Geometry,
                    venue.AddressComponents
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
                "Venue address geocoding unavailable ({FailureType})",
                exception.GetType().Name
            );
        }
        cancellationToken.ThrowIfCancellationRequested();
        if (locations.Count == 0)
        {
            return
            [
                new(
                    venue.PlaceName,
                    venue.Address,
                    venue.Source,
                    null,
                    "Published address found, but no precise venue pin could be verified for this destination. Neighbourhood and postcode centres are not used as venue locations."
                ),
            ];
        }
        return locations
            .Take(3)
            .Select(location => new VenueAddressSuggestion(
                venue.PlaceName,
                venue.Address,
                venue.Source,
                location.Geometry,
                location.PostalCodeMismatch
                        ? "The venue and map postcodes differ. The venue may use an organization-specific mailing postcode. Check the street address and map pin before saving."
                    : location.Confidence == AddressMatchConfidence.Medium
                    || location.Ambiguous
                    || locations.Count > 1
                        ? "Possible address match. Check the map address and pin before saving."
                    : null
            )
            {
                MapAddress = location.FormattedAddress,
            })
            .ToArray();
    }
}
