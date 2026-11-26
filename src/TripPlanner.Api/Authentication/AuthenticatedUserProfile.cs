using System.Security.Claims;

namespace TripPlanner.Api.Authentication;

public sealed record AuthenticatedUserProfile(string Provider, string Email, string DisplayName)
{
    private const string EmailClaim =
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress";

    public static AuthenticatedUserProfile? FromHttpContext(HttpContext context)
    {
        return FromPrincipal(context.User);
    }

    public static AuthenticatedUserProfile? FromPrincipal(ClaimsPrincipal principal)
    {
        if (principal.Identity?.IsAuthenticated != true)
        {
            return null;
        }

        if (LocalDevelopmentUsers.HasLocalIdentity(principal))
        {
            return LocalDevelopmentUsers.ReadProfile(principal);
        }

        string? localProvider = NormalizeProvider(principal.FindFirstValue("provider"));
        string? email = FirstNotEmpty(
            principal.FindFirstValue(ClaimTypes.Email),
            principal.FindFirstValue("email"),
            principal.FindFirstValue("preferred_username")
        );

        return Create(
            localProvider,
            FirstNotEmpty(
                principal.FindFirstValue(ClaimTypes.Name),
                principal.FindFirstValue("name")
            ),
            email
        );
    }

    private static AuthenticatedUserProfile? Create(
        string? provider,
        string? displayName,
        string? email
    )
    {
        if (string.IsNullOrWhiteSpace(provider) || string.IsNullOrWhiteSpace(email))
        {
            return null;
        }

        string normalizedEmail = email.Trim().ToLowerInvariant();
        return new AuthenticatedUserProfile(
            provider,
            normalizedEmail,
            FirstNotEmpty(displayName, normalizedEmail)!
        );
    }

    private static string? NormalizeProvider(string? provider) =>
        provider?.ToLowerInvariant() switch
        {
            "aad" or "microsoft" or "microsoftaccount" => "microsoft",
            "google" => "google",
            _ => null,
        };

    private static string? FirstNotEmpty(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
}
