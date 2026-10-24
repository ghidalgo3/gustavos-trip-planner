using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using OpenIddict.Abstractions;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.ActivityPlanning;

namespace TripPlanner.Api.Mcp;

public sealed class McpExecutionAdapter(
    IHttpContextAccessor contexts,
    IPlannerDb database,
    ICurrentUser currentUser,
    IOptions<McpOptions> options
)
{
    public async Task<CallToolResult> ExecuteAsync(
        bool write,
        Func<HttpContext, Task<IResult>> action,
        string? contextVersion = null,
        string? etag = null
    )
    {
        var original =
            contexts.HttpContext
            ?? throw new InvalidOperationException("MCP requires an HTTP request.");
        if (
            !original.User.HasScope(
                write ? McpServiceExtensions.WriteScope : McpServiceExtensions.ReadScope
            ) && (write || !original.User.HasScope(McpServiceExtensions.WriteScope))
        )
        {
            return new()
            {
                IsError = true,
                StructuredContent = JsonSerializer.SerializeToElement(new { status = 403 }),
                Content =
                [
                    new TextContentBlock
                    {
                        Text = "Insufficient scope. Reconnect with the required permission.",
                    },
                ],
                Meta = new JsonObject
                {
                    ["mcp/www_authenticate"] = new JsonArray(
                        $"Bearer error=\"insufficient_scope\", error_description=\"Reconnect TripPlanner to grant the required permission.\", scope=\"{(write ? McpServiceExtensions.WriteScope : McpServiceExtensions.ReadScope)}\", resource_metadata=\"{new Uri(new Uri(options.Value.Issuer!), "/.well-known/oauth-protected-resource/mcp")}\""
                    ),
                },
            };
        }

        if (
            !Guid.TryParse(
                original.User.GetClaim(OpenIddictConstants.Claims.Subject),
                out var userId
            )
            || await database.GetUserAsync(userId, original.RequestAborted)
                is not { HomeCityLocation: not null } user
            || !string.Equals(
                user.Email,
                currentUser.Profile?.Email,
                StringComparison.OrdinalIgnoreCase
            )
        )
        {
            return new()
            {
                IsError = true,
                StructuredContent = JsonSerializer.SerializeToElement(new { status = 403 }),
                Content =
                [
                    new TextContentBlock
                    {
                        Text = "Complete your TripPlanner profile and reconnect this account.",
                    },
                ],
            };
        }

        var context = new DefaultHttpContext
        {
            RequestServices = original.RequestServices,
            User = original.User,
            RequestAborted = original.RequestAborted,
        };
        context.Request.Path = original.Request.Path;
        context.Request.Headers["Destination-Context"] = contextVersion;
        context.Request.Headers["Planning-Context"] = contextVersion;
        context.Request.Headers.IfMatch = etag;
        await using var responseBody = new MemoryStream();
        context.Response.Body = responseBody;
        IResult result;
        try
        {
            result = await action(context);
        }
        catch (ActivityPlanningChangedException)
        {
            result = ActivityPlanEndpoints.Stale();
        }
        catch (Npgsql.PostgresException e) when (e.SqlState is "40001" or "40P01")
        {
            result = ActivityPlanEndpoints.Stale();
        }
        // Forbid results from shared handlers must be MCP errors, not cookie-login redirects.
        if (result is ForbidHttpResult)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
        }
        else
        {
            await result.ExecuteAsync(context);
        }

        context.Response.Body.Position = 0;
        using var reader = new StreamReader(context.Response.Body);
        string json = await reader.ReadToEndAsync(original.RequestAborted);
        var output = new JsonObject
        {
            ["status"] = context.Response.StatusCode,
            ["data"] = json.Length == 0 ? null : JsonNode.Parse(json),
            ["etag"] = context.Response.Headers.ETag.FirstOrDefault(),
            ["contextVersion"] = context.Response.Headers["Planning-Context"].FirstOrDefault(),
        };
        if (output["data"] is JsonObject data)
        {
            output["operationId"] = data["operationId"]?.DeepClone();
            output["resultId"] = data["id"]?.DeepClone() ?? data["result"]?["id"]?.DeepClone();
            output["contextVersion"] ??=
                data["contextVersion"]?.DeepClone()
                ?? data["result"]?["contextVersion"]?.DeepClone();
        }
        return new()
        {
            IsError = context.Response.StatusCode >= 400,
            StructuredContent = JsonSerializer.SerializeToElement(output),
            Content = [new TextContentBlock { Text = output.ToJsonString() }],
        };
    }
}
