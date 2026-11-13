using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Tests.Support;

internal static class ActivityPlanningFixture
{
    internal static readonly DateOnly Date = new(2027, 6, 10);

    internal static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-16T12:00:00Z");

    internal static ActivityPlanningContext Context(params TimeSpan?[] durations)
    {
        var user = new User(
            Guid.NewGuid(),
            "google",
            "owner@example.com",
            "Owner",
            "Boston",
            new(-71, 42),
            [],
            Now,
            Now
        );
        var trip = new Trip(
            Guid.NewGuid(),
            user.Id,
            "Paris",
            "",
            JsonSerializer.SerializeToElement(new { }),
            Now,
            Now
        );
        var place = new DestinationPlace(
            trip.Id,
            "paris-fr",
            "Paris",
            "FR",
            "Europe/Paris",
            2.35,
            48.86,
            "context"
        );
        var visit = new DestinationVisit(trip.Id, place.CityId, Guid.NewGuid(), 0, Date, Date);
        var activities = durations
            .Select(
                (duration, i) =>
                    new Activity(
                        Guid.NewGuid(),
                        trip.Id,
                        place.CityId,
                        new(
                            "Point",
                            GeographyPoint.Create(latitude: 48.86, longitude: 2.35 + i * .001)
                        ),
                        new(
                            $"Activity {i + 1}",
                            duration,
                            "",
                            null,
                            ActivityState.Proposed,
                            ["Culture"]
                        ),
                        Now,
                        Now
                    )
            )
            .ToArray();
        return new(
            trip,
            place,
            [visit],
            activities,
            [new(Guid.NewGuid(), trip.Id, [user.Id])],
            [user],
            new() { [user.Id] = new() },
            new(),
            new(),
            new Dictionary<Guid, GeoJsonFeature<StayLocationProperties>>
            {
                [visit.StayId] = new(
                    "Feature",
                    "stay",
                    new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.35)),
                    new("Hotel")
                ),
            },
            [],
            null,
            new(),
            1
        );
    }

    internal static ActivityPlan Plan(ActivityPlanningContext s) =>
        ActivityPlanRules.Initial(s) with
        {
            SelectedActivityIds = s.Activities.Select(a => a.Id).ToArray(),
            Days =
            [
                new(
                    s.Visits[0].StayId,
                    s.Visits[0].ArrivalDate!.Value,
                    s.Activities.Select(a => a.Id).ToArray()
                )
                {
                    AvailabilityConfirmed = true,
                },
            ],
            Rules = s
                .Activities.Select(a => new ActivityPlanRule(a.Id) { AlwaysAvailable = true })
                .ToArray(),
            TransportOverrides = s
                .Activities.Select(
                    (a, i) =>
                        new ActivityTransportOverride(
                            s.Visits[0].ArrivalDate!.Value,
                            i == 0 ? null : s.Activities[i - 1].Id,
                            a.Id,
                            "walking",
                            TimeSpan.Zero
                        )
                )
                .Append(
                    new(
                        s.Visits[0].ArrivalDate!.Value,
                        s.Activities.LastOrDefault()?.Id,
                        null,
                        "walking",
                        TimeSpan.Zero
                    )
                )
                .ToArray(),
        };

    internal static SelectedFlight ReturnFlight(Guid tripId, Guid partyId) =>
        new(
            tripId,
            partyId,
            "selected",
            0,
            new("BOS", "CDG", Date, Date, 1, "economy", "US", null),
            JsonSerializer.SerializeToElement(
                new
                {
                    outbound = new
                    {
                        segments = new[]
                        {
                            new
                            {
                                departure_airport = "BOS",
                                arrival_airport = "CDG",
                                departure_time_utc = "2027-06-09T22:00:00Z",
                                arrival_time_utc = "2027-06-10T08:00:00Z",
                            },
                        },
                    },
                    inbound = new
                    {
                        segments = new[]
                        {
                            new
                            {
                                departure_airport = "CDG",
                                arrival_airport = "BOS",
                                departure_time_utc = "2027-06-10T18:00:00Z",
                                arrival_time_utc = "2027-06-11T00:00:00Z",
                            },
                        },
                    },
                }
            ),
            Now
        );

    internal static ActivityPlanningContext WithFlights(ActivityPlanningContext context)
    {
        context = context with { Flights = [ReturnFlight(context.Trip.Id, context.Parties[0].Id)] };
        return context with
        {
            FlightLegs = new ActivityFlightAvailability(new()).ReadLegs(context),
        };
    }

    internal static async Task<(
        Trip Trip,
        User User,
        DestinationPlace Place,
        Activity Activity
    )> Seed(TestApplicationFactory factory, HttpClient client)
    {
        client.DefaultRequestHeaders.Add("X-Test-Email", "planning@example.com");
        client.DefaultRequestHeaders.Add("X-Test-Name", "Planner");
        client.DefaultRequestHeaders.Add("X-Test-Provider", "google");
        client.DefaultRequestHeaders.Add("X-Test-Subject", "planning-subject");
        var identity = (await client.GetFromJsonAsync<CurrentUserResponse>("/user"))!;
        await client.PutAsJsonAsync("/user/profile", new UserProfile(new("Boston", -71, 42), []));
        var user = (await factory.Database.GetUserAsync(identity.Id!.Value))!;
        return await SeedDatabase(factory.Database, user);
    }

    internal static async Task<(
        Trip Trip,
        User User,
        DestinationPlace Place,
        Activity Activity
    )> SeedDatabase(IPlannerDb db, User user)
    {
        var trip = await db.CreateTripAsync(user.Id, "Paris plan", "");
        var place = await db.SaveDestinationPlaceAsync(
            user.Id,
            new(trip.Id, "paris-fr", "Paris", "FR", "Europe/Paris", 2.35, 48.86, "context")
        );
        await db.AddDestinationVisitAsync(
            user.Id,
            new(trip.Id, place.CityId, Guid.NewGuid(), 0, Date, Date)
        );
        place = (await db.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId))!;
        var activity = new Activity(
            Guid.NewGuid(),
            trip.Id,
            place.CityId,
            new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.35)),
            new("Museum", TimeSpan.FromMinutes(90), "", null, ActivityState.Planned, ["Culture"]),
            Now,
            Now
        );
        await db.SaveActivityAsync(user.Id, activity, place.ContextVersion, null);
        return (trip, user, place, activity);
    }

    internal static async Task<(HttpClient Client, User User)> Member(
        TestApplicationFactory factory
    )
    {
        var client = factory.CreateClient();
        string subject = Guid.NewGuid().ToString("N");
        client.DefaultRequestHeaders.Add("X-Test-Subject", subject);
        client.DefaultRequestHeaders.Add("X-Test-Name", "Companion");
        client.DefaultRequestHeaders.Add("X-Test-Email", subject + "@example.com");
        var identity = (await client.GetFromJsonAsync<CurrentUserResponse>("/user"))!;
        await client.PutAsJsonAsync("/user/profile", new UserProfile(new("Boston", -71, 42), []));
        return (client, (await factory.Database.GetUserAsync(identity.Id!.Value))!);
    }
}
