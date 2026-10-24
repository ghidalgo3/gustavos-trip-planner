using TripPlanner.Api.Mcp;

namespace TripPlanner.Api.Endpoints;

public static class McpEndpoints
{
    public static void MapMcpEndpoints(this WebApplication app, bool enabled)
    {
        if (enabled)
        {
            app.MapMcp("/mcp").RequireAuthorization(McpServiceExtensions.Policy);
        }

        // Stateless MCP maps POST only. Reserve its namespace so unsupported
        // methods and unknown paths cannot fall through to the SPA's index.html.
        app.Map(
                "/mcp/{**path}",
                (HttpContext context, string? path) =>
                {
                    context.Response.Headers.CacheControl = "no-store";
                    if (!enabled || !string.IsNullOrEmpty(path))
                    {
                        return Results.NotFound();
                    }

                    context.Response.Headers.Allow = "POST";
                    return Results.StatusCode(StatusCodes.Status405MethodNotAllowed);
                }
            )
            .ExcludeFromDescription();
    }
}
