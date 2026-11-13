using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
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
        var description = geocode.GetProperty("description").GetString()!;
        foreach (
            var requirement in new[]
            {
                "MUST save any researched address in properties.address regardless of geocoding success",
                "null, fails or is incorrect",
                "MUST attempt independent coordinate research",
                "Government records are desirable when relevant but are not required",
                "[longitude, latitude]",
                "Read back with get_activity",
            }
        )
        {
            StringAssert.Contains(description, requirement);
        }
        foreach (var name in new[] { "create_activity", "update_activity" })
        {
            var tool = tools
                .GetProperty("tools")
                .EnumerateArray()
                .Single(t => t.GetProperty("name").GetString() == name);
            StringAssert.Contains(
                tool.GetProperty("description").GetString()!,
                "properties.address"
            );
            var addressDescription = tool.GetProperty("inputSchema")
                .GetProperty("properties")
                .GetProperty("request")
                .GetProperty("properties")
                .GetProperty("properties")
                .GetProperty("properties")
                .GetProperty("address")
                .GetProperty("description")
                .GetString()!;
            StringAssert.Contains(
                addressDescription,
                "even if geocoding fails or geometry is null"
            );
        }
    }

    [TestMethod]
    [DataRow("precise", true, false)]
    [DataRow("missing", false, false)]
    [DataRow("missing", false, true)]
    [DataRow("medium", false, false)]
    [DataRow("ambiguous", false, false)]
    [DataRow("multiple", false, false)]
    public async Task AgentCanGeocodeAndSaveItsResearchedActivityInJapan(
        string outcome,
        bool hasPoint,
        bool independentPoint
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
        var providerGeometry = data.GetProperty("geometry");
        var geometry = independentPoint
            ? JsonSerializer.SerializeToElement(
                new { type = "Point", coordinates = new[] { 139.7021, 35.6581 } }
            )
            : providerGeometry;
        Assert.AreEqual(hasPoint, providerGeometry.ValueKind == JsonValueKind.Object);
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
        Assert.AreEqual(
            independentPoint ? GeographyPoint.Create(35.6581, 139.7021)
                : hasPoint ? Geocoder.Point.Position
                : null,
            saved.Geometry?.Position
        );
        var readBack = await Call(
            session.Agent,
            "get_activity",
            new
            {
                tripId = session.TripId,
                destinationId = place.CityId,
                activityId = saved.Id,
            }
        );
        Assert.AreEqual(
            address,
            readBack
                .GetProperty("data")
                .GetProperty("properties")
                .GetProperty("address")
                .GetString()
        );
        Assert.IsTrue(
            JsonElement.DeepEquals(geometry, readBack.GetProperty("data").GetProperty("geometry"))
        );
    }

    [TestMethod]
    [DataRow(ActivityState.Proposed, "missing", true)]
    [DataRow(ActivityState.Planned, "missing", true)]
    [DataRow(ActivityState.Rejected, "missing", true)]
    [DataRow(ActivityState.Proposed, "failure", false)]
    [DataRow(ActivityState.Planned, "failure", false)]
    [DataRow(ActivityState.Rejected, "failure", false)]
    public async Task LocationUpdatePersistsIndependentResearchWithoutChangingStateOrPlan(
        ActivityState state,
        string outcome,
        bool resolved
    )
    {
        var maps = new Geocoder(outcome);
        await using var factory = new TestApplicationFactory
        {
            McpEnabled = true,
            MapsClient = maps,
        };
        using var browser = McpEndpointTests.CreateClient(factory);
        var user = await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var (trip, _, place, activity) = await ActivityPlanningFixture.SeedDatabase(
            factory.Database,
            user
        );
        place = (await factory.Database.GetDestinationPlaceAsync(user.Id, trip.Id, place.CityId))!;
        var properties = activity.Properties with
        {
            State = state,
            Description = "Keep the existing visit notes.",
            Cost = new(12, "EUR", "perPerson"),
            TicketRequirement = "Required",
            Links = [new("https://venue.example/tickets", "Tickets")],
        };
        Assert.IsNotNull(
            await factory.Database.SaveActivityAsync(
                user.Id,
                activity with
                {
                    Geometry = null,
                    Properties = properties,
                },
                place.ContextVersion,
                activity.UpdatedAt
            )
        );
        var token = await McpEndpointTests.Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var activityArgs = new
        {
            tripId = trip.Id,
            destinationId = place.CityId,
            activityId = activity.Id,
        };
        var planArgs = new { tripId = trip.Id, destinationCity = place.CityId };
        var planBefore = await Call(agent, "get_activity_plan", planArgs);
        if (state == ActivityState.Planned)
        {
            var plan = JsonNode.Parse(
                planBefore.GetProperty("data").GetProperty("plan").GetRawText()
            )!;
            var stay = (
                await factory.Database.GetDestinationVisitsAsync(user.Id, trip.Id)
            ).Single();
            plan["days"] = JsonSerializer.SerializeToNode(
                new[]
                {
                    new
                    {
                        stayId = stay.StayId,
                        date = ActivityPlanningFixture.Date,
                        activityIds = new[] { activity.Id },
                        name = "Museum day",
                    },
                }
            );
            plan["rules"] = JsonSerializer.SerializeToNode(
                new[]
                {
                    new
                    {
                        activityId = activity.Id,
                        fixedDate = ActivityPlanningFixture.Date,
                        fixedStart = "10:00:00",
                    },
                }
            );
            await Call(
                agent,
                "replace_activity_plan",
                new
                {
                    tripId = trip.Id,
                    destinationCity = place.CityId,
                    etag = planBefore.GetProperty("etag").GetString(),
                    request = new
                    {
                        plan,
                        contextVersion = planBefore
                            .GetProperty("data")
                            .GetProperty("contextVersion")
                            .GetString(),
                    },
                }
            );
            planBefore = await Call(agent, "get_activity_plan", planArgs);
        }

        const string address = "12 Example Street, Building A, Paris 75001, France";
        var geocode = await Geocode(agent, trip.Id, place.CityId, address);
        if (outcome == "failure")
        {
            Assert.AreEqual(
                502,
                geocode.GetProperty("structuredContent").GetProperty("status").GetInt32()
            );
        }
        else
        {
            Assert.AreEqual(
                JsonValueKind.Null,
                geocode
                    .GetProperty("structuredContent")
                    .GetProperty("data")
                    .GetProperty("geometry")
                    .ValueKind
            );
        }
        var before = await Call(agent, "get_activity", activityArgs);
        var destinations = await Call(agent, "list_destinations", new { tripId = trip.Id });
        var destination = destinations
            .GetProperty("data")
            .GetProperty("features")
            .EnumerateArray()
            .Single(f => f.GetProperty("id").GetString() == place.CityId);
        var request = JsonNode.Parse(before.GetProperty("data").GetRawText())!;
        var provenance = resolved
            ? "Verified venue; independently published coordinates from the venue map; no remaining uncertainty."
            : "Unresolved; reasonable research exhausted with conflicting coordinates; coordinate resolution remains incomplete.";
        request["geometry"] = resolved
            ? JsonSerializer.SerializeToNode(
                new { type = "Point", coordinates = new[] { 2.3364, 48.8606 } }
            )
            : null;
        request["properties"]!["address"] = address;
        request["properties"]!["description"] = properties.Description + " " + provenance;
        request["properties"]!["links"]!
            .AsArray()
            .Add(
                JsonSerializer.SerializeToNode(
                    new
                    {
                        url = "https://venue.example/map",
                        label = "Official address and venue map",
                    }
                )
            );
        await Call(
            agent,
            "update_activity",
            new
            {
                tripId = trip.Id,
                destinationId = place.CityId,
                activityId = activity.Id,
                etag = before.GetProperty("etag").GetString(),
                contextVersion = destination
                    .GetProperty("properties")
                    .GetProperty("contextVersion")
                    .GetString(),
                request,
            }
        );
        var after = await Call(agent, "get_activity", activityArgs);
        Assert.IsTrue(
            JsonElement.DeepEquals(
                JsonSerializer.SerializeToElement(request),
                after.GetProperty("data")
            ),
            after.ToString()
        );
        Assert.AreEqual(
            address,
            after.GetProperty("data").GetProperty("properties").GetProperty("address").GetString()
        );
        Assert.AreEqual(
            state.ToString(),
            after.GetProperty("data").GetProperty("properties").GetProperty("state").GetString()
        );
        var planAfter = await Call(agent, "get_activity_plan", planArgs);
        Assert.IsTrue(
            JsonElement.DeepEquals(
                planBefore.GetProperty("data").GetProperty("plan"),
                planAfter.GetProperty("data").GetProperty("plan")
            )
        );
        Assert.AreEqual(1, maps.Calls);
    }

    private static async Task<JsonElement> Call(HttpClient agent, string name, object arguments)
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
