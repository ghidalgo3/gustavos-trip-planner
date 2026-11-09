using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Services.Documents;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Mcp;

[TestClass]
public sealed class AgentOwnedResearchTests
{
    [TestMethod]
    public async Task CatalogExposesStorageAndSchedulingWithoutServerLlmResearchOrFlags()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var user = await browser.GetStringAsync("/user");
        Assert.DoesNotContain("featureFlags", user);
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var tools = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(agent, "tools/list", new { })
        );
        var names = tools
            .GetProperty("tools")
            .EnumerateArray()
            .Select(t => t.GetProperty("name").GetString())
            .ToArray();
        foreach (
            var name in new[]
            {
                "get_planning_context",
                "create_activity",
                "update_activity",
                "replace_activity_plan",
                "get_activity_preferences",
            }
        )
        {
            CollectionAssert.Contains(names, name);
        }
        foreach (
            var name in new[]
            {
                "create_activity_place_proposal",
                "create_stay_address_proposal",
                "create_activity_details_proposal",
                "create_activity_location_proposal",
            }
        )
        {
            CollectionAssert.DoesNotContain(names, name);
        }
        Assert.DoesNotContain("useAi", tools.GetRawText());
    }

    [TestMethod]
    public async Task AgentCanSaveItsResearchedActivityInJapanWithoutAnyLlmFeatureFlag()
    {
        var document = JsonSerializer.Deserialize<TripDocument>(
            File.ReadAllText(Endpoints.TripDocumentEndpointTests.RepositoryFile("docs/after.json")),
            TripResourceProjection.JsonOptions
        )!;
        await using var session = await Verification.McpEvalServer.CreateSession(document);
        var place = await session.Factory.Database.GetDestinationPlaceAsync(
            session.UserId,
            session.TripId,
            "tokyo-jp"
        );
        Assert.IsFalse(string.IsNullOrEmpty(place!.ContextVersion));
        var result = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                session.Agent,
                "tools/call",
                new
                {
                    name = "create_activity",
                    arguments = new
                    {
                        tripId = session.TripId,
                        destinationId = "tokyo-jp",
                        contextVersion = place.ContextVersion,
                        request = new
                        {
                            type = "Feature",
                            id = (string?)null,
                            geometry = (object?)null,
                            properties = new
                            {
                                name = "Agent-researched vegan lunch",
                                description = "Research supplied by the caller's agent.",
                                duration = "PT1H",
                                cost = (object?)null,
                                state = "Proposed",
                                kinds = new[] { "Food" },
                                address = "Shibuya, Tokyo",
                                ticketRequirement = "Unknown",
                                links = new[]
                                {
                                    new
                                    {
                                        url = "https://venue.example/menu",
                                        label = "Menu researched by the agent",
                                    },
                                },
                            },
                        },
                    },
                }
            )
        );
        Assert.IsFalse(
            result.TryGetProperty("isError", out var error) && error.GetBoolean(),
            result.ToString()
        );
        var activities = await session.Factory.Database.GetActivitiesAsync(
            session.UserId,
            session.TripId,
            "tokyo-jp"
        );
        var saved = activities.Single(a => a.Properties.Name == "Agent-researched vegan lunch");
        Assert.AreEqual("https://venue.example/menu", saved.Properties.Links.Single().Url);
        Assert.AreEqual("Shibuya, Tokyo", saved.Properties.Address);
    }

    [TestMethod]
    [DataRow("/trips/{0}/destinations/tokyo-jp/activities/place-proposals")]
    [DataRow("/trips/{0}/destinations/tokyo-jp/stay/address-proposals")]
    [DataRow("/trips/{0}/destinations/tokyo-jp:suggest")]
    [DataRow("/trips/{0}/destinations/tokyo-jp:import")]
    public async Task RetiredResearchAndGenerationRoutesAreUnavailable(string path)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        await TripDocumentFixture.Seed(factory, client);
        var response = await client.PostAsJsonAsync(string.Format(path, Guid.NewGuid()), new { });
        Assert.IsTrue(
            response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed
        );
    }
}
