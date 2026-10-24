using System.Net;
using System.Net.Http.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Support;
using static TripPlanner.Api.Tests.Support.ActivityPlanningFixture;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class ActivityPlanEndpointTests
{
    [TestMethod]
    public async Task ScheduleProposal_QueuesSelectedPlanWithoutApplyingIt()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var current = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        var request = new CreateActivityProposalRequest(
            Guid.NewGuid(),
            current.ContextVersion,
            current.Plan,
            RefreshEvidence: true,
            Kind: "schedule"
        );
        var response = await client.PostAsJsonAsync(path + "/proposals", request);
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        var job = (
            await factory.Database.GetActivityPlanningJobAsync(
                user.Id,
                trip.Id,
                place.CityId,
                request.RequestId
            )
        )!;
        Assert.AreEqual("schedule", job.Kind);
        CollectionAssert.AreEqual(new[] { activity.Id }, job.Plan.SelectedActivityIds);
        Assert.IsTrue(job.RefreshEvidence);
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
    }

    [TestMethod]
    public async Task Preview_EvaluatesDraftWithoutSaving_AndRejectsStaleOrForeignInputs()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var initial = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        var draft = initial.Plan with
        {
            Days = [initial.Plan.Days[0] with { ActivityIds = [activity.Id] }],
        };
        var beforeLog = await client.GetStringAsync("/user/activity-log");
        var beforeOperations = await client.GetStringAsync("/operations");
        var preview = await client.PostAsJsonAsync(
            path + "/previews",
            new PreviewActivityPlanRequest(draft, initial.ContextVersion)
        );
        Assert.AreEqual(
            HttpStatusCode.OK,
            preview.StatusCode,
            await preview.Content.ReadAsStringAsync()
        );
        var assessed = (await preview.Content.ReadFromJsonAsync<ActivityPlanAssessment>())!;
        Assert.AreEqual(activity.Id, assessed.Days.Single().Entries.Single().ActivityId);
        Assert.AreEqual(activity.Properties.Duration, assessed.Days.Single().ActivityDuration);
        Assert.IsNotNull(preview.Headers.ETag);
        var after = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        Assert.IsEmpty(after.Plan.Days[0].ActivityIds);
        Assert.AreEqual(initial.Version, after.Version);
        Assert.AreEqual(initial.ContextVersion, after.ContextVersion);
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
        Assert.AreEqual(beforeLog, await client.GetStringAsync("/user/activity-log"));
        Assert.AreEqual(beforeOperations, await client.GetStringAsync("/operations"));
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PostAsJsonAsync(
                    path + "/previews",
                    new PreviewActivityPlanRequest(draft, "stale")
                )
            ).StatusCode
        );
        var invalid = draft with { Days = [draft.Days[0] with { ActivityIds = [Guid.NewGuid()] }] };
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (
                await client.PostAsJsonAsync(
                    path + "/previews",
                    new PreviewActivityPlanRequest(invalid, initial.ContextVersion)
                )
            ).StatusCode
        );
        client.DefaultRequestHeaders.Remove("X-Test-Subject");
        client.DefaultRequestHeaders.Add("X-Test-Subject", "other-preview-user");
        client.DefaultRequestHeaders.Remove("X-Test-Email");
        client.DefaultRequestHeaders.Add("X-Test-Email", "other-preview@example.com");
        await client.GetAsync("/user");
        await client.PutAsJsonAsync("/user/profile", new UserProfile(new("Boston", -71, 42), []));
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (
                await client.PostAsJsonAsync(
                    path + "/previews",
                    new PreviewActivityPlanRequest(draft, initial.ContextVersion)
                )
            ).StatusCode
        );
    }

    private static async Task<HttpResponseMessage> Put(
        HttpClient client,
        string path,
        object body,
        string? etag
    )
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(body),
        };
        if (etag is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", etag);
        }

        return await client.SendAsync(request);
    }

    [TestMethod]
    public async Task PlanReplacement_SynchronizesStates_AuditsSuccess_AndRejectsStaleInputs()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var read = await client.GetAsync(path);
        var initial = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.HasCount(1, initial.Plan.SelectedActivityIds);
        Assert.IsTrue(initial.Assessment.Issues.Any(i => i.Code == "unscheduled"));
        var plan = initial.Plan with
        {
            Days =
            [
                initial.Plan.Days[0] with
                {
                    ActivityIds = [activity.Id],
                    AvailabilityConfirmed = true,
                },
            ],
            Rules = [new(activity.Id) { AlwaysAvailable = true }],
        };
        var request = new ReplaceActivityPlanRequest(plan, initial.ContextVersion);
        Assert.AreEqual((HttpStatusCode)428, (await Put(client, path, request, null)).StatusCode);
        var saved = await Put(client, path, request, read.Headers.ETag!.ToString());
        Assert.AreEqual(
            HttpStatusCode.OK,
            saved.StatusCode,
            await saved.Content.ReadAsStringAsync()
        );
        var current = (await saved.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.AreEqual(
            HttpStatusCode.PreconditionFailed,
            (await Put(client, path, request, read.Headers.ETag!.ToString())).StatusCode
        );
        var changed = activity with
        {
            Properties = activity.Properties with { Duration = TimeSpan.FromHours(2) },
            UpdatedAt = Now.AddMinutes(1),
        };
        await factory.Database.SaveActivityAsync(
            user.Id,
            changed,
            place.ContextVersion,
            activity.UpdatedAt
        );
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await Put(
                    client,
                    path,
                    new ReplaceActivityPlanRequest(current.Plan, current.ContextVersion),
                    saved.Headers.ETag!.ToString()
                )
            ).StatusCode
        );
        read = await client.GetAsync(path);
        current = (await read.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.IsTrue(current.TimingStale);
        var excluded = current.Plan with
        {
            SelectedActivityIds = [],
            ExcludedActivityIds = [activity.Id],
            Days = current.Plan.Days.Select(d => d with { ActivityIds = [] }).ToArray(),
            Rules = [],
        };
        saved = await Put(
            client,
            path,
            new ReplaceActivityPlanRequest(excluded, current.ContextVersion),
            read.Headers.ETag!.ToString()
        );
        Assert.AreEqual(HttpStatusCode.OK, saved.StatusCode);
        Assert.AreEqual(
            ActivityState.Rejected,
            (await factory.Database.GetActivityAsync(user.Id, trip.Id, place.CityId, activity.Id))!
                .Properties
                .State
        );
        var log = (await client.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!;
        Assert.HasCount(2, log.Entries.Where(e => e.Action == "Updated activity plan"));
        Assert.IsTrue(log.Entries.All(e => e.ActorUserId == user.Id && e.Source == "Website"));
    }

    [TestMethod]
    public async Task Assessments_AreIdempotentAndDoNotApplyUnsavedDrafts()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await Seed(factory, client);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var plan = (await client.GetFromJsonAsync<ActivityPlanResponse>(path))!;
        var draft = plan.Plan with { SelectedActivityIds = [], Days = [] };
        var request = new CreateActivityAssessmentRequest(
            Guid.NewGuid(),
            plan.ContextVersion,
            draft
        );
        var first = await client.PostAsJsonAsync(path + "/assessments", request);
        var second = await client.PostAsJsonAsync(path + "/assessments", request);
        Assert.AreEqual(
            HttpStatusCode.OK,
            first.StatusCode,
            await first.Content.ReadAsStringAsync()
        );
        Assert.AreEqual(
            await first.Content.ReadAsStringAsync(),
            await second.Content.ReadAsStringAsync()
        );
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (
                await client.PostAsJsonAsync(
                    path + "/assessments",
                    request with
                    {
                        Plan = plan.Plan,
                    }
                )
            ).StatusCode
        );
        Assert.IsNull(await factory.Database.GetActivityPlanAsync(user.Id, trip.Id, place.CityId));
        Assert.AreEqual(
            ActivityState.Planned,
            (await factory.Database.GetActivityAsync(user.Id, trip.Id, place.CityId, activity.Id))!
                .Properties
                .State
        );
        Assert.AreEqual(
            "Completed",
            (
                await client.GetFromJsonAsync<TrackedOperation>($"/operations/{request.RequestId}")
            )!.Status
        );
    }
}
