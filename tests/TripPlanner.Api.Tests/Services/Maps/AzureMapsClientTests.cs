using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.Maps;

[TestClass]
public sealed class AzureMapsClientTests
{
    [TestMethod]
    [DataRow("FR", 2.35, 48.86, true)]
    [DataRow("US", 2.35, 48.86, false)]
    [DataRow("FR", 181, 48.86, false)]
    [DataRow("FR", 2.35, 91, false)]
    public async Task CityGeocodingReturnsCountryCheckedCoordinates(
        string country,
        double longitude,
        double latitude,
        bool found
    )
    {
        using var handler = new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = JsonContent.Create(
                new
                {
                    features = new[]
                    {
                        new
                        {
                            properties = new
                            {
                                address = new { countryRegion = new { ISO = country } },
                            },
                            geometry = new { coordinates = new[] { longitude, latitude } },
                        },
                    },
                },
                options: new JsonSerializerOptions()
            ),
        });
        using var http = new HttpClient(handler);
        IAzureMapsClient maps = AzureMapsTestClient.Create(http, new Tokens());
        var point = await maps.GeocodeCityAsync("Paris", "FR", default);
        Assert.AreEqual(found, point is not null);
        if (found)
        {
            Assert.AreEqual(GeographyPoint.Create(latitude, longitude), point!.Position);
        }
        Assert.AreEqual(
            "https://maps.example.test/endpoint/geocode",
            handler.Uri!.GetLeftPart(UriPartial.Path)
        );
        StringAssert.Contains(handler.Uri.Query, "resultTypes=PopulatedPlace");
        Assert.AreEqual("jwt-sas secret-token", handler.Authorization);
    }

    [TestMethod]
    [DataRow(901)]
    [DataRow(172800)]
    public async Task RoutingEstimatesReturnTypedDurationsAndProviderExpiry(int seconds)
    {
        using var handler = new Handler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                $"{{\"properties\":{{\"matrix\":[{{\"statusCode\":200,\"durationInSeconds\":{seconds}}}]}}}}"
            ),
            Headers =
            {
                CacheControl = new CacheControlHeaderValue { MaxAge = TimeSpan.FromMinutes(15) },
            },
        });
        using var http = new HttpClient(handler);
        IAzureMapsClient maps = AzureMapsTestClient.Create(http, new Tokens());
        using var budget = new PlanningProviderBudget(1);
        var result = await maps.EstimateRouteAsync(
            GeographyPoint.Create(48.8, 2.3),
            GeographyPoint.Create(48.9, 2.4),
            DateTimeOffset.Parse("2027-06-10T07:00:00Z"),
            "walking",
            budget,
            default
        );
        Assert.IsNotNull(result);
        Assert.AreEqual(TimeSpan.FromSeconds(seconds), result.Duration);
        Assert.IsTrue(result.ExpiresAt >= result.RetrievedAt.AddMinutes(15));
        StringAssert.Contains(handler.Uri!.AbsolutePath, "/route/matrix");
        Assert.IsTrue(budget.Exhausted);
    }

    [TestMethod]
    [DataRow(429)]
    [DataRow(502)]
    [DataRow(503)]
    public async Task RoutingRetriesTransientFailuresWithinTheSharedBudget(int status)
    {
        int calls = 0;
        using var handler = new Handler(_ =>
            ++calls == 1
                ? new HttpResponseMessage((HttpStatusCode)status)
                {
                    Headers = { RetryAfter = new RetryConditionHeaderValue(TimeSpan.Zero) },
                }
                : new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        """{"properties":{"matrix":[{"statusCode":200,"durationInSeconds":900}]}}"""
                    ),
                }
        );
        using var http = new HttpClient(handler);
        IAzureMapsClient maps = AzureMapsTestClient.Create(http, new Tokens());
        using var budget = new PlanningProviderBudget(2);
        var result = await maps.EstimateRouteAsync(
            GeographyPoint.Create(48.8, 2.3),
            GeographyPoint.Create(48.9, 2.4),
            DateTimeOffset.Parse("2027-06-10T07:00:00Z"),
            "walking",
            budget,
            default
        );
        Assert.IsNotNull(result);
        Assert.AreEqual(2, calls);
        Assert.IsTrue(budget.Exhausted);
    }

    [TestMethod]
    public async Task CallerCancellationStopsGeocoding()
    {
        using var handler = new Handler(_ =>
            throw new AssertFailedException("Canceled geocoding must not send a request.")
        );
        using var http = new HttpClient(handler);
        IAzureMapsClient maps = AzureMapsTestClient.Create(http, new Tokens());
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            maps.GeocodeCityAsync("Paris", "FR", cancellation.Token)
        );
    }

    private sealed class Tokens : IMapTokenProvider
    {
        public Task<MapToken> GetTokenAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(
                new MapToken(
                    "secret-token",
                    "https://maps.example.test/endpoint/",
                    DateTimeOffset.MaxValue
                )
            );
        }
    }

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> reply)
        : HttpMessageHandler
    {
        public Uri? Uri { get; private set; }
        public string? Authorization { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            Uri = request.RequestUri;
            Authorization = request.Headers.Authorization?.ToString();
            return Task.FromResult(reply(request));
        }
    }
}
