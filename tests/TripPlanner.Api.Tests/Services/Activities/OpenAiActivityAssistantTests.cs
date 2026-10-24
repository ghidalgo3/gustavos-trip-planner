using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Activities;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Tests.Services.Activities;

[TestClass]
public class OpenAiActivityAssistantTests
{
    internal const string Candidates = """
        {"activities":[{"name":"Louvre","placeName":"Louvre Museum","duration":"PT2H","description":"Explore art collections.","costAmount":null,"costCurrency":null,"costBasis":null}]}
        """;

    internal static string CompletedResponse(string text = Candidates) =>
        JsonSerializer.Serialize(
            new
            {
                status = "completed",
                output = new object[]
                {
                    new { type = "reasoning" },
                    new
                    {
                        type = "message",
                        content = new[] { new { type = "output_text", text } },
                    },
                },
            }
        );

    [TestMethod]
    [DataRow(false)]
    [DataRow(true)]
    public async Task Suggest_SendsDestinationDatesAndStructuredPromptAndMapsCandidates(
        bool withImage
    )
    {
        using var handler = new ResponseHandler(CompletedResponse());
        var assistant = Create(handler);
        IReadOnlyList<ActivityImage> images = withImage ? [new("image/png", [1, 2, 3])] : [];
        IReadOnlyList<ActivityCandidate> result = await assistant.SuggestAsync(
            "Paris",
            "FR",
            [new(Guid.NewGuid(), 0, new(2027, 6, 10), new(2027, 6, 14), "", "")],
            "Find art museums",
            images,
            default
        );
        Assert.AreEqual("Louvre", result.Single().Name);
        Assert.AreEqual(TimeSpan.FromHours(2), result.Single().Duration);
        Assert.IsNull(result.Single().CostAmount);
        Assert.IsNull(result.Single().Longitude);
        Assert.AreEqual("https://api.openai.com/v1/responses", handler.Url);
        Assert.AreEqual("Bearer test-key", handler.Authorization);
        using var json = JsonDocument.Parse(handler.Request!);
        var request = json.RootElement;
        Assert.IsFalse(request.GetProperty("store").GetBoolean());
        Assert.AreEqual("configured-model", request.GetProperty("model").GetString());
        var format = request.GetProperty("text").GetProperty("format");
        Assert.AreEqual("json_schema", format.GetProperty("type").GetString());
        Assert.IsTrue(format.GetProperty("strict").GetBoolean());
        var durationPattern = format
            .GetProperty("schema")
            .GetProperty("properties")
            .GetProperty("activities")
            .GetProperty("items")
            .GetProperty("properties")
            .GetProperty("duration")
            .GetProperty("pattern")
            .GetString()!;
        // Validate the actual outgoing schema without allowing regex lookaround.
        var durationRegex = new Regex(durationPattern, RegexOptions.NonBacktracking);
        Assert.IsTrue(durationRegex.IsMatch("PT1H30M"));
        Assert.IsFalse(durationRegex.IsMatch("P1DT"));
        Assert.AreEqual(
            10,
            format
                .GetProperty("schema")
                .GetProperty("properties")
                .GetProperty("activities")
                .GetProperty("maxItems")
                .GetInt32()
        );
        var content = request.GetProperty("input")[0].GetProperty("content");
        using var context = JsonDocument.Parse(content[0].GetProperty("text").GetString()!);
        Assert.AreEqual("Paris", context.RootElement.GetProperty("city").GetString());
        Assert.AreEqual(
            "Find art museums",
            context.RootElement.GetProperty("userPrompt").GetString()
        );
        Assert.AreEqual(
            "2027-06-10",
            context.RootElement.GetProperty("stays")[0].GetProperty("ArrivalDate").GetString()
        );
        Assert.AreEqual(withImage ? 2 : 1, content.GetArrayLength());
        if (withImage)
        {
            StringAssert.Contains(
                request.GetProperty("instructions").GetString()!,
                "Do not add activities that were not mentioned in the images"
            );
            Assert.AreEqual(
                "data:image/png;base64,AQID",
                content[1].GetProperty("image_url").GetString()
            );
        }
    }

    [TestMethod]
    public async Task ImageExtraction_ReceivesEveryImageAndCanReturnNoActivities()
    {
        using var handler = new ResponseHandler(CompletedResponse("{\"activities\":[]}"));
        var result = await Create(handler)
            .SuggestAsync(
                "Tokyo",
                "JP",
                [],
                "Also invent some restaurants",
                [new("image/png", [1]), new("image/jpeg", [2])],
                default
            );
        Assert.IsEmpty(result);
        using var json = JsonDocument.Parse(handler.Request!);
        var content = json.RootElement.GetProperty("input")[0].GetProperty("content");
        Assert.AreEqual(
            "data:image/png;base64,AQ==",
            content[1].GetProperty("image_url").GetString()
        );
        Assert.AreEqual(
            "data:image/jpeg;base64,Ag==",
            content[2].GetProperty("image_url").GetString()
        );
        StringAssert.Contains(
            json.RootElement.GetProperty("instructions").GetString()!,
            "must not introduce additional activities"
        );
    }

    [TestMethod]
    [DataRow("{\"status\":\"incomplete\",\"output\":[]}")]
    [DataRow(
        "{\"status\":\"completed\",\"output\":[{\"content\":[{\"type\":\"refusal\",\"refusal\":\"No\"}]}]}"
    )]
    [DataRow("{\"status\":\"completed\",\"output\":[]}")]
    [DataRow("{}")]
    public async Task Suggest_RejectsUnusableResponses(string response)
    {
        using var handler = new ResponseHandler(response);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Create(handler).SuggestAsync("Paris", "FR", [], "Museums", [], default)
        );
    }

    [TestMethod]
    [DataRow(400)]
    [DataRow(401)]
    [DataRow(429)]
    [DataRow(500)]
    public async Task Suggest_PropagatesUpstreamFailures(int status)
    {
        using var handler = new ResponseHandler("{}", (HttpStatusCode)status);
        var exception = await Assert.ThrowsAsync<HttpRequestException>(() =>
            Create(handler).SuggestAsync("Paris", "FR", [], "Museums", [], default)
        );
        Assert.AreEqual((HttpStatusCode)status, exception.StatusCode);
        StringAssert.Contains(exception.Message, $"HTTP {status}");
        StringAssert.Contains(exception.Message, "requestId=unavailable");
    }

    [TestMethod]
    public async Task Suggest_FailureIncludesProviderDiagnosticsWithoutRequestSecrets()
    {
        const string input = "Private travel preferences";
        var image = new ActivityImage("image/png", Encoding.UTF8.GetBytes("private image"));
        var body = JsonSerializer.Serialize(
            new
            {
                error = new
                {
                    type = "invalid_request_error",
                    code = "invalid_json_schema",
                    param = "text.format.schema",
                    message = $"Unsupported schema.\n test-key sk-partial*** {input} {Convert.ToBase64String(image.Data)} "
                        + new string('x', 3000),
                    privateData = "not-for-logs",
                },
                request = "not-for-logs",
            }
        );
        using var handler = new ResponseHandler(body, HttpStatusCode.BadRequest, "req-123");
        var exception = await Assert.ThrowsAsync<HttpRequestException>(() =>
            Create(handler).SuggestAsync("Paris", "FR", [], input, [image], default)
        );
        StringAssert.Contains(exception.Message, "model=configured-model");
        StringAssert.Contains(exception.Message, "requestId=req-123");
        StringAssert.Contains(exception.Message, "type=invalid_request_error");
        StringAssert.Contains(exception.Message, "code=invalid_json_schema");
        StringAssert.Contains(exception.Message, "param=text.format.schema");
        StringAssert.Contains(exception.Message, "Unsupported schema.");
        StringAssert.Contains(exception.Message, "[REDACTED]");
        StringAssert.Contains(exception.Message, "[truncated]");
        foreach (
            var secret in new[]
            {
                "test-key",
                "sk-partial",
                input,
                Convert.ToBase64String(image.Data),
                "not-for-logs",
            }
        )
        {
            Assert.DoesNotContain(secret, exception.ToString());
        }
        Assert.DoesNotContain("\n", exception.Message);
    }

    [TestMethod]
    [DataRow("")]
    [DataRow("<html>private proxy response</html>")]
    [DataRow("{\"error\":\"private proxy response\"}")]
    [DataRow("{\"error\":{\"message\":123,\"type\":[]}}")]
    [DataRow("[]")]
    public async Task Suggest_MalformedErrorPreservesHttpStatusWithoutDumpingBody(string body)
    {
        using var handler = new ResponseHandler(body, HttpStatusCode.BadGateway, "req-456");
        var exception = await Assert.ThrowsAsync<HttpRequestException>(() =>
            Create(handler).SuggestAsync("Paris", "FR", [], "Museums", [], default)
        );
        Assert.AreEqual(HttpStatusCode.BadGateway, exception.StatusCode);
        StringAssert.Contains(exception.Message, "requestId=req-456");
        StringAssert.Contains(exception.Message, "Provider error details unavailable");
        Assert.DoesNotContain("private proxy response", exception.Message);
    }

    [TestMethod]
    public async Task Suggest_OversizedErrorPreservesHttpStatusWithoutDumpingBody()
    {
        using var handler = new ResponseHandler(new string('x', 17000), HttpStatusCode.BadRequest);
        var exception = await Assert.ThrowsAsync<HttpRequestException>(() =>
            Create(handler).SuggestAsync("Paris", "FR", [], "Museums", [], default)
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, exception.StatusCode);
        StringAssert.Contains(exception.Message, "diagnostic size limit");
        Assert.IsLessThan(500, exception.Message.Length);
    }

    [TestMethod]
    public async Task Suggest_MissingKeyDoesNotSendARequest()
    {
        using var handler = new ResponseHandler("{}");
        var assistant = new OpenAiActivityAssistant(
            new HttpClient(handler),
            Microsoft.Extensions.Options.Options.Create(new OpenAiOptions { ApiKey = " " })
        );
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            assistant.SuggestAsync("Paris", "FR", [], "Museums", [], default)
        );
        Assert.IsNull(handler.Request);
    }

    [TestMethod]
    [DataRow("FR", "Louvre Museum", 2.33, 48.86, true)]
    [DataRow("US", "Louvre Museum", 2.33, 48.86, false)]
    [DataRow("FR", "Paris", 2.33, 48.86, false)]
    [DataRow("FR", "Louvre Museum", 181.0, 48.86, false)]
    public async Task PlaceResolver_OnlyPinsVerifiedNamedPlaces(
        string country,
        string name,
        double longitude,
        double latitude,
        bool matches
    )
    {
        string response = JsonSerializer.Serialize(
            new
            {
                results = new[]
                {
                    new
                    {
                        poi = new { name },
                        address = new { countryCode = country },
                        position = new { lon = longitude, lat = latitude },
                    },
                },
            }
        );
        using var handler = new ResponseHandler(response);
        var resolver = new AzureActivityPlaceResolver(new HttpClient(handler), new MapTokens());
        var point = await resolver.ResolveAsync("Louvre", "Paris", "FR", default);
        Assert.AreEqual(matches, point is not null);
        if (point is not null)
        {
            Assert.AreEqual(
                GeographyPoint.Create(latitude: latitude, longitude: longitude),
                point.Position
            );
        }

        StringAssert.Contains(handler.Urls[0], "/search/poi/json?");
        StringAssert.Contains(handler.Urls[0], "countrySet=FR");
        Assert.AreEqual("jwt-sas test-sas", handler.Authorization);
    }

    [TestMethod]
    [DataRow("Visit Sensō-ji Temple", "Sensoji Temple")]
    [DataRow("Explore Musée d’Orsay", "Musee d'Orsay")]
    [DataRow("Sensoji Temple, 2-3-1 Asakusa, Tokyo", "Sensoji Temple")]
    public async Task PlaceResolver_NormalizesNamesAndSearchesNearDestination(
        string requested,
        string found
    )
    {
        var json = JsonSerializer.Serialize(
            new
            {
                results = new[]
                {
                    new
                    {
                        poi = new { name = found },
                        address = new { countryCode = "JP" },
                        position = new { lon = 139.81, lat = 35.71 },
                    },
                },
            }
        );
        using var handler = new ResponseHandler(json);
        var resolver = new AzureActivityPlaceResolver(new HttpClient(handler), new MapTokens());
        Assert.IsNotNull(
            await resolver.ResolveAsync(
                requested,
                "Tokyo",
                "JP",
                default,
                new("Point", GeographyPoint.Create(latitude: 35.68, longitude: 139.69))
            )
        );
        StringAssert.Contains(handler.Url!, "lon=139.69");
        StringAssert.Contains(handler.Url!, "lat=35.68");
        StringAssert.Contains(handler.Url!, "language=en-US");
    }

    [TestMethod]
    [DataRow("High", "Temple", "JP", true)]
    [DataRow("High", "LandmarkBuilding", "JP", true)]
    [DataRow("High", "TouristStructure", "JP", true)]
    [DataRow("Medium", "Temple", "JP", false)]
    [DataRow("High", "PopulatedPlace", "JP", false)]
    [DataRow("High", "Temple", "US", false)]
    public async Task PlaceResolver_FallsBackToConfidentNamedLandmarksWithoutUsingCityCenters(
        string confidence,
        string type,
        string countryCode,
        bool resolves
    )
    {
        using var handler = new LandmarkHandler(confidence, type, countryCode);
        var resolver = new AzureActivityPlaceResolver(new HttpClient(handler), new MapTokens());
        var point = await resolver.ResolveAsync(
            "Visit Sensō-ji Temple",
            "Tokyo",
            "JP",
            default,
            new("Point", GeographyPoint.Create(latitude: 35.68, longitude: 139.69))
        );
        Assert.AreEqual(resolves, point is not null);
        Assert.AreEqual(2, handler.Calls);
        if (point is not null)
        {
            Assert.AreEqual(
                GeographyPoint.Create(latitude: 35.7115, longitude: 139.7913),
                point.Position
            );
        }
    }

    [TestMethod]
    public async Task PlaceResolver_DoesNotRepeatDestinationAlreadyInThePlaceName()
    {
        using var handler = new LandmarkHandler("High", "Temple", "JP");
        var resolver = new AzureActivityPlaceResolver(new HttpClient(handler), new MapTokens());
        Assert.IsNotNull(
            await resolver.ResolveAsync(
                "Sensoji Temple, Tokyo, JP",
                "Tokyo",
                "JP",
                default,
                new("Point", GeographyPoint.Create(latitude: 35.68, longitude: 139.69))
            )
        );
        StringAssert.Contains(
            Uri.UnescapeDataString(handler.LastUri!.Query),
            "query=Sensoji Temple, Tokyo, JP&"
        );
    }

    private sealed class LandmarkHandler(string confidence, string type, string countryCode)
        : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public Uri? LastUri { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            Calls++;
            LastUri = request.RequestUri;
            string json = request.RequestUri!.AbsolutePath.Contains("/search/")
                ? "{\"results\":[]}"
                : JsonSerializer.Serialize(
                    new
                    {
                        features = new[]
                        {
                            new
                            {
                                geometry = new
                                {
                                    type = "Point",
                                    coordinates = new[] { 139.7913, 35.7115 },
                                },
                                properties = new
                                {
                                    confidence,
                                    type,
                                    address = new
                                    {
                                        countryRegion = new { ISO = countryCode },
                                        formattedAddress = "Sensō-ji, Japan",
                                    },
                                },
                            },
                        },
                    }
                );
            return Task.FromResult(
                new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json"),
                }
            );
        }
    }

    private sealed class MapTokens : IMapTokenProvider
    {
        public Task<MapToken> GetTokenAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(
                new MapToken(
                    "test-sas",
                    "https://atlas.example.test",
                    DateTimeOffset.UtcNow.AddHours(1)
                )
            );
    }

    internal static OpenAiActivityAssistant Create(ResponseHandler handler) =>
        new(
            new HttpClient(handler),
            Microsoft.Extensions.Options.Options.Create(
                new OpenAiOptions { ApiKey = "test-key", Model = "configured-model" }
            )
        );

    internal sealed class ResponseHandler(
        string response,
        HttpStatusCode status = HttpStatusCode.OK,
        string? requestId = null
    ) : HttpMessageHandler
    {
        public string? Request { get; private set; }
        public string? Url { get; private set; }
        public List<string> Urls { get; } = [];
        public string? Authorization { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            Request = request.Content is null
                ? null
                : await request.Content.ReadAsStringAsync(cancellationToken);
            Url = request.RequestUri!.AbsoluteUri;
            Urls.Add(Url);
            Authorization = request.Headers.Authorization?.ToString();
            var result = new HttpResponseMessage(status)
            {
                Content = new StringContent(response, Encoding.UTF8, "application/json"),
            };
            if (requestId is not null)
            {
                result.Headers.Add("x-request-id", requestId);
            }
            return result;
        }
    }
}
