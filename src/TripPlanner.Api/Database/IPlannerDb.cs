using System.Text.Json;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Database;

public interface IPlannerDb
{
    Task<IReadOnlyDictionary<string, GeoJsonFeature<StayLocationProperties>>> GetStayLocationsAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );
    Task<bool> SaveStayLocationAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        GeoJsonFeature<StayLocationProperties>? feature,
        CancellationToken cancellationToken = default
    );

    Task<DestinationPlace?> GetDestinationPlaceAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    );
    Task<DestinationPlace> SaveDestinationPlaceAsync(
        Guid ownerUserId,
        DestinationPlace place,
        CancellationToken cancellationToken = default
    );
    Task<DestinationPlace?> ReplaceDestinationPlaceAsync(
        Guid ownerUserId,
        DestinationPlace place,
        CancellationToken cancellationToken = default
    );
    Task<bool> DeleteDestinationAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    );
    Task<IReadOnlyList<DestinationPlace>> GetDestinationPlacesAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );
    Task<IReadOnlyList<DestinationVisit>> GetDestinationVisitsAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );
    Task<DestinationVisit?> AddDestinationVisitAsync(
        Guid ownerUserId,
        DestinationVisit visit,
        CancellationToken cancellationToken = default
    );
    Task<DestinationVisit?> ReplaceDestinationVisitAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        Guid stayId,
        DestinationStayInput input,
        CancellationToken cancellationToken = default
    );
    Task<bool> DeleteDestinationVisitAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        Guid stayId,
        CancellationToken cancellationToken = default
    );
    Task<IReadOnlyList<Activity>> GetActivitiesAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    );
    Task<Activity?> GetActivityAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        Guid activityId,
        CancellationToken cancellationToken = default
    );
    Task<Activity?> SaveActivityAsync(
        Guid ownerUserId,
        Activity activity,
        string contextVersion,
        DateTimeOffset? expectedUpdatedAt,
        CancellationToken cancellationToken = default
    );
    Task<bool> DeleteActivityAsync(
        Guid ownerUserId,
        Guid tripId,
        string cityId,
        Guid activityId,
        string contextVersion,
        DateTimeOffset expectedUpdatedAt,
        CancellationToken cancellationToken = default
    );
    Task<TrackedOperation> CreateActivityJobAsync(
        Guid ownerUserId,
        Guid tripId,
        Guid requestId,
        string cityId,
        string contextVersion,
        string input,
        byte[]? image,
        string? mimeType,
        CancellationToken cancellationToken = default
    );
    Task<ActivityJob?> ClaimActivityJobAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    );
    Task<bool> CompleteActivityJobAsync(
        ActivityJob job,
        IReadOnlyList<Activity>? activities,
        string[] warnings,
        string? error,
        CancellationToken cancellationToken = default
    );
    Task<ActivitySuggestionResult?> GetActivityJobResultAsync(
        Guid viewerUserId,
        Guid tripId,
        string cityId,
        Guid operationId,
        CancellationToken cancellationToken = default
    );
    Task<IReadOnlyList<FlightChoiceProgress>> GetFlightChoicesAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );
    Task<FlightChoiceProgress> SetFlightChoicesAsync(
        Guid ownerUserId,
        Guid tripId,
        FlightChoiceProgress choices,
        CancellationToken cancellationToken = default
    );
    Task<IReadOnlyList<SelectedFlight>> GetSelectedFlightsAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );
    Task<SelectedFlight> SetSelectedFlightAsync(
        Guid ownerUserId,
        SelectedFlight selectedFlight,
        CancellationToken cancellationToken = default
    );
    Task DeleteSelectedFlightAsync(
        Guid ownerUserId,
        Guid tripId,
        Guid partyId,
        CancellationToken cancellationToken = default
    );
    Task<TrackedOperation> CreateTripFormOperationAsync(
        Guid userId,
        Guid tripId,
        Guid operationId,
        string input,
        PlanningDocument draft,
        CancellationToken cancellationToken = default
    );
    Task<TripFormWork?> ClaimTripFormWorkAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    );
    Task<bool> CompleteTripFormWorkAsync(
        TripFormWork work,
        TripFormProposal? proposal,
        string? error,
        CancellationToken cancellationToken = default
    );
    Task<TripFormProposal?> GetTripFormProposalAsync(
        Guid userId,
        Guid tripId,
        Guid operationId,
        CancellationToken cancellationToken = default
    );
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
    Task<bool> RetryFareWorkAsync(
        FareWork work,
        TimeSpan delay,
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

    Task<IReadOnlyList<UserSearchResult>> SearchUsersAsync(
        Guid excludingUserId,
        string query,
        CancellationToken cancellationToken = default
    );

    Task<PartyMemberChangeStatus> ChangePartyMemberAsync(
        Guid ownerUserId,
        Guid tripId,
        Guid partyId,
        Guid memberUserId,
        bool add,
        CancellationToken cancellationToken = default,
        string role = "Traveller"
    );

    Task<IReadOnlyList<Party>> GetPartiesAsync(
        Guid viewerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );

    Task<Trip?> SetFlightConstraintsAsync(
        Guid ownerUserId,
        Guid tripId,
        JsonElement constraints,
        CancellationToken cancellationToken = default
    );

    Task<User> SetUserProfileAsync(
        Guid userId,
        UserProfile profile,
        CancellationToken cancellationToken = default
    );

    Task<User> SetUserFeatureFlagsAsync(
        Guid userId,
        string featureFlags,
        CancellationToken cancellationToken = default
    );

    Task<IReadOnlyList<Trip>> GetTripsAsync(
        Guid viewerUserId,
        CancellationToken cancellationToken = default
    );

    Task<Trip?> GetVisibleTripAsync(
        Guid viewerUserId,
        Guid tripId,
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
        CancellationToken cancellationToken = default,
        JsonElement? constraints = null
    );

    Task<Trip?> UpdateTripAsync(
        Guid ownerUserId,
        Guid tripId,
        string name,
        string description,
        CancellationToken cancellationToken = default,
        JsonElement? constraints = null
    );

    Task<bool> DeleteTripAsync(
        Guid ownerUserId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );
}
