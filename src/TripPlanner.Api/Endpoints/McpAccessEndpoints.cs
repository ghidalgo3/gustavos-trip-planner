using Microsoft.Extensions.Options;
using OpenIddict.Abstractions;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Mcp;
using TripPlanner.Api.Options;

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
                var applications =
                    context.RequestServices.GetRequiredService<IOpenIddictApplicationManager>();
                var applicationIds = new HashSet<string>();
                foreach (var client in McpServiceExtensions.GetMcpClients(options.Value))
                {
                    var application = await applications.FindByClientIdAsync(
                        client.ClientId,
                        context.RequestAborted
                    );
                    if (
                        application is not null
                        && await applications.GetIdAsync(application, context.RequestAborted)
                            is { } applicationId
                    )
                    {
                        applicationIds.Add(applicationId);
                    }
                }
                await foreach (
                    var token in tokens.FindBySubjectAsync(
                        user.Id.ToString("D"),
                        context.RequestAborted
                    )
                )
                {
                    if (
                        await tokens.GetApplicationIdAsync(token, context.RequestAborted)
                            is { } tokenApplicationId
                        && applicationIds.Contains(tokenApplicationId)
                        && await tokens.HasStatusAsync(
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
        {
            return Results.NotFound();
        }

        var user = await database.GetUserByEmailAsync(
            currentUser.Profile!.Email,
            context.RequestAborted
        );
        if (user is null)
        {
            return Results.NotFound();
        }

        string subject = user.Id.ToString("D");
        var applications =
            context.RequestServices.GetRequiredService<IOpenIddictApplicationManager>();
        foreach (var client in McpServiceExtensions.GetMcpClients(options.Value))
        {
            var application = await applications.FindByClientIdAsync(
                client.ClientId,
                context.RequestAborted
            );
            if (application is null)
            {
                continue;
            }
            string? applicationId = await applications.GetIdAsync(
                application,
                context.RequestAborted
            );
            if (applicationId is not null)
            {
                await context
                    .RequestServices.GetRequiredService<IOpenIddictTokenManager>()
                    .RevokeAsync(subject, applicationId, null, null, context.RequestAborted);
                await context
                    .RequestServices.GetRequiredService<IOpenIddictAuthorizationManager>()
                    .RevokeAsync(subject, applicationId, null, null, context.RequestAborted);
            }
        }
        return Results.NoContent();
    }
}
