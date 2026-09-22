using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public interface IPlannerDb
{
    Task<TrackedOperation> CreateFlightSearchOperationAsync(
        Guid userId,
        Guid tripId,
        Guid requestId,
        SearchPlanPreview preview,
        CancellationToken cancellationToken = default
    );
    Task<TrackedOperation?> GetOperationAsync(
        Guid userId,
        Guid operationId,
        CancellationToken cancellationToken = default
    );
    Task<IReadOnlyList<TrackedOperation>> GetOperationsAsync(
        Guid userId,
        string? type,
        int top,
        int skip,
        CancellationToken cancellationToken = default
    );
    Task<IReadOnlyList<FareSearchResult>?> GetFareSearchResultsAsync(
        Guid userId,
        Guid tripId,
        SearchPlanPreview preview,
        CancellationToken cancellationToken = default
    );
    Task<FareWork?> ClaimFareWorkAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    );
    Task<bool> CompleteFareWorkAsync(
        FareWork work,
        JsonElement? response,
        DateTimeOffset? fetchedAt,
        string? error,
        CancellationToken cancellationToken = default
    );

    Task<User> GetOrCreateUserAsync(
        AuthenticatedUserProfile profile,
        CancellationToken cancellationToken = default
    );

    Task<User?> GetUserAsync(Guid userId, CancellationToken cancellationToken = default);

    Task<User?> GetUserByEmailAsync(string email, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Party>> GetPartiesAsync(
        Guid ownerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );

    Task<Trip?> SetConstraintsAsync(
        Guid ownerUserId,
        Guid tripId,
        JsonElement constraints,
        CancellationToken cancellationToken = default
    );

    Task<User> SetHomeCityAsync(
        AuthenticatedUserProfile profile,
        string cityName,
        GeographicPoint location,
        CancellationToken cancellationToken = default
    );

    Task<IReadOnlyList<Trip>> GetTripsAsync(
        Guid ownerUserId,
        CancellationToken cancellationToken = default
    );

    Task<Trip?> GetTripAsync(
        Guid ownerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );

    Task<Trip> CreateTripAsync(
        Guid ownerUserId,
        string name,
        string description,
        CancellationToken cancellationToken = default
    );

    Task<Trip?> UpdateTripAsync(
        Guid ownerUserId,
        Guid tripId,
        string name,
        string description,
        CancellationToken cancellationToken = default
    );

    Task<bool> DeleteTripAsync(
        Guid ownerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );
}
