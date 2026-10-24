using System.Diagnostics;
using OpenTelemetry;

namespace TripPlanner.Api.Telemetry;

public sealed class SanitizeHttpTelemetryProcessor : BaseProcessor<Activity>
{
    private static readonly HashSet<string> AllowedTags =
    [
        "http.request.method",
        "http.method",
        "http.response.status_code",
        "http.status_code",
        "http.route",
        "server.address",
        "server.port",
        "url.scheme",
        "network.protocol.version",
        "error.type",
    ];

    public override void OnEnd(Activity activity)
    {
        string method =
            activity.GetTagItem("http.request.method")?.ToString()
            ?? activity.GetTagItem("http.method")?.ToString()
            ?? "HTTP";
        string route = activity.GetTagItem("http.route")?.ToString() ?? "/unmatched";
        string? rawUrl =
            activity.GetTagItem("url.full")?.ToString()
            ?? activity.GetTagItem("http.url")?.ToString();
        foreach (var tag in activity.TagObjects.ToArray())
        {
            if (!AllowedTags.Contains(tag.Key))
            {
                activity.SetTag(tag.Key, null);
            }
        }

        // Request paths use route templates, never user IDs or bearer tokens.
        // External dependency paths can also carry credentials: retain origin only.
        string path = activity.Kind == ActivityKind.Server ? route : "/";
        if (Uri.TryCreate(rawUrl, UriKind.Absolute, out var url))
        {
            activity.SetTag(
                "url.full",
                url.GetComponents(UriComponents.SchemeAndServer, UriFormat.UriEscaped) + path
            );
        }
        activity.DisplayName = $"{method} {path}";
        activity.SetStatus(activity.Status);
    }
}
