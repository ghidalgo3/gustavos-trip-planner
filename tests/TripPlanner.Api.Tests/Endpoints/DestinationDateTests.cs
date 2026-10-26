using System.Net;
using System.Net.Http.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Endpoints;

[TestClass]
public sealed class DestinationDateTests
{
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
