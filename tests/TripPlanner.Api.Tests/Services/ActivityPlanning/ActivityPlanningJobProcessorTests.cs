using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.ActivityPlanning;

[TestClass]
public sealed class ActivityPlanningJobProcessorTests
{
    [TestMethod]
    public async Task Worker_RechecksPlannerPermissionBeforeProviderWork()
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
            role: PartyRole.Planner
        );
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var plan = (await memberClient.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        var request = new CreateActivityProposalRequest(
            Guid.NewGuid(),
            plan.ContextVersion,
            RefreshEvidence: true
        );
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await memberClient.PostAsJsonAsync(path + "/proposals", request)).StatusCode
        );
        await factory.Database.ChangePartyMemberAsync(
            user.Id,
            trip.Id,
            party.Id,
            companion.Id,
            true,
            role: PartyRole.Traveller
        );
        Assert.IsTrue(
            await factory
                .Services.GetRequiredService<ActivityPlanningJobProcessor>()
                .ProcessNextAsync()
        );
        var job = (
            await factory.Database.GetActivityPlanningJobAsync(
                user.Id,
                trip.Id,
                place.CityId,
                request.RequestId
            )
        )!;
        Assert.AreEqual("Failed", job.Status);
        Assert.IsNull(job.Result);
        StringAssert.Contains(job.Error!, "permissions changed");
        Assert.AreEqual(companion.Id, job.UserId);
        Assert.AreEqual("Website", job.Source);
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
    }
}
