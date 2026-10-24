using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class ActivityCalendarEndpointTests
{
    [TestMethod]
    public async Task Calendar_ExportsOnlySavedTimes_HidesTokens_AndRevokes()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, _) = await ActivityPlanningFixture.Seed(factory, client);
        var service = factory.Services.GetRequiredService<ActivityPlanningService>();
        var planningContext = (
            await service.ReadAsync(user.Id, trip.Id, place.CityId, CancellationToken.None)
        )!;
        var plan = ActivityPlanningFixture.Plan(planningContext);
        var assessment = planningContext.Evaluate(plan, ActivityPlanningFixture.Now);
        await factory.Database.SaveActivityPlanAsync(
            user.Id,
            trip.Id,
            place.CityId,
            new(plan, assessment, 0, planningContext.InputRevision, ActivityPlanningFixture.Now),
            0,
            planningContext.InputRevision
        );
        string path = $"/trips/{trip.Id}/calendar-subscriptions";
        var created = await client.PostAsync(path, null);
        Assert.AreEqual(
            HttpStatusCode.Created,
            created.StatusCode,
            await created.Content.ReadAsStringAsync()
        );
        var sub = (await created.Content.ReadFromJsonAsync<CalendarSubscriptionResponse>())!;
        string feedPath = new Uri(sub.Url!).PathAndQuery;
        string feed = await client.GetStringAsync(feedPath);
        StringAssert.Contains(feed, "BEGIN:VEVENT");
        StringAssert.Contains(feed, "DTSTART:20270610T053000Z");
        Assert.DoesNotContain(sub.Url!, await client.GetStringAsync(path));
        Assert.DoesNotContain("tokenHash", await client.GetStringAsync(path));
        planningContext = (
            await service.ReadAsync(user.Id, trip.Id, place.CityId, CancellationToken.None)
        )!;
        await factory.Database.SaveActivityPlanningEvidenceAsync(
            user.Id,
            trip.Id,
            place.CityId,
            new() { Warnings = ["New routing evidence"] },
            planningContext.InputRevision
        );
        Assert.AreEqual(
            feed,
            await client.GetStringAsync(feedPath),
            "Refreshing evidence must not move saved events."
        );
        Assert.AreEqual(
            HttpStatusCode.NoContent,
            (await client.DeleteAsync(path + "/" + sub.Id)).StatusCode
        );
        Assert.AreEqual(HttpStatusCode.NotFound, (await client.GetAsync(feedPath)).StatusCode);
        var log = await client.GetStringAsync("/user/activity-log");
        Assert.DoesNotContain(new Uri(sub.Url!).Segments.Last(), log);
        Assert.DoesNotContain("tokenHash", log);
    }
}
