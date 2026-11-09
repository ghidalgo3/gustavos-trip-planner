using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Tests.Verification;

public static class ActivityPlanningProviderVerification
{
    public static async Task<bool> RunAsync(ActivityPlanningProviders providers)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        using var budget = new PlanningProviderBudget(12);
        var now = DateTimeOffset.UtcNow;
        var date = DateOnly.FromDateTime(now.UtcDateTime.AddDays(2));
        var user = new User(
            Guid.NewGuid(),
            "verification",
            "verification@example.invalid",
            "Verification",
            null,
            null,
            [],
            now,
            now
        );
        var trip = new Trip(
            Guid.NewGuid(),
            user.Id,
            "Provider verification",
            "",
            JsonSerializer.SerializeToElement(new { }),
            now,
            now
        );
        var place = new DestinationPlace(
            trip.Id,
            "paris-fr",
            "Paris",
            "FR",
            "Europe/Paris",
            2.3376,
            48.8606
        );
        var activity = new Activity(
            Guid.NewGuid(),
            trip.Id,
            place.CityId,
            new("Point", GeographyPoint.Create(latitude: 48.8606, longitude: 2.3376)),
            new(
                "Louvre Museum",
                TimeSpan.FromHours(2),
                "Visit the Louvre Museum in Paris",
                null,
                ActivityState.Proposed,
                [ActivityKind.Culture],
                "Musée du Louvre, Paris"
            ),
            now,
            now
        );
        var planningContext = new ActivityPlanningContext(
            trip,
            place,
            [new(trip.Id, place.CityId, Guid.NewGuid(), 0, date, date)],
            [activity],
            [],
            [user],
            new() { [user.Id] = new("I enjoy art museums") },
            new(),
            new(),
            new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>(),
            [],
            null,
            new(),
            1
        );
        bool successful = true;
        async Task Check(string name, Func<Task<bool>> test)
        {
            try
            {
                bool passed = await test();
                Console.WriteLine($"{name}: {(passed ? "passed" : "no usable evidence")}");
                successful &= passed;
            }
            catch (Exception e) when (e is not OutOfMemoryException)
            {
                Console.WriteLine(
                    $"{name}: unavailable ({(e is PlanningProviderException ? e.Message : e.GetType().Name)}); no provider bodies or credentials logged."
                );
                successful = false;
            }
        }
        await Check(
            "Azure Maps walking",
            async () =>
                (
                    await providers.RoutesAsync(
                        GeographyPoint.Create(latitude: 48.8606, longitude: 2.3376),
                        GeographyPoint.Create(latitude: 48.8566, longitude: 2.3522),
                        now.AddDays(2),
                        "walking",
                        budget,
                        deadline.Token
                    )
                ).Length > 0
        );
        await Check(
            "Azure Maps car",
            async () =>
                (
                    await providers.RoutesAsync(
                        GeographyPoint.Create(latitude: 48.8606, longitude: 2.3376),
                        GeographyPoint.Create(latitude: 48.8584, longitude: 2.2945),
                        now.AddDays(2),
                        "taxi",
                        budget,
                        deadline.Token
                    )
                ).Length > 0
        );
        await Check(
            "OpenAI Decisions affinity",
            async () =>
                (await providers.AffinityAsync(planningContext, budget, deadline.Token)).Length == 1
        );
        await Check(
            "OpenAI Responses opening hours",
            async () =>
                await providers.HoursAsync(activity, place.Name, [date], budget, deadline.Token)
                    is not null
        );
        return successful;
    }
}
