using System.Security.Cryptography;
using System.Text.Json;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Tests.Database;

public sealed partial class InMemoryPlannerDb
{
    private readonly Dictionary<
        (Guid Subject, string Scope, string City),
        StoredActivityPreferences
    > _activityPreferences = [];
    private readonly Dictionary<(Guid Trip, string City), StoredActivityPlan> _activityPlans = [];
    private readonly Dictionary<
        (Guid Trip, string City),
        ActivityPlanningEvidence
    > _planningEvidence = [];
    private readonly Dictionary<Guid, ActivityPlanningJob> _planningJobs = [];
    private readonly Dictionary<Guid, ActivityCalendarSubscription> _calendarSubscriptions = [];

    private long PlanningRevision(Guid tripId)
    {
        var members = _parties.Values.Where(p => p.TripId == tripId).OrderBy(p => p.Id).ToArray();
        var ids = members.SelectMany(p => p.UserIds).Append(_trips[tripId].OwnerUserId).ToHashSet();
        var bytes = JsonSerializer.SerializeToUtf8Bytes(
            new
            {
                Trip = _trips[tripId],
                Parties = members,
                Activities = _activities.Values.Where(a => a.TripId == tripId).OrderBy(a => a.Id),
                Visits = _destinationVisits
                    .Values.Where(v => v.TripId == tripId)
                    .OrderBy(v => v.StayId),
                Places = _destinationPlaces
                    .Values.Where(p => p.TripId == tripId)
                    .OrderBy(p => p.CityId),
                Stays = _stayLocations
                    .Where(p => p.Key.TripId == tripId)
                    .OrderBy(p => p.Key.CityId)
                    .Select(p => p.Value),
                Flights = _selectedFlights
                    .Where(p => p.Key.TripId == tripId)
                    .OrderBy(p => p.Key.PartyId)
                    .Select(p => p.Value),
                Preferences = _activityPreferences
                    .Where(p => p.Key.Subject == tripId || ids.Contains(p.Key.Subject))
                    .OrderBy(p => p.Key.Subject)
                    .ThenBy(p => p.Key.Scope)
                    .ThenBy(p => p.Key.City)
                    .Select(p => new
                    {
                        p.Key.Subject,
                        p.Key.Scope,
                        p.Key.City,
                        p.Value,
                    }),
                Evidence = _planningEvidence
                    .Where(p => p.Key.Trip == tripId)
                    .OrderBy(p => p.Key.City)
                    .Select(p => p.Value),
            }
        );
        return BitConverter.ToInt64(SHA256.HashData(bytes)) & long.MaxValue;
    }

    public Task<long> GetActivityPlanningRevisionAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            return Task.FromResult(
                _trips.TryGetValue(tripId, out var trip) && CanViewTrip(userId, trip)
                    ? PlanningRevision(tripId)
                    : -1L
            );
        }
    }

    public Task<StoredActivityPreferences> GetActivityPreferencesAsync(
        Guid subjectId,
        string scope,
        string cityId = "",
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            return Task.FromResult(
                _activityPreferences.GetValueOrDefault((subjectId, scope, cityId)) ?? new(new())
            );
        }
    }

    public Task<StoredActivityPreferences?> SaveActivityPreferencesAsync(
        Guid userId,
        Guid? tripId,
        string scope,
        string cityId,
        ActivityPreferences preferences,
        long expectedVersion,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                scope != "profile"
                && (
                    tripId is not { } id
                    || !_trips.TryGetValue(id, out var trip)
                    || !CanPlanTrip(userId, trip)
                )
            )
            {
                return Task.FromResult<StoredActivityPreferences?>(null);
            }

            var key = (scope == "profile" ? userId : tripId!.Value, scope, cityId);
            if ((_activityPreferences.GetValueOrDefault(key)?.Version ?? 0) != expectedVersion)
            {
                return Task.FromResult<StoredActivityPreferences?>(null);
            }

            var saved = new StoredActivityPreferences(preferences, expectedVersion + 1);
            _activityPreferences[key] = saved;
            return Task.FromResult<StoredActivityPreferences?>(saved);
        }
    }

    private void ReconcileActivityPlans(Guid tripId)
    {
        foreach (var key in _activityPlans.Keys.Where(k => k.Trip == tripId).ToArray())
        {
            if (!_destinationPlaces.ContainsKey((tripId, key.City)))
            {
                _activityPlans.Remove(key);
                continue;
            }
            var saved = _activityPlans[key];
            var plan = ActivityPlanRules.Reconcile(
                saved.Plan,
                _activities.Values.Where(a => a.TripId == tripId && a.CityId == key.City).ToArray(),
                _destinationVisits
                    .Values.Where(v => v.TripId == tripId && v.CityId == key.City)
                    .ToArray()
            );
            plan = plan with
            {
                Days = plan
                    .Days.Select(day =>
                        day with
                        {
                            FlightMatches = day
                                .FlightMatches.Where(match =>
                                    _trips.TryGetValue(tripId, out var visibleTrip)
                                    && CanViewTrip(match.TravellerId, visibleTrip)
                                )
                                .ToArray(),
                        }
                    )
                    .ToArray(),
            };
            if (JsonSerializer.Serialize(saved.Plan) != JsonSerializer.Serialize(plan))
            {
                _activityPlans[key] = saved with { Plan = plan, Version = saved.Version + 1 };
            }
        }
        foreach (
            var sub in _calendarSubscriptions
                .Values.Where(s => s.TripId == tripId && s.RevokedAt is null)
                .ToArray()
        )
        {
            if (!_trips.TryGetValue(tripId, out var trip) || !CanViewTrip(sub.UserId, trip))
            {
                _calendarSubscriptions[sub.Id] = sub with
                {
                    RevokedAt = OperationClock.GetUtcNow(),
                };
            }
        }
    }

    public Task<StoredActivityPlan?> GetActivityPlanAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (!_trips.TryGetValue(tripId, out var trip) || !CanViewTrip(userId, trip))
            {
                return Task.FromResult<StoredActivityPlan?>(null);
            }

            return Task.FromResult(_activityPlans.GetValueOrDefault((tripId, cityId)));
        }
    }

    public Task<StoredActivityPlan?> SaveActivityPlanAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        StoredActivityPlan plan,
        long expectedVersion,
        long expectedInputRevision,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(userId, trip)
                || !_destinationPlaces.ContainsKey((tripId, cityId))
                || PlanningRevision(tripId) != expectedInputRevision
                || (_activityPlans.GetValueOrDefault((tripId, cityId))?.Version ?? 0)
                    != expectedVersion
            )
            {
                return Task.FromResult<StoredActivityPlan?>(null);
            }

            foreach (
                var activity in _activities
                    .Values.Where(a => a.TripId == tripId && a.CityId == cityId)
                    .ToArray()
            )
            {
                ActivityState state = ActivityPlanRules.SelectionState(activity, plan.Plan);
                if (state != activity.Properties.State)
                {
                    _activities[activity.Id] = activity with
                    {
                        Properties = activity.Properties with { State = state },
                        UpdatedAt = OperationClock.GetUtcNow(),
                    };
                }
            }
            var saved = plan with
            {
                Version = expectedVersion + 1,
                InputRevision = PlanningRevision(tripId),
            };
            _activityPlans[(tripId, cityId)] = saved;
            return Task.FromResult<StoredActivityPlan?>(saved);
        }
    }

    public Task<ActivityPlanningEvidence> GetActivityPlanningEvidenceAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            return Task.FromResult(_planningEvidence.GetValueOrDefault((tripId, cityId)) ?? new());
        }
    }

    public Task<bool> SaveActivityPlanningEvidenceAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        ActivityPlanningEvidence evidence,
        long expectedInputRevision,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(userId, trip)
                || PlanningRevision(tripId) != expectedInputRevision
            )
            {
                return Task.FromResult(false);
            }

            _planningEvidence[(tripId, cityId)] = evidence;
            return Task.FromResult(true);
        }
    }

    public Task<ActivityPlanningJob?> CreateActivityPlanningJobAsync(
        Guid userId,
        Guid tripId,
        ActivityPlanningJob job,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (!_trips.TryGetValue(tripId, out var trip) || !CanPlanTrip(userId, trip))
            {
                return Task.FromResult<ActivityPlanningJob?>(null);
            }

            if (_planningJobs.TryGetValue(job.Id, out var existing))
            {
                return Task.FromResult(
                    existing.UserId == userId
                    && existing.TripId == tripId
                    && existing.RequestHash == job.RequestHash
                        ? existing
                        : null
                );
            }

            if (_operations.ContainsKey(job.Id) || PlanningRevision(tripId) != job.InputRevision)
            {
                return Task.FromResult<ActivityPlanningJob?>(null);
            }

            _planningJobs[job.Id] = job;
            _operations[job.Id] = new(
                userId,
                tripId,
                1,
                job.Status == "Completed" ? 1 : 0,
                job.CreatedAt
            )
            {
                Type = "activityPlan" + (job.Kind == "assessment" ? "Assessment" : "Proposal"),
                Status = job.Status,
            };
            return Task.FromResult<ActivityPlanningJob?>(job);
        }
    }

    public Task<ActivityPlanningJob?> GetActivityPlanningJobAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        Guid jobId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            return Task.FromResult(
                _trips.TryGetValue(tripId, out var trip)
                && CanViewTrip(userId, trip)
                && _planningJobs.TryGetValue(jobId, out var job)
                && job.TripId == tripId
                && job.CityId == cityId
                    ? job
                    : null
            );
        }
    }

    public Task<ActivityPlanningJob?> ClaimActivityPlanningJobAsync(
        TimeSpan leaseDuration,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            var now = OperationClock.GetUtcNow();
            var job = _planningJobs
                .Values.OrderBy(j => j.CreatedAt)
                .FirstOrDefault(j =>
                    (j.Status is "pending" or "InProgress")
                    && (j.LeaseExpiresAt is null || j.LeaseExpiresAt <= now)
                );
            if (job is null)
            {
                return Task.FromResult<ActivityPlanningJob?>(null);
            }

            job = job with
            {
                LeaseId = Guid.NewGuid(),
                LeaseExpiresAt = now + leaseDuration,
                Attempts = job.Attempts + 1,
                Status = "InProgress",
            };
            _planningJobs[job.Id] = job;
            _operations[job.Id].Status = "InProgress";
            return Task.FromResult<ActivityPlanningJob?>(job);
        }
    }

    public Task<bool> CompleteActivityPlanningJobAsync(
        ActivityPlanningJob job,
        ActivityPlanningResult? result,
        string? error,
        bool finished,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                !_planningJobs.TryGetValue(job.Id, out var current)
                || current.LeaseId != job.LeaseId
                || current.LeaseExpiresAt <= OperationClock.GetUtcNow()
                || current.Status != "InProgress"
            )
            {
                return Task.FromResult(false);
            }

            var status = finished
                ? error is null
                    ? "Completed"
                    : "Failed"
                : "InProgress";
            _planningJobs[job.Id] = current with
            {
                Result = result ?? current.Result,
                Error = error,
                Status = status,
            };
            var operation = _operations[job.Id];
            operation.Status = status;
            operation.CompletedItems = status == "Completed" ? 1 : 0;
            operation.FailedItems = status == "Failed" ? 1 : 0;
            operation.UpdatedAt = OperationClock.GetUtcNow();
            return Task.FromResult(true);
        }
    }

    public Task<bool> SaveActivityProposalReviewAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        Guid jobId,
        ActivityProposalReview review,
        ActivityProposalReview expectedReview,
        long expectedInputRevision,
        long expectedPlanVersion,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                !_trips.TryGetValue(tripId, out var trip)
                || !CanPlanTrip(userId, trip)
                || !_planningJobs.TryGetValue(jobId, out var job)
                || job.TripId != tripId
                || job.CityId != cityId
                || PlanningRevision(tripId) != expectedInputRevision
                || (_activityPlans.GetValueOrDefault((tripId, cityId))?.Version ?? 0)
                    != expectedPlanVersion
                || ActivityPlanRules.Hash(job.Review) != ActivityPlanRules.Hash(expectedReview)
            )
            {
                return Task.FromResult(false);
            }

            _planningJobs[jobId] = job with { Review = review };
            return Task.FromResult(true);
        }
    }

    public Task<string[]> GetDismissedActivitySuggestionsAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        string contextVersion,
        long planVersion,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            return Task.FromResult(
                _planningJobs
                    .Values.Where(j =>
                        j.TripId == tripId
                        && j.CityId == cityId
                        && j.Result?.ContextVersion == contextVersion
                        && j.PlanVersion == planVersion
                    )
                    .SelectMany(j =>
                        j.Result!.Suggestions.Where(s =>
                                j.Review.DismissedSuggestionIds.Contains(s.Id)
                            )
                            .Select(s => s.Fingerprint)
                    )
                    .Distinct()
                    .ToArray()
            );
        }
    }

    public Task<ActivityCalendarSubscription[]> GetActivityCalendarSubscriptionsAsync(
        Guid userId,
        Guid tripId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            return Task.FromResult(
                _calendarSubscriptions
                    .Values.Where(s => s.UserId == userId && s.TripId == tripId)
                    .OrderBy(s => s.CreatedAt)
                    .ToArray()
            );
        }
    }

    public Task<ActivityCalendarSubscription?> CreateActivityCalendarSubscriptionAsync(
        Guid userId,
        Guid tripId,
        ActivityCalendarSubscription subscription,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (!_trips.TryGetValue(tripId, out var trip) || !CanViewTrip(userId, trip))
            {
                return Task.FromResult<ActivityCalendarSubscription?>(null);
            }

            _calendarSubscriptions[subscription.Id] = subscription;
            return Task.FromResult<ActivityCalendarSubscription?>(subscription);
        }
    }

    public Task<bool> RevokeActivityCalendarSubscriptionAsync(
        Guid userId,
        Guid tripId,
        Guid subscriptionId,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            if (
                !_calendarSubscriptions.TryGetValue(subscriptionId, out var sub)
                || sub.UserId != userId
                || sub.TripId != tripId
            )
            {
                return Task.FromResult(false);
            }

            _calendarSubscriptions[sub.Id] = sub with
            {
                RevokedAt = sub.RevokedAt ?? OperationClock.GetUtcNow(),
            };
            return Task.FromResult(true);
        }
    }

    public Task<ActivityCalendarSubscription?> FindActivityCalendarSubscriptionAsync(
        string tokenHash,
        CancellationToken cancellationToken = default
    )
    {
        lock (_tripLock)
        {
            foreach (
                var tripId in _calendarSubscriptions
                    .Values.Select(s => s.TripId)
                    .Distinct()
                    .ToArray()
            )
            {
                ReconcileActivityPlans(tripId);
            }

            return Task.FromResult(
                _calendarSubscriptions.Values.FirstOrDefault(s =>
                    s.TokenHash == tokenHash && s.RevokedAt is null
                )
            );
        }
    }
}
