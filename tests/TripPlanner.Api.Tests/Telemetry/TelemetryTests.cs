using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using Azure.Core.Pipeline;
using Azure.Monitor.OpenTelemetry.Exporter;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using OpenTelemetry;
using OpenTelemetry.Trace;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Telemetry;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Telemetry;

[TestClass]
public class TelemetryTests
{
    private const string ConnectionString =
        "InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://example.invalid/";

    [TestMethod]
    public async Task BrowserConfigurationIsPublicAndDisabledByDefault()
    {
        using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/telemetry/config");
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("no-store", response.Headers.CacheControl?.ToString());
        Assert.IsNull(
            (
                await response.Content.ReadFromJsonAsync<BrowserTelemetryConfiguration>()
            )!.ConnectionString
        );
    }

    [TestMethod]
    public async Task BrowserTraceParentCorrelatesWithSanitizedServerRequests()
    {
        var capture = new CaptureProcessor();
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Configuration["ApplicationInsights:ConnectionString"] = ConnectionString;
        builder.AddTripPlannerTelemetry();
        // Exercise production instrumentation and exporting without external I/O.
        builder.Services.PostConfigureAll<AzureMonitorExporterOptions>(options =>
            options.Transport = new HttpClientTransport(
                new HttpClient(new AcceptTelemetryHandler())
            )
        );
        builder.Services.AddOpenTelemetry().WithTracing(tracing => tracing.AddProcessor(capture));
        await using var app = builder.Build();
        app.MapGet("/user/{userId:guid}/trips", () => Results.Unauthorized());
        app.MapTelemetryEndpoints();
        await app.StartAsync();
        using var client = app.GetTestClient();
        var enabledConfig = await client.GetFromJsonAsync<BrowserTelemetryConfiguration>(
            "/telemetry/config"
        );
        Assert.AreEqual(ConnectionString, enabledConfig!.ConnectionString);
        var traceId = ActivityTraceId.CreateRandom();
        const string parentId = "1234567890abcdef";
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            "/user/00000000-0000-0000-0000-000000000001/trips?query=bearer-secret"
        );
        request.Headers.Add("traceparent", $"00-{traceId}-{parentId}-01");
        // Instrumentation also sees requests from other hosts running in parallel.
        // A completed unrelated span must not satisfy the browser request's wait.
        var unrelatedTraceId = ActivityTraceId.CreateRandom();
        using var unrelated = new HttpRequestMessage(
            HttpMethod.Get,
            "/user/00000000-0000-0000-0000-000000000002/trips"
        );
        unrelated.Headers.Add("traceparent", $"00-{unrelatedTraceId}-{parentId}-01");
        using var unrelatedResponse = await client.SendAsync(unrelated);
        Assert.AreEqual(HttpStatusCode.Unauthorized, unrelatedResponse.StatusCode);
        await capture.WaitForServerSpanAsync(unrelatedTraceId);
        var browserSpan = capture.WaitForServerSpanAsync(traceId);
        Assert.IsFalse(
            browserSpan.IsCompleted,
            "An unrelated request must not complete the browser trace's wait."
        );
        using var response = await client.SendAsync(request);
        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
        var span = await browserSpan;
        Assert.AreEqual(traceId, span.TraceId);
        Assert.AreEqual(parentId, span.ParentSpanId.ToHexString());
        StringAssert.Contains(span.DisplayName, "{userId:guid}");
        string tags = string.Join(" ", span.TagObjects.Select(tag => $"{tag.Key}={tag.Value}"));
        Assert.DoesNotContain("bearer-secret", tags);
        Assert.DoesNotContain("00000000-0000-0000-0000-000000000001", tags);
        Assert.IsNull(span.GetTagItem("url.query"));

        foreach (
            string path in new[]
            {
                "/health",
                "/mapToken",
                "/calendars/bearer-secret.ics",
                "/telemetry/config",
            }
        )
        {
            string excludedTrace = ActivityTraceId.CreateRandom().ToHexString();
            using var excluded = new HttpRequestMessage(HttpMethod.Get, path);
            excluded.Headers.Add("traceparent", $"00-{excludedTrace}-{parentId}-01");
            using var ignored = await client.SendAsync(excluded);
            Assert.IsFalse(
                capture.Activities.Any(activity => activity.TraceId.ToHexString() == excludedTrace)
            );
        }
        var config = await client.GetFromJsonAsync<BrowserTelemetryConfiguration>(
            "/telemetry/config"
        );
        Assert.AreEqual(ConnectionString, config!.ConnectionString);
    }

    [TestMethod]
    [DataRow(
        ActivityKind.Server,
        "GET /trips/{tripId:guid}",
        "https://example.com/trips/{tripId:guid}"
    )]
    [DataRow(ActivityKind.Client, "GET /", "https://example.com/")]
    public void HttpTelemetryOmitsRawPathsQueriesAndArbitraryTags(
        ActivityKind kind,
        string name,
        string expectedUrl
    )
    {
        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == "telemetry-privacy-test",
            Sample = (ref ActivityCreationOptions<ActivityContext> _) =>
                ActivitySamplingResult.AllDataAndRecorded,
        };
        ActivitySource.AddActivityListener(listener);
        using var source = new ActivitySource("telemetry-privacy-test");
        using var activity = source.StartActivity("raw secret path", kind)!;
        activity.SetTag("http.request.method", "GET");
        activity.SetTag("http.route", "/trips/{tripId:guid}");
        activity.SetTag(
            "url.full",
            "https://user:bearer-secret@example.com/trips/bearer-secret?token=bearer-secret"
        );
        activity.SetTag("url.query", "token=bearer-secret");
        activity.SetTag("exception.message", "bearer-secret");
        activity.SetStatus(ActivityStatusCode.Error, "bearer-secret");
        new SanitizeHttpTelemetryProcessor().OnEnd(activity);
        Assert.AreEqual(name, activity.DisplayName);
        Assert.AreEqual(expectedUrl, activity.GetTagItem("url.full"));
        Assert.IsNull(activity.GetTagItem("url.query"));
        Assert.IsNull(activity.GetTagItem("exception.message"));
        Assert.IsNull(activity.StatusDescription);
        Assert.AreEqual(ActivityStatusCode.Error, activity.Status);
    }

    private sealed class CaptureProcessor : BaseProcessor<Activity>
    {
        public ConcurrentBag<Activity> Activities { get; } = [];
        private readonly ConcurrentDictionary<
            ActivityTraceId,
            TaskCompletionSource<Activity>
        > serverSpans = new();

        private TaskCompletionSource<Activity> ServerSpan(ActivityTraceId traceId) =>
            serverSpans.GetOrAdd(
                traceId,
                static _ => new(TaskCreationOptions.RunContinuationsAsynchronously)
            );

        public async Task<Activity> WaitForServerSpanAsync(ActivityTraceId traceId)
        {
            try
            {
                return await ServerSpan(traceId).Task.WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch (TimeoutException)
            {
                Assert.Fail(
                    $"No server span completed for trace {traceId}. Captured: "
                        + string.Join(
                            "; ",
                            Activities.Select(activity =>
                                $"{activity.Kind} {activity.TraceId} {activity.DisplayName}"
                            )
                        )
                );
                throw;
            }
        }

        public override void OnEnd(Activity activity)
        {
            Activities.Add(activity);
            if (activity.Kind == ActivityKind.Server)
            {
                ServerSpan(activity.TraceId).TrySetResult(activity);
            }
        }
    }

    private sealed class AcceptTelemetryHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        ) =>
            Task.FromResult(
                new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        "{\"itemsReceived\":1,\"itemsAccepted\":1,\"errors\":[]}"
                    ),
                }
            );
    }
}
