using System.Globalization;
using System.Net;
using Microsoft.Spatial;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.Maps;

[TestClass]
public sealed class AzureMapsTimeZoneTests
{
    [TestMethod]
    [DataRow(37.5665, 126.9780, "Asia/Seoul")]
    [DataRow(35.6762, 139.6503, "Asia/Tokyo")]
    [DataRow(48.8566, 2.3522, "Europe/Paris")]
    [DataRow(40.7128, -74.0060, "America/New_York")]
    [DataRow(27.7172, 85.3240, "Asia/Kathmandu")]
    public async Task CityZonesResolveLocallyWithoutAnAzureRequest(
        double latitude,
        double longitude,
        string expected
    )
    {
        using var handler = new ResponseHandler("{}", HttpStatusCode.Forbidden);
        using var client = new HttpClient(handler);
        var resolver = Create(client);
        var actual = await resolver.ResolveTimeZoneAsync(
            GeographyPoint.Create(latitude, longitude),
            default
        );
        Assert.AreEqual(expected, actual);
        Assert.IsNull(
            handler.Url,
            "A city's time zone must not depend on an API key or timezone-read permission."
        );
    }

    [TestMethod]
    [DataRow("TimeZones", "Id")]
    [DataRow("timeZones", "id")]
    public async Task CoordinatesResolveToAnIanaZoneRatherThanACurrentOffset(
        string collection,
        string id
    )
    {
        using var handler = new ResponseHandler(
            $$"""{"{{collection}}":[{"{{id}}":"America/New_York"}]}"""
        );
        using var client = new HttpClient(handler);
        StringAssert.StartsWith(
            GeoTimeZone.TimeZoneLookup.GetTimeZone(0.5, -150.25).Result,
            "Etc/"
        );
        var resolver = Create(client);
        var previousCulture = CultureInfo.CurrentCulture;
        string? result;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
            result = await resolver.ResolveTimeZoneAsync(
                GeographyPoint.Create(0.5, -150.25),
                default
            );
        }
        finally
        {
            CultureInfo.CurrentCulture = previousCulture;
        }
        Assert.AreEqual("America/New_York", result);
        Assert.AreEqual(
            "https://atlas.example.test/timezone/byCoordinates/json?api-version=1.0&options=none&query=0.5,-150.25",
            handler.Url
        );
        Assert.AreEqual("jwt-sas test-token", handler.Authorization);
        Assert.IsNotNull(result);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(result);
        Assert.AreEqual(TimeSpan.FromHours(-5), zone.GetUtcOffset(new DateTime(2027, 1, 10)));
        Assert.AreEqual(TimeSpan.FromHours(-4), zone.GetUtcOffset(new DateTime(2027, 7, 10)));
    }

    [TestMethod]
    [DataRow("{\"TimeZones\":[]}", 200)]
    [DataRow("{\"TimeZones\":[{\"Id\":\"Unknown/Zone\"}]}", 200)]
    [DataRow("{\"TimeZones\":[{\"Id\":\"Europe/Paris\"},{\"Id\":\"Europe/Rome\"}]}", 200)]
    [DataRow("{\"TimeZones\":[{\"Id\":7}]}", 200)]
    [DataRow("null", 200)]
    [DataRow("not json", 200)]
    [DataRow("{}", 503)]
    public async Task UnavailableOrUnrecognizedResultsRemainUnknown(string body, int status)
    {
        using var handler = new ResponseHandler(body, (HttpStatusCode)status);
        using var client = new HttpClient(handler);
        Assert.IsNull(
            await Create(client).ResolveTimeZoneAsync(GeographyPoint.Create(0.5, -150.25), default)
        );
    }

    [TestMethod]
    public async Task ProviderTimeoutDoesNotPreventAddingADestination()
    {
        using var handler = new CanceledHandler();
        using var client = new HttpClient(handler);
        Assert.IsNull(
            await Create(client).ResolveTimeZoneAsync(GeographyPoint.Create(0.5, -150.25), default)
        );
    }

    [TestMethod]
    public async Task CallerCancellationIsPropagated()
    {
        using var handler = new CanceledHandler();
        using var client = new HttpClient(handler);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            Create(client)
                .ResolveTimeZoneAsync(GeographyPoint.Create(0.5, -150.25), cancellation.Token)
        );
    }

    private static AzureMapsClient Create(HttpClient client) =>
        AzureMapsTestClient.Create(client, new Tokens());

    private sealed class Tokens : IMapTokenProvider
    {
        public Task<MapToken> GetTokenAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(
                new MapToken("test-token", "https://atlas.example.test", DateTimeOffset.MaxValue)
            );
    }

    private sealed class ResponseHandler(string body, HttpStatusCode status = HttpStatusCode.OK)
        : HttpMessageHandler
    {
        public string? Url { get; private set; }
        public string? Authorization { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            Url = request.RequestUri!.ToString();
            Authorization = request.Headers.Authorization?.ToString();
            return Task.FromResult(
                new HttpResponseMessage(status) { Content = new StringContent(body) }
            );
        }
    }

    private sealed class CanceledHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        ) => throw new TaskCanceledException();
    }
}
