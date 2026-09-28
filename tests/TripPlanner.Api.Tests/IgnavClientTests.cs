using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Tests;

[TestClass]
public sealed class IgnavClientTests
{
    [TestMethod]
    [DataRow("oneWay", "one-way")]
    [DataRow("flexible", "search")]
    public async Task RouteRequests_UseProviderContract(string kind, string endpoint)
    {
        using var http = new HttpClient(new RouteHandler(kind, endpoint));
        var client = new IgnavClient(
            http,
            Microsoft.Extensions.Options.Options.Create(
                new IgnavOptions { ApiKey = "fake-test-key" }
            ),
            NullLogger<IgnavClient>.Instance
        );
        await client.SearchAsync(
            new(
                "ATL",
                "HKT",
                new(2030, 5, 1),
                new(2030, 5, 13),
                2,
                "economy",
                "US",
                1,
                kind,
                kind == "flexible"
                    ?
                    [
                        new("ATL", "HKT", new(2030, 5, 1), 1),
                        new("HND", "ATL", new(2030, 5, 13), 1),
                    ]
                    : null
            ),
            default
        );
    }

    private sealed class RouteHandler(string kind, string endpoint) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            Assert.AreEqual(
                $"https://ignav.com/api/fares/{endpoint}",
                request.RequestUri!.ToString()
            );
            using var json = JsonDocument.Parse(
                await request.Content!.ReadAsStringAsync(cancellationToken)
            );
            var body = json.RootElement;
            Assert.IsFalse(body.TryGetProperty("SearchKind", out _));
            Assert.IsFalse(body.TryGetProperty("return_date", out _));
            Assert.IsFalse(body.GetProperty("allow_self_transfer").GetBoolean());
            if (kind == "flexible")
            {
                Assert.AreEqual(2, body.GetProperty("legs").GetArrayLength());
                Assert.AreEqual(
                    "HND",
                    body.GetProperty("legs")[1].GetProperty("origin").GetString()
                );
                Assert.IsFalse(body.TryGetProperty("origin", out _));
            }
            else
                Assert.AreEqual("2030-05-01", body.GetProperty("departure_date").GetString());
            return new(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"itineraries\":[]}",
                    Encoding.UTF8,
                    "application/json"
                ),
            };
        }
    }

    [TestMethod]
    public async Task SendsDocumentedRequestAndKeepsRawResponse()
    {
        using var handler = new Handler();
        using var http = new HttpClient(handler);
        var client = new IgnavClient(
            http,
            Microsoft.Extensions.Options.Options.Create(
                new IgnavOptions { ApiKey = "fake-test-key" }
            ),
            NullLogger<IgnavClient>.Instance
        );
        var result = await client.SearchAsync(
            new("BOS", "CDG", new(2030, 1, 5), new(2030, 1, 15), 2, "economy", "US", 0),
            default
        );
        Assert.AreEqual("preserved", result.GetProperty("extra_field").GetString());
        handler.Invalid = true;
        await Assert.ThrowsExactlyAsync<JsonException>(() =>
            client.SearchAsync(
                new("BOS", "CDG", new(2030, 1, 5), new(2030, 1, 15), 2, "economy", "US", 0),
                default
            )
        );
    }

    [TestMethod]
    public async Task UnauthorizedResponse_LogsStatusAndBodyWithoutLeakingApiKey()
    {
        const string key = "test-key-with-\"quote";
        var logger = new CapturingLogger();
        using var http = new HttpClient(new UnauthorizedHandler(key));
        var client = new IgnavClient(
            http,
            Microsoft.Extensions.Options.Options.Create(new IgnavOptions { ApiKey = key }),
            logger
        );
        var exception = await Assert.ThrowsExactlyAsync<HttpRequestException>(() =>
            client.SearchAsync(
                new("BOS", "CDG", new(2030, 1, 5), new(2030, 1, 15), 2, "economy", "US", 0),
                default
            )
        );
        Assert.AreEqual(HttpStatusCode.Unauthorized, exception.StatusCode);
        Assert.AreEqual(LogLevel.Error, logger.Level);
        StringAssert.Contains(logger.Message, "HTTP 401 (Unauthorized)");
        StringAssert.Contains(logger.Message, "Invalid API key");
        StringAssert.Contains(logger.Message, "https://ignav.com/api/fares/round-trip");
        StringAssert.Contains(logger.Message, "[REDACTED]");
        StringAssert.Contains(logger.Message, "[truncated]");
        Assert.DoesNotContain(key, logger.Message);
        Assert.DoesNotContain(JsonSerializer.Serialize(key)[1..^1], logger.Message);
        Assert.DoesNotContain("\n", logger.Message);
    }

    [TestMethod]
    public async Task BookingLinks_UsesTheCachedIgnavItineraryId()
    {
        using var http = new HttpClient(new BookingLinksHandler());
        var client = new IgnavClient(
            http,
            Microsoft.Extensions.Options.Options.Create(
                new IgnavOptions { ApiKey = "fake-test-key" }
            ),
            NullLogger<IgnavClient>.Instance
        );

        var result = await client.GetBookingLinksAsync("fare-123", default);

        Assert.AreEqual(
            "https://book.example.test/fare-123",
            result
                .GetProperty("booking_options")[0]
                .GetProperty("links")[0]
                .GetProperty("url")
                .GetString()
        );
    }

    private sealed class UnauthorizedHandler(string key) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        ) =>
            Task.FromResult(
                new HttpResponseMessage(HttpStatusCode.Unauthorized)
                {
                    Content = new StringContent(
                        "Invalid API key: "
                            + key
                            + "\n"
                            + JsonSerializer.Serialize(new { key })
                            + new string('x', 5000)
                    ),
                }
            );
    }

    private sealed class CapturingLogger : ILogger<IgnavClient>
    {
        public string Message { get; private set; } = "";
        public LogLevel Level { get; private set; }

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter
        )
        {
            Level = logLevel;
            Message = formatter(state, exception);
        }
    }

    private sealed class BookingLinksHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            Assert.AreEqual(
                "https://ignav.com/api/fares/booking-links",
                request.RequestUri!.ToString()
            );
            Assert.AreEqual(HttpMethod.Post, request.Method);
            Assert.AreEqual("fake-test-key", request.Headers.GetValues("X-Api-Key").Single());
            using var json = JsonDocument.Parse(
                await request.Content!.ReadAsStringAsync(cancellationToken)
            );
            Assert.AreEqual("fare-123", json.RootElement.GetProperty("ignav_id").GetString());
            return new(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"booking_options\":[{\"links\":[{\"url\":\"https://book.example.test/fare-123\"}]}]}",
                    Encoding.UTF8,
                    "application/json"
                ),
            };
        }
    }

    private sealed class Handler : HttpMessageHandler
    {
        public bool Invalid { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            Assert.AreEqual(
                "https://ignav.com/api/fares/round-trip",
                request.RequestUri!.ToString()
            );
            Assert.AreEqual(HttpMethod.Post, request.Method);
            Assert.AreEqual("fake-test-key", request.Headers.GetValues("X-Api-Key").Single());
            using var json = JsonDocument.Parse(
                await request.Content!.ReadAsStringAsync(cancellationToken)
            );
            Assert.AreEqual(2, json.RootElement.GetProperty("adults").GetInt32());
            Assert.AreEqual(0, json.RootElement.GetProperty("max_stops").GetInt32());
            Assert.AreEqual("2030-01-15", json.RootElement.GetProperty("return_date").GetString());
            return new(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    Invalid ? "{}" : "{\"itineraries\":[],\"extra_field\":\"preserved\"}",
                    Encoding.UTF8,
                    "application/json"
                ),
            };
        }
    }
}
