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

public sealed class ActivityPlaceResearch(IActivityVenueSearch venues, VenueAddressLookup locations)
    : IActivityPlaceResearch
{
    public Task<IReadOnlyList<VenueAddressSuggestion>> FindAsync(
        string query,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken cancellationToken
    ) => locations.FindAsync(venues.SearchActivitiesAsync, query, destination, cancellationToken);
}
