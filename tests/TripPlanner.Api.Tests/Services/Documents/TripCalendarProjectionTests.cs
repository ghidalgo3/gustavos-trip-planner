using System.Text.Json.Nodes;
using TripPlanner.Api.Services.Documents;

namespace TripPlanner.Api.Tests.Services.Documents;

[TestClass]
public sealed class TripCalendarProjectionTests
{
    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public void SchedulingAnActivityPreservesItsIdentityAndDetails(bool scheduled)
    {
        var id = Guid.NewGuid().ToString();
        var activity = new JsonObject
        {
            ["id"] = id,
            ["name"] = "Museum",
            ["duration"] = "PT2H",
            ["selection"] = "Selected",
            ["description"] = "Visit the collection",
        };
        var timing = new JsonArray();
        if (scheduled)
        {
            timing.Add(
                new JsonObject
                {
                    ["id"] = id,
                    ["start"] = "2030-04-02T01:00:00Z",
                    ["timeZone"] = "Asia/Tokyo",
                    ["duration"] = "PT1H30M",
                }
            );
        }
        var item = TripCalendarProjection.Project(Guid.NewGuid(), [], [], [activity], [], timing)[
            "items"
        ]![0]!;
        Assert.AreEqual(id, item["id"]!.GetValue<string>());
        Assert.AreEqual("Museum", item["name"]!.GetValue<string>());
        Assert.AreEqual("PT2H", item["estimatedDuration"]!.GetValue<string>());
        Assert.AreEqual(scheduled ? "event" : "task", item["type"]!.GetValue<string>());
        Assert.AreEqual(scheduled, item["busy"]!.GetValue<bool>());
        Assert.AreEqual(scheduled, item["start"] is not null);
        Assert.AreEqual(scheduled, item["duration"] is not null);
        Assert.IsNull(activity["start"], "Projection must not mutate saved activity data.");
    }

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public void LodgingIsAnExplicitNonblockingCalendarItemWithStableIdentity(bool dated)
    {
        var tripId = Guid.NewGuid();
        var visit = new JsonObject
        {
            ["id"] = Guid.NewGuid().ToString(),
            ["destinationId"] = "tokyo",
            ["order"] = 0,
            ["arrivalDate"] = dated ? "2030-04-02" : null,
            ["departureDate"] = dated ? "2030-04-05" : null,
            ["accommodationPlaceId"] = "hotel",
            ["accommodationEtag"] = "hotel-1",
        };
        JsonObject[] places =
        [
            new()
            {
                ["id"] = "city",
                ["destinationId"] = "tokyo",
                ["name"] = "Tokyo",
                ["timeZone"] = "Asia/Tokyo",
            },
            new() { ["id"] = "hotel", ["name"] = "Hotel" },
        ];
        JsonObject Lodging() =>
            TripCalendarProjection.Project(tripId, places, [visit], [], [], new JsonArray())[
                "items"
            ]!
                .AsArray()
                .OfType<JsonObject>()
                .Single(item => item["kind"]!.GetValue<string>() == "lodging");
        var first = Lodging();
        Assert.AreEqual(dated ? "event" : "task", first["type"]!.GetValue<string>());
        Assert.IsFalse(first["busy"]!.GetValue<bool>());
        Assert.AreEqual("hotel", first["placeId"]!.GetValue<string>());
        Assert.AreEqual("hotel-1", first["etag"]!.GetValue<string>());
        Assert.IsTrue(JsonNode.DeepEquals(visit["arrivalDate"], first["start"]));
        Assert.IsTrue(JsonNode.DeepEquals(visit["departureDate"], first["end"]));
        visit["arrivalDate"] = "2030-05-01";
        Assert.IsTrue(JsonNode.DeepEquals(first["id"], Lodging()["id"]));
    }
}
