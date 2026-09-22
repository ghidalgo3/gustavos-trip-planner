using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services;

namespace TripPlanner.Api.Endpoints;

public static class UserEndpoints
{
    public static void MapUserEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/user", GetCurrentUser).WithName("GetCurrentUser");
        var authenticatedUser = api.MapGroup("/user")
            .RequireAuthorization(AuthenticationServiceExtensions.CurrentUserPolicy);
        authenticatedUser.MapGet("/avatar", GetCurrentUserAvatar).WithName("GetCurrentUserAvatar");
        authenticatedUser.MapPut("/homeCity", SetHomeCity).WithName("SetHomeCity");
    }

    private static async Task<IResult> GetCurrentUser(
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        AuthenticatedUserProfile? profile = currentUser.Profile;
        if (profile is null)
            return Results.Ok(new CurrentUserResponse(false, null, null, null, null, false, null));
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
            return Results.NotFound();
        using HttpResponseMessage? imageResponse = await GetProfileImageAsync(
            httpClientFactory.CreateClient(),
            profile.Provider,
            accessToken,
            context.RequestAborted
        );
        if (imageResponse is null || !imageResponse.IsSuccessStatusCode)
            return Results.NotFound();
        byte[] image = await imageResponse.Content.ReadAsByteArrayAsync(context.RequestAborted);
        context.Response.Headers.CacheControl = "private, max-age=300";
        return Results.File(
            image,
            imageResponse.Content.Headers.ContentType?.MediaType ?? "image/jpeg"
        );
    }

    private static async Task<IResult> SetHomeCity(
        SetHomeCityRequest request,
        HttpContext context,
        IPlannerDb database,
        ICurrentUser currentUser
    )
    {
        AuthenticatedUserProfile profile = currentUser.Profile!;
        var errors = new Dictionary<string, string[]>();
        string cityName = request.CityName.Trim();
        if (string.IsNullOrWhiteSpace(cityName))
            errors[nameof(request.CityName)] = ["CityName is required."];
        if (!double.IsFinite(request.Longitude) || request.Longitude is < -180 or > 180)
            errors[nameof(request.Longitude)] = ["Longitude must be between -180 and 180."];
        if (!double.IsFinite(request.Latitude) || request.Latitude is < -90 or > 90)
            errors[nameof(request.Latitude)] = ["Latitude must be between -90 and 90."];
        if (errors.Count > 0)
            return Results.ValidationProblem(errors);
        User user = await database.SetHomeCityAsync(
            profile,
            cityName,
            new GeographicPoint(request.Longitude, request.Latitude),
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
            return null;
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            "https://www.googleapis.com/oauth2/v3/userinfo"
        );
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using HttpResponseMessage response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
            return null;
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
            return null;
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
            user.HomeCityName
        );
}
