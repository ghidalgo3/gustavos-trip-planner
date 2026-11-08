using System.Net;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.Maps;

[TestClass]
public sealed class AzureMapsRoutingTests
{
    [TestMethod]
    [DataRow("walking", "walking")]
    [DataRow("driving", "driving")]
    [DataRow("taxi", "driving")]
    public async Task RoutePath_UsesRequestedModeAndDeparture_AndReturnsActualStreetGeometry(
        string mode,
        string azureMode
    )
    {
        var departure = DateTimeOffset.Parse("2027-06-10T07:00:00+02:00");
        using var handler = new Handler(request =>
        {
            Assert.AreEqual("atlas.microsoft.com", request.RequestUri!.Host);
            StringAssert.Contains(request.RequestUri.AbsolutePath, "/route/directions");
            Assert.DoesNotContain("secret-sas", request.RequestUri.ToString());
            using var body = JsonDocument.Parse(
                request.Content!.ReadAsStringAsync().GetAwaiter().GetResult()
            );
            Assert.AreEqual(azureMode, body.RootElement.GetProperty("travelMode").GetString());
            Assert.AreEqual(
                departure,
                body.RootElement.GetProperty("departAt").GetDateTimeOffset()
            );
            Assert.AreEqual(
                "routePath",
                body.RootElement.GetProperty("routeOutputOptions")[0].GetString()
            );
            return """{"features":[{"properties":{"type":"Waypoint"},"geometry":{"type":"Point","coordinates":[2.3,48.8]}},{"properties":{"type":"RoutePath"},"geometry":{"type":"MultiLineString","coordinates":[[[2.3,48.8],[2.32,48.81],[2.35,48.86]]]}}]}""";
        });
        var provider = AzureMapsTestClient.Create(new HttpClient(handler), new Tokens());
        var path = await provider.RouteAsync(
            GeographyPoint.Create(48.8, 2.3),
            GeographyPoint.Create(48.86, 2.35),
            departure,
            mode,
            default
        );
        Assert.IsNotNull(path);
        Assert.HasCount(3, path.Coordinates.Single());
        Assert.AreEqual(2.32, path.Coordinates[0][1][0]);
    }

    [TestMethod]
    [DataRow("{\"features\":[]}")]
    [DataRow("{\"features\":[null,1,{}]}")]
    [DataRow(
        "{\"features\":[{\"properties\":{\"type\":\"RoutePath\"},\"geometry\":{\"type\":\"MultiLineString\",\"coordinates\":[[[2.3,48.8],[2.32,48.81],[2.36,48.86]]]}}]}"
    )]
    [DataRow(
        "{\"features\":[{\"properties\":{\"type\":\"RoutePath\"},\"geometry\":{\"type\":\"MultiLineString\",\"coordinates\":[[[2.31,48.8],[2.32,48.81],[2.35,48.86]]]}}]}"
    )]
    [DataRow(
        "{\"features\":[{\"properties\":{\"type\":\"RoutePath\"},\"geometry\":{\"type\":\"MultiLineString\",\"coordinates\":[[[181,48],[2,48]]]}}]}"
    )]
    public async Task MissingOrInvalidGeometry_DoesNotInventAStraightLine(string json)
    {
        using var handler = new Handler(_ => json);
        var provider = AzureMapsTestClient.Create(new HttpClient(handler), new Tokens());
        Assert.IsNull(
            await provider.RouteAsync(
                GeographyPoint.Create(48.8, 2.3),
                GeographyPoint.Create(48.86, 2.35),
                DateTimeOffset.UtcNow,
                "walking",
                default
            )
        );
    }

    [TestMethod]
    public async Task SapporoSparseRoadNetwork_DoesNotDrawARouteToTheWrongDestination()
    {
        // Actual Azure response: seven vertices, with the destination snapped
        // about a kilometre away from the requested point.
        using var handler = new Handler(_ =>
            """
                {"features":[{"properties":{"type":"RoutePath"},"geometry":{"type":"MultiLineString","coordinates":[[[141.35297,43.0583],[141.35722,43.05833],[141.36877,43.05878],[141.37207,43.05993],[141.37839,43.06214],[141.37936,43.0628],[141.38192,43.06461]]]}}]}
                """
        );
        var provider = AzureMapsTestClient.Create(new HttpClient(handler), new Tokens());
        Assert.IsNull(
            await provider.RouteAsync(
                GeographyPoint.Create(43.056, 141.353),
                GeographyPoint.Create(43.071, 141.3735),
                DateTimeOffset.UtcNow,
                "walking",
                default
            )
        );
    }

    private sealed class Tokens : IMapTokenProvider
    {
        public Task<MapToken> GetTokenAsync(CancellationToken ct) =>
            Task.FromResult(
                new MapToken(
                    "secret-sas",
                    "https://atlas.microsoft.com",
                    DateTimeOffset.UtcNow.AddHours(1)
                )
            );
    }

    private sealed class Handler(Func<HttpRequestMessage, string> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken ct
        ) =>
            Task.FromResult(
                new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(respond(request)),
                }
            );
    }
}
