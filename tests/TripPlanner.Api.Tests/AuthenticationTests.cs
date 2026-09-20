using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace TripPlanner.Api.Tests;

[TestClass]
public class AuthenticationTests
{
    [TestMethod]
    public async Task User_WithoutPlatformHeader_IsAnonymous()
    {
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var user = await client.GetFromJsonAsync<UserResponse>("/api/user");

        Assert.IsNotNull(user);
        Assert.IsFalse(user.IsAuthenticated);
    }

    [TestMethod]
    public async Task User_WithPlatformHeader_ReturnsSafeProfile()
    {
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();
        const string principal = """
            {"auth_typ":"google","name_typ":"name","role_typ":"roles","claims":[{"typ":"name","val":"Ada Traveler"},{"typ":"email","val":"ada@example.com"}]}
            """;
        client.DefaultRequestHeaders.Add(
            "X-MS-CLIENT-PRINCIPAL",
            Convert.ToBase64String(Encoding.UTF8.GetBytes(principal))
        );

        var response = await client.GetAsync("/api/user");
        var user = await response.Content.ReadFromJsonAsync<UserResponse>();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsNotNull(user);
        Assert.IsTrue(user.IsAuthenticated);
        Assert.AreEqual("Ada Traveler", user.Name);
        Assert.AreEqual("ada@example.com", user.Email);
        Assert.AreEqual("google", user.Provider);
    }

    [TestMethod]
    public async Task LocalGoogleLogin_UsesDevelopmentCallbackWithoutOpenRedirect()
    {
        await using var baseFactory = new WebApplicationFactory<Program>();
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
        await using var baseFactory = new WebApplicationFactory<Program>();
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

    private sealed record UserResponse(
        bool IsAuthenticated,
        string? Name,
        string? Email,
        string? Provider
    );
}
