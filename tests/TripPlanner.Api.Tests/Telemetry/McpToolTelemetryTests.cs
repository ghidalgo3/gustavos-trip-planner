using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using TripPlanner.Api.Instructions;
using TripPlanner.Api.Telemetry;
using TripPlanner.Api.Tests.Mcp;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Telemetry;

[TestClass]
public sealed class McpToolTelemetryTests
{
    [TestMethod]
    [DataRow("list_trips", 200)]
    [DataRow("create_trip", 400)]
    [DataRow("create_trip", 403)]
    [DataRow("get_trip", 404)]
    [DataRow("unregistered-bearer-secret", 0)]
    public async Task AgentToolOutcomesAreVisibleEvenWhenTransportReturns200(
        string tool,
        int expectedStatus
    )
    {
        var traceId = ActivityTraceId.CreateRandom();
        var spans = new ConcurrentBag<Activity>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = source =>
                source.Name is OperationTelemetry.SourceName or "Microsoft.AspNetCore",
            Sample = (ref ActivityCreationOptions<ActivityContext> _) =>
                ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = activity =>
            {
                if (
                    activity.Source.Name == OperationTelemetry.SourceName
                    && activity.TraceId == traceId
                )
                {
                    new SanitizeHttpTelemetryProcessor().OnEnd(activity);
                    spans.Add(activity);
                }
            },
        };
        ActivitySource.AddActivityListener(listener);
        await using var factory = new TestApplicationFactory { McpEnabled = true };
        using var browser = McpEndpointTests.CreateClient(factory);
        await McpEndpointTests.SeedAndSetCookie(factory, browser);
        var token = await McpEndpointTests.Tokens(
            browser,
            expectedStatus == 403 ? "tripplanner.read" : "tripplanner.read tripplanner.write"
        );
        using var agent = McpEndpointTests.CreateClient(factory);
        agent.DefaultRequestHeaders.Authorization = new(
            "Bearer",
            token.GetProperty("access_token").GetString()
        );
        agent.DefaultRequestHeaders.Add("traceparent", $"00-{traceId}-1234567890abcdef-01");
        object arguments = tool switch
        {
            "create_trip" => new
            {
                request = new
                {
                    name = expectedStatus == 400 ? "" : "bearer-secret",
                    description = "bearer-secret",
                },
            },
            "get_trip" => new { tripId = Guid.NewGuid() },
            _ => new { },
        };
        using var response = await McpEndpointTests.Rpc(
            agent,
            "tools/call",
            new { name = tool, arguments }
        );
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        // Drain the response so the JSON-RPC invocation and its activity have finished.
        await response.Content.ReadAsStringAsync();
        Assert.HasCount(1, spans);
        var span = spans.Single();
        Assert.AreEqual(
            expectedStatus == 0 ? "unknown_tool" : tool,
            span.GetTagItem("mcp.tool.name")
        );
        Assert.AreEqual(McpInstructions.Planning.Version, span.GetTagItem("mcp.guidance.version"));
        Assert.AreEqual(
            expectedStatus == 200 ? ActivityStatusCode.Ok : ActivityStatusCode.Error,
            span.Status
        );
        Assert.AreEqual(
            expectedStatus == 200 ? "success" : "failure",
            span.GetTagItem("tripplanner.outcome")
        );
        if (expectedStatus > 0)
        {
            Assert.AreEqual(expectedStatus, span.GetTagItem("mcp.result.status_code"));
        }
        else
        {
            Assert.IsNotNull(span.GetTagItem("rpc.error_code"));
        }
        Assert.DoesNotContain(
            "bearer-secret",
            span.DisplayName + string.Join(" ", span.TagObjects)
        );
        Assert.IsEmpty(span.Events);
        Assert.IsNull(span.StatusDescription);
    }
}
