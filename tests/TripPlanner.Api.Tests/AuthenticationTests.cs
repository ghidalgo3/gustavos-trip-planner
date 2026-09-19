using System.Net;
using System.Net.Http.Json;
using System.Text;
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

    private sealed record UserResponse(
        bool IsAuthenticated,
        string? Name,
        string? Email,
        string? Provider
    );
}
