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
            new HttpClient(handler),
            AzureMapsTestClient.Create(new HttpClient(handler), new Maps()),
            Microsoft.Extensions.Options.Options.Create(
                new OpenAiOptions { ApiKey = "private-openai-key" }
            ),
            Microsoft.Extensions.Options.Options.Create(new ActivityPlanningOptions()),
            TimeProvider.System
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

    [TestMethod]
    public async Task Research_RequiresConsultedSourceAndApplicableDates()
    {
        using var handler = new Handler(_ =>
            Json(
                """{"status":"completed","output":[{"type":"web_search_call","action":{"sources":[{"url":"https://official.example/hours"}]}},{"content":[{"type":"output_text","text":"{\"sourceUrl\":\"https://invented.example/hours\",\"windows\":[{\"date\":\"2027-06-10\",\"start\":\"09:00:00\",\"end\":\"18:00:00\"}],\"closedDates\":[],\"provisional\":false}"}]}]}"""
            )
        );
        using var budget = new PlanningProviderBudget(5);
        Assert.IsNull(
            await Provider(handler)
                .HoursAsync(
                    ActivityPlanningFixture.Context(TimeSpan.FromHours(1)).Activities[0],
                    "Paris",
                    [ActivityPlanningFixture.Date],
                    budget,
                    CancellationToken.None
                )
        );
    }

    [TestMethod]
    [DataRow("22:30:00", true)]
    [DataRow("25:00", false)]
    [DataRow("22:30", false)]
    [DataRow("22:30:01", false)]
    public async Task InterpretedTiming_ParsesAtTheProviderBoundary_AndPreservesUnspecifiedSettings(
        string sleepStart,
        bool accepted
    )
    {
        var data = JsonSerializer.Serialize(
            new
            {
                sleepStart,
                sleepEnd = (string?)null,
                slackDuration = (string?)null,
            }
        );
        using var handler = new Handler(_ =>
            Json(
                JsonSerializer.Serialize(
                    new
                    {
                        status = "completed",
                        output = new[]
                        {
                            new { content = new[] { new { type = "output_text", text = data } } },
                        },
                    }
                )
            )
        );
        var context = ActivityPlanningFixture.Context(TimeSpan.FromHours(1));
        var plan = ActivityPlanningFixture.Plan(context);
        using var budget = new PlanningProviderBudget(5);
        var suggestions = await Provider(handler)
            .InterpretAsync(context, plan, budget, CancellationToken.None);
        Assert.HasCount(accepted ? 1 : 0, suggestions);
        if (accepted)
        {
            Assert.AreEqual(new TimeOnly(22, 30), suggestions[0].Settings.SleepStart);
            Assert.AreEqual(plan.Settings.SleepEnd, suggestions[0].Settings.SleepEnd);
            Assert.AreEqual(plan.Settings.SlackDuration, suggestions[0].Settings.SlackDuration);
        }
        Assert.AreEqual(new TimeOnly(23, 0), plan.Settings.SleepStart);
    }

    [TestMethod]
    [DataRow("09:00:00", true)]
    [DataRow("25:00", false)]
    [DataRow("09:00", false)]
    [DataRow("09:00:01", false)]
    public async Task ResearchedHours_RejectInvalidClockTimes_WithoutInventingMidnight(
        string start,
        bool accepted
    )
    {
        const string url = "https://official.example/hours";
        var data = JsonSerializer.Serialize(
            new
            {
                sourceUrl = url,
                windows = new[]
                {
                    new
                    {
                        date = "2027-06-10",
                        start,
                        end = "18:00:00",
                    },
                },
                closedDates = Array.Empty<string>(),
                provisional = false,
            }
        );
        using var handler = new Handler(_ =>
            Json(
                JsonSerializer.Serialize(
                    new
                    {
                        status = "completed",
                        output = new object[]
                        {
                            new
                            {
                                type = "web_search_call",
                                action = new { sources = new[] { new { url } } },
                            },
                            new { content = new[] { new { type = "output_text", text = data } } },
                        },
                    }
                )
            )
        );
        using var budget = new PlanningProviderBudget(5);
        var hours = await Provider(handler)
            .HoursAsync(
                ActivityPlanningFixture.Context(TimeSpan.FromHours(1)).Activities[0],
                "Paris",
                [ActivityPlanningFixture.Date],
                budget,
                CancellationToken.None
            );
        if (accepted)
        {
            Assert.IsNotNull(hours);
            Assert.AreEqual(new TimeOnly(9, 0), hours.Windows.Single().Start);
            Assert.AreEqual(new TimeOnly(18, 0), hours.Windows.Single().End);
        }
        else
        {
            Assert.IsNull(hours);
        }
    }

    [TestMethod]
    public async Task Decisions_ReturnsOnlyBoundedScoresForKnownActivities()
    {
        var planningContext = ActivityPlanningFixture.Context(
            TimeSpan.FromHours(1),
            TimeSpan.FromMinutes(90)
        );
        string id = planningContext.Activities[0].Id.ToString();
        using var handler = new Handler(_ =>
            Json(
                $"{{\"answers\":[{{\"name\":\"{id}\",\"type\":\"score\",\"score\":3.5,\"confidence\":0.9}},{{\"name\":\"unknown\",\"type\":\"score\",\"score\":4,\"confidence\":1}},{{\"name\":\"{planningContext.Activities[1].Id}\",\"type\":\"score\",\"score\":999,\"confidence\":1}}]}}"
            )
        );
        using var budget = new PlanningProviderBudget(5);
        var scores = await Provider(handler)
            .AffinityAsync(planningContext, budget, CancellationToken.None);
        Assert.HasCount(1, scores);
        Assert.AreEqual(3.5, scores[0].Score);
        Assert.AreEqual(planningContext.Travellers[0].Id, scores[0].UserId);
    }
}
