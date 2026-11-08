using Microsoft.Spatial;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Services.ActivityPlanning;

public sealed class ActivityPlanningService(
    IPlannerDb database,
    ActivityFlightAvailability flights,
    TimeProvider clock,
    IAzureMapsClient maps
)
{
    public static string ContextVersion(ActivityPlanningContext planningContext) =>
        planningContext.InputRevision.ToString(System.Globalization.CultureInfo.InvariantCulture);

    public async Task<ActivityPlanningContext?> ReadAsync(
        Guid userId,
        Guid tripId,
        string cityId,
        CancellationToken ct
    )
    {
        // Reads may span connections. Check the revision again before exposing a coherent planning context.
        for (int attempt = 0; attempt < 3; attempt++)
        {
            long revision = await database.GetActivityPlanningRevisionAsync(userId, tripId, ct);
            if (revision < 0)
            {
                return null;
            }

            var trip = await database.GetVisibleTripAsync(userId, tripId, ct);
            var place = await database.GetDestinationPlaceAsync(userId, tripId, cityId, ct);
            if (trip is null || place is null)
            {
                return null;
            }
            if (string.IsNullOrWhiteSpace(place.TimeZone))
            {
                place = place with
                {
                    TimeZone =
                        await maps.ResolveTimeZoneAsync(
                            GeographyPoint.Create(place.Latitude, place.Longitude),
                            ct
                        ) ?? "",
                };
            }

            var parties = await database.GetPartiesAsync(userId, tripId, ct);
            var travellers = new List<User>();
            var profiles = new Dictionary<Guid, ActivityPreferences>();
            foreach (
                var id in parties
                    .SelectMany(p => p.UserIds)
                    .Append(trip.OwnerUserId)
                    .Distinct()
                    .Order()
            )
            {
                if (await database.GetUserAsync(id, ct) is not { } user)
                {
                    continue;
                }

                travellers.Add(user);
                profiles[id] = (
                    await database.GetActivityPreferencesAsync(id, "profile", cancellationToken: ct)
                ).Preferences;
            }
            var planningContext = new ActivityPlanningContext(
                trip,
                place,
                (await database.GetDestinationVisitsAsync(userId, tripId, ct))
                    .Where(v => v.CityId == cityId)
                    .ToArray(),
                (await database.GetActivitiesAsync(userId, tripId, cityId, ct)).ToArray(),
                parties.ToArray(),
                travellers.ToArray(),
                profiles,
                (
                    await database.GetActivityPreferencesAsync(
                        tripId,
                        "trip",
                        cancellationToken: ct
                    )
                ).Preferences,
                (
                    await database.GetActivityPreferencesAsync(tripId, "destination", cityId, ct)
                ).Preferences,
                await database.GetStayLocationsAsync(userId, tripId, ct),
                (await database.GetSelectedFlightsAsync(userId, tripId, ct)).ToArray(),
                await database.GetActivityPlanAsync(userId, tripId, cityId, ct),
                await database.GetActivityPlanningEvidenceAsync(userId, tripId, cityId, ct),
                revision
            );
            planningContext = planningContext with
            {
                FlightChoices = (
                    await database.GetFlightChoicesAsync(userId, tripId, ct)
                ).ToArray(),
            };
            if (revision == await database.GetActivityPlanningRevisionAsync(userId, tripId, ct))
            {
                return planningContext with { FlightLegs = flights.ReadLegs(planningContext) };
            }
        }
        throw new ActivityPlanningChangedException();
    }

    public ActivityPlanResponse Response(
        ActivityPlanningContext planningContext,
        DateTimeOffset? evaluatedAt = null
    )
    {
        var plan = planningContext.SavedPlan?.Plan ?? ActivityPlanRules.Initial(planningContext);
        if (string.IsNullOrWhiteSpace(plan.TimeZone))
        {
            plan = plan with
            {
                TimeZone = ActivityPlanRules.EffectiveTimeZone(plan, planningContext),
            };
        }
        return new(
            plan,
            planningContext.SavedPlan?.Version ?? 0,
            ContextVersion(planningContext),
            planningContext.Evaluate(plan, evaluatedAt ?? clock.GetUtcNow()),
            planningContext.SavedPlan?.Assessment,
            planningContext.SavedPlan is { } saved
                && saved.InputRevision != planningContext.InputRevision,
            new(
                planningContext.Place.Name,
                planningContext.Visits,
                planningContext.Travellers.Select(u => u.Id).ToArray(),
                planningContext.Travellers.Select(u => u.DisplayName).ToArray(),
                planningContext.TripPreferences.Instructions,
                planningContext.DestinationPreferences.Instructions,
                flights.Suggest(planningContext, plan)
            )
        );
    }

    public ActivityPlanningResult Assess(
        ActivityPlanningContext planningContext,
        ActivityPlan plan,
        Guid id
    ) =>
        new(
            id,
            "assessment",
            "completed",
            planningContext.SavedPlan?.Version ?? 0,
            ContextVersion(planningContext),
            planningContext.Evaluate(plan, clock.GetUtcNow()),
            [],
            [],
            planningContext.Evidence.Warnings
        )
        {
            SuggestedRules = planningContext.Evidence.SuggestedRules,
            SuggestedAvailability = flights.Suggest(planningContext, plan),
        };
}

public sealed class ActivityPlanningChangedException : Exception;
