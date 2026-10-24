using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.Maps;

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
    Task<IReadOnlyList<VenueAddressSuggestion>> FindAsync(
        string query,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken cancellationToken
    );
}

public sealed class StayAddressResearch(IStayVenueSearch venues, VenueAddressLookup locations)
    : IStayAddressResearch
{
    public Task<IReadOnlyList<VenueAddressSuggestion>> FindAsync(
        string query,
        GeoJsonFeature<DestinationProperties> destination,
        CancellationToken cancellationToken
    ) => locations.FindAsync(venues.SearchAsync, query, destination, cancellationToken);
}
