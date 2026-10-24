using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Mcp;
using TripPlanner.Api.Tests.Support;
using static TripPlanner.Api.Tests.Mcp.McpEndpointTests;

namespace TripPlanner.Api.Tests.Validation;

[TestClass]
public class InputValidationTests
{
    [TestMethod]
    [DataRow(null, true)]
    [DataRow("flight-key", true)]
    [DataRow("", false)]
    [DataRow(" ", false)]
    public void PartialFlightChoicesAllowUnselectedSlotsButNotInvalidKeys(string? key, bool valid)
    {
        var errors = TripPlanner.Api.Validation.ApiInputValidation.Validate(
            new SetFlightChoicesRequest([null, key]),
            "request"
        );
        Assert.AreEqual(valid, errors.Count == 0);
        Assert.IsNotEmpty(
            TripPlanner.Api.Validation.ApiInputValidation.Validate(
                new SelectFlightRequest("cache", 0, [null!], 100, "USD"),
                "request"
            )
        );
    }

    [TestMethod]
    [DataRow("\"24:00\"")]
    [DataRow("\"9:00\"")]
    [DataRow("\"09:00\"")]
    [DataRow("\"09:00:01\"")]
    [DataRow("null")]
    [DataRow("900")]
    public async Task InvalidClockTimes_AreRejectedByRestAndMcp(string value)
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = CreateClient(factory);
        var user = await SeedAndSetCookie(factory, browser);
        SetTestPrincipal(browser, user.Email);
        var request = new JsonObject
        {
            ["instructions"] = "",
            ["defaults"] = new JsonObject { ["sleepStart"] = JsonNode.Parse(value) },
        };
        using var restRequest = new HttpRequestMessage(HttpMethod.Put, "/user/activity-preferences")
        {
            Content = JsonContent.Create(request),
        };
        restRequest.Headers.TryAddWithoutValidation("If-Match", "\"0\"");
        using var response = await browser.SendAsync(restRequest);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        var token = await Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var result = await Result(
            await Rpc(
                agent,
                "tools/call",
                new
                {
                    name = "replace_activity_preferences",
                    arguments = new
                    {
                        scope = "Profile",
                        request,
                        etag = "\"0\"",
                    },
                }
            )
        );
        Assert.IsTrue(result.GetProperty("isError").GetBoolean(), result.ToString());
        Assert.AreEqual(
            400,
            result.GetProperty("structuredContent").GetProperty("status").GetInt32(),
            result.ToString()
        );
    }

    [TestMethod]
    public async Task OpenApiSchemas_DescribeTheSameInputConstraints()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        var document = await client.GetFromJsonAsync<JsonElement>("/openapi/v1.json");
        var schemas = document.GetProperty("components").GetProperty("schemas");
        JsonElement Resolve(JsonElement schema) =>
            schema.TryGetProperty("$ref", out var reference)
                ? schemas.GetProperty(reference.GetString()!.Split('/')[^1])
                : schema;
        var activity = schemas.GetProperty("ActivityProperties").GetProperty("properties");
        var choiceItemType = schemas
            .GetProperty("SetFlightChoicesRequest")
            .GetProperty("properties")
            .GetProperty("legKeys")
            .GetProperty("items")
            .GetProperty("type");
        CollectionAssert.AreEquivalent(
            new[] { "string", "null" },
            choiceItemType.EnumerateArray().Select(item => item.GetString()).ToArray()
        );
        foreach (
            var (model, field) in new[]
            {
                ("DailyPlanningSettings", "sleepStart"),
                ("ActivityPlanDay", "availableFrom"),
                ("ActivityPlanRule", "fixedStart"),
                ("ActivityOpeningWindow", "start"),
            }
        )
        {
            var clock = Resolve(
                schemas.GetProperty(model).GetProperty("properties").GetProperty(field)
            );
            Assert.AreEqual(ClockTimeAttribute.Pattern, clock.GetProperty("pattern").GetString());
            Assert.AreEqual(16, clock.GetProperty("maxLength").GetInt32());
            Assert.AreEqual(8, clock.GetProperty("minLength").GetInt32());
            Assert.IsFalse(clock.TryGetProperty("format", out _), clock.ToString());
        }
        StringAssert.Contains(
            activity.GetProperty("duration").GetProperty("type").ToString(),
            "string"
        );
        CollectionAssert.AreEquivalent(
            new[] { "Proposed", "Planned", "Rejected" },
            Resolve(activity.GetProperty("state"))
                .GetProperty("enum")
                .EnumerateArray()
                .Select(v => v.GetString())
                .ToArray()
        );
        CollectionAssert.AreEquivalent(
            new[] { "Traveller", "Planner" },
            Resolve(
                    schemas
                        .GetProperty("PartyMemberRequest")
                        .GetProperty("properties")
                        .GetProperty("role")
                )
                .GetProperty("enum")
                .EnumerateArray()
                .Select(v => v.GetString())
                .ToArray()
        );
        StringAssert.Contains(
            activity.GetProperty("duration").GetProperty("description").GetString()!,
            "P7D"
        );
        Assert.AreEqual(
            2,
            schemas
                .GetProperty("GeoJsonPoint")
                .GetProperty("properties")
                .GetProperty("coordinates")
                .GetProperty("maxItems")
                .GetInt32()
        );
    }

    [TestMethod]
    [DataRow(
        "replace_activity_preferences",
        "{\"scope\":\"Invented\",\"request\":{\"instructions\":\"\"},\"etag\":\"\\\"0\\\"\"}"
    )]
    [DataRow(
        "replace_activity_preferences",
        "{\"scope\":99,\"request\":{\"instructions\":\"\"},\"etag\":\"\\\"0\\\"\"}"
    )]
    [DataRow(
        "replace_activity_preferences",
        "{\"scope\":\"Profile\",\"request\":{\"instructions\":\"\",\"defaults\":{\"transportMode\":\"jetpack\"}},\"etag\":\"\\\"0\\\"\"}"
    )]
    [DataRow(
        "replace_activity_preferences",
        "{\"scope\":\"Profile\",\"request\":{\"instructions\":\"\",\"defaults\":{\"transportMode\":\"transit\"}},\"etag\":\"\\\"0\\\"\"}"
    )]
    [DataRow(
        "replace_activity_preferences",
        "{\"scope\":\"Profile\",\"request\":{\"instructions\":\"\",\"defaults\":{\"sleepStart\":\"25:00\"}},\"etag\":\"\\\"0\\\"\"}"
    )]
    [DataRow(
        "replace_activity_preferences",
        "{\"scope\":\"Profile\",\"request\":{\"instructions\":\"\",\"defaults\":{\"slackDuration\":1441}},\"etag\":\"\\\"0\\\"\"}"
    )]
    [DataRow("list_operations", "{\"top\":101}")]
    [DataRow("list_operations", "{\"type\":\"madeUp\"}")]
    [DataRow("get_trip", "{\"tripId\":\"00000000-0000-0000-0000-000000000000\"}")]
    public async Task McpParameters_RejectInvalidEnumAndScalarInputs(string tool, string json)
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = CreateClient(factory);
        await SeedAndSetCookie(factory, browser);
        var token = await Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var result = await Result(
            await Rpc(agent, "tools/call", new { name = tool, arguments = JsonNode.Parse(json) })
        );
        Assert.IsTrue(result.GetProperty("isError").GetBoolean(), result.ToString());
        Assert.AreEqual(
            400,
            result.GetProperty("structuredContent").GetProperty("status").GetInt32(),
            result.ToString()
        );
    }

    [TestMethod]
    [DataRow("/trips", "POST", "{\"name\":\"Trip\",\"constraints\":[]}")]
    [DataRow("/trips/{trip}", "PUT", "{\"name\":null}")]
    [DataRow(
        "/trips/{trip}/destinations",
        "POST",
        "{\"type\":\"Feature\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[0,0]},\"properties\":{\"name\":\"Paris\",\"countryCode\":\"123\"}}"
    )]
    [DataRow(
        "/trips/{trip}/destinations",
        "POST",
        "{\"type\":\"Feature\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[0,0]},\"properties\":{\"name\":\"Paris\",\"countryCode\":\"FR\",\"timeZone\":\"invented-zone\"}}"
    )]
    [DataRow(
        "/trips/{trip}/destinations",
        "POST",
        "{\"type\":\"Feature\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[0,0]},\"properties\":{\"name\":\"Paris\",\"countryCode\":\"FR\",\"arrivalDate\":\"0001-01-01\"}}"
    )]
    [DataRow("/trips/{trip}/flights/constraints", "PUT", "{\"schemaVersion\":2}")]
    [DataRow("/trips/{trip}/flights/constraints", "PUT", "{\"parties\":null}")]
    [DataRow("/trips/{trip}/flights/constraints", "PUT", "{\"parties\":[null]}")]
    [DataRow(
        "/trips/{trip}/flights/constraints",
        "PUT",
        "{\"parties\":[{\"partyId\":\"{party}\",\"cabin\":\"luxury\"}]}"
    )]
    [DataRow(
        "/trips/{trip}/flights/constraints",
        "PUT",
        "{\"parties\":[{\"partyId\":\"{party}\",\"market\":\"12\"}]}"
    )]
    [DataRow(
        "/trips/{trip}/flights/constraints",
        "PUT",
        "{\"parties\":[{\"partyId\":\"{party}\",\"maxJourneyHours\":0}]}"
    )]
    [DataRow(
        "/trips/{trip}/flights/constraints",
        "PUT",
        "{\"parties\":[{\"partyId\":\"{party}\",\"maxStops\":3}]}"
    )]
    [DataRow(
        "/trips/{trip}/flights/constraints",
        "PUT",
        "{\"searchLimits\":{\"flexibilityDays\":6}}"
    )]
    [DataRow(
        "/trips/{trip}/flights/{party}",
        "PUT",
        "{\"cacheKey\":\"fare\",\"itineraryIndex\":0,\"priceCurrency\":\"123\"}"
    )]
    [DataRow(
        "/trips/{trip}/flights/{party}/purchases",
        "PUT",
        "{\"cacheKey\":\"fare\",\"itineraryIndex\":-1,\"purchasedLegs\":[true]}"
    )]
    [DataRow("/trips/{trip}/flights/choices/{party}", "PUT", "{\"legKeys\":null}")]
    [DataRow(
        "/trips/{trip}/flights/choices/{party}",
        "PUT",
        "{\"legKeys\":[],\"purchasedOfferIds\":[\"\"]}"
    )]
    [DataRow("/trips/{trip}/flights/choices/{party}/bookingLinks", "POST", "{\"ignavId\":\"\"}")]
    [DataRow(
        "/user/{user}/trips/{trip}/parties/{party}/members/{user}",
        "PUT",
        "{\"role\":\"Admin\"}"
    )]
    [DataRow("/user/{user}/trips/{trip}/parties/{party}/members/{user}", "PUT", "{\"role\":null}")]
    [DataRow("/user/{user}/trips/{trip}/parties/{party}/members/{user}", "PUT", "{\"role\":0}")]
    [DataRow("/user/{user}/trips/{trip}/parties/{party}/members/{user}", "PUT", "{\"role\":99}")]
    [DataRow(
        "/user/profile",
        "PUT",
        "{\"homeCity\":{\"name\":\"Boston\",\"longitude\":0,\"latitude\":0},\"preferredAirlines\":[null]}"
    )]
    [DataRow(
        "/user/activity-preferences",
        "PUT",
        "{\"instructions\":\"\",\"defaults\":{\"transportMode\":\"jetpack\"}}"
    )]
    [DataRow(
        "/user/activity-preferences",
        "PUT",
        "{\"instructions\":\"\",\"defaults\":{\"transportMode\":\"transit\"}}"
    )]
    [DataRow(
        "/user/activity-preferences",
        "PUT",
        "{\"instructions\":\"\",\"defaults\":{\"sleepStart\":\"25:00\"}}"
    )]
    [DataRow(
        "/user/activity-preferences",
        "PUT",
        "{\"instructions\":\"\",\"defaults\":{\"slackDuration\":-1}}"
    )]
    [DataRow(
        "/trips/{trip}/destinations/paris-fr/activity-plan/proposals",
        "POST",
        "{\"requestId\":\"{user}\",\"contextVersion\":\"version\",\"kind\":\"invented\"}"
    )]
    public async Task ResourceInputs_RejectInvalidEnumsRangesFormatsAndNulls(
        string route,
        string method,
        string body
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        SetTestPrincipal(client, "ada@example.com");
        await client.PutAsJsonAsync("/user/profile", new UserProfile(new("Boston", -71, 42), []));
        var user = factory.Database.Users.Single();
        var trip = await factory.Database.CreateTripAsync(user.Id, "Unchanged", "");
        var party = (await factory.Database.GetPartiesAsync(user.Id, trip.Id)).Single();
        string Expand(string text) =>
            text.Replace("{trip}", trip.Id.ToString())
                .Replace("{user}", user.Id.ToString())
                .Replace("{party}", party.Id.ToString());
        using var request = new HttpRequestMessage(new HttpMethod(method), Expand(route))
        {
            Content = new StringContent(
                Expand(body),
                System.Text.Encoding.UTF8,
                "application/json"
            ),
        };
        using var response = await client.SendAsync(request);
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            response.StatusCode,
            await response.Content.ReadAsStringAsync()
        );
        Assert.AreEqual("Unchanged", factory.Database.Trips.Single().Name);
        Assert.IsEmpty(
            (await client.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!.Entries
        );
    }

    [TestMethod]
    [DataRow("properties.state", "\"Booked\"")]
    [DataRow("properties.state", "\"planned\"")]
    [DataRow("properties.state", "\"\"")]
    [DataRow("properties.state", "null")]
    [DataRow("properties.state", "0")]
    [DataRow("properties.state", "99")]
    [DataRow("properties.state", "\"0\"")]
    [DataRow("properties.duration", "0")]
    [DataRow("properties.duration", "\"PT0S\"")]
    [DataRow("properties.duration", "\"P7DT1M\"")]
    [DataRow("properties.duration", "\"PT90S\"")]
    [DataRow("properties.duration", "10081")]
    [DataRow("properties.duration", "1.5")]
    [DataRow("properties.duration", "\"01:30:00\"")]
    [DataRow("properties.cost.amount", "-1")]
    [DataRow("properties.cost", "{\"currency\":\"EUR\",\"basis\":\"total\"}")]
    [DataRow("properties.cost.currency", "\"123\"")]
    [DataRow("properties.cost.basis", "\"perGroup\"")]
    [DataRow("geometry.type", "\"LineString\"")]
    [DataRow("geometry.coordinates", "[181,0]")]
    [DataRow("geometry.coordinates", "[0,91]")]
    [DataRow("geometry.coordinates", "[0]")]
    [DataRow("geometry.coordinates", "[0,0,0]")]
    [DataRow("geometry.coordinates", "[\"2\",48]")]
    [DataRow("properties.links", "null")]
    [DataRow("properties.links", "[null]")]
    [DataRow("properties.links", "[{\"url\":\"javascript:alert(1)\"}]")]
    [DataRow("properties.links", "[{\"url\":\"https://user:password@example.com\"}]")]
    [DataRow("properties", "null")]
    [DataRow("type", "\"Activity\"")]
    public async Task InvalidActivityInputs_AreRejectedByRestAndMcpWithoutMutations(
        string field,
        string invalidJson
    )
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = CreateClient(factory);
        var user = await SeedAndSetCookie(factory, browser);
        SetTestPrincipal(browser, user.Email);
        var trip = await factory.Database.CreateTripAsync(user.Id, "Paris", "");
        using var destinationResponse = await browser.PostAsJsonAsync(
            $"/trips/{trip.Id}/destinations",
            new CreateDestinationRequest(
                "Feature",
                new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.35)),
                new("Paris", "FR")
            )
        );
        destinationResponse.EnsureSuccessStatusCode();
        var destination = (
            await destinationResponse.Content.ReadFromJsonAsync<
                GeoJsonFeature<DestinationProperties>
            >()
        )!;
        string url = $"/trips/{trip.Id}/destinations/{destination.Id}/activities";
        var input = new ActivityInput(
            "Feature",
            null,
            new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.35)),
            new(
                "Museum",
                TimeSpan.FromHours(1),
                "Art",
                new(10, "EUR", "perPerson"),
                ActivityState.Proposed
            )
        );
        using var create = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(input),
        };
        create.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        using var created = await browser.SendAsync(create);
        created.EnsureSuccessStatusCode();
        var activity = (
            await created.Content.ReadFromJsonAsync<GeoJsonFeature<ActivityProperties>>()
        )!;
        string etag = created.Headers.ETag!.Tag;
        var token = await Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        int logCount = (await browser.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!
            .Entries
            .Count;
        foreach (bool replace in new[] { false, true })
        {
            var body = JsonSerializer.SerializeToNode(
                input with
                {
                    Id = replace ? activity.Id : null,
                },
                JsonSerializerOptions.Web
            )!;
            var path = field.Split('.');
            JsonNode parent = body;
            foreach (var part in path[..^1])
            {
                parent = parent[part]!;
            }

            parent[path[^1]] = JsonNode.Parse(invalidJson);
            using var request = new HttpRequestMessage(
                replace ? HttpMethod.Put : HttpMethod.Post,
                replace ? $"{url}/{activity.Id}" : url
            )
            {
                Content = JsonContent.Create(body),
            };
            request.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
            request.Headers.TryAddWithoutValidation("If-Match", etag);
            using var response = await browser.SendAsync(request);
            Assert.AreEqual(
                HttpStatusCode.BadRequest,
                response.StatusCode,
                await response.Content.ReadAsStringAsync()
            );
            var args = new JsonObject
            {
                ["tripId"] = trip.Id.ToString(),
                ["destinationId"] = destination.Id,
                ["request"] = body.DeepClone(),
                ["contextVersion"] = destination.Properties.ContextVersion,
            };
            if (replace)
            {
                args["activityId"] = activity.Id;
                args["etag"] = etag;
            }
            var result = await Result(
                await Rpc(
                    agent,
                    "tools/call",
                    new { name = replace ? "update_activity" : "create_activity", arguments = args }
                )
            );
            Assert.IsTrue(result.GetProperty("isError").GetBoolean(), result.ToString());
            Assert.AreEqual(
                400,
                result.GetProperty("structuredContent").GetProperty("status").GetInt32(),
                result.ToString()
            );
        }
        var saved = await factory.Database.GetActivitiesAsync(user.Id, trip.Id, destination.Id);
        Assert.HasCount(1, saved);
        Assert.AreEqual(ActivityState.Proposed, saved[0].Properties.State);
        Assert.HasCount(
            logCount,
            (await browser.GetFromJsonAsync<ActivityLogPage>("/user/activity-log"))!.Entries
        );
    }

    [TestMethod]
    [DataRow("Proposed")]
    [DataRow("Planned")]
    [DataRow("Rejected")]
    public async Task ActivityStates_AcceptAllSupportedValues(string state)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        SetTestPrincipal(client, "ada@example.com");
        await client.PutAsJsonAsync("/user/profile", new UserProfile(new("Boston", -71, 42), []));
        var trip = (
            await (
                await client.PostAsJsonAsync("/trips", new CreateTripRequest("Trip", ""))
            ).Content.ReadFromJsonAsync<TripResponse>()
        )!;
        var destination = (
            await (
                await client.PostAsJsonAsync(
                    $"/trips/{trip.Id}/destinations",
                    new CreateDestinationRequest(
                        "Feature",
                        new("Point", GeographyPoint.Create(latitude: 48.86, longitude: 2.35)),
                        new("Paris", "FR")
                    )
                )
            ).Content.ReadFromJsonAsync<GeoJsonFeature<DestinationProperties>>()
        )!;
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/trips/{trip.Id}/destinations/{destination.Id}/activities"
        )
        {
            Content = JsonContent.Create(
                new
                {
                    type = "Feature",
                    properties = new
                    {
                        name = "Museum",
                        description = "",
                        state,
                    },
                }
            ),
        };
        request.Headers.Add("Destination-Context", destination.Properties.ContextVersion);
        using var result = await client.SendAsync(request);
        Assert.AreEqual(
            HttpStatusCode.Created,
            result.StatusCode,
            await result.Content.ReadAsStringAsync()
        );
    }

    [TestMethod]
    [DataRow("/operations?top=101")]
    [DataRow("/operations?skip=-1")]
    [DataRow("/operations?type=invented")]
    [DataRow("/user/activity-log?skip=100001")]
    [DataRow("/airports?q=x")]
    [DataRow("/airports/home?city=Boston&longitude=181&latitude=0")]
    [DataRow("/airports/cities?codes=123")]
    public async Task QueryParameters_RejectInvalidRangesAndEnums(string url)
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        SetTestPrincipal(client, "ada@example.com");
        await client.PutAsJsonAsync("/user/profile", new UserProfile(new("Boston", -71, 42), []));
        Assert.AreEqual(HttpStatusCode.BadRequest, (await client.GetAsync(url)).StatusCode);
    }

    [TestMethod]
    public async Task PublishedMcpSchemas_DescribeEnumsRangesAndFormats()
    {
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = CreateClient(factory);
        await SeedAndSetCookie(factory, browser);
        var token = await Tokens(browser, "tripplanner.read tripplanner.write");
        using var agent = CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        var result = await Result(await Rpc(agent, "tools/list"));
        var tools = result
            .GetProperty("tools")
            .EnumerateArray()
            .ToDictionary(t => t.GetProperty("name").GetString()!);
        var schema = tools["create_activity"].GetProperty("inputSchema").GetProperty("properties");
        Assert.AreEqual("uuid", schema.GetProperty("tripId").GetProperty("format").GetString());
        var activity = schema.GetProperty("request").GetProperty("properties");
        var props = activity.GetProperty("properties").GetProperty("properties");
        CollectionAssert.AreEquivalent(
            new[] { "Proposed", "Planned", "Rejected" },
            props
                .GetProperty("state")
                .GetProperty("enum")
                .EnumerateArray()
                .Select(v => v.GetString())
                .ToArray()
        );
        Assert.AreEqual(
            "duration",
            props.GetProperty("duration").GetProperty("format").GetString()
        );
        StringAssert.Contains(
            props.GetProperty("duration").GetProperty("type").ToString(),
            "string"
        );
        StringAssert.Contains(
            props.GetProperty("duration").GetProperty("description").GetString()!,
            "P7D"
        );
        Assert.AreEqual(20, props.GetProperty("links").GetProperty("maxItems").GetInt32());
        var cost = props.GetProperty("cost").GetProperty("properties");
        CollectionAssert.AreEquivalent(
            new[] { "perPerson", "total" },
            cost.GetProperty("basis")
                .GetProperty("enum")
                .EnumerateArray()
                .Select(v => v.GetString())
                .ToArray()
        );
        Assert.AreEqual(
            "^[A-Za-z]{3}$",
            cost.GetProperty("currency").GetProperty("pattern").GetString()
        );
        var coordinates = activity
            .GetProperty("geometry")
            .GetProperty("properties")
            .GetProperty("coordinates");
        Assert.AreEqual(2, coordinates.GetProperty("maxItems").GetInt32());
        Assert.AreEqual("array", coordinates.GetProperty("type").GetString());
        Assert.AreEqual(
            180,
            coordinates.GetProperty("prefixItems")[0].GetProperty("maximum").GetInt32()
        );
        Assert.AreEqual(
            90,
            coordinates.GetProperty("prefixItems")[1].GetProperty("maximum").GetInt32()
        );
        var destination = tools["add_destination"]
            .GetProperty("inputSchema")
            .GetProperty("properties")
            .GetProperty("request")
            .GetProperty("properties")
            .GetProperty("properties")
            .GetProperty("properties");
        Assert.AreEqual(
            "date",
            destination.GetProperty("arrivalDate").GetProperty("format").GetString()
        );
        Assert.IsTrue(
            destination.GetProperty("constraints").TryGetProperty("properties", out _),
            destination.GetProperty("constraints").GetRawText()
        );
        Assert.AreEqual(
            5,
            destination
                .GetProperty("constraints")
                .GetProperty("properties")
                .GetProperty("arrivalFlexibilityDays")
                .GetProperty("maximum")
                .GetInt32()
        );
        var trip = tools["create_trip"]
            .GetProperty("inputSchema")
            .GetProperty("properties")
            .GetProperty("request")
            .GetProperty("properties");
        Assert.AreEqual(200, trip.GetProperty("name").GetProperty("maxLength").GetInt32());
        var scope = tools["get_activity_preferences"]
            .GetProperty("inputSchema")
            .GetProperty("properties")
            .GetProperty("scope");
        CollectionAssert.AreEquivalent(
            new[] { "Profile", "Trip", "Destination" },
            scope.GetProperty("enum").EnumerateArray().Select(v => v.GetString()).ToArray()
        );
        var proposal = tools["create_activity_plan_proposal"]
            .GetProperty("inputSchema")
            .GetProperty("properties")
            .GetProperty("request")
            .GetProperty("properties");
        CollectionAssert.AreEquivalent(
            new[] { "draft", "improvements", "schedule" },
            proposal
                .GetProperty("kind")
                .GetProperty("enum")
                .EnumerateArray()
                .Select(v => v.GetString())
                .ToArray()
        );
        var settings = tools["replace_activity_preferences"]
            .GetProperty("inputSchema")
            .GetProperty("properties")
            .GetProperty("request")
            .GetProperty("properties")
            .GetProperty("defaults")
            .GetProperty("properties");
        CollectionAssert.AreEquivalent(
            new[] { "walking", "taxi", "driving" },
            settings
                .GetProperty("transportMode")
                .GetProperty("enum")
                .EnumerateArray()
                .Select(v => v.GetString())
                .ToArray()
        );
        StringAssert.Contains(
            settings.GetProperty("slackDuration").GetProperty("description").GetString()!,
            "P1D"
        );
        Assert.AreEqual(
            ClockTimeAttribute.Pattern,
            settings.GetProperty("sleepStart").GetProperty("pattern").GetString()
        );
        Assert.AreEqual(
            "string",
            settings.GetProperty("sleepStart").GetProperty("type").GetString()
        );
        Assert.IsFalse(settings.GetProperty("sleepStart").TryGetProperty("format", out _));
    }
}
