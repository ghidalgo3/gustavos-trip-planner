using System.Security.Claims;
using System.Text.Json;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Authentication;

internal static class ReviewerAccess
{
    private const string VerifiedGoogleEmail = "tripplanner:verified_google_email";
    private const string MicrosoftObjectId =
        "http://schemas.microsoft.com/identity/claims/objectidentifier";

    public static void Validate(AuthenticationOptions options, bool mcpEnabled)
    {
        if (!options.ReviewerAccess.Required)
        {
            return;
        }

        string?[] credentials =
        [
            options.Google.ClientId,
            options.Google.ClientSecret,
            options.Microsoft.ClientId,
            options.Microsoft.ClientSecret,
        ];
        if (
            options.UseAppServiceAuthentication
            || mcpEnabled
            || !options.IsEnabled
            || credentials.Any(value =>
                value!.StartsWith("@Microsoft.KeyVault(", StringComparison.OrdinalIgnoreCase)
            )
            || (
                !options.ReviewerAccess.GoogleEmails.Any(IsGmailAddress)
                && !options.ReviewerAccess.MicrosoftObjectIds.Any(id => id != Guid.Empty)
            )
        )
        {
            throw new InvalidOperationException(
                "Reviewer access requires both OAuth clients, at least one approved account, and MCP disabled."
            );
        }
    }

    public static void AddVerifiedGoogleEmail(ClaimsPrincipal? principal, JsonElement user)
    {
        if (
            principal?.Identity is ClaimsIdentity identity
            && (
                user.TryGetProperty("email_verified", out var verified)
                || user.TryGetProperty("verified_email", out verified)
            )
            && verified.ValueKind == JsonValueKind.True
            && IsGmailAddress(principal.FindFirstValue(ClaimTypes.Email))
        )
        {
            identity.AddClaim(new Claim(VerifiedGoogleEmail, "true"));
        }
    }

    public static bool Allows(ReviewerAccessOptions options, ClaimsPrincipal? principal)
    {
        if (!options.Required)
        {
            return true;
        }

        if (principal is null)
        {
            return false;
        }

        var profile = AuthenticatedUserProfile.FromPrincipal(principal);
        return profile?.Provider switch
        {
            "google" => principal.HasClaim(VerifiedGoogleEmail, "true")
                && options.GoogleEmails.Contains(profile.Email, StringComparer.OrdinalIgnoreCase),
            "microsoft" => GetMicrosoftObjectId(principal) is { } objectId
                && options.MicrosoftObjectIds.Contains(objectId),
            _ => false,
        };
    }

    public static Guid? GetMicrosoftObjectId(ClaimsPrincipal? principal) =>
        principal?.FindFirstValue("provider") == "microsoft"
        && Guid.TryParse(
            principal.FindFirstValue("oid") ?? principal.FindFirstValue(MicrosoftObjectId),
            out Guid objectId
        )
        && objectId != Guid.Empty
            ? objectId
            : null;

    private static bool IsGmailAddress(string? email) =>
        email?.EndsWith("@gmail.com", StringComparison.OrdinalIgnoreCase) == true;
}
