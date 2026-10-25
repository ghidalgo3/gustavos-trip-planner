using System.Net;
using System.Net.Http.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Support;
using static TripPlanner.Api.Tests.Support.ActivityPlanningFixture;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class ActivityRouteEndpointTests
{
    [TestMethod]
    [DataRow(false, false, true)]
    [DataRow(true, false, true)]
    [DataRow(false, true, true)]
    [DataRow(false, false, false)]
    public async Task RoutePreview_UsesSelectedDraftLegAndStay_WithoutSaving(
        bool returning,
        bool traveller,
        bool available
    )
    {
        var routes = new Routes { Available = available };
        await using var factory = new TestApplicationFactory { RouteMapProvider = routes };
        using var owner = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, owner);
        var visit = (await factory.Database.GetDestinationVisitsAsync(user.Id, trip.Id)).Single();
        await factory.Database.SaveStayLocationAsync(
            user.Id,
            trip.Id,
            place.CityId,
            visit.StayId,
            new("Feature", "hotel", new("Point", GeographyPoint.Create(48.85, 2.34)), new("Hotel"))
        );
        var (companion, member) = await Member(factory);
        using var memberClient = companion;
        if (traveller)
        {
            var party = (await factory.Database.GetPartiesAsync(user.Id, trip.Id)).Single();
            await factory.Database.ChangePartyMemberAsync(
                user.Id,
                trip.Id,
                party.Id,
                member.Id,
                true
            );
        }
        var client = traveller ? memberClient : owner;
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var initial = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        var plan = initial.Plan with
        {
            Days = [initial.Plan.Days[0] with { ActivityIds = [activity.Id] }],
        };
        var request = new ActivityRoutePreviewRequest(
            plan,
            initial.ContextVersion,
            visit.StayId,
            Date,
            returning ? activity.Id : null,
            returning ? null : activity.Id
        );
        var result = await client.PostAsJsonAsync(path + "/route-previews", request);
        Assert.AreEqual(
            available ? HttpStatusCode.OK : HttpStatusCode.UnprocessableEntity,
            result.StatusCode,
            await result.Content.ReadAsStringAsync()
        );
        if (available)
        {
            var preview = (await result.Content.ReadFromJsonAsync<ActivityRoutePreviewResponse>())!;
            Assert.AreEqual("MultiLineString", preview.Geometry.Type);
            Assert.AreEqual(preview.Mode, routes.Mode);
        }
        else
        {
            StringAssert.Contains(await result.Content.ReadAsStringAsync(), "Route unavailable");
            Assert.DoesNotContain("coordinates", await result.Content.ReadAsStringAsync());
        }
        Assert.AreEqual(returning ? 2.35 : 2.34, routes.From!.Longitude);
        Assert.AreEqual(returning ? 2.34 : 2.35, routes.To!.Longitude);
        Assert.AreEqual("no-store", result.Headers.CacheControl!.ToString());
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
        int calls = routes.Calls;
        var stale = await client.PostAsJsonAsync(
            path + "/route-previews",
            request with
            {
                ContextVersion = "stale",
            }
        );
        Assert.AreEqual(HttpStatusCode.Conflict, stale.StatusCode);
        var foreign = await client.PostAsJsonAsync(
            path + "/route-previews",
            request with
            {
                FromActivityId = Guid.NewGuid(),
            }
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, foreign.StatusCode);
        Assert.AreEqual(calls, routes.Calls);
    }

    private sealed class Routes : IActivityRouteMapProvider
    {
        public bool Available { get; init; } = true;
        public GeographyPoint? From { get; private set; }
        public GeographyPoint? To { get; private set; }
        public string? Mode { get; private set; }
        public int Calls { get; private set; }

        public Task<ActivityRoutePath?> GetAsync(
            GeographyPoint from,
            GeographyPoint to,
            DateTimeOffset departure,
            string mode,
            CancellationToken ct
        )
        {
            From = from;
            To = to;
            Mode = mode;
            Calls++;
            if (!Available)
            {
                return Task.FromResult<ActivityRoutePath?>(null);
            }
            return Task.FromResult<ActivityRoutePath?>(
                new(
                    "MultiLineString",
                    [
                        [
                            [from.Longitude, from.Latitude],
                            [to.Longitude, to.Latitude],
                        ],
                    ]
                )
            );
        }
    }
}
