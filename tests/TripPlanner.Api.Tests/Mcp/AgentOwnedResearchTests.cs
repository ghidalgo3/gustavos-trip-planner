using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
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
                "geocode_address",
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
        var geocode = tools
            .GetProperty("tools")
            .EnumerateArray()
            .Single(tool => tool.GetProperty("name").GetString() == "geocode_address");
        var annotations = geocode.GetProperty("annotations");
        Assert.IsTrue(annotations.GetProperty("readOnlyHint").GetBoolean());
        Assert.IsTrue(annotations.GetProperty("openWorldHint").GetBoolean());
    }

    [TestMethod]
    [DataRow("precise", true)]
    [DataRow("missing", false)]
    [DataRow("medium", false)]
    [DataRow("ambiguous", false)]
    [DataRow("multiple", false)]
    public async Task AgentCanGeocodeAndSaveItsResearchedActivityInJapan(
        string outcome,
        bool hasPoint
    )
    {
        const string address = "2-24-12 Shibuya, Shibuya-ku, Tokyo 150-0002, Japan";
        var maps = new Geocoder(outcome);
        var document = JsonSerializer.Deserialize<TripDocument>(
            File.ReadAllText(Endpoints.TripDocumentEndpointTests.RepositoryFile("docs/after.json")),
            TripResourceProjection.JsonOptions
        )!;
        await using var session = await Verification.McpEvalServer.CreateSession(document, maps);
        var place = await session.Factory.Database.GetDestinationPlaceAsync(
            session.UserId,
            session.TripId,
            "tokyo-jp"
        );
        Assert.IsFalse(string.IsNullOrEmpty(place!.ContextVersion));
        var geocode = await Geocode(session.Agent, session.TripId, place.CityId, address);
        Assert.IsFalse(geocode.GetProperty("isError").GetBoolean(), geocode.ToString());
        var data = geocode.GetProperty("structuredContent").GetProperty("data");
        var geometry = data.GetProperty("geometry");
        Assert.AreEqual(hasPoint, geometry.ValueKind == JsonValueKind.Object);
        Assert.AreEqual(
            hasPoint ? address : null,
            data.GetProperty("formattedAddress").GetString()
        );
        Assert.AreEqual(1, maps.Calls);
        Assert.AreEqual(address, maps.Address);
        Assert.AreEqual(place.CountryCode, maps.CountryCode);
        Assert.AreEqual(
            GeographyPoint.Create(place.Latitude, place.Longitude),
            maps.Center?.Position
        );
        var before = await session.Factory.Database.GetActivitiesAsync(
            session.UserId,
            session.TripId,
            place.CityId
        );
        Assert.IsFalse(before.Any(a => a.Properties.Name == "Agent-researched vegan lunch"));

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
                            geometry,
                            properties = new
                            {
                                name = "Agent-researched vegan lunch",
                                description = "Research supplied by the caller's agent.",
                                duration = "PT1H",
                                cost = (object?)null,
                                state = "Proposed",
                                kinds = new[] { "Food" },
                                address,
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
        Assert.AreEqual(address, saved.Properties.Address);
        Assert.AreEqual(hasPoint ? Geocoder.Point.Position : null, saved.Geometry?.Position);
    }

    [TestMethod]
    public async Task ReadScopeCanGeocodeOnlyForVisibleTripDestinationsWithValidAddresses()
    {
        var maps = new Geocoder("failure");
        await using var factory = new TestApplicationFactory
        {
            McpEnabled = true,
            MapsClient = maps,
        };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var (trip, _, place, _) = await ActivityPlanningFixture.SeedDatabase(
            factory.Database,
            user
        );
        var other = await factory.Database.GetOrCreateUserAsync(
            new("google", "other@example.test", "Other")
        );
        var (privateTrip, _, privatePlace, _) = await ActivityPlanningFixture.SeedDatabase(
            factory.Database,
            other
        );
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );

        var inaccessible = await Geocode(
            agent,
            privateTrip.Id,
            privatePlace.CityId,
            "1 Main Street"
        );
        Assert.AreEqual(
            404,
            inaccessible.GetProperty("structuredContent").GetProperty("status").GetInt32()
        );
        var missing = await Geocode(agent, trip.Id, "missing-city", "1 Main Street");
        Assert.AreEqual(
            404,
            missing.GetProperty("structuredContent").GetProperty("status").GetInt32()
        );
        foreach (var address in new[] { "  ", new string('a', 501) })
        {
            var invalid = await Geocode(agent, trip.Id, place.CityId, address);
            Assert.IsTrue(invalid.GetProperty("isError").GetBoolean(), invalid.ToString());
        }
        Assert.AreEqual(0, maps.Calls);

        var unavailable = await Geocode(agent, trip.Id, place.CityId, "1 Main Street");
        Assert.AreEqual(1, maps.Calls);
        Assert.AreEqual(
            502,
            unavailable.GetProperty("structuredContent").GetProperty("status").GetInt32()
        );
        Assert.DoesNotContain("provider internals", unavailable.ToString());
    }

    private static async Task<JsonElement> Geocode(
        HttpClient agent,
        Guid tripId,
        string destinationId,
        string address
    ) =>
        await McpEndpointTests.Result(
            await McpEndpointTests.Rpc(
                agent,
                "tools/call",
                new
                {
                    name = "geocode_address",
                    arguments = new
                    {
                        tripId,
                        destinationId,
                        address,
                    },
                }
            )
        );

    private sealed class Geocoder(string outcome) : AzureMapsStub
    {
        public static readonly GeoJsonPoint Point = new(
            "Point",
            GeographyPoint.Create(35.658, 139.702)
        );
        public int Calls { get; private set; }
        public string? Address { get; private set; }
        public string? CountryCode { get; private set; }
        public GeoJsonPoint? Center { get; private set; }

        public override Task<IReadOnlyList<AddressLocationCandidate>> GeocodeAddressAsync(
            string address,
            string city,
            string countryCode,
            CancellationToken cancellationToken,
            GeoJsonPoint? center = null,
            StructuredAddress? structuredAddress = null
        )
        {
            Calls++;
            Address = address;
            CountryCode = countryCode;
            Center = center;
            var match = new AddressLocationCandidate(
                Point,
                address,
                outcome == "medium" ? AddressMatchConfidence.Medium : AddressMatchConfidence.High,
                outcome == "ambiguous"
            );
            return Task.FromResult<IReadOnlyList<AddressLocationCandidate>>(
                outcome switch
                {
                    "missing" => [],
                    "multiple" =>
                    [
                        match,
                        match with
                        {
                            Geometry = new("Point", GeographyPoint.Create(35.659, 139.703)),
                        },
                    ],
                    "failure" => throw new HttpRequestException("provider internals"),
                    _ => [match],
                }
            );
        }
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
