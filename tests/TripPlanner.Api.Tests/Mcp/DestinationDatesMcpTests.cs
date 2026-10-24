using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Mcp;

[TestClass]
public sealed class DestinationDatesMcpTests
{
    [TestMethod]
    public async Task DestinationTools_RejectOverlap_AndAllowSharedTravelDay()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var (trip, _, place, _) = await ActivityPlanningFixture.SeedDatabase(
            factory.Database,
            user
        );
        var visit = (await factory.Database.GetDestinationVisitsAsync(user.Id, trip.Id)).Single();
        await factory.Database.ReplaceDestinationVisitAsync(
            user.Id,
            trip.Id,
            place.CityId,
            visit.StayId,
            new(new(2027, 6, 10), new(2027, 6, 15))
        );
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        foreach (var (arrival, expected) in new[] { (14, 409), (15, 201) })
        {
            var result = await McpEndpointTests.Result(
                await McpEndpointTests.Rpc(
                    agent,
                    "tools/call",
                    new
                    {
                        name = "add_destination",
                        arguments = new
                        {
                            tripId = trip.Id,
                            request = new CreateDestinationRequest(
                                "Feature",
                                new("Point", GeographyPoint.Create(48.86, 2.35)),
                                new("Paris", "FR", new(2027, 6, arrival), new(2027, 6, 20))
                            ),
                        },
                    }
                )
            );
            Assert.AreEqual(
                expected,
                result.GetProperty("structuredContent").GetProperty("status").GetInt32(),
                result.ToString()
            );
            Assert.AreEqual(expected == 409, result.GetProperty("isError").GetBoolean());
        }
        var changed = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                agent,
                "tools/call",
                new
                {
                    name = "update_visit",
                    arguments = new
                    {
                        tripId = trip.Id,
                        destinationId = place.CityId,
                        stayId = visit.StayId,
                        request = new DestinationStayInput(new(2027, 6, 10), new(2027, 6, 16)),
                    },
                }
            )
        );
        Assert.AreEqual(
            409,
            changed.GetProperty("structuredContent").GetProperty("status").GetInt32(),
            changed.ToString()
        );
        Assert.AreEqual(
            new DateOnly(2027, 6, 15),
            (await factory.Database.GetDestinationVisitsAsync(user.Id, trip.Id))
                .Single(v => v.StayId == visit.StayId)
                .DepartureDate
        );
    }
}
