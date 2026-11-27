using System.Text.Json;
using System.Transactions;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.SeedDatabase;

public sealed partial class DatabaseSeeder
{
    public async Task<Trip> SeedPlanningAuditAsync(User owner, string name, DateOnly today)
    {
        if ((await database.GetTripsAsync(owner.Id)).Any(trip => trip.Name == name))
        {
            throw new InvalidOperationException("Choose a new name for each planning audit run.");
        }

        using var transaction = new TransactionScope(
            TransactionScopeOption.Required,
            new TransactionOptions { IsolationLevel = IsolationLevel.ReadCommitted },
            TransactionScopeAsyncFlowOption.Enabled
        );
        var trip = await database.CreateTripAsync(owner.Id, name, "");
        var start = today.AddDays(14);
        var amsterdam = await AddAuditVisitAsync(
            owner.Id,
            trip.Id,
            Amsterdam,
            0,
            start,
            start.AddDays(2)
        );
        var london = await AddAuditVisitAsync(
            owner.Id,
            trip.Id,
            London,
            1,
            start.AddDays(3),
            start.AddDays(3)
        );
        var place =
            await database.GetDestinationPlaceAsync(owner.Id, trip.Id, Amsterdam.Id)
            ?? throw new InvalidOperationException(
                "Amsterdam is missing from the planning fixture."
            );
        var now = DateTimeOffset.UtcNow;
        var activities = new List<Activity>();
        foreach (var title in new[] { "Canal walk", "Museum visit", "Market visit" })
        {
            var activity = new Activity(
                Guid.NewGuid(),
                trip.Id,
                place.CityId,
                null,
                new(title, TimeSpan.FromHours(1), "", null, ActivityState.Yes, [], null),
                now,
                now
            );
            activities.Add(
                await database.SaveActivityAsync(owner.Id, activity, place.ContextVersion, null)
                    ?? throw new InvalidOperationException($"Could not seed {title}.")
            );
        }
        foreach (
            var (visit, city, inbound) in new[]
            {
                (amsterdam, Amsterdam, true),
                (london, London, false),
            }
        )
        {
            var home = new TransportationFeature(
                inbound ? "from" : "to",
                null,
                new(Reference: new("home", owner.Id))
            );
            var destination = new TransportationFeature(
                inbound ? "to" : "from",
                new(
                    "Point",
                    JsonSerializer.SerializeToElement(new[] { city.Longitude, city.Latitude })
                ),
                new(Name: city.Name)
            );
            _ =
                await database.SaveTransportationAsync(
                    owner.Id,
                    trip.Id,
                    new(
                        Guid.NewGuid(),
                        inbound ? $"Home to {city.Name}" : $"{city.Name} to Home",
                        "",
                        "arranged-separately",
                        null,
                        null,
                        null,
                        null,
                        inbound ? [home, destination] : [destination, home],
                        OriginStayId: inbound ? null : visit.StayId,
                        DestinationStayId: inbound ? visit.StayId : null
                    ),
                    null
                ) ?? throw new InvalidOperationException("Could not seed the home travel leg.");
        }
        var revision = await database.GetActivityPlanningRevisionAsync(owner.Id, trip.Id);
        var context = new ActivityPlanningContext(
            trip,
            place,
            [amsterdam],
            [.. activities],
            [],
            [owner],
            [],
            new(),
            new(),
            new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>(),
            [],
            null,
            new(),
            revision
        );
        var plan = ActivityPlanRules.Initial(context) with
        {
            Days =
            [
                new(amsterdam.StayId, start, [activities[0].Id]),
                new(amsterdam.StayId, start.AddDays(1), [activities[1].Id]),
                new(amsterdam.StayId, start.AddDays(2), []),
            ],
            Rules =
            [
                new(activities[0].Id) { FixedDate = start, FixedStart = new(10, 0) },
                new(activities[1].Id) { FixedDate = start.AddDays(1), FixedStart = new(10, 0) },
            ],
        };
        _ =
            await database.SaveActivityPlanAsync(
                owner.Id,
                trip.Id,
                Amsterdam.Id,
                new(plan, context.Evaluate(plan, now), 0, revision, now),
                0,
                revision
            ) ?? throw new InvalidOperationException("Could not seed the activity schedule.");
        transaction.Complete();
        return trip;
    }

    private async Task<DestinationVisit> AddAuditVisitAsync(
        Guid ownerId,
        Guid tripId,
        City city,
        int order,
        DateOnly arrival,
        DateOnly departure
    )
    {
        await database.SaveDestinationPlaceAsync(
            ownerId,
            new(
                tripId,
                city.Id,
                city.Name,
                city.Country,
                city.TimeZone,
                city.Longitude,
                city.Latitude
            )
        );
        return await database.AddDestinationVisitAsync(
                ownerId,
                new(tripId, city.Id, Guid.NewGuid(), order, arrival, departure)
            ) ?? throw new InvalidOperationException($"Could not seed {city.Name}.");
    }
}
