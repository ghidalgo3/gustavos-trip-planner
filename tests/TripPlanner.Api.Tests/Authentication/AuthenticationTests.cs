using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Flights;
using TripPlanner.Api.Services.Maps;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Authentication;

[TestClass]
public class AuthenticationTests
{
    [TestMethod]
    [DataRow("google")]
    [DataRow("aad")]
    public async Task SignIn_PersistsAcrossVisits_RenewsAndExpires_AndSignOutClearsCookie(
        string provider
    )
    {
        var clock = new AuthenticationClock();
        await using var baseFactory = new TestApplicationFactory();
        await using var factory = baseFactory.WithWebHostBuilder(builder =>
            builder.ConfigureServices(services =>
            {
                services.PostConfigure<Microsoft.AspNetCore.Authentication.AuthenticationOptions>(
                    options =>
                        options.DefaultAuthenticateScheme =
                            CookieAuthenticationDefaults.AuthenticationScheme
                );
                services.PostConfigure<CookieAuthenticationOptions>(
                    CookieAuthenticationDefaults.AuthenticationScheme,
                    options => options.TimeProvider = clock
                );
            })
        );
        using var client = factory.CreateClient(
            new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                HandleCookies = false,
            }
        );
        using var challenge = await client.GetAsync($"/.auth/login/{provider}");
        Assert.AreEqual(HttpStatusCode.Redirect, challenge.StatusCode);
        string state = QueryHelpers
            .ParseQuery(challenge.Headers.Location!.Query)["state"]
            .ToString();
        var properties =
            provider == "google"
                ? factory
                    .Services.GetRequiredService<IOptionsMonitor<GoogleOptions>>()
                    .Get("google")
                    .StateDataFormat.Unprotect(state)
                : factory
                    .Services.GetRequiredService<IOptionsMonitor<OpenIdConnectOptions>>()
                    .Get("aad")
                    .StateDataFormat.Unprotect(state);
        Assert.IsNotNull(properties);
        Assert.IsTrue(properties.IsPersistent);

        // Complete the provider sign-in with the properties carried through OAuth state.
        using var scope = factory.Services.CreateScope();
        var context = new DefaultHttpContext { RequestServices = scope.ServiceProvider };
        await context.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(
                new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, "returning-user"),
                        new Claim(ClaimTypes.Email, "returning@example.com"),
                        new Claim("provider", provider == "aad" ? "microsoft" : provider),
                    ],
                    CookieAuthenticationDefaults.AuthenticationScheme
                )
            ),
            properties
        );
        var cookie = SetCookieHeaderValue.Parse(context.Response.Headers.SetCookie.Single()!);
        Assert.AreEqual(clock.GetUtcNow().AddDays(30), cookie.Expires);
        Assert.IsTrue(cookie.HttpOnly);
        Assert.AreEqual(Microsoft.Net.Http.Headers.SameSiteMode.Lax, cookie.SameSite);

        // A fresh browser client can restore the user using only the persistent cookie.
        client.DefaultRequestHeaders.Add("Cookie", $"{cookie.Name}={cookie.Value}");
        clock.Advance(TimeSpan.FromDays(20));
        using var returning = await client.GetAsync("/user");
        var user = await returning.Content.ReadFromJsonAsync<UserResponse>();
        Assert.IsTrue(user!.IsAuthenticated);
        var renewed = SetCookieHeaderValue.Parse(
            returning.Headers.GetValues("Set-Cookie").Single()
        );
        Assert.AreEqual(clock.GetUtcNow().AddDays(30), renewed.Expires);

        client.DefaultRequestHeaders.Remove("Cookie");
        client.DefaultRequestHeaders.Add("Cookie", $"{renewed.Name}={renewed.Value}");
        clock.Advance(TimeSpan.FromDays(1));
        Assert.IsTrue((await client.GetFromJsonAsync<UserResponse>("/user"))!.IsAuthenticated);
        using var logout = await client.GetAsync("/.auth/logout");
        var deleted = SetCookieHeaderValue.Parse(logout.Headers.GetValues("Set-Cookie").Single());
        Assert.AreEqual("tripplanner.auth", deleted.Name.ToString());
        Assert.AreEqual(string.Empty, deleted.Value.ToString());
        Assert.IsTrue(deleted.Expires < clock.GetUtcNow());

        // Even a retained copy of the renewed cookie stops authenticating after expiry.
        clock.Advance(TimeSpan.FromDays(30));
        Assert.IsFalse((await client.GetFromJsonAsync<UserResponse>("/user"))!.IsAuthenticated);
        client.DefaultRequestHeaders.Remove("Cookie");
        Assert.IsFalse((await client.GetFromJsonAsync<UserResponse>("/user"))!.IsAuthenticated);
    }

    private sealed class AuthenticationClock : TimeProvider
    {
        private DateTimeOffset now = new(2030, 1, 1, 0, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => now;

        public void Advance(TimeSpan elapsed) => now += elapsed;
    }

    [TestMethod]
    [DataRow("/profile", "/profile")]
    [DataRow("//attacker.example", "http://localhost:5173/")]
    [DataRow("/\\attacker.example", "http://localhost:5173/")]
    [DataRow("/\n/attacker.example", "http://localhost:5173/")]
    [DataRow("https://attacker.example", "http://localhost:5173/")]
    public async Task LogoutRedirects_RejectBrowserNormalizedExternalTargets(
        string target,
        string expected
    )
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient(
            new WebApplicationFactoryClientOptions { AllowAutoRedirect = false }
        );
        using var response = await client.GetAsync(
            "/.auth/logout?post_logout_redirect_uri=" + Uri.EscapeDataString(target)
        );
        Assert.AreEqual(HttpStatusCode.Redirect, response.StatusCode);
        Assert.AreEqual(expected, response.Headers.Location!.ToString());
    }

    [TestMethod]
    public async Task User_WithoutPlatformHeader_IsAnonymous()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();

        var user = await client.GetFromJsonAsync<UserResponse>("/user");

        Assert.IsNotNull(user);
        Assert.IsFalse(user.IsAuthenticated);
    }

    [TestMethod]
    public async Task User_WithAuthenticatedSession_ReturnsSafeProfile()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddTestPrincipal(client, "google-ada-123", "Ada Traveler", "ada@example.com");

        var response = await client.GetAsync("/user");
        var user = await response.Content.ReadFromJsonAsync<UserResponse>();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsNotNull(user);
        Assert.IsTrue(user.IsAuthenticated);
        Assert.AreEqual("Ada Traveler", user.Name);
        Assert.AreEqual("ada@example.com", user.Email);
        Assert.AreEqual("google", user.Provider);
        Assert.IsFalse(user.CompletedOnboarding);
        Assert.AreNotEqual(Guid.Empty, user.Id);
        Assert.HasCount(1, factory.Database.Users);
        Assert.AreEqual("ada@example.com", factory.Database.Users.Single().Email);

        var repeatedUser = await client.GetFromJsonAsync<UserResponse>("/user");
        Assert.IsNotNull(repeatedUser);
        Assert.AreEqual(user.Id, repeatedUser.Id);
        Assert.HasCount(1, factory.Database.Users);
    }

    [TestMethod]
    public async Task User_WithSameEmailFromMultipleProviders_ReusesIdAndTracksProviders()
    {
        await using var factory = new TestApplicationFactory();
        using var googleClient = factory.CreateClient();
        AddTestPrincipal(googleClient, "google-ada-123", "Ada Traveler", "Ada@Example.com");

        var googleUser = await googleClient.GetFromJsonAsync<UserResponse>("/user");

        using var microsoftClient = factory.CreateClient();
        AddTestPrincipal(
            microsoftClient,
            "microsoft-ada-456",
            "Ada Traveler",
            "ada@example.com",
            "microsoft"
        );

        var microsoftUser = await microsoftClient.GetFromJsonAsync<UserResponse>("/user");

        Assert.IsNotNull(googleUser);
        Assert.IsNotNull(microsoftUser);
        Assert.AreEqual(googleUser.Id, microsoftUser.Id);
        Assert.AreEqual("ada@example.com", microsoftUser.Email);
        Assert.AreEqual("google,microsoft", microsoftUser.Provider);
        Assert.HasCount(1, factory.Database.Users);
        Assert.AreEqual("google,microsoft", factory.Database.Users.Single().Provider);
    }

    [TestMethod]
    public async Task AuthenticatedNonUserRequest_DoesNotCreateUser()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddTestPrincipal(client, "not-provisioned");

        var response = await client.GetAsync("/service");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsEmpty(factory.Database.Users);
    }

    [TestMethod]
    public async Task MapToken_RequiresAuthentication()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/mapToken");

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task UserAvatar_WithoutProviderToken_IsNotStoredOrReturned()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddGooglePrincipal(client);

        var response = await client.GetAsync("/user/avatar");

        Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.IsEmpty(factory.Database.Users);
    }

    [TestMethod]
    public async Task MapToken_ReturnsTheConfiguredAzureMapsToken()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddGooglePrincipal(client);

        var response = await client.GetAsync("/mapToken");
        var token = await response.Content.ReadFromJsonAsync<MapTokenResponse>();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.AreEqual("no-store", response.Headers.CacheControl?.ToString());
        Assert.IsNotNull(token);
        Assert.AreEqual("test-map-token", token.Token);
        Assert.AreEqual("https://atlas.example.test", token.Endpoint);
        Assert.AreEqual(DateTimeOffset.Parse("2030-01-01T02:00:00Z"), token.ExpiresAt);
    }

    [TestMethod]
    public async Task MapToken_RejectsExpiredConfiguredToken()
    {
        await using var factory = new TestApplicationFactory
        {
            MapTokenOverride = new MapToken(
                "expired-token",
                "https://atlas.example.test",
                DateTimeOffset.UtcNow.AddMinutes(-1)
            ),
        };
        using var client = factory.CreateClient();
        AddGooglePrincipal(client);

        var response = await client.GetAsync("/mapToken");

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.AreEqual("no-store", response.Headers.CacheControl?.ToString());
        Assert.Contains("expired", await response.Content.ReadAsStringAsync());
    }

    [TestMethod]
    public async Task SetHomeCity_CompletesOnboarding()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddGooglePrincipal(client);

        var response = await client.PutAsJsonAsync(
            "/user/profile",
            new
            {
                homeCity = new
                {
                    name = "Boston, Massachusetts, United States",
                    longitude = -71.0589,
                    latitude = 42.3601,
                },
                preferredAirlines = new[] { "DL", "AF" },
            }
        );
        var updatedUser = await response.Content.ReadFromJsonAsync<UserResponse>();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsNotNull(updatedUser);
        Assert.IsTrue(updatedUser.CompletedOnboarding);
        Assert.AreEqual("Boston, Massachusetts, United States", updatedUser.Profile.HomeCity?.Name);
        CollectionAssert.AreEqual(new[] { "DL", "AF" }, updatedUser.Profile.PreferredAirlines);
        Assert.AreEqual(-71.0589, factory.Database.Users.Single().HomeCityLocation?.Longitude);
        Assert.AreEqual(42.3601, factory.Database.Users.Single().HomeCityLocation?.Latitude);
    }

    [TestMethod]
    public async Task HomeAirport_RequiresChoiceForMultipleAirportsAndPersistsWholeProfile()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddGooglePrincipal(client);
        var city = new ProfileHomeCity("Tokyo", 139.69, 35.68);
        var missing = await client.PutAsJsonAsync("/user/profile", new UserProfile(city, []));
        Assert.AreEqual(HttpStatusCode.BadRequest, missing.StatusCode);
        var invalid = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(city, [], "ATL")
        );
        Assert.AreEqual(HttpStatusCode.BadRequest, invalid.StatusCode);
        var saved = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(city, ["NH"], "HND")
        );
        Assert.AreEqual(HttpStatusCode.OK, saved.StatusCode);
        var user = await saved.Content.ReadFromJsonAsync<CurrentUserResponse>();
        Assert.AreEqual("HND", user!.Profile.PreferredAirport);
        var catalog = new TripPlanner.Api.Services.Flights.AirportCatalog();
        CollectionAssert.AreEquivalent(
            new[] { "HND", "NRT" },
            catalog.SuggestOrigin([factory.Database.Users.Single()])!.AirportCodes.ToArray()
        );
    }

    [TestMethod]
    public async Task SetUserProfile_UpdatesCityAndAirlinesTogether()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddGooglePrincipal(client);

        var first = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Boston", -71, 42), ["DL"])
        );
        first.EnsureSuccessStatusCode();
        var updated = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Paris", 2.35, 48.86), ["af", "DL", "AF"], "CDG")
        );
        var response = await updated.Content.ReadFromJsonAsync<CurrentUserResponse>();

        Assert.AreEqual(HttpStatusCode.OK, updated.StatusCode);
        Assert.IsNotNull(response);
        Assert.AreEqual("Paris", response.Profile.HomeCity?.Name);
        CollectionAssert.AreEqual(new[] { "AF", "DL" }, response.Profile.PreferredAirlines);
        Assert.HasCount(1, factory.Database.Users);
        Assert.AreEqual(2.35, factory.Database.Users.Single().HomeCityLocation?.Longitude);
        CollectionAssert.AreEqual(
            new[] { "AF", "DL" },
            factory.Database.Users.Single().PreferredAirlines
        );
    }

    [TestMethod]
    public async Task SetUserProfile_RejectsInvalidAirlinesWithoutChangingCity()
    {
        await using var factory = new TestApplicationFactory();
        using var client = factory.CreateClient();
        AddGooglePrincipal(client);
        (
            await client.PutAsJsonAsync(
                "/user/profile",
                new UserProfile(new("Boston", -71, 42), ["DL"])
            )
        ).EnsureSuccessStatusCode();

        var response = await client.PutAsJsonAsync(
            "/user/profile",
            new UserProfile(new("Paris", 2.35, 48.86), ["TOOLONG"])
        );

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.AreEqual("Boston", factory.Database.Users.Single().HomeCityName);
        CollectionAssert.AreEqual(
            new[] { "DL" },
            factory.Database.Users.Single().PreferredAirlines
        );
    }

    [TestMethod]
    public async Task LocalGoogleLogin_UsesDevelopmentCallbackWithoutOpenRedirect()
    {
        await using var baseFactory = new TestApplicationFactory();
        await using var factory = baseFactory.WithWebHostBuilder(builder =>
            builder
                .UseSetting("Authentication:Google:ClientId", "google-client-id")
                .UseSetting("Authentication:Google:ClientSecret", "google-client-secret")
                .UseSetting("Authentication:Microsoft:ClientId", "microsoft-client-id")
                .UseSetting("Authentication:Microsoft:ClientSecret", "microsoft-client-secret")
        );
        using var client = factory.CreateClient(
            new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                BaseAddress = new Uri("http://localhost:5173"),
            }
        );

        var response = await client.GetAsync(
            "/.auth/login/google?post_login_redirect_uri=https://example.com/steal-session"
        );

        Assert.AreEqual(HttpStatusCode.Redirect, response.StatusCode);
        Assert.IsNotNull(response.Headers.Location);
        Assert.AreEqual("accounts.google.com", response.Headers.Location.Host);
        StringAssert.Contains(
            response.Headers.Location.Query,
            Uri.EscapeDataString("http://localhost:5173/.auth/callback/google")
        );
        AssertDevelopmentCorrelationCookie(response);
    }

    [TestMethod]
    public async Task LocalMicrosoftLogin_UsesQueryCallbackAndDevelopmentCookies()
    {
        await using var baseFactory = new TestApplicationFactory();
        await using var factory = baseFactory.WithWebHostBuilder(builder =>
            builder
                .UseSetting("Authentication:Google:ClientId", "google-client-id")
                .UseSetting("Authentication:Google:ClientSecret", "google-client-secret")
                .UseSetting("Authentication:Microsoft:ClientId", "microsoft-client-id")
                .UseSetting("Authentication:Microsoft:ClientSecret", "microsoft-client-secret")
        );
        using var client = factory.CreateClient(
            new WebApplicationFactoryClientOptions
            {
                AllowAutoRedirect = false,
                BaseAddress = new Uri("http://localhost:5173"),
            }
        );

        var response = await client.GetAsync("/.auth/login/aad");

        Assert.AreEqual(HttpStatusCode.Redirect, response.StatusCode);
        Assert.IsNotNull(response.Headers.Location);
        Assert.AreEqual("login.microsoftonline.com", response.Headers.Location.Host);
        StringAssert.Contains(
            response.Headers.Location.Query,
            Uri.EscapeDataString("http://localhost:5173/.auth/callback/microsoft")
        );
        Assert.IsFalse(
            response.Headers.Location.Query.Contains(
                "response_mode=form_post",
                StringComparison.Ordinal
            )
        );
        AssertDevelopmentCorrelationCookie(response);
    }

    private static void AssertDevelopmentCorrelationCookie(HttpResponseMessage response)
    {
        Assert.IsTrue(response.Headers.TryGetValues("Set-Cookie", out var cookies));
        string correlationCookie = cookies.Single(cookie =>
            cookie.StartsWith(".AspNetCore.Correlation.", StringComparison.Ordinal)
        );
        StringAssert.Contains(correlationCookie, "samesite=lax");
        Assert.IsFalse(correlationCookie.Contains("secure", StringComparison.OrdinalIgnoreCase));
    }

    private static void AddGooglePrincipal(HttpClient client)
    {
        AddTestPrincipal(client, "google-map-user", "Map User", "map-user@example.com");
    }

    private static void AddTestPrincipal(
        HttpClient client,
        string subject,
        string? name = null,
        string? email = null,
        string provider = "google"
    )
    {
        client.DefaultRequestHeaders.Add("X-Test-Subject", subject);
        client.DefaultRequestHeaders.Add("X-Test-Provider", provider);
        if (name is not null)
        {
            client.DefaultRequestHeaders.Add("X-Test-Name", name);
        }
        if (email is not null)
        {
            client.DefaultRequestHeaders.Add("X-Test-Email", email);
        }
    }

    private sealed record UserResponse(
        bool IsAuthenticated,
        Guid? Id,
        string? Name,
        string? Email,
        string? Provider,
        bool CompletedOnboarding,
        UserProfile Profile
    );

    private sealed record MapTokenResponse(string Token, string Endpoint, DateTimeOffset ExpiresAt);
}
