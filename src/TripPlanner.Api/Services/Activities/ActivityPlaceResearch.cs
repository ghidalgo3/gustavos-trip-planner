using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Services.Activities;

public interface IActivityVenueSearch
{
    Task<IReadOnlyList<ActivityVenue>> SearchActivitiesAsync(
        string query,
        string city,
        string countryCode,
        IReadOnlyList<DestinationStay> stays,
        CancellationToken cancellationToken
    );
}

public interface IActivityPlaceResearch
{
    Task<IReadOnlyList<VenueAddressSuggestion>> FindAsync(
        string query,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken cancellationToken
    );
}

public sealed class ActivityPlaceResearch(
    IActivityVenueSearch venues,
    VenueAddressLookup locations,
    IActivityCoordinateResearch coordinates,
    ILogger<ActivityPlaceResearch> logger
) : IActivityPlaceResearch
{
    public async Task<IReadOnlyList<VenueAddressSuggestion>> FindAsync(
        string query,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken cancellationToken
    )
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(60));
        var results = await locations.FindAsync(
            venues.SearchActivitiesAsync,
            query,
            destination,
            deadline.Token
        );
        using var concurrency = new SemaphoreSlim(2);
        var resolved = await Task.WhenAll(
            results.Select(async result =>
            {
                if (result.Geometry is not null || deadline.IsCancellationRequested)
                {
                    return result;
                }
                bool entered = false;
                try
                {
                    await concurrency.WaitAsync(deadline.Token);
                    entered = true;
                    var published = await coordinates.FindAsync(
                        new(
                            result.Name,
                            result.Name,
                            null,
                            result.Address,
                            null,
                            null,
                            null,
                            null,
                            null
                        ),
                        result.Address,
                        destination.Geometry!,
                        deadline.Token
                    );
                    if (published is not null)
                    {
                        return result with
                        {
                            Geometry = published.Geometry,
                            LocationSource = published.Source,
                            Warning =
                                "Published venue coordinates. Review the map pin before saving.",
                        };
                    }
                }
                catch (Exception exception)
                    when (exception
                            is HttpRequestException
                                or System.Text.Json.JsonException
                                or OperationCanceledException
                                or InvalidOperationException
                                or IOException
                    )
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    logger.LogWarning(
                        "Published venue location unavailable ({FailureType})",
                        exception.GetType().Name
                    );
                }
                finally
                {
                    if (entered)
                    {
                        concurrency.Release();
                    }
                }
                return result;
            })
        );
        cancellationToken.ThrowIfCancellationRequested();
        return resolved;
    }
}
