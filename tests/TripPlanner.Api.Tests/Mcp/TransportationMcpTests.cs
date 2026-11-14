using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Mcp;

[TestClass]
public sealed class TransportationMcpTests
{
    [TestMethod]
    public async Task AgentCanSaveDirectionsAndConditionallyReplaceOneJourney()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Rail", "");
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        async Task<JsonElement> Call(string name, object arguments)
        {
            var result = await McpEndpointTests.Result(
                await McpEndpointTests.Rpc(agent, "tools/call", new { name, arguments })
            );
            Assert.IsFalse(
                result.TryGetProperty("isError", out var error) && error.GetBoolean(),
                result.ToString()
            );
            return result.GetProperty("structuredContent");
        }
        var request = TransportationFixture.Journey(route: true);
        // RPC helpers use default JSON options, so deserialize the wire form to preserve ISO durations.
        var body = JsonSerializer.SerializeToElement(request, TripResourceProjection.JsonOptions);
        var created = await Call("create_transportation", new { tripId = trip.Id, request = body });
        Assert.AreEqual(201, created.GetProperty("status").GetInt32());
        var value = created
            .GetProperty("data")
            .Deserialize<Transportation>(TripResourceProjection.JsonOptions)!;
        var next = JsonSerializer.SerializeToElement(
            request with
            {
                Notes = "Metro A toward Central; exit 3.",
            },
            TripResourceProjection.JsonOptions
        );
        var replaced = await Call(
            "replace_transportation",
            new
            {
                tripId = trip.Id,
                transportationId = value.Id,
                etag = created.GetProperty("etag").GetString(),
                request = next,
            }
        );
        Assert.AreEqual(
            "Metro A toward Central; exit 3.",
            replaced.GetProperty("data").GetProperty("notes").GetString()
        );
        var list = await Call("list_transportation", new { tripId = trip.Id });
        Assert.AreEqual(1, list.GetProperty("data").GetArrayLength());
    }
}
