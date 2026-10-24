using System.Net;
using System.Net.Http.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class ActivityPlanningPermissionsTests
{
    private static async Task<HttpResponseMessage> Put(
        HttpClient client,
        string path,
        object body,
        string etag
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.TryAddWithoutValidation("If-Match", etag);
        return await client.SendAsync(request);
    }

    [TestMethod]
    [DataRow("Traveller", 403)]
    [DataRow("Planner", 200)]
    public async Task MembershipControlsSharedWrites_ProfilesStayPrivate_AndSubscriptionsStayPersonal(
        string role,
        int expected
    )
    {
        await using var factory = new TestApplicationFactory();
        using var owner = factory.CreateClient();
        var (trip, user, place, _) = await ActivityPlanningFixture.Seed(factory, owner);
        var (member, companion) = await ActivityPlanningFixture.Member(factory);
        using var memberClient = member;
        var party = (await factory.Database.GetPartiesAsync(user.Id, trip.Id)).Single();
        await factory.Database.ChangePartyMemberAsync(
            user.Id,
            trip.Id,
            party.Id,
            companion.Id,
            true,
            role: Enum.Parse<PartyRole>(role)
        );
        const string privateText = "PRIVATE PROFILE: crowded places trigger my migraine";
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await Put(
                    memberClient,
                    "/user/activity-preferences",
                    new ActivityPreferencesRequest(privateText),
                    "\"0\""
                )
            ).StatusCode
        );
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var read = await memberClient.GetAsync(path);
        Assert.AreEqual(HttpStatusCode.OK, read.StatusCode);
        Assert.DoesNotContain(privateText, await read.Content.ReadAsStringAsync());
        Assert.DoesNotContain(
            privateText,
            await owner.GetStringAsync("/user/activity-preferences")
        );
        var plan = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.AreEqual(
            (HttpStatusCode)expected,
            (
                await Put(
                    memberClient,
                    path,
                    new ReplaceActivityPlanRequest(plan.Plan, plan.ContextVersion),
                    read.Headers.ETag!.ToString()
                )
            ).StatusCode
        );
        Assert.AreEqual(
            (HttpStatusCode)expected,
            (
                await Put(
                    memberClient,
                    $"/trips/{trip.Id}/activity-preferences",
                    new ActivityPreferencesRequest("Art and gardens"),
                    "\"0\""
                )
            ).StatusCode
        );
        var created = await memberClient.PostAsync(
            $"/trips/{trip.Id}/calendar-subscriptions",
            null
        );
        Assert.AreEqual(HttpStatusCode.Created, created.StatusCode);
        var subscription = (
            await created.Content.ReadFromJsonAsync<CalendarSubscriptionResponse>()
        )!;
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await owner.DeleteAsync(
                    $"/trips/{trip.Id}/calendar-subscriptions/{subscription.Id}"
                )
            ).StatusCode
        );
        var (stranger, _) = await ActivityPlanningFixture.Member(factory);
        using var strangerClient = stranger;
        Assert.AreEqual(HttpStatusCode.NotFound, (await strangerClient.GetAsync(path)).StatusCode);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await strangerClient.GetAsync($"/trips/{trip.Id}/calendar-subscriptions")).StatusCode
        );
        var log = (await owner.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!;
        Assert.AreEqual(
            role == "Planner" ? 1 : 0,
            log.Entries.Count(e => e.Action == "Updated activity plan")
        );
        Assert.DoesNotContain(privateText, await owner.GetStringAsync("/user/activity-log"));
    }
}
