using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace TripPlanner.Api.Authentication;

public sealed class AppServiceAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder
) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "AppService";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        // Easy Auth removes caller-supplied principal headers before forwarding requests.
        if (!Request.Headers.TryGetValue("X-MS-CLIENT-PRINCIPAL", out var header))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        try
        {
            var appServicePrincipal = JsonSerializer.Deserialize<AppServicePrincipal>(
                Convert.FromBase64String(header.ToString())
            );
            if (appServicePrincipal is not { Provider: "aad", Claims: not null })
            {
                return Task.FromResult(AuthenticateResult.Fail("Invalid App Service principal."));
            }

            var identity = new ClaimsIdentity(
                appServicePrincipal
                    .Claims.Where(claim =>
                        claim is { Type: not null and not "" and not "provider", Value: not null }
                    )
                    .Select(claim => new Claim(claim!.Type!, claim.Value!))
                    .Append(new Claim("provider", "microsoft")),
                SchemeName
            );
            return Task.FromResult(
                AuthenticateResult.Success(
                    new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName)
                )
            );
        }
        catch (Exception exception) when (exception is FormatException or JsonException)
        {
            return Task.FromResult(AuthenticateResult.Fail("Invalid App Service principal."));
        }
    }

    private sealed record AppServicePrincipal(
        [property: JsonPropertyName("auth_typ")] string? Provider,
        [property: JsonPropertyName("claims")] AppServiceClaim?[]? Claims
    );

    private sealed record AppServiceClaim(
        [property: JsonPropertyName("typ")] string? Type,
        [property: JsonPropertyName("val")] string? Value
    );
}
