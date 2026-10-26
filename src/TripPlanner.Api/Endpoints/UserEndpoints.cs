using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;

namespace TripPlanner.Api.Endpoints;

public static class UserEndpoints
{
    public static void MapUserEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/user", GetCurrentUser).WithName("GetCurrentUser");
        var authenticatedUser = api.MapGroup("/user")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        authenticatedUser.MapGet("/avatar", GetCurrentUserAvatar).WithName("GetCurrentUserAvatar");
        authenticatedUser.MapPut("/profile", SetUserProfile).WithName("SetUserProfile");
    }

    private static async Task<IResult> GetCurrentUser(
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        // The anonymous browser bootstrap is public, but bearer credentials must
        // still satisfy the REST audience/scope policy before exposing a profile.
        if (
            context
                .Request.Headers.Authorization.ToString()
                .StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
        )
        {
            var allowed = await context
                .RequestServices.GetRequiredService<IAuthorizationService>()
                .AuthorizeAsync(
                    context.User,
                    context,
                    AuthenticationServiceExtensions.CurrentUserPolicy
                );
            if (!allowed.Succeeded)
            {
                return Results.StatusCode(
                    context.User.Identity?.IsAuthenticated == true ? 403 : 401
                );
            }
        }
        AuthenticatedUserProfile? profile = currentUser.Profile;
        if (profile is null)
        {
            return Results.Ok(
                new CurrentUserResponse(false, null, null, null, null, false, new(null, []))
            );
        }

        User user = await database.GetOrCreateUserAsync(profile, context.RequestAborted);
        return Results.Ok(ToResponse(user));
    }

    private static async Task<IResult> GetCurrentUserAvatar(
        HttpContext context,
        IHttpClientFactory httpClientFactory,
        ICurrentUser currentUser
    )
    {
        AuthenticatedUserProfile profile = currentUser.Profile!;
        string? accessToken = context.RequestServices.GetService<IAuthenticationService>() is null
            ? null
            : await context.GetTokenAsync("access_token");
        if (string.IsNullOrWhiteSpace(accessToken))
        {
            return Results.NotFound();
        }

        using HttpResponseMessage? imageResponse = await GetProfileImageAsync(
            httpClientFactory.CreateClient(),
            profile.Provider,
            accessToken,
            context.RequestAborted
        );
        if (imageResponse is null || !imageResponse.IsSuccessStatusCode)
        {
            return Results.NotFound();
        }

        byte[] image = await imageResponse.Content.ReadAsByteArrayAsync(context.RequestAborted);
        context.Response.Headers.CacheControl = "private, max-age=300";
        return Results.File(
            image,
            imageResponse.Content.Headers.ContentType?.MediaType ?? "image/jpeg"
        );
    }

    private static async Task<IResult> SetUserProfile(
        UserProfile request,
        AirportCatalog airports,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        var errors = new Dictionary<string, string[]>();
        ProfileHomeCity? city = request.HomeCity;
        if (city is null || string.IsNullOrWhiteSpace(city.Name))
        {
            errors[nameof(request.HomeCity)] = ["Home city is required."];
        }
        else
        {
            if (!double.IsFinite(city.Longitude) || city.Longitude is < -180 or > 180)
            {
                errors[nameof(city.Longitude)] = ["Longitude must be between -180 and 180."];
            }

            if (!double.IsFinite(city.Latitude) || city.Latitude is < -90 or > 90)
            {
                errors[nameof(city.Latitude)] = ["Latitude must be between -90 and 90."];
            }
        }
        string[]? submitted = request.PreferredAirlines;
        if (submitted is null || submitted.Length > 20 || submitted.Any(code => code is null))
        {
            errors[nameof(request.PreferredAirlines)] = ["Provide up to 20 airline codes."];
        }

        string[] codes = submitted is null
            ? []
            : submitted
                .Where(code => code is not null)
                .Select(code => code.Trim().ToUpperInvariant())
                .Distinct(StringComparer.Ordinal)
                .ToArray();
        if (codes.Any(code => code.Length != 2 || !code.All(char.IsAsciiLetterOrDigit)))
        {
            errors[nameof(request.PreferredAirlines)] = ["Use two-character airline codes."];
        }

        string? preferredAirport = request.PreferredAirport?.Trim().ToUpperInvariant();
        if (city is not null && errors.Count == 0)
        {
            var choices = airports.HomeAirports(city);
            if (choices.Count == 1 && preferredAirport is null)
            {
                preferredAirport = choices[0].Code;
            }

            if (choices.Count > 1 && preferredAirport is null)
            {
                errors[nameof(request.PreferredAirport)] = ["Choose your preferred home airport."];
            }

            if (preferredAirport is not null && !choices.Any(a => a.Code == preferredAirport))
            {
                errors[nameof(request.PreferredAirport)] =
                [
                    "Choose an airport serving your home city.",
                ];
            }
        }
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        AuthenticatedUserProfile profile = currentUser.Profile!;
        User existing = await database.GetOrCreateUserAsync(profile, context.RequestAborted);
        User user = await database.SetUserProfileAsync(
            existing.Id,
            new UserProfile(city! with { Name = city!.Name.Trim() }, codes, preferredAirport),
            context.RequestAborted
        );
        return Results.Ok(ToResponse(user));
    }

    private static async Task<HttpResponseMessage?> GetProfileImageAsync(
        HttpClient client,
        string provider,
        string accessToken,
        CancellationToken cancellationToken
    )
    {
        if (provider == "microsoft")
        {
            using var microsoftRequest = new HttpRequestMessage(
                HttpMethod.Get,
                "https://graph.microsoft.com/v1.0/me/photo/$value"
            );
            microsoftRequest.Headers.Authorization = new AuthenticationHeaderValue(
                "Bearer",
                accessToken
            );
            return await client.SendAsync(
                microsoftRequest,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken
            );
        }
        if (provider != "google")
        {
            return null;
        }

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            "https://www.googleapis.com/oauth2/v3/userinfo"
        );
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using HttpResponseMessage response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        await using Stream stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using JsonDocument document = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: cancellationToken
        );
        if (
            !document.RootElement.TryGetProperty("picture", out JsonElement picture)
            || !Uri.TryCreate(picture.GetString(), UriKind.Absolute, out Uri? uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !uri.Host.EndsWith(".googleusercontent.com", StringComparison.OrdinalIgnoreCase)
        )
        {
            return null;
        }

        return await client.GetAsync(
            uri,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken
        );
    }

    private static CurrentUserResponse ToResponse(User user) =>
        new(
            true,
            user.Id,
            user.DisplayName,
            user.Email,
            user.Provider,
            user.HomeCityLocation is not null,
            new UserProfile(
                user.HomeCityLocation is null || user.HomeCityName is null
                    ? null
                    : new ProfileHomeCity(
                        user.HomeCityName,
                        user.HomeCityLocation.Longitude,
                        user.HomeCityLocation.Latitude
                    ),
                user.PreferredAirlines,
                user.PreferredAirport
            ),
            user.FeatureFlags.Split(',', StringSplitOptions.RemoveEmptyEntries)
        );
}
