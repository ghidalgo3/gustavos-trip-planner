using Microsoft.Extensions.Options;
using OpenIddict.Abstractions;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Endpoints;

public static class McpAccessEndpoints
{
    public static void MapMcpAccessEndpoints(this RouteGroupBuilder api)
    {
        var access = api.MapGroup("/user/mcp-access")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        access.MapGet("", GetAccess);
        access.MapDelete("", RevokeAccess);
    }

    private static async Task<IResult> GetAccess(
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        IOptions<McpOptions> options
    )
    {
        context.Response.Headers.CacheControl = "no-store";
        bool connected = false;
        if (options.Value.Enabled)
        {
            var user = await database.GetUserByEmailAsync(
                currentUser.Profile!.Email,
                context.RequestAborted
            );
            if (user is not null)
            {
                var tokens = context.RequestServices.GetRequiredService<IOpenIddictTokenManager>();
                await foreach (
                    var token in tokens.FindBySubjectAsync(
                        user.Id.ToString("D"),
                        context.RequestAborted
                    )
                )
                    if (
                        await tokens.HasStatusAsync(
                            token,
                            OpenIddictConstants.Statuses.Valid,
                            context.RequestAborted
                        )
                        && await tokens.GetExpirationDateAsync(token, context.RequestAborted)
                            > DateTimeOffset.UtcNow
                    )
                    {
                        connected = true;
                        break;
                    }
            }
        }
        return Results.Ok(new { enabled = options.Value.Enabled, connected });
    }

    private static async Task<IResult> RevokeAccess(
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser,
        IOptions<McpOptions> options
    )
    {
        if (!options.Value.Enabled)
            return Results.NotFound();
        var user = await database.GetUserByEmailAsync(
            currentUser.Profile!.Email,
            context.RequestAborted
        );
        if (user is null)
            return Results.NotFound();
        string subject = user.Id.ToString("D");
        await context
            .RequestServices.GetRequiredService<IOpenIddictTokenManager>()
            .RevokeBySubjectAsync(subject, context.RequestAborted);
        await context
            .RequestServices.GetRequiredService<IOpenIddictAuthorizationManager>()
            .RevokeBySubjectAsync(subject, context.RequestAborted);
        return Results.NoContent();
    }
}
