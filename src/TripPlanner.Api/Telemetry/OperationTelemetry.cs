using System.Diagnostics;
using System.Text.Json;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using TripPlanner.Api.Instructions;

namespace TripPlanner.Api.Telemetry;

public static class OperationTelemetry
{
    public const string SourceName = "TripPlanner.Api.Operations";
    private static readonly ActivitySource Source = new(SourceName);

    public static async ValueTask<CallToolResult> TraceToolAsync(
        string toolName,
        Func<ValueTask<CallToolResult>> action,
        CancellationToken cancellationToken
    )
    {
        using var activity = Source.StartActivity($"MCP {toolName}", ActivityKind.Internal);
        activity?.SetTag("mcp.tool.name", toolName);
        activity?.SetTag("mcp.guidance.version", McpInstructions.Planning.Version);
        try
        {
            var result = await action();
            int? status =
                result.StructuredContent is { ValueKind: JsonValueKind.Object } data
                && data.TryGetProperty("status", out var value)
                && value.ValueKind == JsonValueKind.Number
                && value.TryGetInt32(out int number)
                && number is >= 100 and <= 599
                    ? number
                    : null;
            activity?.SetTag("mcp.result.status_code", status);
            bool failed = result.IsError == true || status >= 400;
            activity?.SetTag("tripplanner.outcome", failed ? "failure" : "success");
            activity?.SetStatus(failed ? ActivityStatusCode.Error : ActivityStatusCode.Ok);
            if (failed)
            {
                activity?.SetTag(
                    "error.type",
                    status switch
                    {
                        400 => "invalid_arguments",
                        401 => "unauthenticated",
                        403 => "permission_denied",
                        404 => "not_found",
                        409 => "conflict",
                        412 => "stale_version",
                        429 => "rate_limited",
                        >= 500 => "server_error",
                        _ => "tool_error",
                    }
                );
            }
            return result;
        }
        catch (Exception exception)
        {
            Fail(activity, exception, cancellationToken);
            if (exception is McpProtocolException protocol)
            {
                activity?.SetTag("rpc.error_code", (int)protocol.ErrorCode);
            }
            throw;
        }
    }

    public static async Task<bool> TraceJobAsync(
        string kind,
        Func<Task<bool>> action,
        CancellationToken cancellationToken
    )
    {
        // A claimed job is a new operation. Idle queue polling creates no spans.
        // Durable queues currently do not retain the enqueue request's trace context.
        using var activity = Source.StartActivity($"Job {kind}", ActivityKind.Server);
        activity?.SetTag("tripplanner.job.kind", kind);
        try
        {
            bool result = await action();
            if (activity?.Status != ActivityStatusCode.Error)
            {
                activity?.SetTag("tripplanner.outcome", "success");
                activity?.SetStatus(ActivityStatusCode.Ok);
            }
            return result;
        }
        catch (Exception exception)
        {
            Fail(activity, exception, cancellationToken);
            throw;
        }
    }

    // Handled failures still fail the job attempt's trace even when the queue method returns true.
    public static void JobFailed(Exception exception) =>
        Fail(CurrentJob(), exception, CancellationToken.None);

    public static void JobFailed() => Fail(CurrentJob(), "job_failed", "failure");

    private static Activity? CurrentJob() =>
        Activity.Current is { } current
        && current.Source.Name == SourceName
        && current.GetTagItem("tripplanner.job.kind") is not null
            ? current
            : null;

    private static void Fail(Activity? activity, Exception exception, CancellationToken token) =>
        Fail(
            activity,
            exception.GetType().Name,
            exception is OperationCanceledException && token.IsCancellationRequested
                ? "cancelled"
                : "failure"
        );

    private static void Fail(Activity? activity, string errorType, string outcome)
    {
        activity?.SetStatus(ActivityStatusCode.Error);
        activity?.SetTag("tripplanner.outcome", outcome);
        activity?.SetTag("error.type", errorType);
    }
}
