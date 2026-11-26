using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Options;
using AuthenticationOptions = TripPlanner.Api.Options.AuthenticationOptions;

namespace TripPlanner.Api.Endpoints;

public static class AuthenticationEndpoints
{
    public static void MapAuthenticationEndpoints(
        this WebApplication app,
        bool authenticationEnabled,
        bool localUsersEnabled
    )
    {
        app.MapGet(
            "/.auth/login/{provider}",
            async Task<IResult> (
                HttpContext context,
                string provider,
                string? post_login_redirect_uri,
                IOptions<WebOptions> webOptions,
                IOptions<AuthenticationOptions> authOptions
            ) =>
            {
                if (
                    localUsersEnabled
                    && LocalDevelopmentUsers.CreatePrincipal(provider, context.Request) is { } local
                )
                {
                    await context.SignInAsync(
                        CookieAuthenticationDefaults.AuthenticationScheme,
                        local
                    );
                    context.Response.Headers.CacheControl = "no-store";
                    return Results.Redirect("/");
                }

                if (!authenticationEnabled)
                {
                    return NotConfigured();
                }

                string? scheme = provider switch
                {
                    "google" => "google",
                    "aad" => "aad",
                    _ => null,
                };
                if (scheme is null)
                {
                    return Results.NotFound();
                }
                if (!authOptions.Value.IsEnabled)
                {
                    return NotConfigured();
                }
                return Results.Challenge(
                    new AuthenticationProperties
                    {
                        IsPersistent = true,
                        RedirectUri = SafeRedirect(
                            post_login_redirect_uri,
                            webOptions.Value.ClientOrigins
                        ),
                    },
                    [scheme]
                );
            }
        );

        app.MapGet(
            "/.auth/logout",
            async Task<IResult> (
                HttpContext context,
                string? post_logout_redirect_uri,
                IOptions<WebOptions> webOptions
            ) =>
            {
                if (!authenticationEnabled)
                {
                    return NotConfigured();
                }

                await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return Results.Redirect(
                    SafeRedirect(post_logout_redirect_uri, webOptions.Value.ClientOrigins)
                );
            }
        );
    }

    private static IResult NotConfigured() =>
        Results.Problem(
            statusCode: StatusCodes.Status503ServiceUnavailable,
            title: "Authentication is not configured. Start locally with scripts/server."
        );

    private static string SafeRedirect(
        string? candidate,
        IReadOnlyCollection<string> allowedOrigins
    )
    {
        // Browsers can normalize backslashes into authority separators. Reject
        // these and control characters before considering a relative redirect.
        if (candidate is not null && (candidate.Contains('\\') || candidate.Any(char.IsControl)))
        {
            candidate = null;
        }

        if (
            !string.IsNullOrWhiteSpace(candidate)
            && Uri.TryCreate(candidate, UriKind.Absolute, out Uri? uri)
            && allowedOrigins.Any(origin =>
                string.Equals(
                    origin.TrimEnd('/'),
                    uri.GetLeftPart(UriPartial.Authority),
                    StringComparison.OrdinalIgnoreCase
                )
            )
        )
        {
            return uri.ToString();
        }

        if (
            !string.IsNullOrWhiteSpace(candidate)
            && candidate.StartsWith('/')
            && !candidate.StartsWith("//")
        )
        {
            return candidate;
        }

        return allowedOrigins.FirstOrDefault()?.TrimEnd('/') + "/";
    }
}
