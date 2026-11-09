using TripPlanner.Api.Models;

namespace TripPlanner.Api.Database;

public interface IActivityPlanningDb
{
    Task<long> GetActivityPlanningRevisionAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );
    Task<StoredActivityPreferences> GetActivityPreferencesAsync(
        Guid subjectId,
        string scope,
        string cityId = "",
        CancellationToken cancellationToken = default
    );
    Task<StoredActivityPreferences?> SaveActivityPreferencesAsync(
        Guid userId,
        Guid? tripId,
        string scope,
        string cityId,
        ActivityPreferences preferences,
        long expectedVersion,
        CancellationToken cancellationToken = default
    );
    Task<StoredActivityPlan?> GetActivityPlanAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    );
    Task<StoredActivityPlan?> SaveActivityPlanAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        StoredActivityPlan plan,
        long expectedVersion,
        long expectedInputRevision,
        bool preserveTiming = false,
        CancellationToken cancellationToken = default
    );
    Task<ActivityPlanningEvidence> GetActivityPlanningEvidenceAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    );
    Task<bool> SaveActivityPlanningEvidenceAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        ActivityPlanningEvidence evidence,
        long expectedInputRevision,
        CancellationToken cancellationToken = default
    );
    Task<ActivityPlanningJob?> CreateActivityPlanningJobAsync(
        Guid userId,
        Guid tripId,
        ActivityPlanningJob job,
        CancellationToken cancellationToken = default
    );
    Task<ActivityPlanningJob?> GetActivityPlanningJobAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        Guid jobId,
        CancellationToken cancellationToken = default
    );
    Task<ActivityPlanningJob?> ClaimActivityPlanningJobAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    );
    Task<bool> CompleteActivityPlanningJobAsync(
        ActivityPlanningJob job,
        ActivityPlanningResult? result,
        string? error,
        bool finished,
        CancellationToken cancellationToken = default
    );
    Task<bool> SaveActivityProposalReviewAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        Guid jobId,
        ActivityProposalReview review,
        ActivityProposalReview expectedReview,
        long expectedInputRevision,
        long expectedPlanVersion,
        CancellationToken cancellationToken = default
    );
    Task<string[]> GetDismissedActivitySuggestionsAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        string contextVersion,
        long planVersion,
        CancellationToken cancellationToken = default
    );
    Task<ActivityCalendarSubscription[]> GetActivityCalendarSubscriptionsAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    );
    Task<ActivityCalendarSubscription?> CreateActivityCalendarSubscriptionAsync(
        Guid userId,
        Guid tripId,
        ActivityCalendarSubscription subscription,
        CancellationToken cancellationToken = default
    );
    Task<bool> RevokeActivityCalendarSubscriptionAsync(
        Guid userId,
        Guid tripId,
        Guid subscriptionId,
        CancellationToken cancellationToken = default
    );
    Task<ActivityCalendarSubscription?> FindActivityCalendarSubscriptionAsync(
        string tokenHash,
        CancellationToken cancellationToken = default
    );
}
