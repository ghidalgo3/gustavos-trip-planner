using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

[TestClass]
public class OpenAiActivityAssistantTests
{
    internal const string Candidates = """
        {"activities":[{"name":"Louvre","placeName":"Louvre Museum","durationMinutes":120,"description":"Explore art collections.","costAmount":null,"costCurrency":null,"costBasis":null}]}
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
        byte[]? image = withImage ? [1, 2, 3] : null;
        IReadOnlyList<ActivityCandidate> result = await assistant.SuggestAsync(
            "Paris",
            "FR",
            [new(Guid.NewGuid(), 0, new(2027, 6, 10), new(2027, 6, 14), "", "")],
            "Find art museums",
            image,
            withImage ? "image/png" : null,
            default
        );
        Assert.AreEqual("Louvre", result.Single().Name);
        Assert.AreEqual(120, result.Single().DurationMinutes);
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
            Assert.AreEqual(
                "data:image/png;base64,AQID",
                content[1].GetProperty("image_url").GetString()
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
            Create(handler).SuggestAsync("Paris", "FR", [], "Museums", null, null, default)
        );
    }

    [TestMethod]
    [DataRow(401)]
    [DataRow(429)]
    [DataRow(500)]
    public async Task Suggest_PropagatesUpstreamFailures(int status)
    {
        using var handler = new ResponseHandler("{}", (HttpStatusCode)status);
        await Assert.ThrowsAsync<HttpRequestException>(() =>
            Create(handler).SuggestAsync("Paris", "FR", [], "Museums", null, null, default)
        );
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
            assistant.SuggestAsync("Paris", "FR", [], "Museums", null, null, default)
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
            CollectionAssert.AreEqual(new double[] { longitude, latitude }, point.Coordinates);
        StringAssert.Contains(handler.Url!, "/search/poi/json?");
        StringAssert.Contains(handler.Url!, "countrySet=FR");
        Assert.AreEqual("jwt-sas test-sas", handler.Authorization);
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
        HttpStatusCode status = HttpStatusCode.OK
    ) : HttpMessageHandler
    {
        public string? Request { get; private set; }
        public string? Url { get; private set; }
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
            Authorization = request.Headers.Authorization?.ToString();
            return new(status)
            {
                Content = new StringContent(response, Encoding.UTF8, "application/json"),
            };
        }
    }
}
