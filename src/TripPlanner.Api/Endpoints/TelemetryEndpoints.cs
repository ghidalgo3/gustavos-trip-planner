using Microsoft.Extensions.Options;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Endpoints;

public static class TelemetryEndpoints
{
    public static void MapTelemetryEndpoints(this WebApplication app)
    {
        // The ingestion connection string is a public browser identifier, not an
        // API credential. Never expose other server configuration here or in MCP.
        app.MapGet(
                "/telemetry/config",
                (HttpContext context, IOptions<ApplicationInsightsOptions> options) =>
                {
                    context.Response.Headers.CacheControl = "no-store";
                    return Results.Ok(
                        new BrowserTelemetryConfiguration(options.Value.ConnectionString)
                    );
                }
            )
            .AllowAnonymous()
            .WithName("GetBrowserTelemetryConfiguration");
    }
}
