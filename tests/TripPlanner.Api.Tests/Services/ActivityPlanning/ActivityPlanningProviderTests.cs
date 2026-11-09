using System.Net;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.ActivityPlanning;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Services.ActivityPlanning;

[TestClass]
public sealed class ActivityPlanningProviderTests
{
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> reply)
        : HttpMessageHandler
    {
        public int Calls { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken ct
        )
        {
            Calls++;
            return Task.FromResult(reply(request));
        }
    }

    private sealed class Maps : IMapTokenProvider
    {
        public Task<MapToken> GetTokenAsync(CancellationToken ct = default) =>
            Task.FromResult(
                new MapToken(
                    "private-map-token",
                    "https://atlas.microsoft.com",
                    DateTimeOffset.UtcNow.AddHours(1)
                )
            );
    }

    private static ActivityPlanningProviders Provider(Handler handler) =>
        new(
            AzureMapsTestClient.Create(new HttpClient(handler), new Maps()),
            Microsoft.Extensions.Options.Options.Create(new ActivityPlanningOptions())
        );

    private static HttpResponseMessage Json(string json) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
        };

    [TestMethod]
    [DataRow("walking", "walking", 15)]
    [DataRow("taxi", "driving", 20)]
    [DataRow("driving", "driving", 15)]
    public async Task Routes_UseAzureMapsForWalkingAndCars(
        string mode,
        string azureMode,
        int expectedMinutes
    )
    {
        var departure = DateTimeOffset.Parse("2027-06-10T07:00:00Z");
        using var handler = new Handler(request =>
        {
            Assert.AreEqual("atlas.microsoft.com", request.RequestUri!.Host);
            using var body = JsonDocument.Parse(
                request.Content!.ReadAsStringAsync().GetAwaiter().GetResult()
            );
            Assert.AreEqual(azureMode, body.RootElement.GetProperty("travelMode").GetString());
            Assert.AreEqual(
                departure,
                body.RootElement.GetProperty("departAt").GetDateTimeOffset()
            );
            return Json(
                """{"properties":{"matrix":[{"statusCode":200,"durationInSeconds":600,"durationTrafficInSeconds":900}]}}"""
            );
        });
        using var budget = new PlanningProviderBudget(5);
        var route = (
            await Provider(handler)
                .RoutesAsync(
                    GeographyPoint.Create(48.8, 2.3),
                    GeographyPoint.Create(48.9, 2.4),
                    departure,
                    mode,
                    budget,
                    CancellationToken.None
                )
        ).Single();
        Assert.AreEqual(mode, route.Mode);
        Assert.AreEqual(TimeSpan.FromMinutes(expectedMinutes), route.Duration);
        Assert.DoesNotContain("private-", JsonSerializer.Serialize(route));
    }

    [TestMethod]
    public async Task Transit_IsRejectedWithoutCallingAnyProvider()
    {
        using var handler = new Handler(_ =>
            throw new AssertFailedException("Unsupported transport must not make HTTP calls.")
        );
        using var budget = new PlanningProviderBudget(5);
        await Assert.ThrowsExactlyAsync<PlanningProviderException>(() =>
            Provider(handler)
                .RoutesAsync(
                    GeographyPoint.Create(48.8, 2.3),
                    GeographyPoint.Create(48.9, 2.4),
                    DateTimeOffset.UtcNow,
                    "transit",
                    budget,
                    CancellationToken.None
                )
        );
        Assert.AreEqual(0, handler.Calls);
    }

    [TestMethod]
    [DataRow(-1)]
    [DataRow(90000)]
    public async Task MalformedRouteDurations_DoNotBecomeFreeTravel(int seconds)
    {
        using var handler = new Handler(_ =>
            Json(
                $"{{\"properties\":{{\"matrix\":[{{\"statusCode\":200,\"durationInSeconds\":{seconds}}}]}}}}"
            )
        );
        using var budget = new PlanningProviderBudget(5);
        Assert.IsEmpty(
            await Provider(handler)
                .RoutesAsync(
                    GeographyPoint.Create(latitude: 48.8, longitude: 2.3),
                    GeographyPoint.Create(latitude: 48.9, longitude: 2.4),
                    DateTimeOffset.UtcNow.AddDays(1),
                    "walking",
                    budget,
                    CancellationToken.None
                )
        );
    }

    [TestMethod]
    public async Task RequestBudget_IncludesRetries_AndErrorsDoNotExposeCredentials()
    {
        using var handler = new Handler(_ =>
            new(HttpStatusCode.TooManyRequests)
            {
                Content = new StringContent("private-provider-credential"),
            }
        );
        using var budget = new PlanningProviderBudget(1);
        var error = await Assert.ThrowsExactlyAsync<PlanningProviderException>(() =>
            Provider(handler)
                .RoutesAsync(
                    GeographyPoint.Create(latitude: 48.8, longitude: 2.3),
                    GeographyPoint.Create(latitude: 48.9, longitude: 2.4),
                    DateTimeOffset.UtcNow.AddDays(1),
                    "walking",
                    budget,
                    CancellationToken.None
                )
        );
        Assert.AreEqual(1, handler.Calls);
        Assert.DoesNotContain("private-", error.Message);
        Assert.IsTrue(budget.Exhausted);
    }
}
