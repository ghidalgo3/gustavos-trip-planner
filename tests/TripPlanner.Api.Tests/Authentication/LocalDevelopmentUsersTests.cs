using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using TripPlanner.Api.Models;
using TripPlanner.Api.Tests.Support;

namespace TripPlanner.Api.Tests.Authentication;

[TestClass]
public class LocalDevelopmentUsersTests
{
    [TestMethod]
    public async Task DevelopmentSwitchSeedsAndSignsInTwoDistinctLocalAccounts()
    {
        await using var baseFactory = new TestApplicationFactory();
        await using var factory = baseFactory.WithWebHostBuilder(builder =>
            builder
                .UseSetting("Authentication:LocalUsersEnabled", "true")
                .ConfigureServices(services =>
                    services.PostConfigure<Microsoft.AspNetCore.Authentication.AuthenticationOptions>(
                        options =>
                            options.DefaultAuthenticateScheme =
                                CookieAuthenticationDefaults.AuthenticationScheme
                    )
                )
        );
        using var client = factory.CreateClient(
            new WebApplicationFactoryClientOptions
            {
                BaseAddress = new Uri("http://localhost:5173"),
                AllowAutoRedirect = false,
            }
        );

        Assert.HasCount(2, baseFactory.Database.Users);
        var userIds = new HashSet<Guid>();
        foreach (int number in new[] { 1, 2 })
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Get,
                $"/.auth/login/local-user-{number}"
            );
            request.Headers.Add("Sec-Fetch-Site", "same-origin");
            using var signIn = await client.SendAsync(request);
            Assert.AreEqual(HttpStatusCode.Redirect, signIn.StatusCode);

            var user = await client.GetFromJsonAsync<CurrentUserResponse>("/user");
            Assert.IsNotNull(user);
            Assert.IsTrue(user.IsAuthenticated);
            Assert.IsTrue(user.CompletedOnboarding);
            Assert.AreEqual($"Local user {number}", user.Name);
            Assert.AreEqual($"local-user-{number}@example.test", user.Email);
            Assert.IsTrue(userIds.Add(user.Id!.Value));
        }
        Assert.HasCount(2, baseFactory.Database.Users);
    }

    [TestMethod]
    [DataRow("Production", true, "localhost", "same-origin", 0)]
    [DataRow("Development", false, "localhost", "same-origin", 0)]
    [DataRow("Development", true, "localhost", "cross-site", 2)]
    [DataRow("Development", true, "example.test", "same-origin", 2)]
    public async Task LocalLoginRequiresDevelopmentOptInAndLocalNavigation(
        string environment,
        bool enabled,
        string host,
        string fetchSite,
        int expectedUsers
    )
    {
        await using var baseFactory = new TestApplicationFactory();
        await using var factory = baseFactory.WithWebHostBuilder(builder =>
            builder
                .UseEnvironment(environment)
                .UseSetting("Authentication:LocalUsersEnabled", enabled.ToString())
        );
        using var client = factory.CreateClient(
            new WebApplicationFactoryClientOptions
            {
                BaseAddress = new Uri($"http://{host}:5173"),
                AllowAutoRedirect = false,
            }
        );
        using var request = new HttpRequestMessage(HttpMethod.Get, "/.auth/login/local-user-1");
        request.Headers.Add("Sec-Fetch-Site", fetchSite);

        using var response = await client.SendAsync(request);

        Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.IsFalse(response.Headers.Contains("Set-Cookie"));
        Assert.HasCount(expectedUsers, baseFactory.Database.Users);
    }
}
