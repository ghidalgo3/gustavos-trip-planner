using System.Net.Http.Json;
using System.Text.Json;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Mcp;

[TestClass]
public sealed class TravelAgentMcpTests
{
    [TestMethod]
    public async Task JapanEvalRestoresDocumentForRealToolsInIndependentSessions()
    {
        var document = JsonSerializer.Deserialize<TripPlanner.Api.DTO.TripDocument>(
            File.ReadAllText(Endpoints.TripDocumentEndpointTests.RepositoryFile("docs/after.json")),
            TripPlanner.Api.Services.Documents.TripResourceProjection.JsonOptions
        )!;
        await using var first = await Verification.McpEvalServer.CreateSession(document);
        await using var second = await Verification.McpEvalServer.CreateSession(document);
        Assert.AreNotEqual(first.TripId, second.TripId);
        var rpc = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                first.Agent,
                "tools/call",
                new { name = "get_planning_context", arguments = new { tripId = first.TripId } }
            )
        );
        Assert.IsFalse(
            rpc.TryGetProperty("isError", out var error) && error.GetBoolean(),
            rpc.ToString()
        );
        var trip = rpc.GetProperty("structuredContent").GetProperty("data").GetProperty("trip");
        Assert.AreEqual(document.Name, trip.GetProperty("name").GetString());
        Assert.AreEqual(document.Description, trip.GetProperty("description").GetString());
        Assert.AreEqual(2, trip.GetProperty("people").GetArrayLength());
        var items = trip.GetProperty("itinerary").GetProperty("items").EnumerateArray().ToArray();
        foreach (var kind in new[] { "visit", "activity", "lodging", "flight" })
        {
            var expected = document.Itinerary["items"]!
                .AsArray()
                .Count(i => i!["kind"]!.GetValue<string>() == kind);
            Assert.AreEqual(
                expected,
                items.Count(i => i.GetProperty("kind").GetString() == kind),
                kind
            );
        }
        foreach (
            var source in document.Itinerary["items"]!
                .AsArray()
                .Where(i => i!["kind"]!.GetValue<string>() == "activity")
        )
        {
            var restored = items.Single(i =>
                i.GetProperty("id").GetString() == source!["id"]!.GetValue<string>()
            );
            foreach (
                var field in new[]
                {
                    "name",
                    "description",
                    "cost",
                    "kinds",
                    "address",
                    "ticketRequirement",
                    "state",
                    "links",
                    "estimatedDuration",
                    "destinationId",
                    "selection",
                    "rule",
                }
            )
            {
                Assert.IsTrue(
                    System.Text.Json.Nodes.JsonNode.DeepEquals(
                        source![field],
                        System.Text.Json.Nodes.JsonNode.Parse(
                            restored.GetProperty(field).GetRawText()
                        )
                    ),
                    $"{source!["id"]}: {field}"
                );
            }
        }
        var visits = await first.Factory.Database.GetDestinationVisitsAsync(
            first.UserId,
            first.TripId
        );
        Assert.AreEqual(
            new DateOnly(2026, 12, 25),
            visits.OrderBy(v => v.Order).First().ArrivalDate
        );
        var activities = await first.Factory.Database.GetActivitiesAsync(
            first.UserId,
            first.TripId,
            "tokyo-jp"
        );
        var activity = activities.First();
        var place = await first.Factory.Database.GetDestinationPlaceAsync(
            first.UserId,
            first.TripId,
            "tokyo-jp"
        );
        await first.Factory.Database.SaveActivityAsync(
            first.UserId,
            activity with
            {
                Properties = activity.Properties with { Description = "Changed in one eval" },
            },
            place!.ContextVersion,
            null
        );
        var original = await second.Factory.Database.GetActivityAsync(
            second.UserId,
            second.TripId,
            "tokyo-jp",
            activity.Id
        );
        Assert.AreEqual(activity.Properties.Description, original!.Properties.Description);
    }

    [TestMethod]
    public async Task EvalFixtures_AreIsolatedAndCanRepresentMissingDates()
    {
        await using var dated = await Verification.McpEvalServer.CreateSession("known_dates");
        await using var undated = await Verification.McpEvalServer.CreateSession("missing_dates");
        Assert.AreNotEqual(dated.TripId, undated.TripId);
        var knownVisits = await dated.Factory.Database.GetDestinationVisitsAsync(
            dated.UserId,
            dated.TripId
        );
        var missingVisits = await undated.Factory.Database.GetDestinationVisitsAsync(
            undated.UserId,
            undated.TripId
        );
        Assert.AreEqual(ActivityPlanningFixture.Date, knownVisits.Single().ArrivalDate);
        Assert.IsNull(missingVisits.Single().ArrivalDate);
        Assert.IsNull(missingVisits.Single().DepartureDate);
        var rpc = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                dated.Agent,
                "tools/call",
                new { name = "get_planning_context", arguments = new { tripId = undated.TripId } }
            )
        );
        Assert.IsTrue(rpc.GetProperty("isError").GetBoolean());
    }

    [TestMethod]
    [DataRow("tripplanner.read")]
    [DataRow("tripplanner.read tripplanner.write")]
    public async Task PlanningContext_ReusesSavedDatesAndPreferences_WithoutExposingCompanions(
        string scopes
    )
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var (trip, _, place, _) = await ActivityPlanningFixture.SeedDatabase(
            factory.Database,
            user
        );
        await factory.Database.SaveActivityPreferencesAsync(
            user.Id,
            null,
            "profile",
            "",
            new("Love art"),
            0
        );
        await factory.Database.SaveActivityPreferencesAsync(
            user.Id,
            trip.Id,
            "trip",
            "",
            new("Quiet afternoons"),
            0
        );
        await factory.Database.SaveActivityPreferencesAsync(
            user.Id,
            trip.Id,
            "destination",
            place.CityId,
            new("Focus on sculpture"),
            0
        );
        var companion = await factory.Database.GetOrCreateUserAsync(
            new("google", "companion@example.com", "Companion")
        );
        var party = (await factory.Database.GetPartiesAsync(user.Id, trip.Id)).Single();
        await factory.Database.ChangePartyMemberAsync(
            user.Id,
            trip.Id,
            party.Id,
            companion.Id,
            true
        );
        await factory.Database.SaveActivityPreferencesAsync(
            companion.Id,
            null,
            "profile",
            "",
            new("PRIVATE_COMPANION_PREFERENCES"),
            0
        );
        var token = await McpEndpointTests.Tokens(browser, scopes);
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var result = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                agent,
                "tools/call",
                new { name = "get_planning_context", arguments = new { tripId = trip.Id } }
            )
        );
        Assert.IsFalse(
            result.TryGetProperty("isError", out var error) && error.GetBoolean(),
            result.ToString()
        );
        var data = result.GetProperty("structuredContent").GetProperty("data");
        Assert.AreEqual(trip.Id, data.GetProperty("trip").GetProperty("id").GetGuid());
        Assert.AreEqual(
            "Love art",
            data.GetProperty("profilePreferences").GetProperty("instructions").GetString()
        );
        Assert.AreEqual(
            "Quiet afternoons",
            data.GetProperty("tripPreferences").GetProperty("instructions").GetString()
        );
        StringAssert.Contains(data.ToString(), "Focus on sculpture");
        StringAssert.Contains(data.ToString(), "2027-06-10");
        Assert.DoesNotContain("PRIVATE_COMPANION_PREFERENCES", result.ToString());
        CollectionAssert.AreEqual(
            Enum.GetNames<ActivityKind>(),
            data.GetProperty("activityKinds").EnumerateArray().Select(v => v.GetString()).ToArray()
        );
        Assert.IsFalse(string.IsNullOrWhiteSpace(data.GetProperty("guidanceVersion").GetString()));
        StringAssert.Contains(data.GetProperty("guidance").GetString()!, "coherent theme");
        var denied = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                agent,
                "tools/call",
                new { name = "get_planning_context", arguments = new { tripId = Guid.NewGuid() } }
            )
        );
        Assert.IsTrue(denied.GetProperty("isError").GetBoolean());
    }

    [TestMethod]
    public async Task Discovery_ProvidesPlanningEntryPointPromptAndValidatedClassification()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var initialized = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                agent,
                "initialize",
                new
                {
                    protocolVersion = "2025-06-18",
                    capabilities = new { },
                    clientInfo = new { name = "Travel agent test", version = "1" },
                }
            )
        );
        StringAssert.Contains(
            initialized.GetProperty("instructions").GetString()![..512],
            "get_planning_context"
        );
        var prompts = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(agent, "prompts/list")
        );
        StringAssert.Contains(prompts.ToString(), "plan_destination");
        var prompt = await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                agent,
                "prompts/get",
                new
                {
                    name = "plan_destination",
                    arguments = new
                    {
                        tripId = Guid.NewGuid().ToString(),
                        destinationCity = "paris-fr",
                    },
                }
            )
        );
        StringAssert.Contains(prompt.ToString(), "get_planning_context");
        var tools = await McpEndpointTests.Result(await McpEndpointTests.Rpc(agent, "tools/list"));
        foreach (string name in new[] { "create_activity", "update_activity" })
        {
            var tool = tools
                .GetProperty("tools")
                .EnumerateArray()
                .Single(t => t.GetProperty("name").GetString() == name);
            var properties = tool.GetProperty("inputSchema")
                .GetProperty("properties")
                .GetProperty("request")
                .GetProperty("properties")
                .GetProperty("properties");
            var kinds = properties.GetProperty("properties").GetProperty("kinds");
            Assert.AreEqual(1, kinds.GetProperty("minItems").GetInt32());
            Assert.IsTrue(kinds.GetProperty("uniqueItems").GetBoolean());
            StringAssert.Contains(kinds.ToString(), "Food");
            StringAssert.Contains(properties.ToString(), "ticketRequirement");
        }
    }
}
