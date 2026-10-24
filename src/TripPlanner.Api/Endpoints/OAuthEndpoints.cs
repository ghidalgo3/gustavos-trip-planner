using System.Collections.Immutable;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Options;
using OpenIddict.Abstractions;
using OpenIddict.Server;
using OpenIddict.Server.AspNetCore;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Mcp;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace TripPlanner.Api.Endpoints;

public static class OAuthEndpoints
{
    private static readonly object ConsentDecision = new();

    public static void MapOAuthEndpoints(this WebApplication app)
    {
        app.MapGet("/.well-known/oauth-protected-resource/mcp", ResourceMetadata);
        app.MapGet("/.well-known/oauth-protected-resource", ResourceMetadata);
        app.MapMethods("/oauth/authorize", ["GET", "POST"], Authorize);
        app.MapPost("/oauth/token", Exchange);
    }

    private static IResult ResourceMetadata(IOptions<McpOptions> options) =>
        Results.Json(
            new
            {
                resource = new Uri(new Uri(options.Value.Issuer!), "/mcp").AbsoluteUri,
                authorization_servers = new[] { options.Value.Issuer!.TrimEnd('/') + "/" },
                scopes_supported = new[]
                {
                    McpServiceExtensions.ReadScope,
                    McpServiceExtensions.WriteScope,
                },
                bearer_methods_supported = new[] { "header" },
            }
        );

    private static async Task<IResult> Authorize(
        HttpContext context,
        IPlannerDb database,
        IAntiforgery antiforgery,
        IOptions<McpOptions> options
    )
    {
        var request = context.GetOpenIddictServerRequest()!;
        string resource = new Uri(new Uri(options.Value.Issuer!), "/mcp").AbsoluteUri;
        if (!request.GetResources().SequenceEqual([resource]))
        {
            return Deny(
                Errors.InvalidTarget,
                "The requested resource must be this server's /mcp URL."
            );
        }

        if (request.GetPromptValues().Contains(PromptValues.None))
        {
            return Deny(Errors.ConsentRequired, "Explicit consent is required to connect ChatGPT.");
        }

        var authentication = await context.AuthenticateAsync(
            CookieAuthenticationDefaults.AuthenticationScheme
        );
        var profile = authentication.Principal is { } principal
            ? AuthenticatedUserProfile.FromPrincipal(principal)
            : null;
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.ContentSecurityPolicy =
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
        string Encode(string value) => HtmlEncoder.Default.Encode(value);
        if (profile is null)
        {
            string returnUri = context.Request.Path + context.Request.QueryString;
            string redirect = Uri.EscapeDataString(returnUri);
            return Html(
                $"<h1>Connect TripPlanner to ChatGPT</h1><p>Sign in to your TripPlanner account to continue.</p><a href=\"/.auth/login/google?post_login_redirect_uri={redirect}\">Continue with Google</a><a href=\"/.auth/login/aad?post_login_redirect_uri={redirect}\">Continue with Microsoft</a>"
            );
        }
        User? user = await database.GetUserByEmailAsync(profile.Email, context.RequestAborted);
        if (user?.HomeCityLocation is null)
        {
            return Html(
                "<h1>Complete your profile first</h1><p>Open TripPlanner, finish onboarding, then connect ChatGPT again.</p><a href=\"/\">Open TripPlanner</a>"
            );
        }

        if (HttpMethods.IsGet(context.Request.Method))
        {
            var token = antiforgery.GetAndStoreTokens(context);
            string permissions = request.HasScope(McpServiceExtensions.WriteScope)
                ? "View and change trips you have permission to manage, including deleting trips and activities."
                : "View trips shared with you.";
            string fields = string.Concat(
                request
                    .GetParameters()
                    .Select(parameter =>
                        $"<input type=\"hidden\" name=\"{Encode(parameter.Key)}\" value=\"{Encode(parameter.Value.ToString() ?? "")}\">"
                    )
            );
            return Html(
                $"<h1>Allow ChatGPT to access TripPlanner?</h1><p>Signed in as {Encode(user.DisplayName)} ({Encode(user.Email)}).</p><p>{permissions}</p><p>Changes will be attributed to you via ChatGPT in your Activity Log. Access lasts until revoked or expired.</p><form method=\"post\">{fields}<input type=\"hidden\" name=\"{Encode(token.FormFieldName)}\" value=\"{Encode(token.RequestToken!)}\"><button name=\"decision\" value=\"allow\">Allow access</button><button name=\"decision\" value=\"deny\">Cancel</button></form>"
            );
        }
        try
        {
            await antiforgery.ValidateRequestAsync(context);
        }
        catch (AntiforgeryValidationException)
        {
            return Html(
                "<h1>Consent session expired</h1><p>No new access was granted. Return to ChatGPT and start connecting TripPlanner again.</p>",
                StatusCodes.Status400BadRequest
            );
        }
        var form = await context.Request.ReadFormAsync();
        context.Items[ConsentDecision] = form["decision"] == "allow";
        if (form["decision"] != "allow")
        {
            return Deny(Errors.AccessDenied, "The user denied access.");
        }

        var identity = new ClaimsIdentity("OAuth", Claims.Name, Claims.Role);
        identity.SetClaim(Claims.Subject, user.Id.ToString("D"));
        identity.SetClaim(Claims.Name, user.DisplayName);
        identity.SetClaim(Claims.Email, user.Email);
        identity.SetClaim("provider", profile.Provider);
        identity.SetScopes(request.GetScopes());
        identity.SetResources(resource);
        identity.SetDestinations(_ => [Destinations.AccessToken]);
        return Results.SignIn(
            new ClaimsPrincipal(identity),
            authenticationScheme: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme
        );
    }

    internal static async ValueTask ApplyConsentResponseAsync(
        OpenIddictServerEvents.ApplyAuthorizationResponseContext context
    )
    {
        var http = context.Transaction.GetHttpRequest()?.HttpContext;
        // Only acknowledge a CSRF-validated user decision, never a protocol validation failure.
        // OpenIddict has already validated the callback and generated the code/error and state.
        if (
            http?.Items[ConsentDecision] is not bool allowed
            || string.IsNullOrEmpty(context.RedirectUri)
            || (
                allowed
                && (context.Error is not null || string.IsNullOrEmpty(context.AuthorizationCode))
            )
            || (!allowed && context.Error != Errors.AccessDenied)
        )
        {
            return;
        }

        string Encode(string value) => HtmlEncoder.Default.Encode(value);
        var parameters = context
            .Response.GetParameters()
            .SelectMany(parameter =>
                ((ImmutableArray<string?>?)parameter.Value ?? [])
                    .Where(value => !string.IsNullOrEmpty(value))
                    .Select(value => new KeyValuePair<string, string?>(parameter.Key, value))
            )
            .ToArray();
        string handoff;
        if (context.ResponseMode == ResponseModes.FormPost)
        {
            string fields = string.Concat(
                parameters.Select(parameter =>
                    $"<input type=\"hidden\" name=\"{Encode(parameter.Key)}\" value=\"{Encode(parameter.Value!)}\">"
                )
            );
            handoff =
                $"<form method=\"post\" action=\"{Encode(context.RedirectUri)}\">{fields}<button type=\"submit\">Return to ChatGPT</button></form>";
            string origin = new Uri(context.RedirectUri).GetLeftPart(UriPartial.Authority);
            http.Response.Headers.ContentSecurityPolicy =
                $"default-src 'none'; style-src 'unsafe-inline'; form-action {origin}; frame-ancestors 'none'; base-uri 'none'";
        }
        else if (context.ResponseMode is ResponseModes.Query or ResponseModes.Fragment)
        {
            string callback =
                context.ResponseMode == ResponseModes.Query
                    ? QueryHelpers.AddQueryString(context.RedirectUri, parameters)
                    : context.RedirectUri
                        + "#"
                        + QueryHelpers.AddQueryString("", parameters).TrimStart('?');
            handoff =
                $"<a class=\"return-to-chatgpt\" href=\"{Encode(callback)}\">Return to ChatGPT</a>";
        }
        else
        {
            return;
        }

        http.Response.Headers["Referrer-Policy"] = "no-referrer";
        string outcome = allowed
            ? "<h1>Access approved</h1><p>You approved ChatGPT’s access to TripPlanner. Return to ChatGPT to finish connecting.</p><p>You can review agent actions in your profile’s Activity Log and revoke access under Connected agents.</p>"
            : "<h1>Access not granted</h1><p>You declined this request. No new access was granted to ChatGPT. Any previously connected access is unchanged.</p><p>Return to ChatGPT to finish canceling the connection.</p>";
        await Html($"<section role=\"status\">{outcome}</section>{handoff}").ExecuteAsync(http);
        context.HandleRequest();
    }

    private static async Task<IResult> Exchange(
        HttpContext context,
        IPlannerDb database,
        IOptions<McpOptions> options
    )
    {
        var request = context.GetOpenIddictServerRequest()!;
        var authentication = await context.AuthenticateAsync(
            OpenIddictServerAspNetCoreDefaults.AuthenticationScheme
        );
        var principal = authentication.Principal;
        string resource = new Uri(new Uri(options.Value.Issuer!), "/mcp").AbsoluteUri;
        if (
            principal is null
            || !Guid.TryParse(principal.GetClaim(Claims.Subject), out var id)
            || await database.GetUserAsync(id, context.RequestAborted)
                is not { HomeCityLocation: not null }
        )
        {
            return Deny(Errors.InvalidGrant, "This account is no longer available.");
        }

        if (
            !request.GetResources().SequenceEqual([resource])
            || !principal.GetResources().Contains(resource)
        )
        {
            return Deny(Errors.InvalidTarget, "The token must be requested for this MCP resource.");
        }

        if (request.IsRefreshTokenGrantType() && request.Scope is not null)
        {
            principal.SetScopes(request.GetScopes());
        }

        return Results.SignIn(
            principal,
            authenticationScheme: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme
        );
    }

    private static IResult Deny(string error, string description) =>
        Results.Forbid(
            new AuthenticationProperties(
                new Dictionary<string, string?>
                {
                    [OpenIddictServerAspNetCoreConstants.Properties.Error] = error,
                    [OpenIddictServerAspNetCoreConstants.Properties.ErrorDescription] = description,
                }
            ),
            [OpenIddictServerAspNetCoreDefaults.AuthenticationScheme]
        );

    private static IResult Html(string body, int statusCode = StatusCodes.Status200OK) =>
        Results.Content(
            "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Connect TripPlanner</title><style>body{font:17px system-ui;max-width:32rem;margin:3rem auto;padding:1rem}button,a{display:inline-block;border:1px solid #145da0;border-radius:6px;padding:12px;margin:8px 8px 8px 0;background:#eff6ff;color:#134b7f}button{font:inherit}button[value=allow],.return-to-chatgpt,button[type=submit]{background:#145da0;color:white}</style>"
                + body
                + "</html>",
            "text/html",
            statusCode: statusCode
        );
}
