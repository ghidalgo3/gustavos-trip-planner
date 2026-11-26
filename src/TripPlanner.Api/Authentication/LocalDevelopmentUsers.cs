using System.Security.Claims;
using Npgsql;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;

namespace TripPlanner.Api.Authentication;

internal static class LocalDevelopmentUsers
{
    private const string Provider = "local";
    private const string IdentityType = "TripPlanner.LocalDevelopment";

    private static readonly (
        string Login,
        AuthenticatedUserProfile Identity,
        UserProfile Profile
    )[] Users =
    [
        (
            "local-user-1",
            new(Provider, "local-user-1@example.test", "Local user 1"),
            new(new("Boston", -71.0589, 42.3601), [], "BOS")
        ),
        (
            "local-user-2",
            new(Provider, "local-user-2@example.test", "Local user 2"),
            new(new("Seattle", -122.3321, 47.6062), [], "SEA")
        ),
    ];

    public static bool IsEnabled(IHostEnvironment environment, AuthenticationOptions options) =>
        environment.IsDevelopment()
        && options.LocalUsersEnabled
        && !options.UseAppServiceAuthentication
        && !options.ReviewerAccess.Required;

    public static void RequireLocalDatabase(DatabaseOptions options)
    {
        var connection = new NpgsqlConnectionStringBuilder(options.ConnectionString);
        if (
            options.UseAzureManagedIdentity
            || connection.Host is not ("database" or "localhost" or "127.0.0.1" or "::1")
        )
        {
            throw new InvalidOperationException("Local users require a local PostgreSQL database.");
        }
    }

    public static async Task SeedAsync(IPlannerDb database)
    {
        foreach (var (_, identity, profile) in Users)
        {
            User? existing = await database.GetUserByEmailAsync(identity.Email);
            if (existing is not null && existing.Provider != Provider)
            {
                throw new InvalidOperationException(
                    "A local test account conflicts with an existing account."
                );
            }

            User user = existing ?? await database.GetOrCreateUserAsync(identity);
            if (user.HomeCityLocation is null)
            {
                await database.SetUserProfileAsync(user.Id, profile);
            }
        }
    }

    public static ClaimsPrincipal? CreatePrincipal(string login, HttpRequest request)
    {
        if (
            request.Host.Host is not ("localhost" or "127.0.0.1" or "[::1]")
            || request.Headers["Sec-Fetch-Site"] != "same-origin"
        )
        {
            return null;
        }

        var identity = Users.FirstOrDefault(user => user.Login == login).Identity;
        if (identity is null)
        {
            return null;
        }

        return new ClaimsPrincipal(
            new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.Name, identity.DisplayName),
                    new Claim(ClaimTypes.Email, identity.Email),
                    new Claim("provider", Provider),
                ],
                IdentityType
            )
        );
    }

    public static bool HasLocalIdentity(ClaimsPrincipal? principal) =>
        principal?.Identity?.AuthenticationType == IdentityType;

    public static AuthenticatedUserProfile? ReadProfile(ClaimsPrincipal principal) =>
        Users
            .FirstOrDefault(user =>
                user.Identity.Email == principal.FindFirstValue(ClaimTypes.Email)
            )
            .Identity;
}
