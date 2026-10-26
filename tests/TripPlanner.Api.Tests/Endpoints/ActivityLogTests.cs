using System.Net;
using System.Net.Http.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Mcp;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class ActivityLogTests
{
    [TestMethod]
    public async Task ProfileLog_RecordsSuccessfulMutations_AndRetainsDeletedTrips()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var user = await Seed(factory, client, "owner@example.com");
        var trip = await Create(client, "Summer trip");
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await client.PutResourceAsJsonAsync(
                    $"/trips/{trip.Id}",
                    new UpdateTripRequest("Autumn trip", "New dates")
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PutResourceAsJsonAsync(
                    $"/trips/{trip.Id}",
                    new UpdateTripRequest("", "Invalid")
                )
            ).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.DeleteResourceAsync($"/trips/{trip.Id}")).StatusCode
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await client.DeleteResourceAsync($"/trips/{trip.Id}")).StatusCode
        );
        var response = await client.GetAsync("/user/activity-log");
        Assert.IsTrue(response.Headers.CacheControl!.NoStore);
        var log = (await response.Content.ReadFromJsonAsync<ActivityLogPage>())!;
        Assert.HasCount(3, log.Entries);
        CollectionAssert.AreEqual(
            new[] { "Deleted trip", "Updated trip", "Created trip" },
            log.Entries.Select(entry => entry.Action).ToArray()
        );
        Assert.IsTrue(
            log.Entries.All(entry => entry.ActorUserId == user.Id && entry.Source == "Website")
        );
        Assert.AreEqual("Autumn trip", log.Entries[0].TripName);
        Assert.AreEqual("Summer trip", log.Entries[2].TripName);
    }

    [TestMethod]
    public async Task SharedTripLog_IdentifiesPlanner_AndRejectsStrangersAndFormerMembers()
    {
        await using var factory = new TestApplicationFactory();
        using var owner = factory.CreateClient();
        var ownerUser = await Seed(factory, owner, "owner@example.com");
        using var planner = factory.CreateClient();
        var plannerUser = await Seed(factory, planner, "planner@example.com");
        using var observer = factory.CreateClient();
        var observerUser = await Seed(factory, observer, "observer@example.com");
        using var stranger = factory.CreateClient();
        await Seed(factory, stranger, "stranger@example.com");
        var trip = await Create(owner, "Shared trip");
        var party = (await factory.Database.GetPartiesAsync(ownerUser.Id, trip.Id)).Single();
        await factory.Database.ChangePartyMemberAsync(
            ownerUser.Id,
            trip.Id,
            party.Id,
            plannerUser.Id,
            true,
            role: PartyRole.Planner
        );
        await factory.Database.ChangePartyMemberAsync(
            ownerUser.Id,
            trip.Id,
            party.Id,
            observerUser.Id,
            true
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await planner.PutResourceAsJsonAsync(
                    $"/trips/{trip.Id}",
                    new UpdateTripRequest("Planner's update", "")
                )
            ).StatusCode
        );
        var visible = (await observer.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!;
        Assert.HasCount(2, visible.Entries);
        Assert.AreEqual(plannerUser.Id, visible.Entries[0].ActorUserId);
        Assert.IsEmpty(
            (await stranger.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!.Entries
        );
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await stranger.PutResourceAsJsonAsync(
                    $"/trips/{trip.Id}",
                    new UpdateTripRequest("Attack", "")
                )
            ).StatusCode
        );
        Assert.HasCount(
            2,
            (await owner.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!.Entries
        );
        await factory.Database.ChangePartyMemberAsync(
            ownerUser.Id,
            trip.Id,
            party.Id,
            observerUser.Id,
            false
        );
        Assert.IsEmpty(
            (await observer.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!.Entries
        );
    }

    [TestMethod]
    public async Task Log_IsPagedAndRequiresAuthentication()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await client.GetAsync("/user/activity-log")).StatusCode
        );
        await Seed(factory, client, "owner@example.com");
        for (int index = 0; index < 52; index++)
        {
            await Create(client, $"Trip {index}");
        }

        var first = (await client.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!;
        var second = (
            await client.GetFromJsonAsync<ActivityLogPage>("/user/activity-log?skip=50")
        )!;
        Assert.HasCount(50, first.Entries);
        Assert.IsTrue(first.HasMore);
        Assert.HasCount(2, second.Entries);
        Assert.IsFalse(second.HasMore);
        Assert.AreEqual(
            52,
            first.Entries.Concat(second.Entries).Select(entry => entry.Id).Distinct().Count()
        );
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await client.GetAsync("/user/activity-log?skip=-1")).StatusCode
        );
    }

    private static async Task<User> Seed(
        TestApplicationFactory factory,
        HttpClient client,
        string email
    )
    {
        var user = await factory.Database.GetOrCreateUserAsync(new("google", email, email));
        McpEndpointTests.SetTestPrincipal(client, email);
        return await factory.Database.SetUserProfileAsync(user.Id, new(new("Boston", -71, 42), []));
    }

    private static async Task<Trip> Create(HttpClient client, string name)
    {
        var response = await client.PostAsJsonAsync("/trips", new CreateTripRequest(name, ""));
        Assert.AreEqual(
            HttpStatusCode.Created,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        return (await response.Content.ReadFromJsonAsync<Trip>())!;
    }
}
