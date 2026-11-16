using System.Net;
using System.Net.Http.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class DestinationDateTests
{
    [TestMethod]
    public async Task ChangingVisitDates_ReturnsUnscheduledActivitiesAndRejectsAnOldPlanVersion()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, activity) = await ActivityPlanningFixture.Seed(factory, client);
        var service = new ActivityPlanningService(
            factory.Database,
            new(new AirportCatalog()),
            TimeProvider.System,
            new AzureMapsStub()
        );
        var context = (
            await service.ReadAsync(user.Id, trip.Id, place.CityId, CancellationToken.None)
        )!;
        var plan = ActivityPlanningFixture.Plan(context) with
        {
            Rules =
            [
                new(activity.Id)
                {
                    FixedDate = ActivityPlanningFixture.Date,
                    FixedStart = new(9, 0),
                    AlwaysAvailable = true,
                },
            ],
        };
        var saved = (
            await factory.Database.SaveActivityPlanAsync(
                user.Id,
                trip.Id,
                place.CityId,
                new(
                    plan,
                    context.Evaluate(plan, ActivityPlanningFixture.Now),
                    0,
                    context.InputRevision,
                    ActivityPlanningFixture.Now
                ),
                0,
                context.InputRevision
            )
        )!;
        var changed = await client.PutResourceAsJsonAsync(
            $"/trips/{trip.Id}/destinations/{place.CityId}/stays/{context.Visits[0].StayId}",
            new DestinationStayInput(new(2027, 6, 20), new(2027, 6, 22))
        );
        Assert.AreEqual(HttpStatusCode.OK, changed.StatusCode);
        string path = $"/trips/{trip.Id}/destinations/{place.CityId}/activity-plan";
        var response = await client.GetAsync(path);
        var current = (await response.Content.ReadFromJsonAsync<ActivityPlanResponse>())!;
        Assert.AreEqual(saved.Version + 1, current.Version);
        Assert.IsEmpty(current.Plan.Days);
        Assert.Contains(activity.Id, current.Plan.SelectedActivityIds);
        Assert.IsNull(current.Plan.Rules.Single().FixedDate);
        Assert.IsNull(current.Plan.Rules.Single().FixedStart);
        Assert.IsEmpty(current.Assessment.Days.SelectMany(day => day.Entries));
        using var old = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = JsonContent.Create(
                new ReplaceActivityPlanRequest(saved.Plan, current.ContextVersion)
            ),
        };
        old.Headers.TryAddWithoutValidation("If-Match", ActivityPlanRules.ETag(saved.Version));
        Assert.AreEqual(
            HttpStatusCode.PreconditionFailed,
            (await client.SendAsync(old)).StatusCode
        );
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task CreateAndEdit_RejectInteriorOverlapWithoutMutation_AllowSharedTravelDay(
        bool repeatCity
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var (trip, user, place, _) = await ActivityPlanningFixture.Seed(factory, client);
        var first = (await factory.Database.GetDestinationVisitsAsync(user.Id, trip.Id)).Single();
        string path = $"/trips/{trip.Id}/destinations";
        var initial = await client.PutResourceAsJsonAsync(
            $"{path}/{place.CityId}/stays/{first.StayId}",
            new DestinationStayInput(new(2027, 6, 10), new(2027, 6, 15))
        );
        Assert.AreEqual(HttpStatusCode.OK, initial.StatusCode);
        var request = new CreateDestinationRequest(
            "Feature",
            new("Point", GeographyPoint.Create(48.86, 2.35)),
            new(repeatCity ? "Paris" : "Lyon", "FR", new(2027, 6, 14), new(2027, 6, 20))
        );
        string before = await client.GetStringAsync(path);
        string beforeLog = await client.GetStringAsync("/user/activity-log");
        var rejected = await client.PostAsJsonAsync(path, request);
        Assert.AreEqual(HttpStatusCode.Conflict, rejected.StatusCode);
        StringAssert.Contains(
            await rejected.Content.ReadAsStringAsync(),
            "destination_dates_overlap"
        );
        Assert.AreEqual(before, await client.GetStringAsync(path));
        Assert.AreEqual(beforeLog, await client.GetStringAsync("/user/activity-log"));

        request = request with
        {
            Properties = request.Properties with { ArrivalDate = new(2027, 6, 15) },
        };
        var accepted = await client.PostAsJsonAsync(path, request);
        Assert.AreEqual(
            HttpStatusCode.Created,
            accepted.StatusCode,
            await accepted.Content.ReadAsStringAsync()
        );
        var destination = (
            await accepted.Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        var visit = destination.Properties.Stays.Single(s => s.Id != first.StayId);
        string editPath = $"{path}/{destination.Id}/stays/{visit.Id}";
        before = await client.GetStringAsync(path);
        beforeLog = await client.GetStringAsync("/user/activity-log");
        rejected = await client.PutResourceAsJsonAsync(
            editPath,
            new DestinationStayInput(new(2027, 6, 11), new(2027, 6, 20))
        );
        Assert.AreEqual(HttpStatusCode.Conflict, rejected.StatusCode);
        Assert.AreEqual(before, await client.GetStringAsync(path));
        Assert.AreEqual(beforeLog, await client.GetStringAsync("/user/activity-log"));
        Assert.AreEqual(
            HttpStatusCode.OK,
            (
                await client.PutResourceAsJsonAsync(
                    editPath,
                    new DestinationStayInput(new(2027, 6, 16), new(2027, 6, 20))
                )
            ).StatusCode
        );
    }
}
